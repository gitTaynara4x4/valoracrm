from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

PROJECT_DIR = Path(__file__).resolve().parent.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from sqlalchemy import text  # noqa: E402

# Reaproveita exatamente a conciliação de clientes que já foi homologada na Etapa 1.
from conciliar_clientes_jcc import (  # noqa: E402
    CURATED_LINKS,
    CURATED_SAFE_NEW,
    CURATED_SAFE_NEW_CONFLICTING_DOCUMENT,
    CURATED_SAFE_NEW_NO_DOCUMENT,
    JccClient,
    ValoraClient,
    curated_identity_key,
    load_source,
    load_valora_clients,
    normalize_name,
    only_digits,
    source_key_for_title_row,
    valid_document,
)

DEFAULT_SOURCE = PROJECT_DIR / "imports" / "jcc_contas_receber_202008.csv"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "imports" / "saida"
ORIGIN_TYPE = "jcc_contas_receber_202008"
COMPETENCIA = date(2020, 7, 1)
EXPECTED_TITLE_COUNT = 221
EXPECTED_TOTAL = Decimal("31272.60")
EXPECTED_PAID = Decimal("30870.60")
EXPECTED_OPEN = Decimal("402.00")
CENT = Decimal("0.01")


@dataclass
class ClientResolution:
    source_key: str
    jcc_name: str
    jcc_document: str
    valora_id: Optional[int]
    valora_code: str
    valora_name: str
    reason: str
    status: str


@dataclass
class TitlePreview:
    linha: int
    origem_codigo: str
    cliente_jcc: str
    cpf_cnpj_jcc: str
    cliente_id_valora: Optional[int]
    cliente_codigo_valora: str
    cliente_nome_valora: str
    nota: str
    documento: str
    vencimento: str
    valor_total: Decimal
    data_pagamento: str
    valor_pago: Decimal
    situacao_jcc: str
    status_valora: str
    acao: str
    motivo: str
    lancamento_existente_id: Optional[int] = None


def money(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value.quantize(CENT, rounding=ROUND_HALF_UP)
    if isinstance(value, (int, float)):
        return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)
    raw = str(value or "0").strip()
    # Fonte JCC vem em pt-BR (1.234,56); o PostgreSQL/SQLAlchemy devolve
    # Decimal em formato 1234.56. Só removemos ponto quando existe vírgula.
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return Decimal(raw or "0").quantize(CENT, rounding=ROUND_HALF_UP)
    except Exception as exc:
        raise ValueError(f"Valor monetário inválido: {value!r}") from exc


def parse_date_br(value: object) -> Optional[date]:
    raw = str(value or "").strip()
    if not raw:
        return None
    return datetime.strptime(raw, "%d/%m/%Y").date()


def stable_origin_code(row: dict) -> str:
    canonical = "|".join([
        normalize_name(row.get("cliente")),
        only_digits(row.get("cpf_cnpj")) if valid_document(row.get("cpf_cnpj")) else "",
        str(row.get("nota") or "").strip().upper(),
        str(row.get("documento") or "").strip().upper(),
        str(row.get("vencimento") or "").strip(),
        f"{money(row.get('valor_total')):.2f}",
        str(row.get("data_pagamento") or "").strip(),
        f"{money(row.get('valor_pago')):.2f}",
        str(row.get("situacao_jcc") or "").strip().upper(),
        str(row.get("historico") or "").strip(),
    ])
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
    return f"JCCAR202008-{digest}"


def title_status(row: dict) -> str:
    situacao = str(row.get("situacao_jcc") or "").strip().upper()
    total = money(row.get("valor_total"))
    paid = money(row.get("valor_pago"))
    if situacao == "QUITADO":
        if paid <= 0:
            raise ValueError("Título QUITADO sem valor pago.")
        return "recebido"
    if situacao == "A RECEBER":
        # O relatório é de 2020. Preservamos a situação operacional do JCC,
        # mesmo nos sete títulos de valor zero que aparecem como A RECEBER.
        return "vencido"
    if total > 0 and paid >= total:
        return "recebido"
    return "vencido"


def build_indexes(clients: Sequence[ValoraClient]):
    by_id = {c.id: c for c in clients}
    by_doc: Dict[str, List[ValoraClient]] = defaultdict(list)
    by_name: Dict[str, List[ValoraClient]] = defaultdict(list)
    for c in clients:
        if valid_document(c.cpf_cnpj):
            by_doc[c.normalized_document].append(c)
        for n in set(c.names):
            by_name[n].append(c)
    return by_id, by_doc, by_name


def resolve_clients(
    jcc_clients: Sequence[JccClient],
    valora_clients: Sequence[ValoraClient],
) -> Dict[str, ClientResolution]:
    by_id, by_doc, by_name = build_indexes(valora_clients)
    result: Dict[str, ClientResolution] = {}

    for j in jcc_clients:
        key = curated_identity_key(j)
        chosen: Optional[ValoraClient] = None
        reason = ""

        # Vínculos manuais já validados na Etapa 1 têm prioridade absoluta.
        if key in CURATED_LINKS:
            chosen = by_id.get(CURATED_LINKS[key])
            reason = "Vínculo homologado na conciliação JCC/Valora."
            if chosen is None:
                result[j.source_key] = ClientResolution(
                    j.source_key, j.name, j.cpf_cnpj, None, "", "",
                    f"Cliente homologado #{CURATED_LINKS[key]} não existe mais no banco.",
                    "ERRO_CLIENTE_NAO_RESOLVIDO",
                )
                continue

        # Cliente histórico com documento conflitante foi criado SEM CPF/CNPJ.
        elif key in CURATED_SAFE_NEW_CONFLICTING_DOCUMENT:
            exact = [c for c in by_name.get(j.normalized_name, []) if not valid_document(c.cpf_cnpj)]
            if len(exact) == 1:
                chosen = exact[0]
                reason = "Cliente histórico sem CPF/CNPJ localizado pelo nome exato."
            else:
                result[j.source_key] = ClientResolution(
                    j.source_key, j.name, j.cpf_cnpj, None, "", "",
                    f"Esperado 1 cliente histórico sem documento; encontrados {len(exact)}.",
                    "ERRO_CLIENTE_NAO_RESOLVIDO",
                )
                continue

        # Os clientes aprovados como novos já foram criados pela Etapa 1.
        elif key in CURATED_SAFE_NEW or key in CURATED_SAFE_NEW_NO_DOCUMENT:
            if j.valid_document:
                candidates = by_doc.get(j.normalized_document, [])
                if len(candidates) == 1:
                    chosen = candidates[0]
                    reason = "Cliente criado na Etapa 1 localizado pelo CPF/CNPJ."
                elif len(candidates) > 1:
                    exact = [c for c in candidates if j.normalized_name in c.names]
                    if len(exact) == 1:
                        chosen = exact[0]
                        reason = "Cliente criado na Etapa 1 localizado por CPF/CNPJ + nome."
            else:
                candidates = by_name.get(j.normalized_name, [])
                if len(candidates) == 1:
                    chosen = candidates[0]
                    reason = "Cliente criado na Etapa 1 localizado pelo nome exato."
            if chosen is None:
                result[j.source_key] = ClientResolution(
                    j.source_key, j.name, j.cpf_cnpj, None, "", "",
                    "Cliente aprovado/criado na Etapa 1 não pôde ser localizado de forma inequívoca.",
                    "ERRO_CLIENTE_NAO_RESOLVIDO",
                )
                continue

        else:
            # Demais casos: primeiro documento, depois nome exato.
            if j.valid_document:
                candidates = by_doc.get(j.normalized_document, [])
                if len(candidates) == 1:
                    chosen = candidates[0]
                    reason = "CPF/CNPJ único no Valora."
                elif len(candidates) > 1:
                    exact = [c for c in candidates if j.normalized_name in c.names]
                    if len(exact) == 1:
                        chosen = exact[0]
                        reason = "CPF/CNPJ + nome exato no Valora."
            if chosen is None:
                candidates = by_name.get(j.normalized_name, [])
                if len(candidates) == 1:
                    c = candidates[0]
                    current_doc = c.normalized_document if valid_document(c.cpf_cnpj) else ""
                    if not j.valid_document or not current_doc or current_doc == j.normalized_document:
                        chosen = c
                        reason = "Nome exato único no Valora."

            if chosen is None:
                result[j.source_key] = ClientResolution(
                    j.source_key, j.name, j.cpf_cnpj, None, "", "",
                    "Cliente não pôde ser resolvido de forma inequívoca após a Etapa 1.",
                    "ERRO_CLIENTE_NAO_RESOLVIDO",
                )
                continue

        result[j.source_key] = ClientResolution(
            source_key=j.source_key,
            jcc_name=j.name,
            jcc_document=j.cpf_cnpj,
            valora_id=chosen.id,
            valora_code=chosen.code,
            valora_name=chosen.name,
            reason=reason,
            status="OK",
        )

    return result


def existing_imported_title(db, empresa_id: int, origin_code: str):
    return db.execute(text("""
        SELECT id, cliente_id, documento, data_vencimento, valor_total, valor_pago, status
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id
          AND origem_tipo=:origem_tipo
          AND origem_codigo=:origem_codigo
        ORDER BY id
        LIMIT 1
    """), {
        "empresa_id": empresa_id,
        "origem_tipo": ORIGIN_TYPE,
        "origem_codigo": origin_code,
    }).mappings().first()


def possible_existing_title(
    db,
    empresa_id: int,
    *,
    cliente_id: int,
    documento: str,
    vencimento: date,
    valor_total: Decimal,
):
    return db.execute(text("""
        SELECT id, origem_tipo, origem_codigo, status, valor_pago, data_pagamento, descricao
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id
          AND tipo='receber'
          AND cliente_id=:cliente_id
          AND UPPER(TRIM(COALESCE(documento,'')))=:documento
          AND data_vencimento=:vencimento
          AND ROUND(valor_total::numeric, 2)=:valor_total
          AND COALESCE(origem_tipo,'') <> :origem_tipo
        ORDER BY id
        LIMIT 1
    """), {
        "empresa_id": empresa_id,
        "cliente_id": cliente_id,
        "documento": documento.strip().upper(),
        "vencimento": vencimento,
        "valor_total": valor_total,
        "origem_tipo": ORIGIN_TYPE,
    }).mappings().first()


def build_preview(db, empresa_id: int, rows: Sequence[dict], resolutions: Dict[str, ClientResolution]) -> List[TitlePreview]:
    previews: List[TitlePreview] = []
    seen_origin_codes = set()

    for idx, row in enumerate(rows, start=1):
        key = source_key_for_title_row(row)
        resolution = resolutions.get(key)
        origin_code = stable_origin_code(row)
        total = money(row.get("valor_total"))
        paid = money(row.get("valor_pago"))
        venc = parse_date_br(row.get("vencimento"))
        pagamento = parse_date_br(row.get("data_pagamento"))
        situacao = str(row.get("situacao_jcc") or "").strip().upper()
        documento = str(row.get("documento") or "").strip()
        nota = str(row.get("nota") or "").strip()

        base = dict(
            linha=idx,
            origem_codigo=origin_code,
            cliente_jcc=str(row.get("cliente") or "").strip(),
            cpf_cnpj_jcc=str(row.get("cpf_cnpj") or "").strip(),
            cliente_id_valora=resolution.valora_id if resolution else None,
            cliente_codigo_valora=resolution.valora_code if resolution else "",
            cliente_nome_valora=resolution.valora_name if resolution else "",
            nota=nota,
            documento=documento,
            vencimento=venc.isoformat() if venc else "",
            valor_total=total,
            data_pagamento=pagamento.isoformat() if pagamento else "",
            valor_pago=paid,
            situacao_jcc=situacao,
            status_valora="",
        )

        if origin_code in seen_origin_codes:
            previews.append(TitlePreview(**base, acao="ERRO_ORIGEM_DUPLICADA", motivo="Duas linhas da fonte geraram a mesma chave de importação."))
            continue
        seen_origin_codes.add(origin_code)

        if resolution is None or resolution.status != "OK" or not resolution.valora_id:
            previews.append(TitlePreview(**base, acao="ERRO_CLIENTE_NAO_RESOLVIDO", motivo=resolution.reason if resolution else "Identidade JCC não encontrada na conciliação."))
            continue
        if venc is None:
            previews.append(TitlePreview(**base, acao="ERRO_DADOS_FONTE", motivo="Vencimento ausente ou inválido."))
            continue
        if total < 0 or paid < 0 or paid > total:
            previews.append(TitlePreview(**base, acao="ERRO_DADOS_FONTE", motivo=f"Valores incoerentes: total={total}, pago={paid}."))
            continue
        if situacao == "QUITADO" and (paid <= 0 or pagamento is None):
            previews.append(TitlePreview(**base, acao="ERRO_DADOS_FONTE", motivo="QUITADO precisa ter valor e data de pagamento."))
            continue
        if situacao == "A RECEBER" and paid != 0:
            previews.append(TitlePreview(**base, acao="ERRO_DADOS_FONTE", motivo="A RECEBER veio com valor pago diferente de zero."))
            continue

        try:
            status = title_status(row)
        except Exception as exc:
            previews.append(TitlePreview(**base, acao="ERRO_DADOS_FONTE", motivo=str(exc)))
            continue
        base["status_valora"] = status

        imported = existing_imported_title(db, empresa_id, origin_code)
        if imported:
            previews.append(TitlePreview(
                **base,
                acao="JA_IMPORTADO",
                motivo="Título JCC já existe pela mesma chave de origem; será ignorado.",
                lancamento_existente_id=int(imported["id"]),
            ))
            continue

        possible = possible_existing_title(
            db,
            empresa_id,
            cliente_id=int(resolution.valora_id),
            documento=documento,
            vencimento=venc,
            valor_total=total,
        )
        if possible:
            previews.append(TitlePreview(
                **base,
                acao="POSSIVEL_DUPLICADO_EXISTENTE",
                motivo=(
                    f"Já existe título #{possible['id']} para o mesmo cliente/documento/vencimento/valor, "
                    f"mas sem origem JCC. Revisão necessária antes de importar."
                ),
                lancamento_existente_id=int(possible["id"]),
            ))
            continue

        previews.append(TitlePreview(**base, acao="PRONTO_IMPORTAR", motivo="Título pronto para importação histórica."))

    return previews


def build_description(row: dict) -> str:
    historical = " ".join(str(row.get("historico") or "").split())
    if historical:
        return historical[:240]
    return "Importação histórica JCC - Contas a Receber 07/2020"[:240]


def build_observations(row: dict) -> str:
    parts = [
        "IMPORTAÇÃO HISTÓRICA JCC — Contas a Receber (base entregue em 21/08/2026).",
        f"Cliente no JCC: {str(row.get('cliente') or '').strip()}.",
        f"CPF/CNPJ no JCC: {str(row.get('cpf_cnpj') or '').strip() or 'não informado'}.",
        f"Situação no JCC: {str(row.get('situacao_jcc') or '').strip() or 'não informada'}.",
        f"Centro de Custo JCC: {str(row.get('centro_custo_jcc') or '').strip() or 'não informado'}.",
        f"Plano de Contas JCC: {str(row.get('pl_contas_jcc') or '').strip() or 'não informado'}.",
        "A data de emissão não constava no relatório; o campo técnico do Valora foi preenchido com a competência 01/07/2020.",
    ]
    hist = " ".join(str(row.get("historico") or "").split())
    if hist:
        parts.append(f"Histórico JCC: {hist}")
    if str(row.get("situacao_jcc") or "").strip().upper() == "QUITADO":
        parts.append(
            "Pagamento histórico preservado diretamente no título (valor_pago/data_pagamento); "
            "nenhuma movimentação financeira foi criada para não alterar Caixa, Conta Corrente ou saldo atual do Valora."
        )
    return " ".join(parts)


def insert_title(db, empresa_id: int, row: dict, preview: TitlePreview) -> int:
    venc = parse_date_br(row.get("vencimento"))
    pagamento = parse_date_br(row.get("data_pagamento"))
    total = money(row.get("valor_total"))
    paid = money(row.get("valor_pago"))

    lanc_id = db.execute(text("""
        INSERT INTO public.financeiro_lancamentos (
            empresa_id, tipo, descricao, moeda, valor_total, valor_pago,
            data_emissao, data_vencimento, data_pagamento, status,
            cliente_id, documento, observacoes,
            nota_fiscal_numero, origem_tipo, origem_codigo, competencia,
            criado_em, atualizado_em
        ) VALUES (
            :empresa_id, 'receber', :descricao, 'BRL', :valor_total, :valor_pago,
            :data_emissao, :data_vencimento, :data_pagamento, :status,
            :cliente_id, :documento, :observacoes,
            :nota, :origem_tipo, :origem_codigo, :competencia,
            NOW(), NOW()
        )
        RETURNING id
    """), {
        "empresa_id": empresa_id,
        "descricao": build_description(row),
        "valor_total": total,
        "valor_pago": paid,
        "data_emissao": COMPETENCIA,
        "data_vencimento": venc,
        "data_pagamento": pagamento if paid > 0 else None,
        "status": preview.status_valora,
        "cliente_id": int(preview.cliente_id_valora),
        "documento": preview.documento or None,
        "observacoes": build_observations(row),
        "nota": preview.nota or None,
        "origem_tipo": ORIGIN_TYPE,
        "origem_codigo": preview.origem_codigo,
        "competencia": COMPETENCIA,
    }).scalar_one()

    # IMPORTANTE: títulos quitados do JCC são históricos de 2020.
    # Preservamos valor_pago/data_pagamento/status no próprio lançamento, mas NÃO
    # criamos financeiro_movimentacoes. O saldo consolidado atual do Valora soma
    # todas as movimentações financeiras, inclusive as sem conta_banco_id; criar
    # baixas aqui adicionaria indevidamente R$ 30.870,60 ao saldo atual.


    return int(lanc_id)


def write_preview_report(output_dir: Path, empresa_id: int, previews: Sequence[TitlePreview]) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = output_dir / f"jcc_contas_receber_PREVIA_empresa_{empresa_id}_{stamp}.csv"
    json_path = output_dir / f"jcc_contas_receber_PREVIA_empresa_{empresa_id}_{stamp}.json"

    fields = list(asdict(previews[0]).keys()) if previews else []
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for item in previews:
            row = asdict(item)
            row["valor_total"] = f"{item.valor_total:.2f}".replace(".", ",")
            row["valor_pago"] = f"{item.valor_pago:.2f}".replace(".", ",")
            writer.writerow(row)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "empresa_id": empresa_id,
        "origin_type": ORIGIN_TYPE,
        "counts": dict(sorted(Counter(x.acao for x in previews).items())),
        "titles": len(previews),
        "total": str(sum((x.valor_total for x in previews), Decimal("0")).quantize(CENT)),
        "paid": str(sum((x.valor_pago for x in previews), Decimal("0")).quantize(CENT)),
        "open": str(sum((max(Decimal("0"), x.valor_total - x.valor_pago) for x in previews), Decimal("0")).quantize(CENT)),
        "items": [
            {**asdict(x), "valor_total": str(x.valor_total), "valor_pago": str(x.valor_pago)}
            for x in previews
        ],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return csv_path, json_path


def source_totals(rows: Sequence[dict]) -> Tuple[Decimal, Decimal, Decimal]:
    total = sum((money(r.get("valor_total")) for r in rows), Decimal("0")).quantize(CENT)
    paid = sum((money(r.get("valor_pago")) for r in rows), Decimal("0")).quantize(CENT)
    return total, paid, (total - paid).quantize(CENT)


def verify_import(db, empresa_id: int) -> dict:
    titles = db.execute(text("""
        SELECT COUNT(*) AS qtd,
               COALESCE(SUM(valor_total),0) AS total,
               COALESCE(SUM(valor_pago),0) AS pago,
               COALESCE(SUM(GREATEST(valor_total-valor_pago,0)),0) AS saldo,
               COUNT(*) FILTER (WHERE status='recebido') AS recebidos,
               COUNT(*) FILTER (WHERE status IN ('aberto','vencido','parcial')) AS abertos
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id AND origem_tipo=:origem_tipo
    """), {"empresa_id": empresa_id, "origem_tipo": ORIGIN_TYPE}).mappings().one()
    movs = db.execute(text("""
        SELECT COUNT(*) AS qtd,
               COALESCE(SUM(m.valor_principal),0) AS total_principal,
               COUNT(*) FILTER (WHERE m.conta_banco_id IS NOT NULL) AS com_conta_banco
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id=m.lancamento_id AND l.empresa_id=m.empresa_id
        WHERE l.empresa_id=:empresa_id
          AND l.origem_tipo=:origem_tipo
    """), {"empresa_id": empresa_id, "origem_tipo": ORIGIN_TYPE}).mappings().one()
    return {
        "titulos": int(titles["qtd"] or 0),
        "total": money(titles["total"]),
        "pago": money(titles["pago"]),
        "saldo": money(titles["saldo"]),
        "recebidos": int(titles["recebidos"] or 0),
        "abertos": int(titles["abertos"] or 0),
        "movimentacoes_historicas": int(movs["qtd"] or 0),
        "movimentacoes_total_principal": money(movs["total_principal"]),
        "movimentacoes_com_conta_banco": int(movs["com_conta_banco"] or 0),
    }


def print_money(value: Decimal) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def print_preview_summary(previews: Sequence[TitlePreview], resolutions: Dict[str, ClientResolution]) -> None:
    counts = Counter(x.acao for x in previews)
    clients_bad = sum(1 for x in resolutions.values() if x.status != "OK")
    total = sum((x.valor_total for x in previews), Decimal("0")).quantize(CENT)
    paid = sum((x.valor_pago for x in previews), Decimal("0")).quantize(CENT)
    saldo = sum((max(Decimal("0"), x.valor_total - x.valor_pago) for x in previews), Decimal("0")).quantize(CENT)
    quitados = sum(1 for x in previews if x.situacao_jcc == "QUITADO")
    receber = sum(1 for x in previews if x.situacao_jcc == "A RECEBER")

    print("\n[Valora/JCC] PRÉVIA — CONTAS A RECEBER")
    print(f"Clientes JCC resolvidos: {len(resolutions) - clients_bad}/{len(resolutions)}")
    print(f"Títulos da fonte: {len(previews)}")
    print(f"  QUITADO no JCC: {quitados}")
    print(f"  A RECEBER no JCC: {receber}")
    print(f"Total: {print_money(total)}")
    print(f"Pago histórico: {print_money(paid)}")
    print(f"Saldo histórico: {print_money(saldo)}")
    print("\nAções:")
    for key, value in sorted(counts.items()):
        print(f"  {key}: {value}")


def ensure_source_closure(rows: Sequence[dict]) -> None:
    total, paid, saldo = source_totals(rows)
    if len(rows) != EXPECTED_TITLE_COUNT or total != EXPECTED_TOTAL or paid != EXPECTED_PAID or saldo != EXPECTED_OPEN:
        raise RuntimeError(
            "A fonte não fecha com o JCC homologado: "
            f"qtd={len(rows)}, total={total}, pago={paid}, saldo={saldo}."
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Importa a base histórica JCC para Contas a Receber do Valora sem duplicar e sem criar movimentações financeiras que alterem o saldo atual."
    )
    parser.add_argument("--empresa-id", type=int, default=2, help="Empresa do Valora. Padrão: 2.")
    parser.add_argument("--arquivo", type=Path, default=DEFAULT_SOURCE, help="CSV normalizado da base JCC.")
    parser.add_argument("--saida", type=Path, default=DEFAULT_OUTPUT_DIR, help="Pasta dos relatórios de prévia.")
    parser.add_argument("--aplicar", action="store_true", help="Grava os títulos aprovados pela prévia.")
    parser.add_argument(
        "--desfazer",
        action="store_true",
        help="Remove SOMENTE os lançamentos desta importação JCC. Não combina com --aplicar.",
    )
    args = parser.parse_args()

    if args.aplicar and args.desfazer:
        print("ERRO: use --aplicar ou --desfazer, nunca os dois juntos.")
        return 2

    rows, jcc_clients = load_source(args.arquivo)
    ensure_source_closure(rows)

    from backend.database import SessionLocal  # noqa: E402

    db = SessionLocal()
    try:
        company = db.execute(text("SELECT id, nome FROM public.empresas WHERE id=:id"), {"id": args.empresa_id}).mappings().first()
        if not company:
            print(f"ERRO: empresa_id={args.empresa_id} não existe.")
            return 2
        print(f"[Valora] Empresa: #{company['id']} — {company['nome']}")

        # Impede duas importações concorrentes da mesma empresa nesta transação.
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": 2020080000 + int(args.empresa_id)})

        if args.desfazer:
            before = verify_import(db, args.empresa_id)
            if before["titulos"] == 0:
                db.rollback()
                print("[Valora/JCC] Nenhum título desta importação existe para desfazer.")
                return 0
            db.execute(text("""
                DELETE FROM public.financeiro_lancamentos
                WHERE empresa_id=:empresa_id AND origem_tipo=:origem_tipo
            """), {"empresa_id": args.empresa_id, "origem_tipo": ORIGIN_TYPE})
            db.commit()
            print(f"[Valora/JCC] Importação histórica removida: {before['titulos']} títulos.")
            return 0

        valora_clients = load_valora_clients(db, args.empresa_id)
        resolutions = resolve_clients(jcc_clients, valora_clients)
        previews = build_preview(db, args.empresa_id, rows, resolutions)
        print_preview_summary(previews, resolutions)
        csv_path, json_path = write_preview_report(args.saida, args.empresa_id, previews)
        print(f"\nRelatório CSV: {csv_path}")
        print(f"Relatório JSON: {json_path}")

        blockers = [x for x in previews if x.acao.startswith("ERRO_") or x.acao == "POSSIVEL_DUPLICADO_EXISTENTE"]
        if blockers:
            db.rollback()
            print(f"\nIMPORTAÇÃO BLOQUEADA: {len(blockers)} título(s) precisam de revisão.")
            print("Nada foi gravado. Envie o CSV da prévia antes de usar --aplicar.")
            return 3

        if not args.aplicar:
            db.rollback()
            print("\nMODO PRÉVIA: nada foi gravado no banco.")
            print("Se aparecerem somente PRONTO_IMPORTAR e/ou JA_IMPORTADO, a aplicação está segura.")
            return 0

        ready = [x for x in previews if x.acao == "PRONTO_IMPORTAR"]
        if not ready:
            db.rollback()
            print("\nNada novo para importar. Todos os títulos já estavam registrados com a origem JCC.")
            check = verify_import(db, args.empresa_id)
            print(f"Títulos JCC existentes: {check['titulos']}")
            return 0

        by_origin = {stable_origin_code(row): row for row in rows}
        inserted_ids: List[int] = []
        for item in ready:
            row = by_origin[item.origem_codigo]
            inserted_ids.append(insert_title(db, args.empresa_id, row, item))

        # Verificação ainda dentro da mesma transação: se qualquer total divergir,
        # nada da importação é confirmado.
        check = verify_import(db, args.empresa_id)
        expected_count_after = sum(1 for x in previews if x.acao in {"PRONTO_IMPORTAR", "JA_IMPORTADO"})
        expected_total = sum((x.valor_total for x in previews if x.acao in {"PRONTO_IMPORTAR", "JA_IMPORTADO"}), Decimal("0")).quantize(CENT)
        expected_paid = sum((x.valor_pago for x in previews if x.acao in {"PRONTO_IMPORTAR", "JA_IMPORTADO"}), Decimal("0")).quantize(CENT)
        expected_open = (expected_total - expected_paid).quantize(CENT)

        failures = []
        if check["titulos"] != expected_count_after:
            failures.append(f"qtd banco={check['titulos']} esperado={expected_count_after}")
        if check["total"] != expected_total:
            failures.append(f"total banco={check['total']} esperado={expected_total}")
        if check["pago"] != expected_paid:
            failures.append(f"pago banco={check['pago']} esperado={expected_paid}")
        if check["saldo"] != expected_open:
            failures.append(f"saldo banco={check['saldo']} esperado={expected_open}")
        # Esta importação é um retrato histórico. Não pode existir NENHUMA
        # financeiro_movimentacoes ligada aos títulos importados, pois o saldo atual
        # consolidado do Valora considera essas movimentações mesmo sem conta bancária.
        if check["movimentacoes_historicas"] != 0:
            failures.append(
                f"foram encontradas {check['movimentacoes_historicas']} movimentação(ões) financeira(s) "
                "nos títulos históricos; esperado=0"
            )

        # Quando a base toda está presente, exigimos o fechamento exato do PDF/JCC.
        if expected_count_after == EXPECTED_TITLE_COUNT:
            if check["titulos"] != EXPECTED_TITLE_COUNT:
                failures.append("não há 221 títulos no fechamento final")
            if check["total"] != EXPECTED_TOTAL or check["pago"] != EXPECTED_PAID or check["saldo"] != EXPECTED_OPEN:
                failures.append("totais finais não batem com R$31.272,60 / R$30.870,60 / R$402,00")
            if check["recebidos"] != 210:
                failures.append(f"títulos recebidos={check['recebidos']} esperado=210")
            if check["abertos"] != 11:
                failures.append(f"títulos em aberto/vencidos={check['abertos']} esperado=11")
            if check["movimentacoes_historicas"] != 0:
                failures.append(
                    f"movimentações financeiras históricas={check['movimentacoes_historicas']} esperado=0"
                )

        if failures:
            db.rollback()
            print("\nERRO DE HOMOLOGAÇÃO: a transação foi revertida.")
            for fail in failures:
                print(f"  - {fail}")
            return 4

        db.commit()
        print("\n[Valora/JCC] IMPORTAÇÃO CONCLUÍDA")
        print(f"Títulos inseridos nesta execução: {len(inserted_ids)}")
        print(f"Títulos JCC no Valora: {check['titulos']}")
        print(f"Total: {print_money(check['total'])}")
        print(f"Pago histórico: {print_money(check['pago'])}")
        print(f"Saldo a receber: {print_money(check['saldo'])}")
        print(f"Títulos recebidos históricos: {check['recebidos']}")
        print(f"Títulos em aberto/vencidos: {check['abertos']}")
        print(f"Movimentações financeiras criadas: {check['movimentacoes_historicas']}")
        print("Caixa/Conta Corrente/saldo atual: NÃO movimentados pela importação.")
        return 0

    except Exception as exc:
        db.rollback()
        print(f"ERRO: {type(exc).__name__}: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
