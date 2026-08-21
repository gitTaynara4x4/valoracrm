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

# Revisão assistida V6 final feita sobre os relatórios gerados em 21/08/2026.
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
    # Revisão V3 — confirmados a partir das 31 pendências da V2.
    ('ASSOC DA IGREJA METODISTA TERCEIRA REGIAO', ''): 4650,
    ('CHARLES NAN YONG TUNG', '12631578821'): 2375,
    ('CHARLES NAN YONG TUNG COMERCIO', '12631578821'): 2375,
    ('ELETRO VENDA TAUBATE LTDA LUIZ CARLOS DA', '04540326000162'): 4772,
    ('LABORATORIO SACE SERVICO DE ANALISES', ''): 5514,
    # Revisão V4 — vínculos seguros a partir do diagnóstico V3.
    ('EMILIO CENTRO AUTOMOTIVA EPP', '02173224000554'): 4778,
    ('EMILIO CENTRO AUTOMOTIVO LTDA', '02173224000805'): 4776,
    ('HELDER JOSE SILVEIRA FERRAZ', '53185412672'): 1722,
    ('IRACY OTAVIO CAMPHORA', '05794055839'): 1806,
    ('MARCHETTI MARCHETTI PIZZARIA LTDA EPP', '03544009000151'): 5021,
    ('SO CORTE', '05551251000188'): 5628,
    ('T T COMERCIAL E INDUSTRIA DE ALIMENTOS', '04227774000100'): 5030,
    # Revisão V5 — cidade/uso tornam estes vínculos inequívocos.
    ('L B KOBAL VESTUARIO E ACESSORIOS ME', '19639040000106'): 5501,
    ('LOJA PRETO E BRANCO L B KOBAL VESTUARIO E', '19639040000106'): 5500,
    ('PAULO ERNESTO MARQUES SILVA', '97756644891'): 1814,
    # Revisão V6 final — conferência cruzada com endereço/contato e identidade jurídica.
    ('ANA MARIA GOMES RAMOS ARAUJO', '01514059215'): 1653,
    ('CLAUDETE BEZERRA FARIAS', '15388673000138'): 5166,
    ('LABORATORIO EMILIO RIBAS ANALISES CLINICAS', '50463553000159'): 4674,
    ('LAMIA RAFATE SMAIDI EPP ART PE CALCADOS', '07029834000179'): 4877,
    ('MITRA DIOCESANA DE TAUBATE', '72293509000180'): 4678,
    ('MITRA DIOCESANA DE TAUBATE SEMINARIO S', '72293509000180'): 4678,
    ('PRISCILA DA S FEITOSA ME WALTER', '03867616000152'): 5441,
    ('RECOFER INDUSTRIA E COMERCIO DE', '56917891000108'): 5231,
}


# Exceção revisada: o cadastro atual é a mesma identidade operacional/nome,
# porém o documento histórico do JCC diverge. Nunca sobrescrevemos o documento
# atual do Valora; o documento JCC permanece apenas na origem histórica.
CURATED_LINKS_ALLOW_DOCUMENT_DIVERGENCE = {
    ('PRISCILA DA S FEITOSA ME WALTER', '03867616000152'),
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
    # Documento JCC é diferente do único cadastro semelhante existente;
    # preserva a identidade jurídica histórica como novo cliente.
    ('PICANHA E TRUTA RESTAURANTE E LANCHONETE', '06297643000125'),
    # Revisão V5 — CNPJ próprio e nenhum cadastro equivalente encontrado.
    ('MITRA DIOCESANA PAROQUIA SAO VICENTE DE', '48124865000196'),
    ('VALECAP PNEUS E TRUCK CENTER TAUBATE LTDA', '09356391000156'),
    # Revisão V6: não há cadastro equivalente com o mesmo CNPJ/endereço.
    ('IGREJA ASSEMBLEIA DE DEUS', '45170693000107'),
    # A filial 0027-10 é a Paróquia São Vicente de Paulo. As duas identidades
    # históricas abaixo serão consolidadas no mesmo cliente pelo CNPJ.
    ('MITRA DIOCESANA DE TAUBATE', '72293509002710'),
    ('MITRA DIOCESANA DE TAUBATE PAROQUIA SAO', '72293509002710'),
}

# Sem documento válido no JCC: só são criados com --criar-sem-documento.
CURATED_SAFE_NEW_NO_DOCUMENT = {
    ('DARCY MAIA DE OLIVEIRA', ''),
    ('LATIDOS E MIADOS DANIELLE R SAMPAIO', ''),
    # Revisão V3 — não há equivalente plausível entre os candidatos atuais.
    ('ESCRITORIO CONTABILIDADE MAURA', ''),
}


# Documento válido no JCC, porém já está gravado em um cadastro de nome
# totalmente incompatível. Para não anexar o histórico à pessoa errada e não
# duplicar o CPF no banco, cria-se o cliente histórico SEM CPF/CNPJ e registra-se
# o documento JCC apenas em observações.
CURATED_SAFE_NEW_CONFLICTING_DOCUMENT = {
    ('MARCOS ROBERTO MARTINS', '13149510848'),
}

# Dados cadastrais públicos usados somente para tornar os novos cadastros
# inequívocos. Não alteram cadastros já existentes.
CURATED_CREATE_OVERRIDES = {
    ('IGREJA ASSEMBLEIA DE DEUS', '45170693000107'): {
        'name': 'IGREJA EVANGELICA ASSEMBLEIA DE DEUS',
        'address': 'RUA DR EMILIO WINTHER',
        'number': '805',
        'neighborhood': 'CENTRO',
    },
    ('MITRA DIOCESANA DE TAUBATE', '72293509002710'): {
        'name': 'MITRA DIOCESANA DE TAUBATE - PAROQUIA SAO VICENTE DE PAULO',
        'address': 'AVENIDA ARMANDO DE MOURA',
        'number': '256',
        'neighborhood': '',
    },
    ('MITRA DIOCESANA DE TAUBATE PAROQUIA SAO', '72293509002710'): {
        'name': 'MITRA DIOCESANA DE TAUBATE - PAROQUIA SAO VICENTE DE PAULO',
        'address': 'AVENIDA ARMANDO DE MOURA',
        'number': '256',
        'neighborhood': '',
    },
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
    reference_code: str = ""
    address: str = ""
    number: str = ""
    neighborhood: str = ""
    phone: str = ""
    email: str = ""
    created_at: str = ""

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


def source_key_for_title_row(row: dict) -> str:
    name = normalize_spaces(row.get("cliente"))
    doc_raw = normalize_spaces(row.get("cpf_cnpj"))
    doc = only_digits(doc_raw) if valid_document(doc_raw) else ""
    city = normalize_spaces(row.get("cidade"))
    state = normalize_spaces(row.get("uf")).upper()
    return "|".join([normalize_name(name), doc, normalize_name(city), state])


def load_valora_clients(db, empresa_id: int) -> List[ValoraClient]:
    result = db.execute(text("""
        SELECT id, codigo, nome, COALESCE(nome_fantasia, '') AS nome_fantasia,
               COALESCE(cpf_cnpj, '') AS cpf_cnpj,
               COALESCE(cidade, '') AS cidade, COALESCE(estado, '') AS estado,
               COALESCE(codigo_referencia, '') AS codigo_referencia,
               COALESCE(endereco, '') AS endereco, COALESCE(numero, '') AS numero,
               COALESCE(bairro, '') AS bairro, COALESCE(telefone, '') AS telefone,
               COALESCE(email, '') AS email,
               COALESCE(criado_em::text, '') AS criado_em
        FROM public.clientes
        WHERE empresa_id = :empresa_id
        ORDER BY id
    """), {"empresa_id": empresa_id}).mappings().all()
    return [ValoraClient(
        id=int(r["id"]), code=str(r["codigo"] or ""), name=str(r["nome"] or ""),
        fantasy_name=str(r["nome_fantasia"] or ""), cpf_cnpj=str(r["cpf_cnpj"] or ""),
        city=str(r["cidade"] or ""), state=str(r["estado"] or ""),
        reference_code=str(r["codigo_referencia"] or ""), address=str(r["endereco"] or ""),
        number=str(r["numero"] or ""), neighborhood=str(r["bairro"] or ""),
        phone=str(r["telefone"] or ""), email=str(r["email"] or ""),
        created_at=str(r["criado_em"] or ""),
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


def candidate_label(c: ValoraClient, *, prefix: str = "", usage_counts: Optional[Dict[int, int]] = None) -> str:
    doc = c.cpf_cnpj or "sem CPF/CNPJ"
    local = " / ".join(x for x in [normalize_spaces(c.city), normalize_spaces(c.state).upper()] if x) or "local não informado"
    marker = f"{prefix} " if prefix else ""
    usage = int((usage_counts or {}).get(c.id, 0))
    extras: List[str] = []
    if normalize_spaces(c.fantasy_name) and normalize_name(c.fantasy_name) != normalize_name(c.name):
        extras.append(f"fantasia={normalize_spaces(c.fantasy_name)}")
    if normalize_spaces(c.reference_code):
        extras.append(f"ref={normalize_spaces(c.reference_code)}")
    endereco = " ".join(x for x in [normalize_spaces(c.address), normalize_spaces(c.number)] if x).strip()
    if endereco:
        if normalize_spaces(c.neighborhood):
            endereco += f" - {normalize_spaces(c.neighborhood)}"
        extras.append(f"end={endereco}")
    if normalize_spaces(c.phone):
        extras.append(f"tel={normalize_spaces(c.phone)}")
    if normalize_spaces(c.email):
        extras.append(f"email={normalize_spaces(c.email)}")
    if normalize_spaces(c.created_at):
        extras.append(f"criado={normalize_spaces(c.created_at)[:10]}")
    suffix = (" — " + " — ".join(extras)) if extras else ""
    return f"{marker}#{c.id} cód. {c.code} — {c.name} — {doc} — {local} — uso={usage}{suffix}"


def load_client_usage_counts(db, candidate_ids: Sequence[int]) -> Dict[int, int]:
    """Conta referências reais a clientes em todas as FKs do schema público.

    É apenas diagnóstico: não grava nada. Serve para distinguir cadastros duplicados
    visualmente iguais mostrando qual ID já é utilizado pelo restante do Valora.
    """
    ids = sorted({int(x) for x in candidate_ids if x is not None})
    counts: Dict[int, int] = {client_id: 0 for client_id in ids}
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
          AND con.confrelid = 'public.clientes'::regclass
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
            rows = db.execute(text(
                f'SELECT "{column_name}" AS cliente_id, COUNT(*) AS qtd '
                f'FROM "{schema}"."{table_name}" '
                f'WHERE "{column_name}" IN ({ids_sql}) '
                f'GROUP BY "{column_name}"'
            )).mappings().all()
        except Exception:
            # Diagnóstico não pode impedir a conciliação caso alguma tabela legada
            # esteja temporariamente indisponível. Reabre a transação após falha.
            db.rollback()
            continue
        for row in rows:
            cid = int(row["cliente_id"])
            counts[cid] = counts.get(cid, 0) + int(row["qtd"] or 0)
    return counts


def reconcile(jcc_clients: Sequence[JccClient], valora_clients: Sequence[ValoraClient], *, usage_counts: Optional[Dict[int, int]] = None) -> List[Decision]:
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

        # V3: o relatório de pendências precisa mostrar primeiro qualquer cadastro que
        # bate pelo CPF/CNPJ, mesmo quando o nome é muito diferente. Na V2 esse
        # candidato podia desaparecer porque as sugestões eram apenas por nome.
        suggestion_items: List[Tuple[ValoraClient, str]] = []
        seen_suggestion_ids = set()

        for c in doc_candidates:
            if c.id == decision.valora_id or c.id in seen_suggestion_ids:
                continue
            suggestion_items.append((c, "[CPF/CNPJ]") )
            seen_suggestion_ids.add(c.id)

        for c in best_suggestions(j, valora_clients, limit=6):
            if c.id == decision.valora_id or c.id in seen_suggestion_ids:
                continue
            suggestion_items.append((c, "[NOME]"))
            seen_suggestion_ids.add(c.id)
            if len(suggestion_items) >= 3:
                break

        labels = [candidate_label(c, prefix=prefix, usage_counts=usage_counts) for c, prefix in suggestion_items[:3]]
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
            if (
                j.valid_document
                and target_doc
                and target_doc != j.normalized_document
                and key not in CURATED_LINKS_ALLOW_DOCUMENT_DIVERGENCE
            ):
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
            if key in CURATED_LINKS_ALLOW_DOCUMENT_DIVERGENCE:
                d.reason = (
                    "Vínculo confirmado pela revisão assistida apesar do documento histórico divergente; "
                    "o CPF/CNPJ atual do Valora não será alterado."
                )
            else:
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
            continue

        if key in CURATED_SAFE_NEW_CONFLICTING_DOCUMENT:
            d.status = "NOVO_SEGURO_DOCUMENTO_CONFLITANTE"
            d.reason = (
                "Revisado: o documento JCC já pertence a cadastro de nome incompatível no Valora. "
                "Será criado um cliente histórico sem CPF/CNPJ para não vincular o título à pessoa errada."
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
                   COALESCE(cidade, '') AS cidade, COALESCE(estado, '') AS estado,
                   COALESCE(codigo_referencia, '') AS codigo_referencia,
                   COALESCE(endereco, '') AS endereco, COALESCE(numero, '') AS numero,
                   COALESCE(bairro, '') AS bairro, COALESCE(telefone, '') AS telefone,
                   COALESCE(email, '') AS email, COALESCE(criado_em::text, '') AS criado_em
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
                reference_code=str(row["codigo_referencia"] or ""), address=str(row["endereco"] or ""),
                number=str(row["numero"] or ""), neighborhood=str(row["bairro"] or ""),
                phone=str(row["telefone"] or ""), email=str(row["email"] or ""),
                created_at=str(row["criado_em"] or ""),
            )

    candidates = load_valora_clients(db, empresa_id)
    exact = [c for c in candidates if j.normalized_name in c.names]
    if len(exact) == 1:
        return exact[0]
    return None




def recheck_by_exact_name(db, empresa_id: int, j: JccClient) -> Optional[ValoraClient]:
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
        allowed = d.status in {"NOVO_SEGURO_REVISAO", "NOVO_SEGURO_DOCUMENTO_CONFLITANTE"} or (
            create_without_document and d.status == "NOVO_SEGURO_SEM_DOCUMENTO"
        )
        if not allowed:
            continue
        j = jcc_map[d.source_key]
        key = curated_identity_key(j)
        conflicting_document = d.status == "NOVO_SEGURO_DOCUMENTO_CONFLITANTE"

        existing = (
            recheck_by_exact_name(db, empresa_id, j)
            if conflicting_document
            else recheck_before_create(db, empresa_id, j)
        )
        if existing is not None:
            d.valora_id = existing.id
            d.valora_code = existing.code
            d.valora_name = existing.name
            d.valora_cpf_cnpj = existing.cpf_cnpj
            d.status = "VINCULADO_RECHECAGEM_ANTES_DE_CRIAR"
            d.reason = "Cadastro encontrado na rechecagem final; criação cancelada para evitar duplicidade."
            continue
        override = CURATED_CREATE_OVERRIDES.get(key, {})
        doc_value = None if conflicting_document else (j.cpf_cnpj if j.valid_document else None)
        code = next(code_gen)
        create_name = str(override.get("name") or j.name)
        observations = "Importado da base histórica JCC de Contas a Receber (08/2020)."
        if conflicting_document:
            observations += (
                f" Documento informado no JCC: {j.cpf_cnpj}; não gravado porque já está associado "
                "a outro cadastro de nome incompatível no Valora."
            )
        elif not j.valid_document and j.cpf_cnpj:
            observations += f" Documento informado no JCC: {j.cpf_cnpj} (inválido/zerado; não gravado como CPF/CNPJ)."

        row = db.execute(text("""
            INSERT INTO public.clientes (
                empresa_id, codigo, nome, tipo_pessoa, situacao,
                cpf_cnpj, cidade, estado, pais,
                endereco, numero, bairro, observacoes,
                criado_em, atualizado_em
            ) VALUES (
                :empresa_id, :codigo, :nome, :tipo_pessoa, 'ativo',
                :cpf_cnpj, :cidade, :estado, 'Brasil',
                :endereco, :numero, :bairro, :observacoes,
                NOW(), NOW()
            )
            RETURNING id
        """), {
            "empresa_id": empresa_id,
            "codigo": code,
            "nome": create_name,
            "tipo_pessoa": infer_person_type(j.cpf_cnpj, create_name),
            "cpf_cnpj": doc_value,
            "cidade": j.city or None,
            "estado": j.state or None,
            "endereco": override.get("address") or None,
            "numero": override.get("number") or None,
            "bairro": override.get("neighborhood") or None,
            "observacoes": observations,
        }).scalar_one()

        d.valora_id = int(row)
        d.valora_code = code
        d.valora_name = create_name
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


def write_pending_titles_report(
    output_dir: Path,
    pending: Sequence[Decision],
    title_rows: Sequence[dict],
    *,
    empresa_id: int,
) -> Optional[Path]:
    if not pending:
        return None
    by_key = {d.source_key: d for d in pending}
    rows_out: List[dict] = []
    for row in title_rows:
        key = source_key_for_title_row(row)
        d = by_key.get(key)
        if d is None:
            continue
        enriched = dict(row)
        enriched.update({
            "source_key": d.source_key,
            "decision_status": d.status,
            "decision_reason": d.reason,
            "valora_id": d.valora_id or "",
            "valora_code": d.valora_code,
            "valora_name": d.valora_name,
            "suggestion_1": d.suggestion_1,
            "suggestion_2": d.suggestion_2,
            "suggestion_3": d.suggestion_3,
        })
        rows_out.append(enriched)
    if not rows_out:
        return None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = output_dir / f"jcc_titulos_PENDENTES_empresa_{empresa_id}_{stamp}.csv"
    fieldnames = list(rows_out[0].keys())
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        writer.writerows(rows_out)
    return path


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
        description="Concilia clientes da base histórica JCC com os clientes do Valora sem duplicar cadastros (revisão V6 final)."
    )
    parser.add_argument("--empresa-id", type=int, default=2, help="Empresa do Valora. Padrão: 2.")
    parser.add_argument("--arquivo", type=Path, default=DEFAULT_SOURCE, help="CSV normalizado da base JCC.")
    parser.add_argument("--saida", type=Path, default=DEFAULT_OUTPUT_DIR, help="Pasta dos relatórios.")
    parser.add_argument("--aplicar", action="store_true", help="Cria clientes aprovados como novos seguros (inclusive conflito documental tratado sem CPF/CNPJ).")
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
        print("[Valora] Calculando uso dos cadastros para diagnosticar duplicidades...")
        usage_counts = load_client_usage_counts(db, [c.id for c in valora_clients])

        decisions = reconcile(jcc_clients, valora_clients, usage_counts=usage_counts)
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
            pending_titles_path = write_pending_titles_report(
                args.saida, pending, title_rows, empresa_id=args.empresa_id
            )
            if pending_titles_path:
                print(f"Títulos das pendências (diagnóstico por documento): {pending_titles_path}")
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
