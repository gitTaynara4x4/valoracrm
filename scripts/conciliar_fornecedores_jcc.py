from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# Permite executar diretamente: python scripts/conciliar_fornecedores_jcc.py
PROJECT_DIR = Path(__file__).resolve().parent.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from sqlalchemy import text  # noqa: E402


DEFAULT_SOURCE = PROJECT_DIR / "imports" / "jcc_contas_pagar_detalhado_202008_202608.csv"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "imports" / "saida"
EXPECTED_TITLE_COUNT = 1261
EXPECTED_TOTAL = 757870.78
EXPECTED_UNIQUE_SUPPLIERS = 84


# Revisão assistida baseada no relatório V1 e na conferência manual dos candidatos.
# As chaves são nomes normalizados do JCC; o ID é sempre revalidado no banco antes de usar.
ASSISTED_LINKS: Dict[str, Tuple[int, str]] = {'BANCO DO BRASIL S A': (103,
                         'Banco do Brasil já existente no Valora; cadastro de Taubaté é o equivalente operacional.'),
 'BANCO SANTANDER S A': (104,
                         'Banco Santander já existente no Valora; cadastro da agência de Taubaté é o equivalente '
                         'operacional.'),
 'BANDEIRANTE ENERGIA S A': (333, 'EDP Bandeirante Energia é a mesma concessionária identificada na fonte JCC.'),
 'D P DO AMARAL DE TREMEMBE LTDA ME': (240, 'Variação histórica do nome de D.P. Comércio Tremembé Ltda - ME.'),
 'DATORA MOBILE TELECOMUNICACOES S A': (246,
                                        'Nome JCC corresponde ao cadastro Datora Mobile Telecomunicações existente.'),
 'EMERSOM DE CARVALHO TAUBATE ME': (351, 'Erro de grafia EMERSOM/EMERSON; restante do nome confere.'),
 'FRANCISCO IVAN NAGY': (391, 'Variação de grafia NAGY/NAGGY; demais dados nominais conferem.'),
 'INFINITO MERCADO DE AUTOS': (473,
                               'Cadastro existente Infinito Mercado de Autopeças é o candidato inequívoco para as '
                               'compras automotivas da fonte.'),
 'NEXTEL TELECOMUNICACOES LTDA': (657, 'Nome corresponde ao cadastro NEXTEL TELECOMUNICACOES existente.'),
 'NUBANK S A': (1000, 'Nome corresponde ao cadastro BANCO NUBANK existente.'),
 'PAN MANUTENCAO AUTOMOTIVA AMARO NEGRINI': (690,
                                             "PAN Manutenção Automotiva; 'Amaro Negrini' identifica a localização e "
                                             'não outro fornecedor.'),
 'PUBLIVALE PRODUTOS PROFISSIONAIS LTDA': (736,
                                           'Variação/erro de descrição PROFISSIONAIS/PROMOCIONAIS; PUBLIVALE confere.'),
 'RECEITA FEDERAL': (758, 'Cadastro existente Receita Federal de Taubaté é o equivalente operacional.'),
 'SEGWARE DO BRASIL LTDA': (821, 'Nome corresponde ao cadastro SEGWARE DO BRASIL LTDA EPP existente.'),
 'SKOFY CONFECCOES E ESTAMPARIA': (848, "Variação singular/plural e '&'; nome empresarial confere."),
 'SO PORTOES': (881, 'Nome JCC confere com o nome fantasia SÓ PORTÕES - TAUBATÉ do cadastro existente.'),
 'SOFTMATIC SISTEMAS AUTO INF LTDA': (853, 'Variação abreviada do cadastro histórico SOFTMATIC SIST AUTOM INF S C.'),
 'TELEFONICA DO BRASIL S A': (901, 'Nome corresponde ao cadastro TELEFONICA S/A existente.'),
 'UNIVERSO ON LINE LTDA': (924, 'Nome corresponde ao cadastro UNIVERSO ONLINE - UOL HOSTING existente.'),
 'VIVO SP': (938, 'Nome corresponde ao cadastro VIVO S. A. existente.')}

# Fornecedores/beneficiários que não possuem equivalente confiável no Valora atual.
# Em --aplicar eles podem ser criados com o nome da fonte, sem inventar CPF/CNPJ.
SAFE_NEW_KEYS = {'ADRIANA ANDRADE PEREIRA',
 'AGUINALDO DOMINGUES DE TOLEDO',
 'ALLISON FILIPE GONCALVES',
 'AURUM SOFTMATIC LTDA',
 'AUTO POSTO',
 'AUTO POSTO MARECHAL MERCADO SHOPPING',
 'BRADESCO CAPITALIZACAO S A',
 'BRADESCO VIDA E PREVIDENCIA S A',
 'CAIKE MIGUEL BONIFACIO MOREIRA',
 'CLARO S A',
 'CLAYTON GONCALVES',
 'CORA SOCIEDADE DE CREDITO',
 'DATORA PARTICIPANTES SERVICOS S A',
 'DATORA TELECOMUNICACOES LTDA ME',
 'DIM DIM SANTANDER S A',
 'E R BORRACHARIA ROMILDO',
 'EDSON LEAL SOUZA',
 'ELIANA APARECIDA DE TOLEDO',
 'EMBRATEL S A',
 'FELIPE MARTINS DOS SANTOS',
 'FUNCIONARIOS MONIT 24HS',
 'GASBARAO',
 'GOVERNO DO ESTADO DE SAO PAULO',
 'GUINCHO DO EDUARDO',
 'GUINCHO RIBEIRO',
 'GYOVANNA CORREA DOS SANTOS',
 'ISABEL APARECIDA DE CARVALHO TOLEDO',
 'JONATAS CRISTIANO BONIFACIO',
 'JUAREZ LOPES DE OLIVEIRA',
 'LEONOR DAS GRACAS T BONIFACIO',
 'LIGIA PERES',
 'LISIEL DONIZETE BONIFACIO',
 'LUCAS DA SILVA ALMEIDA',
 'LUIZ ROBERTO BONIFACIO',
 'MARCUS VINICIUS PEREIRA',
 'MARINA DA SILVA ALMEIDA',
 'MARLENE GONCALVES',
 'NIC BR',
 'NILSON GONCALVES',
 'OFICINA FUNILARIA DO BIZUCA',
 'SEG SISTEMAS FUNCIONARIOS',
 'SHOPPE',
 'SILVIO WILLIAM SILVA',
 'SUPERMERCADOS',
 'TAYNARA FRANCINE FERREIRA DE PAULO'}


def normalize_spaces(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def normalize_name(value: Optional[str]) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = value.encode("ascii", "ignore").decode("ascii").upper()
    return re.sub(r"[^A-Z0-9]+", " ", value).strip()


def compact_name(value: Optional[str]) -> str:
    """Normalização auxiliar só para ranking de sugestões.

    Não é usada para vincular automaticamente. Remove palavras jurídicas muito
    genéricas para aproximar variações como S/A, S.A. e LTDA.
    """
    tokens = normalize_name(value).split()
    stop = {
        "LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "DO", "DA", "DE",
        "DOS", "DAS", "E", "COM", "CIA", "CIA", "SOCIEDADE",
    }
    kept = [t for t in tokens if t not in stop]
    return " ".join(kept or tokens)


def parse_money(value: Optional[str]) -> float:
    raw = str(value or "0").strip()
    if not raw:
        return 0.0
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    return round(float(raw), 2)


def br_money(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def parse_date(value: str) -> datetime:
    return datetime.strptime(str(value).strip(), "%d/%m/%Y")


def name_similarity(a: str, b: str) -> float:
    a_norm = normalize_name(a)
    b_norm = normalize_name(b)
    if not a_norm or not b_norm:
        return 0.0
    seq = SequenceMatcher(None, a_norm, b_norm).ratio()
    ac = compact_name(a_norm)
    bc = compact_name(b_norm)
    seq_compact = SequenceMatcher(None, ac, bc).ratio() if ac and bc else 0.0
    ta, tb = set(ac.split()), set(bc.split())
    jaccard = len(ta & tb) / max(1, len(ta | tb))
    return max(seq, (0.70 * seq_compact) + (0.30 * jaccard))


@dataclass(frozen=True)
class JccSupplier:
    source_key: str
    name: str
    normalized_name: str
    title_count: int
    total_value: float
    first_due: str
    last_due: str
    sample_documents: str
    sample_histories: str


@dataclass
class ValoraSupplier:
    id: int
    code: str
    name: str
    fantasy_name: str
    cpf_cnpj: str
    supplier_type: str
    status: str
    city: str
    state: str
    address: str
    number: str
    neighborhood: str
    phone: str
    whatsapp: str
    email: str
    created_at: str

    @property
    def names(self) -> Tuple[str, ...]:
        values = [normalize_name(self.name)]
        if self.fantasy_name:
            values.append(normalize_name(self.fantasy_name))
        return tuple(v for v in values if v)


@dataclass
class Decision:
    source_key: str
    status: str
    reason: str
    jcc_name: str
    jcc_title_count: int
    jcc_total_value: float
    jcc_first_due: str
    jcc_last_due: str
    jcc_sample_documents: str
    jcc_sample_histories: str
    valora_id: Optional[int] = None
    valora_code: str = ""
    valora_name: str = ""
    valora_fantasy_name: str = ""
    valora_cpf_cnpj: str = ""
    suggestion_1: str = ""
    suggestion_2: str = ""
    suggestion_3: str = ""
    suggestion_4: str = ""
    suggestion_5: str = ""


def load_source(path: Path) -> Tuple[List[dict], List[JccSupplier]]:
    if not path.exists():
        raise FileNotFoundError(f"Base JCC normalizada não encontrada: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter=";"))

    if not rows:
        raise RuntimeError("A base JCC de Contas a Pagar está vazia.")

    total = round(sum(parse_money(r.get("valor_total")) for r in rows), 2)
    if len(rows) != EXPECTED_TITLE_COUNT or abs(total - EXPECTED_TOTAL) > 0.01:
        raise RuntimeError(
            "A base JCC normalizada não fecha com o relatório detalhado original: "
            f"linhas={len(rows)} (esperado {EXPECTED_TITLE_COUNT}), "
            f"total={total:.2f} (esperado {EXPECTED_TOTAL:.2f})."
        )

    grouped: Dict[str, List[dict]] = defaultdict(list)
    display_names: Dict[str, str] = {}
    for row in rows:
        name = normalize_spaces(row.get("fornecedor"))
        key = normalize_name(name)
        if not key:
            raise RuntimeError(f"Linha JCC sem fornecedor: {row}")
        grouped[key].append(row)
        display_names.setdefault(key, name)

    suppliers: List[JccSupplier] = []
    for key, items in sorted(grouped.items()):
        due_dates = sorted(parse_date(x["vencimento"]) for x in items)
        docs = []
        histories = []
        for item in items:
            doc = normalize_spaces(item.get("documento"))
            hist = normalize_spaces(item.get("historico"))
            if doc and doc not in docs:
                docs.append(doc)
            if hist and hist not in histories:
                histories.append(hist)
        suppliers.append(
            JccSupplier(
                source_key=key,
                name=display_names[key],
                normalized_name=key,
                title_count=len(items),
                total_value=round(sum(parse_money(x.get("valor_total")) for x in items), 2),
                first_due=due_dates[0].strftime("%d/%m/%Y"),
                last_due=due_dates[-1].strftime("%d/%m/%Y"),
                sample_documents=" | ".join(docs[:6]),
                sample_histories=" | ".join(histories[:4]),
            )
        )

    if len(suppliers) != EXPECTED_UNIQUE_SUPPLIERS:
        raise RuntimeError(
            f"Fornecedores JCC normalizados={len(suppliers)}; esperado={EXPECTED_UNIQUE_SUPPLIERS}."
        )

    return rows, suppliers


def load_valora_suppliers(db, empresa_id: int) -> List[ValoraSupplier]:
    rows = db.execute(text("""
        SELECT id, codigo, nome,
               COALESCE(nome_fantasia, '') AS nome_fantasia,
               COALESCE(cpf_cnpj, '') AS cpf_cnpj,
               COALESCE(tipo_fornecedor, '') AS tipo_fornecedor,
               COALESCE(situacao, '') AS situacao,
               COALESCE(cidade, '') AS cidade,
               COALESCE(estado, '') AS estado,
               COALESCE(endereco, '') AS endereco,
               COALESCE(numero, '') AS numero,
               COALESCE(bairro, '') AS bairro,
               COALESCE(telefone, '') AS telefone,
               COALESCE(whatsapp, '') AS whatsapp,
               COALESCE(email, '') AS email,
               COALESCE(criado_em::text, '') AS criado_em
        FROM public.fornecedores
        WHERE empresa_id = :empresa_id
        ORDER BY id
    """), {"empresa_id": empresa_id}).mappings().all()

    return [
        ValoraSupplier(
            id=int(r["id"]), code=str(r["codigo"] or ""), name=str(r["nome"] or ""),
            fantasy_name=str(r["nome_fantasia"] or ""), cpf_cnpj=str(r["cpf_cnpj"] or ""),
            supplier_type=str(r["tipo_fornecedor"] or ""), status=str(r["situacao"] or ""),
            city=str(r["cidade"] or ""), state=str(r["estado"] or ""),
            address=str(r["endereco"] or ""), number=str(r["numero"] or ""),
            neighborhood=str(r["bairro"] or ""), phone=str(r["telefone"] or ""),
            whatsapp=str(r["whatsapp"] or ""), email=str(r["email"] or ""),
            created_at=str(r["criado_em"] or ""),
        )
        for r in rows
    ]


def load_supplier_usage_counts(db, candidate_ids: Sequence[int]) -> Dict[int, int]:
    """Conta referências reais a fornecedores em todas as FKs do schema público.

    É apenas diagnóstico e nunca altera o banco. Ajuda a decidir entre cadastros
    duplicados pelo nome mostrando qual ID já é usado pelo restante do Valora.
    """
    ids = sorted({int(x) for x in candidate_ids if x is not None})
    counts: Dict[int, int] = {supplier_id: 0 for supplier_id in ids}
    if not ids:
        return counts

    fk_rows = db.execute(text("""
        SELECT ns.nspname AS schema_name, cls.relname AS table_name, att.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
        JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
        JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = fk.attnum
        WHERE con.contype = 'f'
          AND con.confrelid = 'public.fornecedores'::regclass
          AND ratt.attname = 'id'
          AND ns.nspname = 'public'
        ORDER BY cls.relname, att.attname
    """)).mappings().all()

    safe_ident = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
    ids_sql = ",".join(str(x) for x in ids)
    for fk in fk_rows:
        schema = str(fk["schema_name"] or "")
        table_name = str(fk["table_name"] or "")
        column_name = str(fk["column_name"] or "")
        if not (safe_ident.fullmatch(schema) and safe_ident.fullmatch(table_name) and safe_ident.fullmatch(column_name)):
            continue
        try:
            refs = db.execute(text(
                f'SELECT "{column_name}" AS fornecedor_id, COUNT(*) AS qtd '
                f'FROM "{schema}"."{table_name}" '
                f'WHERE "{column_name}" IN ({ids_sql}) '
                f'GROUP BY "{column_name}"'
            )).mappings().all()
        except Exception:
            db.rollback()
            continue
        for row in refs:
            sid = int(row["fornecedor_id"])
            counts[sid] = counts.get(sid, 0) + int(row["qtd"] or 0)
    return counts


def candidate_label(
    candidate: ValoraSupplier,
    *,
    score: Optional[float] = None,
    usage_counts: Optional[Dict[int, int]] = None,
    prefix: str = "",
) -> str:
    local = " / ".join(
        x for x in [normalize_spaces(candidate.city), normalize_spaces(candidate.state).upper()] if x
    ) or "local não informado"
    extras: List[str] = []
    if normalize_spaces(candidate.fantasy_name) and normalize_name(candidate.fantasy_name) != normalize_name(candidate.name):
        extras.append(f"fantasia={normalize_spaces(candidate.fantasy_name)}")
    if normalize_spaces(candidate.supplier_type):
        extras.append(f"tipo={normalize_spaces(candidate.supplier_type)}")
    address = " ".join(x for x in [normalize_spaces(candidate.address), normalize_spaces(candidate.number)] if x).strip()
    if address:
        if normalize_spaces(candidate.neighborhood):
            address += f" - {normalize_spaces(candidate.neighborhood)}"
        extras.append(f"end={address}")
    if normalize_spaces(candidate.phone):
        extras.append(f"tel={normalize_spaces(candidate.phone)}")
    if normalize_spaces(candidate.whatsapp) and candidate.whatsapp != candidate.phone:
        extras.append(f"whats={normalize_spaces(candidate.whatsapp)}")
    if normalize_spaces(candidate.email):
        extras.append(f"email={normalize_spaces(candidate.email)}")
    if normalize_spaces(candidate.created_at):
        extras.append(f"criado={normalize_spaces(candidate.created_at)[:10]}")
    if score is not None:
        extras.insert(0, f"similaridade={score * 100:.1f}%")

    usage = int((usage_counts or {}).get(candidate.id, 0))
    marker = f"{prefix} " if prefix else ""
    doc = normalize_spaces(candidate.cpf_cnpj) or "sem CPF/CNPJ"
    suffix = (" — " + " — ".join(extras)) if extras else ""
    return (
        f"{marker}#{candidate.id} cód. {candidate.code} — {candidate.name} — {doc} — "
        f"{local} — uso={usage}{suffix}"
    )


def best_suggestions(
    source: JccSupplier,
    valora_suppliers: Sequence[ValoraSupplier],
    *,
    limit: int = 5,
) -> List[Tuple[float, ValoraSupplier]]:
    scored: List[Tuple[float, ValoraSupplier]] = []
    for candidate in valora_suppliers:
        score = max((name_similarity(source.name, n) for n in candidate.names), default=0.0)
        if score >= 0.50:
            scored.append((score, candidate))
    scored.sort(key=lambda item: (-item[0], item[1].id))
    return scored[:limit]


def reconcile(
    jcc_suppliers: Sequence[JccSupplier],
    valora_suppliers: Sequence[ValoraSupplier],
    *,
    usage_counts: Optional[Dict[int, int]] = None,
) -> List[Decision]:
    by_name: Dict[str, List[Tuple[ValoraSupplier, str]]] = defaultdict(list)
    for candidate in valora_suppliers:
        main_name = normalize_name(candidate.name)
        if main_name:
            by_name[main_name].append((candidate, "NOME"))
        fantasy = normalize_name(candidate.fantasy_name)
        if fantasy and fantasy != main_name:
            by_name[fantasy].append((candidate, "FANTASIA"))

    decisions: List[Decision] = []
    for source in jcc_suppliers:
        exact_raw = by_name.get(source.normalized_name, [])
        exact_by_id: Dict[int, Tuple[ValoraSupplier, str]] = {}
        for candidate, match_type in exact_raw:
            existing = exact_by_id.get(candidate.id)
            if existing is None or existing[1] == "FANTASIA":
                exact_by_id[candidate.id] = (candidate, match_type)
        exact = list(exact_by_id.values())

        decision = Decision(
            source_key=source.source_key,
            status="NOVO",
            reason="Nome não encontrado de forma exata na tabela de fornecedores do Valora.",
            jcc_name=source.name,
            jcc_title_count=source.title_count,
            jcc_total_value=source.total_value,
            jcc_first_due=source.first_due,
            jcc_last_due=source.last_due,
            jcc_sample_documents=source.sample_documents,
            jcc_sample_histories=source.sample_histories,
        )

        assisted = ASSISTED_LINKS.get(source.source_key)
        if assisted:
            target_id, assisted_reason = assisted
            chosen = next((x for x in valora_suppliers if x.id == target_id), None)
            if chosen is None:
                decision.status = "REVISAR_ALVO_ASSISTIDO_NAO_ENCONTRADO"
                decision.reason = (
                    f"A revisão assistida esperava o fornecedor Valora #{target_id}, "
                    "mas esse ID não existe mais nesta empresa."
                )
            else:
                decision.status = "VINCULADO_REVISAO_ASSISTIDA"
                decision.reason = assisted_reason
                decision.valora_id = chosen.id
                decision.valora_code = chosen.code
                decision.valora_name = chosen.name
                decision.valora_fantasy_name = chosen.fantasy_name
                decision.valora_cpf_cnpj = chosen.cpf_cnpj
        elif len(exact) == 1:
            chosen, match_type = exact[0]
            decision.status = "VINCULADO_NOME" if match_type == "NOME" else "VINCULADO_NOME_FANTASIA"
            decision.reason = (
                "Nome normalizado confere exatamente com o fornecedor existente."
                if match_type == "NOME"
                else "Nome JCC confere exatamente com o nome fantasia do fornecedor existente."
            )
            decision.valora_id = chosen.id
            decision.valora_code = chosen.code
            decision.valora_name = chosen.name
            decision.valora_fantasy_name = chosen.fantasy_name
            decision.valora_cpf_cnpj = chosen.cpf_cnpj
        elif len(exact) > 1:
            decision.status = "REVISAR_NOME_DUPLICADO_VALORA"
            decision.reason = "Há mais de um fornecedor no Valora com este mesmo nome/nome fantasia normalizado."

        suggestions: List[Tuple[float, ValoraSupplier, str]] = []
        seen = set()
        if len(exact) > 1:
            for candidate, match_type in exact:
                suggestions.append((1.0, candidate, f"[{match_type} EXATO]"))
                seen.add(candidate.id)

        for score, candidate in best_suggestions(source, valora_suppliers, limit=10):
            if candidate.id == decision.valora_id or candidate.id in seen:
                continue
            suggestions.append((score, candidate, "[NOME]"))
            seen.add(candidate.id)
            if len(suggestions) >= 5:
                break

        if decision.status == "NOVO" and source.source_key in SAFE_NEW_KEYS:
            decision.status = "NOVO_SEGURO_REVISAO"
            decision.reason = (
                "Revisado: não foi identificado fornecedor equivalente confiável no Valora; "
                "candidato seguro para criação preservando exatamente a identidade usada no JCC."
            )

        # Caso não haja nome exato, uma semelhança muito forte vira uma pendência
        # explícita em vez de criar automaticamente. Assim evitamos duplicar por
        # abreviação, erro de digitação ou mudança de razão social.
        if decision.status == "NOVO" and suggestions:
            best_score = suggestions[0][0]
            second_score = suggestions[1][0] if len(suggestions) > 1 else 0.0
            if best_score >= 0.88:
                decision.status = "REVISAR_NOME_SEMELHANTE_FORTE"
                decision.reason = (
                    f"Não há nome exato, mas existe candidato com {best_score * 100:.1f}% de similaridade; "
                    "revisão obrigatória antes de criar."
                )
                if second_score >= best_score - 0.03:
                    decision.reason += " Há mais de um candidato próximo."

        labels = [
            candidate_label(c, score=s, usage_counts=usage_counts, prefix=p)
            for s, c, p in suggestions[:5]
        ]
        for idx, label in enumerate(labels, start=1):
            setattr(decision, f"suggestion_{idx}", label)

        decisions.append(decision)

    return decisions



def is_pending_status(status: str) -> bool:
    return status == "NOVO" or status.startswith("REVISAR_")


def next_supplier_code(db, empresa_id: int) -> str:
    """Gera o próximo código numérico livre usando a mesma lógica do Valora."""
    rows = db.execute(
        text("SELECT codigo FROM public.fornecedores WHERE empresa_id=:empresa_id"),
        {"empresa_id": empresa_id},
    ).scalars().all()

    existing = {normalize_spaces(x) for x in rows if normalize_spaces(x)}
    highest = 0
    for raw in existing:
        try:
            highest = max(highest, int(raw))
        except (TypeError, ValueError):
            continue

    next_number = highest + 1
    while f"{next_number:04d}" in existing:
        next_number += 1
    return f"{next_number:04d}"


def exact_supplier_matches(
    source_name: str,
    valora_suppliers: Sequence[ValoraSupplier],
) -> List[Tuple[ValoraSupplier, str]]:
    """Retorna matches exatos normalizados por razão social ou nome fantasia."""
    wanted = normalize_name(source_name)
    by_id: Dict[int, Tuple[ValoraSupplier, str]] = {}
    for candidate in valora_suppliers:
        main = normalize_name(candidate.name)
        fantasy = normalize_name(candidate.fantasy_name)
        if main and main == wanted:
            by_id[candidate.id] = (candidate, "NOME")
        elif fantasy and fantasy == wanted:
            by_id.setdefault(candidate.id, (candidate, "FANTASIA"))
    return list(by_id.values())


def apply_safe_creations(
    db,
    decisions: Sequence[Decision],
    *,
    empresa_id: int,
) -> Tuple[int, int]:
    """Cria somente os fornecedores previamente aprovados como NOVO_SEGURO_REVISAO.

    Antes de cada INSERT a tabela é relida e o nome é conferido novamente. Se o
    fornecedor apareceu desde a prévia, ele é reutilizado em vez de duplicado.
    """
    pending = [d for d in decisions if is_pending_status(d.status)]
    if pending:
        preview = ", ".join(f"{d.jcc_name} ({d.status})" for d in pending[:5])
        if len(pending) > 5:
            preview += f" e mais {len(pending) - 5}"
        raise RuntimeError(
            f"Aplicação bloqueada: ainda existem {len(pending)} fornecedor(es) pendentes: {preview}."
        )

    created = 0
    rechecked = 0
    for decision in decisions:
        if decision.status != "NOVO_SEGURO_REVISAO":
            continue

        # Recarrega imediatamente antes de criar. Isso torna a operação segura
        # inclusive se alguém cadastrou o fornecedor entre a prévia e o --aplicar.
        current = load_valora_suppliers(db, empresa_id)
        exact = exact_supplier_matches(decision.jcc_name, current)

        if len(exact) == 1:
            chosen, match_type = exact[0]
            decision.status = "VINCULADO_RECHECAGEM_ANTES_DE_CRIAR"
            decision.reason = (
                "Fornecedor encontrado por nome normalizado na rechecagem imediatamente antes do INSERT; "
                "cadastro existente foi reutilizado para evitar duplicidade."
            )
            decision.valora_id = chosen.id
            decision.valora_code = chosen.code
            decision.valora_name = chosen.name
            decision.valora_fantasy_name = chosen.fantasy_name
            decision.valora_cpf_cnpj = chosen.cpf_cnpj
            rechecked += 1
            continue

        if len(exact) > 1:
            ids = ", ".join(str(c.id) for c, _ in exact)
            decision.status = "REVISAR_DUPLICIDADE_SURGIU_ANTES_DE_CRIAR"
            decision.reason = (
                "A aplicação foi interrompida porque a rechecagem encontrou mais de um fornecedor "
                f"com nome equivalente (IDs {ids})."
            )
            raise RuntimeError(
                f"Aplicação bloqueada para {decision.jcc_name!r}: surgiram múltiplos cadastros equivalentes ({ids})."
            )

        code = next_supplier_code(db, empresa_id)
        observations = (
            "Importado da base histórica JCC — Contas a Pagar. "
            f"Identidade da fonte: {decision.jcc_name}. "
            f"Títulos associados na fonte: {decision.jcc_title_count}. "
            f"Período dos vencimentos: {decision.jcc_first_due} a {decision.jcc_last_due}. "
            "O relatório detalhado fornecido não contém CPF/CNPJ do fornecedor; documento fiscal não foi inventado."
        )

        inserted = db.execute(
            text(
                """
                INSERT INTO public.fornecedores
                    (empresa_id, codigo, tipo_fornecedor, situacao, nome, observacoes)
                VALUES
                    (:empresa_id, :codigo, :tipo_fornecedor, :situacao, :nome, :observacoes)
                RETURNING id, codigo, nome, COALESCE(nome_fantasia, '') AS nome_fantasia,
                          COALESCE(cpf_cnpj, '') AS cpf_cnpj
                """
            ),
            {
                "empresa_id": empresa_id,
                "codigo": code,
                "tipo_fornecedor": "Fornecedor",
                "situacao": "ativo",
                "nome": decision.jcc_name,
                "observacoes": observations,
            },
        ).mappings().one()

        decision.status = "CRIADO_AGORA"
        decision.reason = (
            "Fornecedor criado nesta execução após revisão assistida e rechecagem final contra duplicidade."
        )
        decision.valora_id = int(inserted["id"])
        decision.valora_code = str(inserted["codigo"] or "")
        decision.valora_name = str(inserted["nome"] or "")
        decision.valora_fantasy_name = str(inserted["nome_fantasia"] or "")
        decision.valora_cpf_cnpj = str(inserted["cpf_cnpj"] or "")
        created += 1

    return created, rechecked

def write_reports(
    output_dir: Path,
    decisions: Sequence[Decision],
    *,
    empresa_id: int,
    source: Path,
    title_rows: Sequence[dict],
) -> Tuple[Path, Path, Optional[Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = output_dir / f"jcc_fornecedores_conciliacao_empresa_{empresa_id}_{stamp}.csv"
    json_path = output_dir / f"jcc_fornecedores_conciliacao_empresa_{empresa_id}_{stamp}.json"

    fieldnames = list(asdict(decisions[0]).keys()) if decisions else []
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for decision in decisions:
            row = asdict(decision)
            row["jcc_total_value"] = f"{decision.jcc_total_value:.2f}".replace(".", ",")
            writer.writerow(row)

    counts = Counter(d.status for d in decisions)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "empresa_id": empresa_id,
        "source": str(source),
        "source_titles": len(title_rows),
        "source_total": round(sum(parse_money(r.get("valor_total")) for r in title_rows), 2),
        "unique_jcc_suppliers": len(decisions),
        "status_counts": dict(sorted(counts.items())),
        "decisions": [asdict(d) for d in decisions],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    pending = [
        d for d in decisions
        if d.status == "NOVO" or d.status.startswith("REVISAR_")
    ]
    pending_path: Optional[Path] = None
    if pending:
        pending_path = output_dir / f"jcc_fornecedores_PENDENTES_empresa_{empresa_id}_{stamp}.csv"
        fields = list(asdict(pending[0]).keys())
        with pending_path.open("w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
            writer.writeheader()
            for decision in pending:
                row = asdict(decision)
                row["jcc_total_value"] = f"{decision.jcc_total_value:.2f}".replace(".", ",")
                writer.writerow(row)

    return csv_path, json_path, pending_path


def print_summary(decisions: Sequence[Decision], title_rows: Sequence[dict]) -> None:
    counts = Counter(d.status for d in decisions)
    total = round(sum(parse_money(r.get("valor_total")) for r in title_rows), 2)
    first_due = min(parse_date(r["vencimento"]) for r in title_rows).strftime("%d/%m/%Y")
    last_due = max(parse_date(r["vencimento"]) for r in title_rows).strftime("%d/%m/%Y")

    print("\n[Valora/JCC] CONCILIAÇÃO DE FORNECEDORES — CONTAS A PAGAR")
    print(f"Títulos na base detalhada JCC: {len(title_rows)}")
    print(f"Fornecedores/beneficiários JCC: {len(decisions)}")
    print(f"Período dos vencimentos: {first_due} a {last_due}")
    print(f"Valor nominal dos títulos: {br_money(total)}")
    print("\nSituações:")
    for status, count in sorted(counts.items()):
        print(f"  {status}: {count}")

    linked = sum(1 for d in decisions if d.status.startswith("VINCULADO_"))
    safe_new = sum(1 for d in decisions if d.status == "NOVO_SEGURO_REVISAO")
    created = sum(1 for d in decisions if d.status == "CRIADO_AGORA")
    pending = sum(1 for d in decisions if is_pending_status(d.status))
    resolved = linked + safe_new + created

    print(f"\nVinculados a fornecedores existentes: {linked}/{len(decisions)}")
    if safe_new:
        print(f"Novos fornecedores aprovados para criação: {safe_new}")
    if created:
        print(f"Fornecedores criados nesta execução: {created}")
    print(f"Identidades resolvidas: {resolved}/{len(decisions)}")
    print(f"Pendências para revisão manual: {pending}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Concilia os 84 fornecedores/beneficiários da base detalhada de Contas a Pagar do JCC "
            "com a tabela de fornecedores do Valora. Sem --aplicar funciona em modo prévia."
        )
    )
    parser.add_argument("--empresa-id", type=int, default=2, help="Empresa do Valora. Padrão: 2.")
    parser.add_argument("--arquivo", type=Path, default=DEFAULT_SOURCE, help="CSV normalizado da base detalhada JCC.")
    parser.add_argument("--saida", type=Path, default=DEFAULT_OUTPUT_DIR, help="Pasta para os relatórios.")
    parser.add_argument(
        "--aplicar",
        action="store_true",
        help="Cria somente os fornecedores aprovados como NOVO_SEGURO_REVISAO. Sem esta opção nada é gravado.",
    )
    args = parser.parse_args()

    title_rows, jcc_suppliers = load_source(args.arquivo)

    from backend.database import SessionLocal  # import tardio

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
        valora_suppliers = load_valora_suppliers(db, args.empresa_id)
        print(f"[Valora] Fornecedores atuais encontrados: {len(valora_suppliers)}")
        print("[Valora] Calculando uso dos cadastros para diagnosticar duplicidades...")
        usage_counts = load_supplier_usage_counts(db, [x.id for x in valora_suppliers])

        decisions = reconcile(jcc_suppliers, valora_suppliers, usage_counts=usage_counts)
        pending_before = [d for d in decisions if is_pending_status(d.status)]

        created = 0
        rechecked = 0
        if args.aplicar:
            if pending_before:
                print_summary(decisions, title_rows)
                print(
                    "\nERRO: --aplicar bloqueado porque ainda existem pendências. "
                    "Rode a prévia e revise o CSV de PENDENTES."
                )
                db.rollback()
                return 3

            created, rechecked = apply_safe_creations(
                db,
                decisions,
                empresa_id=args.empresa_id,
            )

            # Trava final: todas as 84 identidades precisam estar vinculadas ou criadas.
            unresolved_after = [
                d for d in decisions
                if not (d.status.startswith("VINCULADO_") or d.status == "CRIADO_AGORA")
            ]
            if unresolved_after:
                raise RuntimeError(
                    f"Validação final falhou: {len(unresolved_after)} identidade(s) não resolvida(s)."
                )

            db.commit()
        else:
            db.rollback()

        print_summary(decisions, title_rows)
        csv_path, json_path, pending_path = write_reports(
            args.saida,
            decisions,
            empresa_id=args.empresa_id,
            source=args.arquivo,
            title_rows=title_rows,
        )
        print(f"\nRelatório CSV: {csv_path}")
        print(f"Relatório JSON: {json_path}")
        if pending_path:
            print(f"Pendências reduzidas para revisão: {pending_path}")

        if args.aplicar:
            print("\n[Valora/JCC] CONCILIAÇÃO DE FORNECEDORES CONCLUÍDA")
            print(f"Fornecedores criados nesta execução: {created}")
            print(f"Reaproveitados na rechecagem antes de criar: {rechecked}")
            print("Pendências para revisão manual: 0")
            print("Agora os 84 fornecedores/beneficiários JCC estão resolvidos para a Etapa 2.")
        else:
            print("\nMODO PRÉVIA: nada foi gravado no banco.")
            if pending_before:
                print("Ainda existem pendências; não use --aplicar.")
            else:
                print("Prévia sem pendências. Se os totais acima estiverem corretos, a aplicação está liberada com --aplicar.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERRO: {type(exc).__name__}: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
