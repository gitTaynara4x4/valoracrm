from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

PROJECT_DIR = Path(__file__).resolve().parent.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from sqlalchemy import text  # noqa: E402

# Reaproveita a conciliação de fornecedores homologada na Etapa 1.
from conciliar_fornecedores_jcc import (  # noqa: E402
    JccSupplier,
    Decision,
    load_source,
    load_valora_suppliers,
    normalize_name,
    normalize_spaces,
    reconcile,
)

DEFAULT_SOURCE = PROJECT_DIR / "imports" / "jcc_contas_pagar_detalhado_202008_202608.csv"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "imports" / "saida"
ORIGIN_TYPE = "jcc_contas_pagar_abertos_202008_202608"
EXPECTED_TITLE_COUNT = 1261
EXPECTED_TOTAL = Decimal("757870.78")
EXPECTED_SUPPLIERS = 84
CENT = Decimal("0.01")


@dataclass
class SupplierResolution:
    source_key: str
    jcc_name: str
    valora_id: Optional[int]
    valora_code: str
    valora_name: str
    status: str
    reason: str


@dataclass
class TitlePreview:
    linha_jcc: int
    origem_codigo: str
    fornecedor_jcc: str
    fornecedor_id_valora: Optional[int]
    fornecedor_codigo_valora: str
    fornecedor_nome_valora: str
    nota_jcc: str
    documento: str
    vencimento: str
    valor_total: Decimal
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
    try:
        return datetime.strptime(raw, "%d/%m/%Y").date()
    except ValueError:
        return None


def print_money(value: Decimal) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def stable_origin_code(row: dict) -> str:
    # linha_jcc faz parte da chave porque a própria fonte contém ao menos um
    # lançamento repetido de forma literal. Se o JCC possui duas linhas, as duas
    # precisam continuar existindo, sem colisão de idempotência.
    canonical = "|".join([
        str(row.get("linha_jcc") or "").strip(),
        normalize_name(row.get("fornecedor")),
        normalize_spaces(row.get("nota")).upper(),
        normalize_spaces(row.get("documento")).upper(),
        normalize_spaces(row.get("vencimento")),
        f"{money(row.get('valor_total')):.2f}",
        normalize_spaces(row.get("historico")),
    ])
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
    return f"JCCAP-{digest}"


def resolve_suppliers(
    jcc_suppliers: Sequence[JccSupplier],
    decisions: Sequence[Decision],
) -> Dict[str, SupplierResolution]:
    by_key = {d.source_key: d for d in decisions}
    result: Dict[str, SupplierResolution] = {}

    for source in jcc_suppliers:
        decision = by_key.get(source.source_key)
        if decision is None:
            result[source.source_key] = SupplierResolution(
                source_key=source.source_key,
                jcc_name=source.name,
                valora_id=None,
                valora_code="",
                valora_name="",
                status="ERRO_FORNECEDOR_NAO_RESOLVIDO",
                reason="Fornecedor JCC não apareceu no resultado da conciliação.",
            )
            continue

        if decision.valora_id and decision.status.startswith("VINCULADO_"):
            result[source.source_key] = SupplierResolution(
                source_key=source.source_key,
                jcc_name=source.name,
                valora_id=int(decision.valora_id),
                valora_code=str(decision.valora_code or ""),
                valora_name=str(decision.valora_name or ""),
                status="OK",
                reason=decision.reason,
            )
            continue

        result[source.source_key] = SupplierResolution(
            source_key=source.source_key,
            jcc_name=source.name,
            valora_id=None,
            valora_code="",
            valora_name="",
            status="ERRO_FORNECEDOR_NAO_RESOLVIDO",
            reason=(
                f"Conciliação atual retornou {decision.status}. "
                "Execute primeiro conciliar_fornecedores_jcc.py --aplicar e só depois importe os títulos."
            ),
        )

    return result


def title_status(vencimento: date) -> str:
    return "vencido" if vencimento < date.today() else "aberto"


def existing_imported_title(db, empresa_id: int, origin_code: str):
    return db.execute(text("""
        SELECT id, fornecedor_id, documento, data_vencimento, valor_total, valor_pago, status
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
    fornecedor_id: int,
    documento: str,
    vencimento: date,
    valor_total: Decimal,
):
    return db.execute(text("""
        SELECT id, origem_tipo, origem_codigo, status, valor_pago, descricao
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id
          AND tipo='pagar'
          AND fornecedor_id=:fornecedor_id
          AND UPPER(TRIM(COALESCE(documento,'')))=:documento
          AND data_vencimento=:vencimento
          AND ROUND(valor_total::numeric, 2)=:valor_total
          AND COALESCE(origem_tipo,'') <> :origem_tipo
        ORDER BY id
        LIMIT 1
    """), {
        "empresa_id": empresa_id,
        "fornecedor_id": fornecedor_id,
        "documento": documento.strip().upper(),
        "vencimento": vencimento,
        "valor_total": valor_total,
        "origem_tipo": ORIGIN_TYPE,
    }).mappings().first()


def build_preview(
    db,
    empresa_id: int,
    rows: Sequence[dict],
    resolutions: Dict[str, SupplierResolution],
) -> List[TitlePreview]:
    previews: List[TitlePreview] = []
    seen_origin_codes = set()

    for pos, row in enumerate(rows, start=1):
        linha_raw = str(row.get("linha_jcc") or pos).strip()
        try:
            linha_jcc = int(linha_raw)
        except Exception:
            linha_jcc = pos

        source_key = normalize_name(row.get("fornecedor"))
        resolution = resolutions.get(source_key)
        origin_code = stable_origin_code(row)
        total = money(row.get("valor_total"))
        venc = parse_date_br(row.get("vencimento"))
        documento = normalize_spaces(row.get("documento"))
        nota = normalize_spaces(row.get("nota"))

        base = dict(
            linha_jcc=linha_jcc,
            origem_codigo=origin_code,
            fornecedor_jcc=normalize_spaces(row.get("fornecedor")),
            fornecedor_id_valora=resolution.valora_id if resolution else None,
            fornecedor_codigo_valora=resolution.valora_code if resolution else "",
            fornecedor_nome_valora=resolution.valora_name if resolution else "",
            nota_jcc=nota,
            documento=documento,
            vencimento=venc.isoformat() if venc else "",
            valor_total=total,
            status_valora=title_status(venc) if venc else "",
        )

        if origin_code in seen_origin_codes:
            previews.append(TitlePreview(
                **base,
                acao="ERRO_ORIGEM_DUPLICADA",
                motivo="Duas linhas da fonte geraram a mesma chave de origem.",
            ))
            continue
        seen_origin_codes.add(origin_code)

        if resolution is None or resolution.status != "OK" or not resolution.valora_id:
            previews.append(TitlePreview(
                **base,
                acao="ERRO_FORNECEDOR_NAO_RESOLVIDO",
                motivo=resolution.reason if resolution else "Fornecedor JCC não localizado na conciliação.",
            ))
            continue
        if venc is None:
            previews.append(TitlePreview(
                **base, acao="ERRO_DADOS_FONTE", motivo="Vencimento ausente ou inválido."
            ))
            continue
        if total <= 0:
            previews.append(TitlePreview(
                **base, acao="ERRO_DADOS_FONTE", motivo=f"Valor do título inválido: {total}."
            ))
            continue
        if not documento:
            previews.append(TitlePreview(
                **base, acao="ERRO_DADOS_FONTE", motivo="Documento JCC ausente."
            ))
            continue

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
            fornecedor_id=int(resolution.valora_id),
            documento=documento,
            vencimento=venc,
            valor_total=total,
        )
        if possible:
            previews.append(TitlePreview(
                **base,
                acao="POSSIVEL_DUPLICADO_EXISTENTE",
                motivo=(
                    f"Já existe título #{possible['id']} para o mesmo fornecedor/documento/vencimento/valor, "
                    "mas sem origem desta importação JCC. Revisão necessária antes de importar."
                ),
                lancamento_existente_id=int(possible["id"]),
            ))
            continue

        previews.append(TitlePreview(
            **base,
            acao="PRONTO_IMPORTAR",
            motivo="Título em aberto do JCC pronto para importação.",
        ))

    return previews


def build_description(row: dict) -> str:
    historical = normalize_spaces(row.get("historico"))
    if historical:
        return historical[:240]
    supplier = normalize_spaces(row.get("fornecedor"))
    doc = normalize_spaces(row.get("documento"))
    return f"Conta a pagar JCC — {supplier} — {doc}"[:240]


def build_observations(row: dict) -> str:
    parts = [
        "IMPORTAÇÃO JCC — Contas a Pagar detalhado (base entregue em 21/08/2026).",
        f"Fornecedor/beneficiário no JCC: {normalize_spaces(row.get('fornecedor'))}.",
        f"Documento JCC: {normalize_spaces(row.get('documento')) or 'não informado'}.",
        f"Nota JCC: {normalize_spaces(row.get('nota')) or 'não informada'}.",
        f"Linha da base JCC: {normalize_spaces(row.get('linha_jcc')) or 'não informada'}.",
        "O relatório detalhado não informa data de emissão; por exigência técnica do Valora, "
        "data_emissao foi preenchida com a própria data de vencimento.",
        "O valor importado corresponde exatamente ao campo 'A Pagar' do relatório detalhado. "
        "Nenhuma baixa ou movimentação financeira histórica foi inventada.",
        "Nenhuma movimentação de Caixa/Conta Corrente foi criada por esta importação.",
    ]
    hist = normalize_spaces(row.get("historico"))
    if hist:
        parts.append(f"Histórico JCC: {hist}")
    return " ".join(parts)


def insert_title(db, empresa_id: int, row: dict, preview: TitlePreview) -> int:
    venc = parse_date_br(row.get("vencimento"))
    total = money(row.get("valor_total"))

    lanc_id = db.execute(text("""
        INSERT INTO public.financeiro_lancamentos (
            empresa_id, tipo, descricao, moeda, valor_total, valor_pago,
            data_emissao, data_vencimento, data_pagamento, status,
            fornecedor_id, documento, observacoes,
            nota_fiscal_numero, origem_tipo, origem_codigo,
            criado_em, atualizado_em
        ) VALUES (
            :empresa_id, 'pagar', :descricao, 'BRL', :valor_total, 0,
            :data_emissao, :data_vencimento, NULL, :status,
            :fornecedor_id, :documento, :observacoes,
            :nota, :origem_tipo, :origem_codigo,
            NOW(), NOW()
        )
        RETURNING id
    """), {
        "empresa_id": empresa_id,
        "descricao": build_description(row),
        "valor_total": total,
        "data_emissao": venc,
        "data_vencimento": venc,
        "status": preview.status_valora,
        "fornecedor_id": int(preview.fornecedor_id_valora),
        "documento": preview.documento,
        "observacoes": build_observations(row),
        "nota": preview.nota_jcc or None,
        "origem_tipo": ORIGIN_TYPE,
        "origem_codigo": preview.origem_codigo,
    }).scalar_one()

    # Não criamos financeiro_movimentacoes. Esta base representa os títulos
    # detalhados que o JCC ainda apresenta em Contas a Pagar. Criar baixas antigas
    # sem a movimentação individual de origem alteraria Caixa/Conta Corrente.
    return int(lanc_id)


def source_totals(rows: Sequence[dict]) -> Tuple[int, Decimal, int]:
    total = sum((money(r.get("valor_total")) for r in rows), Decimal("0")).quantize(CENT)
    suppliers = {normalize_name(r.get("fornecedor")) for r in rows if normalize_name(r.get("fornecedor"))}
    return len(rows), total, len(suppliers)


def ensure_source_closure(rows: Sequence[dict]) -> None:
    count, total, suppliers = source_totals(rows)
    if count != EXPECTED_TITLE_COUNT or total != EXPECTED_TOTAL or suppliers != EXPECTED_SUPPLIERS:
        raise RuntimeError(
            "A fonte não fecha com o relatório JCC homologado: "
            f"qtd={count} (esperado {EXPECTED_TITLE_COUNT}), "
            f"total={total} (esperado {EXPECTED_TOTAL}), "
            f"fornecedores={suppliers} (esperado {EXPECTED_SUPPLIERS})."
        )


def write_preview_report(
    output_dir: Path,
    empresa_id: int,
    previews: Sequence[TitlePreview],
) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = output_dir / f"jcc_contas_pagar_PREVIA_empresa_{empresa_id}_{stamp}.csv"
    json_path = output_dir / f"jcc_contas_pagar_PREVIA_empresa_{empresa_id}_{stamp}.json"

    fields = list(asdict(previews[0]).keys()) if previews else []
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for item in previews:
            row = asdict(item)
            row["valor_total"] = f"{item.valor_total:.2f}".replace(".", ",")
            writer.writerow(row)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "empresa_id": empresa_id,
        "origin_type": ORIGIN_TYPE,
        "counts": dict(sorted(Counter(x.acao for x in previews).items())),
        "titles": len(previews),
        "total": str(sum((x.valor_total for x in previews), Decimal("0")).quantize(CENT)),
        "items": [
            {**asdict(x), "valor_total": str(x.valor_total)}
            for x in previews
        ],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return csv_path, json_path


def verify_import(db, empresa_id: int) -> dict:
    titles = db.execute(text("""
        SELECT COUNT(*) AS qtd,
               COALESCE(SUM(valor_total),0) AS total,
               COALESCE(SUM(valor_pago),0) AS pago,
               COALESCE(SUM(GREATEST(valor_total-valor_pago,0)),0) AS saldo,
               COUNT(*) FILTER (WHERE fornecedor_id IS NULL) AS sem_fornecedor,
               COUNT(*) FILTER (WHERE data_vencimento < CURRENT_DATE) AS vencidos_por_data,
               COUNT(*) FILTER (WHERE data_vencimento = CURRENT_DATE) AS vencem_hoje,
               COUNT(*) FILTER (WHERE data_vencimento > CURRENT_DATE) AS futuros
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id AND origem_tipo=:origem_tipo
    """), {"empresa_id": empresa_id, "origem_tipo": ORIGIN_TYPE}).mappings().one()

    movs = db.execute(text("""
        SELECT COUNT(*) AS qtd,
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
        "sem_fornecedor": int(titles["sem_fornecedor"] or 0),
        "vencidos_por_data": int(titles["vencidos_por_data"] or 0),
        "vencem_hoje": int(titles["vencem_hoje"] or 0),
        "futuros": int(titles["futuros"] or 0),
        "movimentacoes": int(movs["qtd"] or 0),
        "movimentacoes_com_conta_banco": int(movs["com_conta_banco"] or 0),
    }


def print_preview_summary(
    previews: Sequence[TitlePreview],
    resolutions: Dict[str, SupplierResolution],
) -> None:
    counts = Counter(x.acao for x in previews)
    bad_suppliers = sum(1 for x in resolutions.values() if x.status != "OK")
    total = sum((x.valor_total for x in previews), Decimal("0")).quantize(CENT)
    vencidos = sum(1 for x in previews if x.status_valora == "vencido")
    abertos = sum(1 for x in previews if x.status_valora == "aberto")

    print("\n[Valora/JCC] PRÉVIA — CONTAS A PAGAR")
    print(f"Fornecedores JCC resolvidos: {len(resolutions) - bad_suppliers}/{len(resolutions)}")
    print(f"Títulos detalhados da fonte: {len(previews)}")
    print(f"Valor total em aberto informado pelo relatório: {print_money(total)}")
    print(f"Vencidos pela data atual: {vencidos}")
    print(f"A vencer/vence hoje: {abertos}")
    print("Valor pago criado pela importação: R$ 0,00")
    print("Movimentações de Caixa/Banco previstas: 0")
    print("\nAções:")
    for key, value in sorted(counts.items()):
        print(f"  {key}: {value}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Importa os 1.261 títulos detalhados de Contas a Pagar do JCC para o Valora, "
            "reutilizando os 84 fornecedores já conciliados e sem criar movimentações financeiras históricas."
        )
    )
    parser.add_argument("--empresa-id", type=int, default=2, help="Empresa do Valora. Padrão: 2.")
    parser.add_argument("--arquivo", type=Path, default=DEFAULT_SOURCE, help="CSV normalizado da base detalhada JCC.")
    parser.add_argument("--saida", type=Path, default=DEFAULT_OUTPUT_DIR, help="Pasta dos relatórios de prévia.")
    parser.add_argument("--aplicar", action="store_true", help="Grava os títulos aprovados pela prévia.")
    parser.add_argument(
        "--desfazer",
        action="store_true",
        help="Remove SOMENTE os títulos desta importação JCC. Não combina com --aplicar.",
    )
    args = parser.parse_args()

    if args.aplicar and args.desfazer:
        print("ERRO: use --aplicar ou --desfazer, nunca os dois juntos.")
        return 2

    rows, jcc_suppliers = load_source(args.arquivo)
    ensure_source_closure(rows)

    from backend.database import SessionLocal  # noqa: E402

    db = SessionLocal()
    try:
        company = db.execute(
            text("SELECT id, nome FROM public.empresas WHERE id=:id"),
            {"id": args.empresa_id},
        ).mappings().first()
        if not company:
            print(f"ERRO: empresa_id={args.empresa_id} não existe.")
            return 2
        print(f"[Valora] Empresa: #{company['id']} — {company['nome']}")

        # Evita duas execuções de escrita concorrentes da mesma importação.
        if args.aplicar or args.desfazer:
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 82120260821 + args.empresa_id})

        if args.desfazer:
            count = db.execute(text("""
                SELECT COUNT(*)
                FROM public.financeiro_lancamentos
                WHERE empresa_id=:empresa_id AND origem_tipo=:origem_tipo
            """), {"empresa_id": args.empresa_id, "origem_tipo": ORIGIN_TYPE}).scalar_one()

            # Por segurança, não desfaz se alguém gerou movimentação sobre estes títulos.
            mov_count = db.execute(text("""
                SELECT COUNT(*)
                FROM public.financeiro_movimentacoes m
                JOIN public.financeiro_lancamentos l
                  ON l.id=m.lancamento_id AND l.empresa_id=m.empresa_id
                WHERE l.empresa_id=:empresa_id AND l.origem_tipo=:origem_tipo
            """), {"empresa_id": args.empresa_id, "origem_tipo": ORIGIN_TYPE}).scalar_one()
            if int(mov_count or 0) > 0:
                print(
                    "ERRO: existem movimentações financeiras vinculadas aos títulos importados. "
                    "O --desfazer foi bloqueado para não apagar baixas reais feitas depois da migração."
                )
                db.rollback()
                return 2

            db.execute(text("""
                DELETE FROM public.financeiro_lancamentos
                WHERE empresa_id=:empresa_id AND origem_tipo=:origem_tipo
            """), {"empresa_id": args.empresa_id, "origem_tipo": ORIGIN_TYPE})
            db.commit()
            print(f"[Valora/JCC] DESFAZER concluído. Títulos removidos: {int(count or 0)}")
            return 0

        valora_suppliers = load_valora_suppliers(db, args.empresa_id)
        decisions = reconcile(jcc_suppliers, valora_suppliers, usage_counts={})
        resolutions = resolve_suppliers(jcc_suppliers, decisions)
        previews = build_preview(db, args.empresa_id, rows, resolutions)
        print_preview_summary(previews, resolutions)

        csv_path, json_path = write_preview_report(args.saida, args.empresa_id, previews)
        print(f"\nRelatório CSV: {csv_path}")
        print(f"Relatório JSON: {json_path}")

        blockers = [x for x in previews if x.acao not in {"PRONTO_IMPORTAR", "JA_IMPORTADO"}]
        if blockers:
            print(f"\nIMPORTAÇÃO BLOQUEADA: {len(blockers)} título(s) precisam de revisão.")
            print("Não use --aplicar. Envie o CSV de prévia para revisão.")
            db.rollback()
            return 2

        if not args.aplicar:
            print("\nMODO PRÉVIA: nada foi gravado no banco.")
            print("Se aparecerem somente PRONTO_IMPORTAR e/ou JA_IMPORTADO, a aplicação está segura.")
            return 0

        inserted = 0
        rows_by_line = {}
        for idx, row in enumerate(rows, start=1):
            try:
                key = int(str(row.get("linha_jcc") or idx).strip())
            except Exception:
                key = idx
            rows_by_line[key] = row

        for preview in previews:
            if preview.acao != "PRONTO_IMPORTAR":
                continue
            row = rows_by_line.get(preview.linha_jcc)
            if row is None:
                raise RuntimeError(f"Linha JCC {preview.linha_jcc} não encontrada na fonte durante a aplicação.")
            insert_title(db, args.empresa_id, row, preview)
            inserted += 1

        verification = verify_import(db, args.empresa_id)
        if verification["titulos"] != EXPECTED_TITLE_COUNT:
            raise RuntimeError(
                f"Verificação final falhou: títulos={verification['titulos']}; esperado={EXPECTED_TITLE_COUNT}."
            )
        if verification["total"] != EXPECTED_TOTAL:
            raise RuntimeError(
                f"Verificação final falhou: total={verification['total']}; esperado={EXPECTED_TOTAL}."
            )
        if verification["pago"] != Decimal("0.00") or verification["saldo"] != EXPECTED_TOTAL:
            raise RuntimeError(
                "Verificação final falhou: a importação precisa manter valor_pago=0 e saldo igual ao relatório detalhado."
            )
        if verification["sem_fornecedor"] != 0:
            raise RuntimeError(
                f"Verificação final falhou: {verification['sem_fornecedor']} título(s) ficaram sem fornecedor."
            )
        if verification["movimentacoes"] != 0 or verification["movimentacoes_com_conta_banco"] != 0:
            raise RuntimeError(
                "Verificação final falhou: foram encontradas movimentações financeiras ligadas à importação."
            )

        db.commit()
        print("\n[Valora/JCC] IMPORTAÇÃO DE CONTAS A PAGAR CONCLUÍDA")
        print(f"Títulos inseridos nesta execução: {inserted}")
        print(f"Títulos JCC no Valora: {verification['titulos']}")
        print(f"Total em aberto importado: {print_money(verification['total'])}")
        print(f"Valor pago criado: {print_money(verification['pago'])}")
        print(f"Saldo dos títulos importados: {print_money(verification['saldo'])}")
        print(f"Vencidos pela data atual: {verification['vencidos_por_data']}")
        print(f"Vencem hoje: {verification['vencem_hoje']}")
        print(f"A vencer: {verification['futuros']}")
        print("Movimentações financeiras criadas: 0")
        print("Caixa/Conta Corrente/saldo bancário: NÃO movimentados pela importação.")
        return 0

    except Exception as exc:
        db.rollback()
        print(f"\nERRO: {exc}")
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
