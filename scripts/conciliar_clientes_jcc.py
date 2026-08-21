from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# Permite executar: python scripts/conciliar_clientes_jcc.py
PROJECT_DIR = Path(__file__).resolve().parent.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from sqlalchemy import text  # noqa: E402


DEFAULT_SOURCE = PROJECT_DIR / "imports" / "jcc_contas_receber_202008.csv"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "imports" / "saida"
PLACEHOLDER_DOCS = {"00000000000", "00000000000000"}
EXPECTED_TITLE_COUNT = 221
EXPECTED_TOTAL = 31272.60
EXPECTED_PAID = 30870.60

# Revisão assistida feita sobre o relatório gerado em 21/08/2026.
# Estes vínculos NÃO alteram CPF/CNPJ do cadastro existente; servem somente
# para reutilizar o cliente correto na importação histórica e evitar duplicidades.
CURATED_LINKS = {
    ('ACADEMIA FITNESS CLUB', '28314197000152'): 5593,
    ('AGRIPINO FRANCISC DE SOUZA', '01947534840'): 2466,
    ('APOIO CIVIL E METALURGICO LTDA', '04316730000157'): 5195,
    ('ASSOC DE PAIS E MESTRES DA ESC EST DE 1 E 2', '45178589000150'): 4649,
    ('ASSOCIACAO DA IGREJA METODISTA TERCEIRA', '04083369006016'): 4653,
    ('AUTO PECAS OPCAO TAUBATE LTDA ME PAULO', '67611145000108'): 4662,
    ('AVANTE AUTO CENTER LTDA', '33727739000159'): 5622,
    ('AVENTOR EMPRENDIMENTO IMOBILIARIA SPE LTDA', '31620753000123'): 5656,
    ('BENEDITO ORLANDO BETTIM', '60216867800'): 1665,
    ('BILILI ADMINISTRADORA E CORRETORA DE', '01182829000115'): 5246,
    ('BIROSCA QUADIMARCO', '12725834000143'): 5739,
    ('BL DANELLI LOTERICAS LTDA CAMPEAO DA', '04826380000179'): 1756,
    ('BLOKHU COMERCIO DE MATERIAIS DE', '15029430000103'): 4905,
    ('BRASIL CASA DE MADEIRA IMP E EXP LTDA', '07665122000146'): 5227,
    ('CHOPERIA VILLASA LTDA ME', '11759066000186'): 4689,
    ('CIMENDUTRA COMERCIAL E DISTRIBUIDORA DE', '03413942000190'): 5536,
    ('CLEUSA IZABEL BRANDAO ME', '08064709000162'): 4697,
    ('CLINICA ODONTOLOGICA DR RUBENS', '10173893000120'): 5267,
    ('CONDOMINIO EDIFICIO PRIVILEGE INDEPENDENCIA', '33363699832'): 4613,
    ('CONDOMINIO JULIETA SEBE CARNEIRO OFFICES', '06296015000125'): 4728,
    ('CONSULTORIO DENTARIO DR DOUGLAS SAMPAIO', '26113119866'): 2535,
    ('DANICELL VILIAN DANIELA LAUREANO FERREIRA', '10218564000159'): 4744,
    ('DANIEL MUSSI IVO ME CD WORD', '00855530000111'): 4743,
    ('DANIELA LAUREANO FERREIRA TAUBATE ME', '03268970000160'): 5396,
    ('DEPOSITO SANTOS MATERIAIS P CONTRUCAO', '53490603000185'): 4749,
    ('EMFLORA EMP FLORESTAIS LTDA', '36297810001090'): 4774,
    ('ESCRITORIO DE CONTABILIDADE UNIAO LTDA ME', '61871406000134'): 4786,
    ('ESTETICA TAUBATE LASER LTDA', '29649959000134'): 5603,
    ('FELIPPE C B DE FREITAS ME KYRIOS', '09309240000147'): 4801,
    ('FERRARI E FERRARI VEICULOS LTDA', '10424697000181'): 4603,
    ('FONTES SALLES ELETRICIDADE E', '07561119000182'): 4808,
    ('G D M PIZZARIA LTDA PIZZARIA NOSTRA', '45808524000141'): 4816,
    ('I CURSINO TEOFILO DE CARVALHO CIA LTDA ME', '13016219000120'): 4999,
    ('IEDA LEMOS DE OLIVEIRA', '01960137808'): 1727,
    ('JOSE ANTONIO DA CUNHA', '04688708815'): 1738,
    ('KATIA APARECIDA DE ABREU SANTOS 36612753803', '26837541000162'): 5572,
    ('LEITE NA PISTA COMERCIO DE PRODUTOS DA', '66526476000179'): 4881,
    ('LIBERUM SOLUCOES EM INFORMATICA', '07368378000191'): 5391,
    ('LUCAS MINORU ODA', '42771995859'): 2618,
    ('LUIZ ANTONIO OTAVIO CAMPHORA', '88739902820'): 1764,
    ('LUIZ HENRIQUE MONTEIRO PERUCINI', '29071724840'): 2612,
    ('MARCELO M C SOUZA TAUBATE MAGNUM', '05114532000173'): 4897,
    ('MARCO ANTONIO BAPTISTELLA COM E CONS EPP', '29321068000154'): 5532,
    ('MAURA DOS SANTOS SERV ADM ME', '08770886000164'): 4910,
    ('MEC Q COMERCIO E SERVICOS DE METROLOGIA', '96513486000211'): 4914,
    ('MERCEARIA J V CURSINO SANTOS LTDA EPP', '04069069000122'): 4917,
    ('NAGIB FILHOS COMERCIO DE TECIDOS LTDA', '72279771000170'): 4937,
    ('OFICINA VALDIR ALARCAO', '78819458853'): 1854,
    ('OTICA ESPECIALIZADA DE MOGI DAS CRUZES', '05873394000297'): 5070,
    ('OTICA ESPECIALIZADA DE MOGI DAS CRUZES', '05873394000378'): 5397,
    ('PASQUALINA OTAVIO CAMPHORA', '05794055839'): 1807,
    ('PATRICIA NEVES BARBOSA PUCCINI ME', '05690371000166'): 5198,
    ('PERFECTUS ALUMINIO LTDA EPP', '62972591000116'): 5234,
    ('PRIMO AUTO PECAS INFINITO DISTRIBUIDORA DE', '00295151000114'): 4847,
    ('PRISCILA VASCONCELLOS', '13368473000198'): 5387,
    ('PROJECAO EMPRESA CONTABIL S C LTDA', '96487723000136'): 4977,
    ('RESTAURANTE SAN REMAN E A PARREIRA', '68926286000174'): 4767,
    ('S E CUBA R P DA MOTA LTDA ME BATISTA', '27151429000136'): 5490,
    ('SAMANTHA DE PAULA SALGADO CERCA', '22205674862'): 1885,
    ('SEBASTIAO DE QUEIROZ NETTO ME NETO', '50394634000144'): 5007,
    ('TAUMEC COMERCIO E MANUTENCAO E BOMBAS', '07738320000192'): 5033,
    ('TONIKA TANAKA FUCAMACHI', '31078021821'): 2584,
    ('TOTAL OFICINA COM PREST SERV AUTOMOTIVO', '21263358000187'): 5281,
    ('UNIAO CENTRAL BRASILEIRA DA IGREJA', '55233019003438'): 5047,
    ('V C ROSA DE SOUZA E CIA LTDA ME OTICA DA', '09386123000187'): 5049,
}

# Casos revisados em que não foi encontrado candidato plausível no cadastro atual.
# Antes de criar, o script revalida CPF/CNPJ e nome no banco.
CURATED_SAFE_NEW = {
    ('AVANZATO OPTICAL LTDA', '33098952000149'),
    ('CONSULTORIO ODONTOLOGICO DRA HELOISA', '07245399808'),
    ('EXCEDE METAIS LTDA DEPOSITO DE CALHAS', '04206182000102'),
    ('IGREJA EVANGELICA DO POVO', '17793895000161'),
    ('IMOBILIARIA RE MAX CANAA', '18036183000160'),
    ('JRM ENGENHARIA', '09089458000133'),
    ('L F OBEID MOVEIS PLANEJADOS', '15692190000122'),
    ('OTICA IMPACTO DE MOGI DAS CRUZES LTDA ME', '15244905000427'),
    ('PAULO DA ROCHA CAMARGO', '00858307804'),
    ('QUALIPAPER INDUSTRIA E COMERCIO DE PAPEIS', '18724764000195'),
    ('RENATO MUSSI IVO ESCRITORIO DE ADVOCACIA', '06030932802'),
    ('SEBASTIAO MARCOS RIOS BRAGA', '03940401000110'),
    ('SYSTEM JET COMERCIO E SERVICOS DE EQUIP', '12533092000154'),
    ('TAMOTO IMAKAWA', '21148830863'),
    ('TOLEDO FUSCA SILVIA SALLES DE TOLEDO', '10208698000199'),
    ('WALDELAYNE DE CASSIA F LEAL ME', '07622412000102'),
}

# Sem documento válido no JCC: só são criados com --criar-sem-documento.
CURATED_SAFE_NEW_NO_DOCUMENT = {
    ('DARCY MAIA DE OLIVEIRA', ''),
    ('LATIDOS E MIADOS DANIELLE R SAMPAIO', ''),
}


def only_digits(value: Optional[str]) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_name(value: Optional[str]) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = value.encode("ascii", "ignore").decode("ascii").upper()
    return re.sub(r"[^A-Z0-9]+", " ", value).strip()


def normalize_spaces(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def valid_document(value: Optional[str]) -> bool:
    doc = only_digits(value)
    return len(doc) in {11, 14} and doc not in PLACEHOLDER_DOCS and len(set(doc)) > 1


def infer_person_type(document: Optional[str], name: str) -> str:
    doc = only_digits(document)
    if len(doc) == 14 and valid_document(doc):
        return "PJ"
    if len(doc) == 11 and valid_document(doc):
        return "PF"
    business_tokens = (
        " LTDA", " EIRELI", " EMPRESA", " COMERCIO", " COMERCIAL", " INDUSTRIA",
        " ASSOCIACAO", " ASSOC ", " CONDOMINIO", " IGREJA", " PAROQUIA", " ACADEMIA",
        " SERVICOS", " S/S", " ME ", "- ME", " EPP", " ESCOLA", " CLINICA",
    )
    probe = f" {normalize_name(name)} "
    return "PJ" if any(token in probe for token in business_tokens) else "PF"


def parse_money(value: str) -> float:
    value = str(value or "0").strip().replace(".", "").replace(",", ".")
    return round(float(value or 0), 2)


@dataclass(frozen=True)
class JccClient:
    source_key: str
    name: str
    normalized_name: str
    cpf_cnpj: str
    normalized_document: str
    valid_document: bool
    city: str
    state: str
    title_count: int
    total_value: float
    documents: str


@dataclass
class ValoraClient:
    id: int
    code: str
    name: str
    fantasy_name: str
    cpf_cnpj: str
    city: str
    state: str

    @property
    def normalized_document(self) -> str:
        return only_digits(self.cpf_cnpj)

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
    jcc_cpf_cnpj: str
    jcc_city: str
    jcc_state: str
    jcc_title_count: int
    jcc_total_value: float
    valora_id: Optional[int] = None
    valora_code: str = ""
    valora_name: str = ""
    valora_cpf_cnpj: str = ""
    suggestion_1: str = ""
    suggestion_2: str = ""
    suggestion_3: str = ""
    created_now: bool = False


def load_source(path: Path) -> Tuple[List[dict], List[JccClient]]:
    if not path.exists():
        raise FileNotFoundError(f"Base JCC não encontrada: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if not rows:
        raise RuntimeError("A base JCC está vazia.")

    source_total = round(sum(parse_money(r.get("valor_total", "0")) for r in rows), 2)
    source_paid = round(sum(parse_money(r.get("valor_pago", "0")) for r in rows), 2)
    if len(rows) != EXPECTED_TITLE_COUNT or abs(source_total - EXPECTED_TOTAL) > 0.01 or abs(source_paid - EXPECTED_PAID) > 0.01:
        raise RuntimeError(
            "A base JCC normalizada não fecha com o relatório original: "
            f"linhas={len(rows)}, total={source_total:.2f}, pago={source_paid:.2f}."
        )

    # Identidade preserva nome + documento + cidade/UF. Isso evita fundir filiais/contas
    # diferentes do JCC que eventualmente compartilham CPF/CNPJ.
    grouped: Dict[Tuple[str, str, str, str], List[dict]] = defaultdict(list)
    for row in rows:
        name = normalize_spaces(row.get("cliente"))
        doc_raw = normalize_spaces(row.get("cpf_cnpj"))
        doc = only_digits(doc_raw) if valid_document(doc_raw) else ""
        city = normalize_spaces(row.get("cidade"))
        state = normalize_spaces(row.get("uf")).upper()
        grouped[(normalize_name(name), doc, normalize_name(city), state)].append(row)

    clients: List[JccClient] = []
    for (name_norm, doc_norm, city_norm, state), items in sorted(grouped.items()):
        first = items[0]
        source_key = "|".join([name_norm, doc_norm, city_norm, state])
        unique_docs = sorted({normalize_spaces(x.get("documento")) for x in items if normalize_spaces(x.get("documento"))})
        clients.append(JccClient(
            source_key=source_key,
            name=normalize_spaces(first.get("cliente")),
            normalized_name=name_norm,
            cpf_cnpj=normalize_spaces(first.get("cpf_cnpj")),
            normalized_document=doc_norm,
            valid_document=bool(doc_norm),
            city=normalize_spaces(first.get("cidade")),
            state=state,
            title_count=len(items),
            total_value=round(sum(parse_money(x.get("valor_total", "0")) for x in items), 2),
            documents=" | ".join(unique_docs),
        ))

    return rows, clients


def load_valora_clients(db, empresa_id: int) -> List[ValoraClient]:
    result = db.execute(text("""
        SELECT id, codigo, nome, COALESCE(nome_fantasia, '') AS nome_fantasia,
               COALESCE(cpf_cnpj, '') AS cpf_cnpj,
               COALESCE(cidade, '') AS cidade, COALESCE(estado, '') AS estado
        FROM public.clientes
        WHERE empresa_id = :empresa_id
        ORDER BY id
    """), {"empresa_id": empresa_id}).mappings().all()
    return [ValoraClient(
        id=int(r["id"]), code=str(r["codigo"] or ""), name=str(r["nome"] or ""),
        fantasy_name=str(r["nome_fantasia"] or ""), cpf_cnpj=str(r["cpf_cnpj"] or ""),
        city=str(r["cidade"] or ""), state=str(r["estado"] or ""),
    ) for r in result]


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def best_suggestions(jcc: JccClient, valora_clients: Sequence[ValoraClient], limit: int = 3) -> List[ValoraClient]:
    scored: List[Tuple[float, ValoraClient]] = []
    for c in valora_clients:
        score = max((similarity(jcc.normalized_name, n) for n in c.names), default=0.0)
        if jcc.city and c.city and normalize_name(jcc.city) == normalize_name(c.city):
            score += 0.03
        if jcc.state and c.state and jcc.state.upper() == c.state.upper():
            score += 0.01
        if score >= 0.62:
            scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], x[1].id))
    return [c for _, c in scored[:limit]]


def candidate_label(c: ValoraClient) -> str:
    doc = c.cpf_cnpj or "sem CPF/CNPJ"
    return f"#{c.id} cód. {c.code} — {c.name} — {doc}"


def reconcile(jcc_clients: Sequence[JccClient], valora_clients: Sequence[ValoraClient]) -> List[Decision]:
    by_doc: Dict[str, List[ValoraClient]] = defaultdict(list)
    by_name: Dict[str, List[ValoraClient]] = defaultdict(list)
    for c in valora_clients:
        if valid_document(c.cpf_cnpj):
            by_doc[c.normalized_document].append(c)
        for n in set(c.names):
            by_name[n].append(c)

    jcc_names_by_doc: Dict[str, set] = defaultdict(set)
    for j in jcc_clients:
        if j.valid_document:
            jcc_names_by_doc[j.normalized_document].add(j.normalized_name)

    decisions: List[Decision] = []
    for j in jcc_clients:
        decision = Decision(
            source_key=j.source_key, status="NOVO", reason="Não encontrado no Valora.",
            jcc_name=j.name, jcc_cpf_cnpj=j.cpf_cnpj, jcc_city=j.city, jcc_state=j.state,
            jcc_title_count=j.title_count, jcc_total_value=j.total_value,
        )

        doc_candidates = by_doc.get(j.normalized_document, []) if j.valid_document else []
        name_candidates = by_name.get(j.normalized_name, [])
        shared_doc_in_jcc = j.valid_document and len(jcc_names_by_doc[j.normalized_document]) > 1

        chosen: Optional[ValoraClient] = None

        if doc_candidates:
            exact_name_doc = [c for c in doc_candidates if j.normalized_name in c.names]
            if len(exact_name_doc) == 1:
                chosen = exact_name_doc[0]
                decision.status = "VINCULADO_CPF_CNPJ_NOME"
                decision.reason = "CPF/CNPJ e nome conferem exatamente."
            elif len(doc_candidates) == 1 and not shared_doc_in_jcc:
                candidate = doc_candidates[0]
                sim = max((similarity(j.normalized_name, n) for n in candidate.names), default=0.0)
                if sim >= 0.55:
                    chosen = candidate
                    decision.status = "VINCULADO_CPF_CNPJ"
                    decision.reason = "CPF/CNPJ confere; nome é diferente, mas compatível para revisão visual."
                else:
                    decision.status = "REVISAR_CPF_CNPJ_NOME_DIVERGENTE"
                    decision.reason = "CPF/CNPJ existe no Valora, mas o nome é muito diferente."
            elif len(doc_candidates) > 1:
                decision.status = "REVISAR_CPF_CNPJ_DUPLICADO_VALORA"
                decision.reason = "Há mais de um cliente no Valora com o mesmo CPF/CNPJ."
            else:
                decision.status = "REVISAR_DOCUMENTO_COMPARTILHADO_JCC"
                decision.reason = "O mesmo CPF/CNPJ aparece em cadastros JCC com nomes diferentes; não será fundido automaticamente."

        if chosen is None and not doc_candidates:
            if len(name_candidates) == 1:
                candidate = name_candidates[0]
                candidate_doc = candidate.normalized_document if valid_document(candidate.cpf_cnpj) else ""
                if j.valid_document and candidate_doc and candidate_doc != j.normalized_document:
                    decision.status = "REVISAR_NOME_DOCUMENTO_DIVERGENTE"
                    decision.reason = "Nome exato existe no Valora, mas com outro CPF/CNPJ."
                else:
                    chosen = candidate
                    if j.valid_document and not candidate_doc:
                        decision.status = "VINCULADO_NOME_DOCUMENTO_A_COMPLETAR"
                        decision.reason = "Nome exato encontrado; o cadastro Valora não possui CPF/CNPJ válido."
                    else:
                        decision.status = "VINCULADO_NOME"
                        decision.reason = "Nome exato encontrado no Valora."
            elif len(name_candidates) > 1:
                decision.status = "REVISAR_NOME_DUPLICADO_VALORA"
                decision.reason = "Há mais de um cliente no Valora com o mesmo nome normalizado."
            elif shared_doc_in_jcc:
                decision.status = "REVISAR_DOCUMENTO_COMPARTILHADO_JCC"
                decision.reason = "CPF/CNPJ compartilhado entre cadastros diferentes do JCC; criar automaticamente pode fundir clientes distintos."
            elif not j.valid_document:
                decision.status = "NOVO_SEM_DOCUMENTO_VALIDO"
                decision.reason = "Cliente não encontrado e o JCC usa CPF/CNPJ zerado/inválido."
            else:
                decision.status = "NOVO"
                decision.reason = "CPF/CNPJ e nome não existem no Valora."

        if chosen is not None:
            decision.valora_id = chosen.id
            decision.valora_code = chosen.code
            decision.valora_name = chosen.name
            decision.valora_cpf_cnpj = chosen.cpf_cnpj

        suggestions = best_suggestions(j, valora_clients)
        # Não repetir o cliente já escolhido como sugestão.
        suggestions = [c for c in suggestions if c.id != decision.valora_id][:3]
        labels = [candidate_label(c) for c in suggestions]
        decision.suggestion_1 = labels[0] if len(labels) > 0 else ""
        decision.suggestion_2 = labels[1] if len(labels) > 1 else ""
        decision.suggestion_3 = labels[2] if len(labels) > 2 else ""
        decisions.append(decision)

    return decisions



def curated_identity_key(j: JccClient) -> Tuple[str, str]:
    return (j.normalized_name, j.normalized_document if j.valid_document else "")


def apply_curated_review(
    decisions: List[Decision],
    jcc_map: Dict[str, JccClient],
    valora_clients: Sequence[ValoraClient],
) -> List[Decision]:
    """Aplica a revisão assistida sem criar nem alterar registros."""
    by_id = {c.id: c for c in valora_clients}

    for d in decisions:
        j = jcc_map[d.source_key]
        key = curated_identity_key(j)

        if key in CURATED_LINKS:
            target_id = CURATED_LINKS[key]
            target = by_id.get(target_id)
            if target is None:
                d.status = "REVISAR_VINCULO_REVISADO_ID_INEXISTENTE"
                d.reason = f"Revisão apontava para cliente #{target_id}, mas ele não existe mais no Valora."
                d.valora_id = None
                d.valora_code = ""
                d.valora_name = ""
                d.valora_cpf_cnpj = ""
                continue

            target_doc = target.normalized_document if valid_document(target.cpf_cnpj) else ""
            if j.valid_document and target_doc and target_doc != j.normalized_document:
                d.status = "REVISAR_VINCULO_REVISADO_DOCUMENTO_DIVERGENTE"
                d.reason = (
                    f"Cliente revisado #{target_id} agora possui CPF/CNPJ diferente do JCC; "
                    "vínculo automático bloqueado."
                )
                d.valora_id = None
                d.valora_code = ""
                d.valora_name = ""
                d.valora_cpf_cnpj = ""
                continue

            d.status = "VINCULADO_REVISAO_ASSISTIDA"
            d.reason = "Vínculo confirmado na revisão assistida para evitar criação de cliente duplicado."
            d.valora_id = target.id
            d.valora_code = target.code
            d.valora_name = target.name
            d.valora_cpf_cnpj = target.cpf_cnpj
            continue

        if key in CURATED_SAFE_NEW:
            d.status = "NOVO_SEGURO_REVISAO"
            d.reason = "Revisado: não foi identificado cliente equivalente no Valora; candidato seguro para criação."
            d.valora_id = None
            d.valora_code = ""
            d.valora_name = ""
            d.valora_cpf_cnpj = ""
            continue

        if key in CURATED_SAFE_NEW_NO_DOCUMENT:
            d.status = "NOVO_SEGURO_SEM_DOCUMENTO"
            d.reason = (
                "Revisado: não foi identificado cliente equivalente; JCC não possui CPF/CNPJ válido. "
                "Só criar com --criar-sem-documento."
            )
            d.valora_id = None
            d.valora_code = ""
            d.valora_name = ""
            d.valora_cpf_cnpj = ""

    return decisions


def recheck_before_create(db, empresa_id: int, j: JccClient) -> Optional[ValoraClient]:
    """Última trava contra duplicidade imediatamente antes do INSERT."""
    if j.valid_document:
        row = db.execute(text("""
            SELECT id, codigo, nome, COALESCE(nome_fantasia, '') AS nome_fantasia,
                   COALESCE(cpf_cnpj, '') AS cpf_cnpj,
                   COALESCE(cidade, '') AS cidade, COALESCE(estado, '') AS estado
            FROM public.clientes
            WHERE empresa_id=:empresa_id
              AND regexp_replace(COALESCE(cpf_cnpj,''), '[^0-9]', '', 'g')=:doc
            ORDER BY id
            LIMIT 1
        """), {"empresa_id": empresa_id, "doc": j.normalized_document}).mappings().first()
        if row:
            return ValoraClient(
                id=int(row["id"]), code=str(row["codigo"] or ""), name=str(row["nome"] or ""),
                fantasy_name=str(row["nome_fantasia"] or ""), cpf_cnpj=str(row["cpf_cnpj"] or ""),
                city=str(row["cidade"] or ""), state=str(row["estado"] or ""),
            )

    candidates = load_valora_clients(db, empresa_id)
    exact = [c for c in candidates if j.normalized_name in c.names]
    if len(exact) == 1:
        return exact[0]
    return None



def existing_codes(db, empresa_id: int) -> set[str]:
    rows = db.execute(text("SELECT codigo FROM public.clientes WHERE empresa_id=:empresa_id"), {"empresa_id": empresa_id}).all()
    result = set()
    for row in rows:
        digits = only_digits(row[0])
        if digits:
            result.add(digits)
    return result


def next_code_factory(used: set[str]):
    max_value = max((int(x) for x in used if x.isdigit()), default=0)
    current = max_value + 1
    while True:
        code = f"{current:04d}"
        current += 1
        if code not in used:
            used.add(code)
            yield code


def create_safe_missing_clients(db, empresa_id: int, decisions: List[Decision], jcc_map: Dict[str, JccClient], *, create_without_document: bool) -> int:
    used_codes = existing_codes(db, empresa_id)
    code_gen = next_code_factory(used_codes)
    created = 0

    for d in decisions:
        allowed = d.status == "NOVO_SEGURO_REVISAO" or (
            create_without_document and d.status == "NOVO_SEGURO_SEM_DOCUMENTO"
        )
        if not allowed:
            continue
        j = jcc_map[d.source_key]

        existing = recheck_before_create(db, empresa_id, j)
        if existing is not None:
            d.valora_id = existing.id
            d.valora_code = existing.code
            d.valora_name = existing.name
            d.valora_cpf_cnpj = existing.cpf_cnpj
            d.status = "VINCULADO_RECHECAGEM_ANTES_DE_CRIAR"
            d.reason = "Cadastro encontrado na rechecagem final; criação cancelada para evitar duplicidade."
            continue
        doc_value = j.cpf_cnpj if j.valid_document else None
        code = next(code_gen)
        observations = "Importado da base histórica JCC de Contas a Receber (08/2020)."
        if not j.valid_document and j.cpf_cnpj:
            observations += f" Documento informado no JCC: {j.cpf_cnpj} (inválido/zerado; não gravado como CPF/CNPJ)."

        row = db.execute(text("""
            INSERT INTO public.clientes (
                empresa_id, codigo, nome, tipo_pessoa, situacao,
                cpf_cnpj, cidade, estado, pais, observacoes,
                criado_em, atualizado_em
            ) VALUES (
                :empresa_id, :codigo, :nome, :tipo_pessoa, 'ativo',
                :cpf_cnpj, :cidade, :estado, 'Brasil', :observacoes,
                NOW(), NOW()
            )
            RETURNING id
        """), {
            "empresa_id": empresa_id,
            "codigo": code,
            "nome": j.name,
            "tipo_pessoa": infer_person_type(j.cpf_cnpj, j.name),
            "cpf_cnpj": doc_value,
            "cidade": j.city or None,
            "estado": j.state or None,
            "observacoes": observations,
        }).scalar_one()

        d.valora_id = int(row)
        d.valora_code = code
        d.valora_name = j.name
        d.valora_cpf_cnpj = doc_value or ""
        d.created_now = True
        d.status = "CRIADO_AGORA"
        d.reason = "Cliente não existia no Valora e foi criado pela importação JCC."
        created += 1

    return created


def write_reports(output_dir: Path, decisions: Sequence[Decision], *, empresa_id: int, source: Path, title_rows: Sequence[dict]) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = output_dir / f"jcc_clientes_conciliacao_empresa_{empresa_id}_{stamp}.csv"
    json_path = output_dir / f"jcc_clientes_conciliacao_empresa_{empresa_id}_{stamp}.json"

    fieldnames = list(asdict(decisions[0]).keys()) if decisions else []
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for d in decisions:
            row = asdict(d)
            row["jcc_total_value"] = f"{d.jcc_total_value:.2f}".replace(".", ",")
            writer.writerow(row)

    summary = Counter(d.status for d in decisions)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "empresa_id": empresa_id,
        "source": str(source),
        "source_titles": len(title_rows),
        "source_total": round(sum(parse_money(r.get("valor_total", "0")) for r in title_rows), 2),
        "source_paid": round(sum(parse_money(r.get("valor_pago", "0")) for r in title_rows), 2),
        "unique_jcc_clients": len(decisions),
        "status_counts": dict(sorted(summary.items())),
        "decisions": [asdict(d) for d in decisions],
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return csv_path, json_path


def print_summary(decisions: Sequence[Decision], title_rows: Sequence[dict], *, created: int = 0) -> None:
    counts = Counter(d.status for d in decisions)
    total = sum(parse_money(r.get("valor_total", "0")) for r in title_rows)
    paid = sum(parse_money(r.get("valor_pago", "0")) for r in title_rows)
    print("\n[Valora/JCC] CONCILIAÇÃO DE CLIENTES")
    print(f"Títulos na base JCC: {len(title_rows)}")
    print(f"Clientes/identidades JCC: {len(decisions)}")
    print(f"Total dos títulos: R$ {total:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
    print(f"Valor pago histórico: R$ {paid:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
    print(f"Saldo histórico: R$ {(total-paid):,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
    print("\nSituações:")
    for status, count in sorted(counts.items()):
        print(f"  {status}: {count}")
    if created:
        print(f"\nClientes criados nesta execução: {created}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Concilia clientes da base histórica JCC com os clientes do Valora sem duplicar cadastros."
    )
    parser.add_argument("--empresa-id", type=int, default=2, help="Empresa do Valora. Padrão: 2.")
    parser.add_argument("--arquivo", type=Path, default=DEFAULT_SOURCE, help="CSV normalizado da base JCC.")
    parser.add_argument("--saida", type=Path, default=DEFAULT_OUTPUT_DIR, help="Pasta dos relatórios.")
    parser.add_argument("--aplicar", action="store_true", help="Cria somente clientes aprovados como NOVO_SEGURO_REVISAO.")
    parser.add_argument(
        "--criar-sem-documento",
        action="store_true",
        help="Com --aplicar, também cria NOVO_SEM_DOCUMENTO_VALIDO sem gravar CPF/CNPJ zerado.",
    )
    args = parser.parse_args()

    title_rows, jcc_clients = load_source(args.arquivo)
    jcc_map = {j.source_key: j for j in jcc_clients}

    from backend.database import SessionLocal  # import tardio: permite validar a base sem abrir o driver do banco

    db = SessionLocal()
    try:
        company = db.execute(text("SELECT id, nome FROM public.empresas WHERE id=:id"), {"id": args.empresa_id}).mappings().first()
        if not company:
            print(f"ERRO: empresa_id={args.empresa_id} não existe.")
            return 2
        print(f"[Valora] Empresa: #{company['id']} — {company['nome']}")
        valora_clients = load_valora_clients(db, args.empresa_id)
        print(f"[Valora] Clientes atuais encontrados: {len(valora_clients)}")

        decisions = reconcile(jcc_clients, valora_clients)
        decisions = apply_curated_review(decisions, jcc_map, valora_clients)
        created = 0
        if args.aplicar:
            created = create_safe_missing_clients(
                db, args.empresa_id, decisions, jcc_map,
                create_without_document=args.criar_sem_documento,
            )
            db.commit()
        else:
            db.rollback()

        print_summary(decisions, title_rows, created=created)
        csv_path, json_path = write_reports(
            args.saida, decisions, empresa_id=args.empresa_id,
            source=args.arquivo, title_rows=title_rows,
        )
        print(f"\nRelatório CSV: {csv_path}")
        print(f"Relatório JSON: {json_path}")

        pending = [
            d for d in decisions
            if d.status.startswith("REVISAR_") or d.status in {"NOVO", "NOVO_SEM_DOCUMENTO_VALIDO"}
        ]
        if pending:
            pending_path = args.saida / (
                f"jcc_clientes_PENDENTES_empresa_{args.empresa_id}_"
                f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            )
            fields = list(asdict(pending[0]).keys())
            with pending_path.open("w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
                writer.writeheader()
                for item in pending:
                    row = asdict(item)
                    row["jcc_total_value"] = f"{item.jcc_total_value:.2f}".replace(".", ",")
                    writer.writerow(row)
            print(f"Pendências reduzidas para revisão: {pending_path}")
        if not args.aplicar:
            print("\nMODO PRÉVIA: nada foi gravado no banco.")
            print("Envie o CSV gerado para revisão antes de rodar com --aplicar.")
        else:
            pending_count = sum(1 for d in decisions if d.status.startswith("REVISAR_") or d.status in {"NOVO", "NOVO_SEM_DOCUMENTO_VALIDO"})
            print(f"Pendências para revisão manual: {pending_count}")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERRO: {type(exc).__name__}: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
