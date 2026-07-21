from __future__ import annotations

import csv
import html
import io
import json
import re
import unicodedata
from collections import OrderedDict, defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import String, cast, func, inspect as sa_inspect
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal
from backend.dynamic_filters import apply_dynamic_filters, parse_bool
from backend.security.permissions import get_current_user, user_has_permission

router = APIRouter(prefix="/api/exportacoes", tags=["Exportações"])


# -----------------------------------------------------------------------------
# Sessão / autenticação
# -----------------------------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -----------------------------------------------------------------------------
# Configuração dos módulos
# -----------------------------------------------------------------------------
COMMON_LABELS: Dict[str, str] = {
    "id": "ID interno",
    "codigo": "Código",
    "nome": "Nome",
    "nome_fantasia": "Nome fantasia",
    "tipo_pessoa": "Tipo de pessoa",
    "tipo_fornecedor": "Tipo de fornecedor",
    "situacao": "Situação",
    "status": "Status",
    "ativo": "Ativo",
    "cpf_cnpj": "CPF/CNPJ",
    "rg_ie": "RG/Inscrição estadual",
    "inscricao_estadual": "Inscrição estadual",
    "inscricao_municipal": "Inscrição municipal",
    "suframa": "SUFRAMA",
    "data_nascimento": "Data de nascimento",
    "codigo_referencia": "Código de referência",
    "retencao_percentual": "Retenção (%)",
    "telefone": "Telefone",
    "telefone_agencia": "Telefone da agência",
    "whatsapp": "WhatsApp",
    "fax": "Fax",
    "email": "E-mail",
    "email_nfe": "E-mail NF-e",
    "email_cobranca": "E-mail de cobrança",
    "email_fiscal": "E-mail fiscal",
    "email_destino": "E-mail de destino",
    "site": "Site",
    "contato": "Contato",
    "parceiro_comercial": "Parceiro comercial",
    "percentual_comissao": "Comissão (%)",
    "percentual_desconto": "Desconto (%)",
    "regiao": "Região",
    "segmento": "Segmento",
    "modalidade_pagamento": "Modalidade de pagamento",
    "classificacao": "Classificação",
    "cep": "CEP",
    "endereco": "Endereço",
    "logradouro": "Logradouro",
    "numero": "Número",
    "complemento": "Complemento",
    "bairro": "Bairro",
    "cidade": "Cidade",
    "estado": "UF/Estado",
    "pais": "País",
    "codigo_ibge_cidade": "Código IBGE da cidade",
    "codigo_ibge_uf": "Código IBGE da UF",
    "observacoes": "Observações",
    "descricao": "Descrição",
    "categoria": "Categoria",
    "unidade": "Unidade",
    "preco_venda": "Preço de venda",
    "custo": "Custo",
    "estoque_atual": "Estoque atual",
    "codigo_barras": "Código de barras",
    "nome_generico": "Nome genérico",
    "marca": "Marca",
    "modelo": "Modelo",
    "numero_serie": "Número de série",
    "localizacao": "Localização",
    "responsavel": "Responsável",
    "valor_aquisicao": "Valor de aquisição",
    "data_aquisicao": "Data de aquisição",
    "item_nome": "Item desejado",
    "quantidade": "Quantidade",
    "urgencia": "Urgência",
    "fornecedor_vencedor_id": "ID do fornecedor vencedor",
    "fornecedor_vencedor_item_id": "ID da proposta vencedora",
    "produto_id": "ID do produto",
    "valor_aprovado": "Valor aprovado",
    "data_aprovacao": "Data de aprovação",
    "criado_em": "Data de cadastro",
    "atualizado_em": "Última atualização",
    "tipo_endereco": "Tipo de endereço",
    "empresa_nome": "Empresa",
    "data_ultima_compra": "Data da última compra",
    "valor_ultima_compra": "Valor da última compra",
    "valor_prestacao": "Valor da prestação",
    "vencimento_ultima_parcela": "Vencimento da última parcela",
    "banco": "Banco",
    "agencia": "Agência",
    "conta_corrente": "Conta corrente",
    "gerente": "Gerente",
    "limite_credito": "Limite de crédito",
    "cpf": "CPF",
    "rg": "RG",
    "cargo": "Cargo",
    "participacao_percentual": "Participação (%)",
    "data_movimento": "Data do movimento",
    "tipo": "Tipo",
    "usuario_id": "ID do usuário",
    "usuario_nome": "Usuário",
    "nome_original": "Nome original",
    "nome_armazenado": "Nome armazenado",
    "mime_type": "Tipo do arquivo",
    "tamanho_bytes": "Tamanho (bytes)",
    "caminho_relativo": "Caminho do arquivo",
    "limite_compras": "Limite de compras",
    "plano_contas": "Plano de contas",
    "fornecedor_id": "ID do fornecedor",
    "fornecedor_nome": "Fornecedor",
    "valor_unitario": "Valor unitário",
    "frete": "Frete",
    "valor_total": "Valor total",
    "prazo_entrega": "Prazo de entrega",
    "condicao_pagamento": "Condição de pagamento",
    "vencedor": "Vencedor",
}


MODULES: Dict[str, Dict[str, Any]] = {
    "clientes": {
        "title": "Clientes",
        "singular": "Cliente",
        "model": models.Cliente,
        "custom_field_model": models.CampoCliente,
        "custom_value_model": models.ClienteCampoValor,
        "custom_parent_fk": "cliente_id",
        "order": [
            "codigo", "nome", "nome_fantasia", "tipo_pessoa", "situacao", "cpf_cnpj", "rg_ie",
            "inscricao_municipal", "suframa", "data_nascimento", "codigo_referencia",
            "retencao_percentual", "telefone", "whatsapp", "fax", "email", "email_nfe",
            "email_cobranca", "email_fiscal", "site", "contato", "parceiro_comercial",
            "percentual_comissao", "percentual_desconto", "regiao", "segmento",
            "modalidade_pagamento", "classificacao", "cep", "endereco", "numero",
            "complemento", "bairro", "cidade", "estado", "pais", "codigo_ibge_cidade",
            "codigo_ibge_uf", "observacoes", "criado_em", "atualizado_em", "id",
        ],
        "search_fields": ["codigo", "nome", "nome_fantasia", "cpf_cnpj", "telefone", "whatsapp", "email", "cidade"],
        "filter_fields": {"situacao": "situacao", "tipo_pessoa": "tipo_pessoa", "cidade": "cidade"},
        "system_aliases": {"tipo": "tipo_pessoa", "documento": "cpf_cnpj", "contato": "telefone", "cidade_uf": "cidade", "status": "situacao", "data_cadastro": "criado_em", "ativo": "situacao"},
        "exact_system_fields": {"tipo_pessoa", "situacao", "estado"},
        "digit_system_fields": {"codigo", "cpf_cnpj", "rg_ie", "inscricao_municipal", "suframa", "telefone", "whatsapp", "fax", "cep", "codigo_ibge_cidade", "codigo_ibge_uf"},
        "title_fields": ("codigo", "nome"),
        "nested": [
            ("Endereços adicionais", models.ClienteEndereco, "cliente_id"),
            ("Referências comerciais", models.ClienteReferenciaComercial, "cliente_id"),
            ("Referências bancárias", models.ClienteReferenciaBancaria, "cliente_id"),
            ("Sócios", models.ClienteSocio, "cliente_id"),
            ("Ocorrências", models.ClienteOcorrencia, "cliente_id"),
            ("Anexos", models.ClienteAnexo, "cliente_id"),
        ],
    },
    "fornecedores": {
        "title": "Fornecedores",
        "singular": "Fornecedor",
        "model": models.Fornecedor,
        "custom_field_model": models.CampoFornecedor,
        "custom_value_model": models.FornecedorCampoValor,
        "custom_parent_fk": "fornecedor_id",
        "order": [
            "codigo", "nome", "nome_fantasia", "tipo_fornecedor", "situacao", "cpf_cnpj",
            "inscricao_estadual", "inscricao_municipal", "contato", "telefone", "whatsapp",
            "fax", "email", "site", "cep", "endereco", "numero", "complemento", "bairro",
            "cidade", "estado", "pais", "codigo_ibge_cidade", "codigo_ibge_uf",
            "limite_compras", "classificacao", "plano_contas", "observacoes", "criado_em",
            "atualizado_em", "id",
        ],
        "search_fields": ["codigo", "nome", "nome_fantasia", "cpf_cnpj", "telefone", "whatsapp", "email", "cidade"],
        "filter_fields": {"situacao": "situacao", "tipo": "tipo_fornecedor", "cidade": "cidade"},
        "system_aliases": {"tipo": "tipo_fornecedor", "fornecedor": "nome", "documento": "cpf_cnpj", "contato": "telefone", "cidade_uf": "cidade", "status": "situacao", "data_cadastro": "criado_em"},
        "exact_system_fields": {"tipo_fornecedor", "situacao", "estado"},
        "digit_system_fields": {"codigo", "cpf_cnpj", "inscricao_estadual", "inscricao_municipal", "telefone", "whatsapp", "fax", "cep", "codigo_ibge_cidade", "codigo_ibge_uf"},
        "title_fields": ("codigo", "nome"),
        "nested": [],
    },
    "produtos": {
        "title": "Produtos",
        "singular": "Produto",
        "model": models.Produto,
        "custom_field_model": models.CampoProduto,
        "custom_value_model": models.ProdutoCampoValor,
        "custom_parent_fk": "produto_id",
        "order": [
            "codigo", "nome", "descricao", "categoria", "unidade", "preco_venda", "custo",
            "estoque_atual", "ativo", "criado_em", "atualizado_em", "id",
        ],
        "search_fields": ["codigo", "nome", "descricao", "categoria"],
        "filter_fields": {"categoria": "categoria", "ativo": "ativo"},
        "system_aliases": {"produto": "nome", "nome_produto": "nome", "preco": "preco_venda", "estoque": "estoque_atual", "situacao": "ativo", "status": "ativo", "data_cadastro": "criado_em"},
        "exact_system_fields": {"unidade"},
        "digit_system_fields": {"codigo", "codigo_barras"},
        "title_fields": ("codigo", "nome"),
        "nested": [],
    },
    "patrimonio": {
        "title": "Patrimônio",
        "singular": "Patrimônio",
        "model": models.Patrimonio,
        "custom_field_model": models.CampoPatrimonio,
        "custom_value_model": models.PatrimonioCampoValor,
        "custom_parent_fk": "patrimonio_id",
        "order": [
            "codigo", "nome", "descricao", "categoria", "marca", "modelo", "numero_serie",
            "localizacao", "responsavel", "status", "valor_aquisicao", "data_aquisicao",
            "observacoes", "ativo", "criado_em", "atualizado_em", "id",
        ],
        "search_fields": ["codigo", "nome", "numero_serie", "localizacao", "responsavel", "categoria"],
        "filter_fields": {"status": "status", "categoria": "categoria", "ativo": "ativo"},
        "system_aliases": {"patrimonio": "nome", "situacao": "status", "data_cadastro": "criado_em"},
        "exact_system_fields": {"status"},
        "digit_system_fields": {"codigo", "numero_serie"},
        "title_fields": ("codigo", "nome"),
        "nested": [],
    },
    "cotacoes": {
        "title": "Cotações",
        "singular": "Cotação",
        "model": models.Cotacao,
        "custom_field_model": models.CampoCotacao,
        "custom_value_model": models.CotacaoCampoValor,
        "custom_parent_fk": "cotacao_id",
        "order": [
            "codigo", "item_nome", "descricao", "quantidade", "unidade", "categoria", "status",
            "urgencia", "fornecedor_vencedor_id", "fornecedor_vencedor_item_id", "valor_aprovado",
            "data_aprovacao", "produto_id", "observacoes", "criado_em", "atualizado_em", "id",
        ],
        "search_fields": ["codigo", "item_nome", "descricao", "categoria"],
        "filter_fields": {"status": "status", "categoria": "categoria"},
        "system_aliases": {"item": "item_nome", "produto": "item_nome", "situacao": "status", "data_cadastro": "criado_em"},
        "exact_system_fields": {"status", "urgencia"},
        "digit_system_fields": {"codigo"},
        "title_fields": ("codigo", "item_nome"),
        "nested": [("Fornecedores cotados", models.CotacaoFornecedor, "cotacao_id")],
    },
}


# -----------------------------------------------------------------------------
# Utilidades de dados
# -----------------------------------------------------------------------------
def _humanize(key: str) -> str:
    if key in COMMON_LABELS:
        return COMMON_LABELS[key]
    return str(key or "").replace("_", " ").strip().capitalize()


def _normalize_for_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _parse_custom_value(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return _normalize_for_json(value)

    text = value.strip()
    if not text:
        return None

    if (text.startswith("[") and text.endswith("]")) or (text.startswith("{") and text.endswith("}")):
        try:
            parsed = json.loads(text)
            return parsed
        except Exception:
            pass
    return text


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _format_display(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if isinstance(value, datetime):
        return value.astimezone().strftime("%d/%m/%Y %H:%M") if value.tzinfo else value.strftime("%d/%m/%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        text = f"{value:,.2f}"
        return text.replace(",", "X").replace(".", ",").replace("X", ".")
    if isinstance(value, dict):
        return "; ".join(f"{_humanize(str(k))}: {_format_display(v)}" for k, v in value.items() if _is_filled(v))
    if isinstance(value, (list, tuple, set)):
        return ", ".join(_format_display(item) for item in value if _is_filled(item))
    text = str(value).strip()
    # Datas ISO salvas como texto.
    match_dt = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?", text)
    if match_dt:
        return f"{match_dt.group(3)}/{match_dt.group(2)}/{match_dt.group(1)} {match_dt.group(4)}:{match_dt.group(5)}"
    match_date = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    if match_date:
        return f"{match_date.group(3)}/{match_date.group(2)}/{match_date.group(1)}"
    return text


def _safe_filename(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("._")
    return text or "exportacao"


def _ordered_columns(model: Any, preferred: Sequence[str]) -> List[str]:
    available = [column.key for column in sa_inspect(model).columns if column.key != "empresa_id"]
    seen = set()
    ordered: List[str] = []
    for key in preferred:
        if key in available and key not in seen:
            ordered.append(key)
            seen.add(key)
    for key in available:
        if key not in seen:
            ordered.append(key)
            seen.add(key)
    return ordered


def _serialize_model_row(row: Any, *, preferred: Sequence[str], exclude: Iterable[str] = ()) -> OrderedDict:
    excluded = set(exclude)
    out: OrderedDict[str, Any] = OrderedDict()
    for key in _ordered_columns(type(row), preferred):
        if key in excluded:
            continue
        out[key] = _normalize_for_json(getattr(row, key, None))
    return out



def _apply_filters(query: Any, config: Mapping[str, Any], request: Request, db: Session, empresa_id: int):
    model = config["model"]

    ids_raw = str(request.query_params.get("ids") or "").strip()
    if ids_raw:
        ids: List[int] = []
        for item in ids_raw.split(","):
            try:
                ids.append(int(item.strip()))
            except (TypeError, ValueError):
                continue
        if ids:
            query = query.filter(model.id.in_(ids))

    busca = str(request.query_params.get("busca") or "").strip()
    if busca:
        q = f"%{busca}%"
        conditions = []
        for field in config.get("search_fields", []):
            column = getattr(model, field, None)
            if column is not None:
                conditions.append(cast(column, String).ilike(q))
        if conditions:
            cond = conditions[0]
            for item in conditions[1:]:
                cond = cond | item
            query = query.filter(cond)

    for param, field in config.get("filter_fields", {}).items():
        raw = str(request.query_params.get(param) or "").strip()
        if not raw:
            continue
        column = getattr(model, field, None)
        if column is None:
            continue
        if field == "ativo":
            parsed = parse_bool(raw)
            if parsed is not None:
                query = query.filter(column == parsed)
        elif field in set(config.get("exact_system_fields", ())):
            query = query.filter(
                func.lower(func.trim(cast(column, String))) == raw.lower()
            )
        elif param in {"cidade", "categoria"}:
            query = query.filter(cast(column, String).ilike(f"%{raw}%"))
        else:
            query = query.filter(cast(column, String) == raw)

    query = apply_dynamic_filters(
        query,
        request=request,
        db=db,
        empresa_id=empresa_id,
        parent_model=model,
        custom_field_model=config["custom_field_model"],
        custom_value_model=config["custom_value_model"],
        custom_parent_fk=config["custom_parent_fk"],
        system_aliases=config.get("system_aliases", {}),
        exact_system_fields=config.get("exact_system_fields", ()),
        digit_system_fields=config.get("digit_system_fields", ()),
    )

    return query


def _build_dataset(modulo: str, request: Request, db: Session, empresa_id: int, filled_only: bool) -> Dict[str, Any]:
    config = MODULES[modulo]
    model = config["model"]
    query = db.query(model).filter(model.empresa_id == empresa_id)
    query = _apply_filters(query, config, request, db, empresa_id)

    # Ordenação previsível: código, nome/item e ID.
    order_columns = []
    for key in config.get("title_fields", ()):
        column = getattr(model, key, None)
        if column is not None:
            order_columns.append(column.asc())
    order_columns.append(model.id.asc())
    rows = query.order_by(*order_columns).all()

    ids = [int(row.id) for row in rows]

    custom_field_model = config["custom_field_model"]
    custom_value_model = config["custom_value_model"]
    parent_fk = config["custom_parent_fk"]

    custom_fields = (
        db.query(custom_field_model)
        .filter(custom_field_model.empresa_id == empresa_id)
        .order_by(custom_field_model.ordem.asc(), custom_field_model.id.asc())
        .all()
    )
    custom_by_id = {int(field.id): field for field in custom_fields}
    custom_values_by_parent: Dict[int, Dict[str, Any]] = defaultdict(dict)

    if ids:
        value_rows = (
            db.query(custom_value_model)
            .filter(getattr(custom_value_model, parent_fk).in_(ids))
            .all()
        )
        for value_row in value_rows:
            field = custom_by_id.get(int(value_row.campo_id))
            if not field:
                continue
            value = _parse_custom_value(value_row.valor)
            if filled_only and not _is_filled(value):
                continue
            custom_values_by_parent[int(getattr(value_row, parent_fk))][str(field.slug)] = value

    nested_by_section: Dict[str, Dict[int, List[OrderedDict]]] = {}
    for section_title, nested_model, nested_fk in config.get("nested", []):
        parent_map: Dict[int, List[OrderedDict]] = defaultdict(list)
        if ids:
            nested_rows = (
                db.query(nested_model)
                .filter(getattr(nested_model, nested_fk).in_(ids))
                .order_by(getattr(nested_model, nested_fk).asc(), nested_model.id.asc())
                .all()
            )
            for nested_row in nested_rows:
                serialized = _serialize_model_row(
                    nested_row,
                    preferred=[],
                    exclude={nested_fk},
                )
                if filled_only:
                    serialized = OrderedDict((k, v) for k, v in serialized.items() if _is_filled(v))
                if serialized:
                    parent_map[int(getattr(nested_row, nested_fk))].append(serialized)
        nested_by_section[section_title] = parent_map

    native_keys = _ordered_columns(model, config.get("order", []))
    field_defs = [
        {"key": key, "label": _humanize(key), "custom": False}
        for key in native_keys
    ]
    custom_defs = [
        {
            "key": str(field.slug),
            "label": str(field.nome or field.slug),
            "custom": True,
            "type": str(getattr(field, "tipo", "") or ""),
            "active": bool(getattr(field, "ativo", True)),
        }
        for field in custom_fields
    ]

    records: List[Dict[str, Any]] = []
    for row in rows:
        native = _serialize_model_row(row, preferred=config.get("order", []), exclude={"empresa_id"})
        if filled_only:
            native = OrderedDict((k, v) for k, v in native.items() if _is_filled(v))

        custom = OrderedDict()
        values = custom_values_by_parent.get(int(row.id), {})
        for definition in custom_defs:
            value = values.get(definition["key"])
            if filled_only and not _is_filled(value):
                continue
            custom[definition["key"]] = value

        nested = OrderedDict()
        for section_title, _, _ in config.get("nested", []):
            items = nested_by_section.get(section_title, {}).get(int(row.id), [])
            if items or not filled_only:
                nested[section_title] = items

        code_key, name_key = config.get("title_fields", ("codigo", "nome"))
        code = _format_display(getattr(row, code_key, None))
        name = _format_display(getattr(row, name_key, None))
        title = " - ".join(part for part in (code, name) if part) or f"Registro #{row.id}"

        records.append({
            "id": int(row.id),
            "title": title,
            "native": native,
            "custom": custom,
            "nested": nested,
        })

    # Quando o usuário pede somente preenchidos, elimina também colunas sem nenhum valor em todo o conjunto.
    if filled_only:
        native_used = {key for record in records for key, value in record["native"].items() if _is_filled(value)}
        custom_used = {key for record in records for key, value in record["custom"].items() if _is_filled(value)}
        field_defs = [definition for definition in field_defs if definition["key"] in native_used]
        custom_defs = [definition for definition in custom_defs if definition["key"] in custom_used]

    empresa = db.query(models.Empresa).filter(models.Empresa.id == empresa_id).first()
    generated_at = datetime.now().astimezone()

    return {
        "module": modulo,
        "title": config["title"],
        "singular": config["singular"],
        "company": {
            "id": empresa_id,
            "name": getattr(empresa, "nome", None) or "Valora CRM",
            "cnpj": getattr(empresa, "cnpj", None),
            "email": getattr(empresa, "email", None),
            "phone": getattr(empresa, "telefone", None),
            "city": getattr(empresa, "cidade", None),
            "state": getattr(empresa, "estado", None),
        },
        "generated_at": generated_at.isoformat(),
        "total": len(records),
        "filled_only": filled_only,
        "native_fields": field_defs,
        "custom_fields": custom_defs,
        "records": records,
    }


# -----------------------------------------------------------------------------
# Exportadores
# -----------------------------------------------------------------------------
def _pdf_paragraph(value: Any, style: Any):
    from reportlab.platypus import Paragraph

    text = _format_display(value)
    return Paragraph(html.escape(text).replace("\n", "<br/>"), style)


def build_pdf(dataset: Mapping[str, Any]) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.colors import HexColor
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Biblioteca de PDF não instalada no servidor.") from exc

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=15 * mm,
        bottomMargin=16 * mm,
        title=f"Relatório completo de {dataset['title']}",
        author=str(dataset.get("company", {}).get("name") or "Valora CRM"),
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ValoraTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=HexColor("#0F172A"),
        alignment=TA_LEFT,
        spaceAfter=4 * mm,
    )
    meta_style = ParagraphStyle(
        "ValoraMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=HexColor("#64748B"),
        spaceAfter=1.5 * mm,
    )
    record_style = ParagraphStyle(
        "ValoraRecord",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        textColor=HexColor("#0F172A"),
        spaceBefore=2 * mm,
        spaceAfter=3 * mm,
    )
    section_style = ParagraphStyle(
        "ValoraSection",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=HexColor("#0F766E"),
        spaceBefore=3 * mm,
        spaceAfter=1.5 * mm,
    )
    label_style = ParagraphStyle(
        "ValoraLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.2,
        leading=10.5,
        textColor=HexColor("#334155"),
    )
    value_style = ParagraphStyle(
        "ValoraValue",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.4,
        leading=11,
        textColor=HexColor("#0F172A"),
    )
    empty_style = ParagraphStyle(
        "ValoraEmpty",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=9,
        textColor=HexColor("#64748B"),
        alignment=TA_CENTER,
    )

    native_labels = {field["key"]: field["label"] for field in dataset.get("native_fields", [])}
    custom_labels = {field["key"]: field["label"] for field in dataset.get("custom_fields", [])}

    def split_long_text(value: Any, limit: int = 900) -> List[str]:
        text_value = _format_display(value)
        if len(text_value) <= limit:
            return [text_value]

        chunks: List[str] = []
        remaining = text_value
        while len(remaining) > limit:
            cut = remaining.rfind(" ", 0, limit)
            if cut < max(80, limit // 3):
                cut = limit
            chunks.append(remaining[:cut].strip())
            remaining = remaining[cut:].strip()
        if remaining:
            chunks.append(remaining)
        return chunks or [text_value]

    def field_table(values: Mapping[str, Any], labels: Mapping[str, str]):
        rows = []
        for key, value in values.items():
            if not _is_filled(value):
                continue
            chunks = split_long_text(value)
            for chunk_index, chunk in enumerate(chunks):
                label_text = labels.get(key, _humanize(key)) if chunk_index == 0 else ""
                rows.append([
                    Paragraph(html.escape(label_text), label_style),
                    Paragraph(html.escape(chunk).replace("\n", "<br/>"), value_style),
                ])
        if not rows:
            return Paragraph("Nenhum dado preenchido nesta seção.", empty_style)
        table = Table(rows, colWidths=[48 * mm, 125 * mm], hAlign="LEFT", repeatRows=0)
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (0, -1), HexColor("#F8FAFC")),
            ("GRID", (0, 0), (-1, -1), 0.35, HexColor("#E2E8F0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return table

    story: List[Any] = []
    story.append(Paragraph(f"Relatório completo de {html.escape(str(dataset['title']))}", title_style))

    company = dataset.get("company", {})
    company_bits = [str(company.get("name") or "Valora CRM")]
    if company.get("cnpj"):
        company_bits.append(f"CNPJ: {company['cnpj']}")
    story.append(Paragraph(" | ".join(html.escape(bit) for bit in company_bits), meta_style))

    generated = datetime.fromisoformat(str(dataset["generated_at"]))
    story.append(Paragraph(
        f"Relatório emitido em: {generated.strftime('%d/%m/%Y %H:%M:%S')} | Registros: {dataset['total']}",
        meta_style,
    ))
    story.append(Spacer(1, 2 * mm))

    records = list(dataset.get("records", []))
    if not records:
        story.append(Paragraph("Nenhum registro encontrado para os filtros selecionados.", empty_style))

    for index, record in enumerate(records):
        if index:
            story.append(PageBreak())

        story.append(Paragraph(
            f"{html.escape(str(dataset['singular']).upper())}: {html.escape(str(record['title']))}",
            record_style,
        ))

        story.append(Paragraph("Dados do cadastro", section_style))
        story.append(field_table(record.get("native", {}), native_labels))

        if record.get("custom"):
            story.append(Paragraph("Campos personalizados", section_style))
            story.append(field_table(record.get("custom", {}), custom_labels))

        for section_title, items in record.get("nested", {}).items():
            if not items:
                continue
            story.append(Paragraph(html.escape(str(section_title)), section_style))
            for item_index, item in enumerate(items, 1):
                if len(items) > 1:
                    story.append(Paragraph(f"Item {item_index}", meta_style))
                story.append(field_table(item, {key: _humanize(key) for key in item.keys()}))
                if item_index < len(items):
                    story.append(Spacer(1, 2 * mm))

    def draw_page(canvas, doc_obj):
        canvas.saveState()
        canvas.setStrokeColor(HexColor("#E2E8F0"))
        canvas.setLineWidth(0.5)
        canvas.line(14 * mm, 12 * mm, A4[0] - 14 * mm, 12 * mm)
        canvas.setFillColor(HexColor("#64748B"))
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(14 * mm, 7.5 * mm, "Gerado pelo Valora CRM")
        canvas.drawRightString(A4[0] - 14 * mm, 7.5 * mm, f"Página {doc_obj.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return buffer.getvalue()


def _flatten_main_rows(dataset: Mapping[str, Any]) -> Tuple[List[Tuple[str, str]], List[Dict[str, Any]]]:
    fields: List[Tuple[str, str]] = []
    for field in dataset.get("native_fields", []):
        fields.append((f"native:{field['key']}", field["label"]))
    for field in dataset.get("custom_fields", []):
        fields.append((f"custom:{field['key']}", f"Personalizado - {field['label']}"))

    rows: List[Dict[str, Any]] = []
    for record in dataset.get("records", []):
        flat: Dict[str, Any] = {}
        for key, value in record.get("native", {}).items():
            flat[f"native:{key}"] = value
        for key, value in record.get("custom", {}).items():
            flat[f"custom:{key}"] = value
        for section, items in record.get("nested", {}).items():
            flat[f"nested:{section}"] = items
        rows.append(flat)

    # Seções relacionadas entram como colunas-resumo no CSV/TXT. No Excel também ganham abas próprias.
    nested_names: List[str] = []
    for record in dataset.get("records", []):
        for section in record.get("nested", {}).keys():
            if section not in nested_names:
                nested_names.append(section)
    for section in nested_names:
        fields.append((f"nested:{section}", section))

    return fields, rows


def _excel_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (list, tuple, dict)):
        return _format_display(value)
    return _format_display(value)


def _unique_sheet_name(name: str, used: set[str]) -> str:
    base = re.sub(r"[\[\]:*?/\\]", "-", str(name or "Dados"))[:31] or "Dados"
    candidate = base
    counter = 2
    while candidate in used:
        suffix = f" {counter}"
        candidate = f"{base[:31-len(suffix)]}{suffix}"
        counter += 1
    used.add(candidate)
    return candidate


def build_xlsx(dataset: Mapping[str, Any]) -> bytes:
    try:
        import xlsxwriter
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Biblioteca de Excel não instalada no servidor.") from exc

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    workbook.set_properties({
        "title": f"Relatório completo de {dataset['title']}",
        "subject": "Exportação do Valora CRM",
        "author": str(dataset.get("company", {}).get("name") or "Valora CRM"),
        "company": str(dataset.get("company", {}).get("name") or "Valora CRM"),
    })

    fmt_title = workbook.add_format({"bold": True, "font_size": 18, "font_color": "#0F172A"})
    fmt_label = workbook.add_format({"bold": True, "font_color": "#475569", "bg_color": "#F8FAFC", "border": 1, "border_color": "#E2E8F0"})
    fmt_header = workbook.add_format({
        "bold": True,
        "font_color": "#FFFFFF",
        "bg_color": "#0F766E",
        "border": 1,
        "border_color": "#0F766E",
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
    })
    fmt_text = workbook.add_format({"border": 1, "border_color": "#E2E8F0", "valign": "top", "text_wrap": True})
    fmt_number = workbook.add_format({"border": 1, "border_color": "#E2E8F0", "valign": "top", "num_format": "#,##0.00"})
    fmt_meta = workbook.add_format({"font_color": "#64748B"})

    used_names: set[str] = set()
    summary = workbook.add_worksheet(_unique_sheet_name("Resumo", used_names))
    summary.set_column("A:A", 24)
    summary.set_column("B:B", 60)
    summary.write("A1", f"Relatório completo de {dataset['title']}", fmt_title)
    generated = datetime.fromisoformat(str(dataset["generated_at"]))
    summary_rows = [
        ("Empresa", dataset.get("company", {}).get("name") or ""),
        ("CNPJ", dataset.get("company", {}).get("cnpj") or ""),
        ("Módulo", dataset["title"]),
        ("Registros exportados", dataset["total"]),
        ("Emitido em", generated.strftime("%d/%m/%Y %H:%M:%S")),
        ("Conteúdo", "Todos os campos preenchidos, incluindo campos personalizados."),
    ]
    for row_index, (label, value) in enumerate(summary_rows, 2):
        summary.write(row_index, 0, label, fmt_label)
        summary.write(row_index, 1, value, fmt_text)

    fields, rows = _flatten_main_rows(dataset)
    main = workbook.add_worksheet(_unique_sheet_name(dataset["title"], used_names))
    main.freeze_panes(1, 0)
    main.set_row(0, 34)

    for col, (_, label) in enumerate(fields):
        main.write(0, col, label, fmt_header)

    widths = [max(12, min(42, len(label) + 2)) for _, label in fields]
    for row_idx, row in enumerate(rows, 1):
        for col_idx, (key, _) in enumerate(fields):
            value = row.get(key)
            cell_value = _excel_value(value)
            if isinstance(cell_value, (int, float)) and not isinstance(cell_value, bool):
                main.write_number(row_idx, col_idx, cell_value, fmt_number)
            else:
                main.write(row_idx, col_idx, cell_value, fmt_text)
            widths[col_idx] = min(42, max(widths[col_idx], min(42, len(str(cell_value)) + 2)))

    if fields:
        main.autofilter(0, 0, max(0, len(rows)), len(fields) - 1)
    for col_idx, width in enumerate(widths):
        main.set_column(col_idx, col_idx, width)

    # Abas extras para listas relacionadas, preservando cada campo separadamente.
    native_code_key = next((field["key"] for field in dataset.get("native_fields", []) if field["key"] == "codigo"), None)
    native_name_key = next((field["key"] for field in dataset.get("native_fields", []) if field["key"] in {"nome", "item_nome"}), None)

    section_names: List[str] = []
    for record in dataset.get("records", []):
        for section in record.get("nested", {}).keys():
            if section not in section_names:
                section_names.append(section)

    for section in section_names:
        section_rows: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
        section_keys: List[str] = []
        for record in dataset.get("records", []):
            for item in record.get("nested", {}).get(section, []):
                section_rows.append((record, item))
                for key in item.keys():
                    if key not in section_keys:
                        section_keys.append(key)
        if not section_rows:
            continue

        ws = workbook.add_worksheet(_unique_sheet_name(section, used_names))
        headers = ["Código do cadastro", "Cadastro"] + [_humanize(key) for key in section_keys]
        for col, label in enumerate(headers):
            ws.write(0, col, label, fmt_header)
        ws.freeze_panes(1, 0)
        section_widths = [18, 34] + [max(12, min(42, len(label) + 2)) for label in headers[2:]]

        for row_idx, (record, item) in enumerate(section_rows, 1):
            code = record.get("native", {}).get(native_code_key) if native_code_key else record.get("id")
            name = record.get("native", {}).get(native_name_key) if native_name_key else record.get("title")
            values = [code, name] + [item.get(key) for key in section_keys]
            for col_idx, value in enumerate(values):
                cell_value = _excel_value(value)
                if isinstance(cell_value, (int, float)) and not isinstance(cell_value, bool):
                    ws.write_number(row_idx, col_idx, cell_value, fmt_number)
                else:
                    ws.write(row_idx, col_idx, cell_value, fmt_text)
                section_widths[col_idx] = min(42, max(section_widths[col_idx], min(42, len(str(cell_value)) + 2)))

        ws.autofilter(0, 0, len(section_rows), len(headers) - 1)
        for col_idx, width in enumerate(section_widths):
            ws.set_column(col_idx, col_idx, width)

    workbook.close()
    return output.getvalue()


def build_csv(dataset: Mapping[str, Any]) -> bytes:
    fields, rows = _flatten_main_rows(dataset)
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow([label for _, label in fields])
    for row in rows:
        writer.writerow([_format_display(row.get(key)) for key, _ in fields])
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def build_txt(dataset: Mapping[str, Any]) -> bytes:
    native_labels = {field["key"]: field["label"] for field in dataset.get("native_fields", [])}
    custom_labels = {field["key"]: field["label"] for field in dataset.get("custom_fields", [])}
    generated = datetime.fromisoformat(str(dataset["generated_at"]))

    lines = [
        f"RELATÓRIO COMPLETO DE {str(dataset['title']).upper()}",
        f"Empresa: {dataset.get('company', {}).get('name') or 'Valora CRM'}",
        f"Emitido em: {generated.strftime('%d/%m/%Y %H:%M:%S')}",
        f"Registros: {dataset['total']}",
        "=" * 90,
    ]

    for index, record in enumerate(dataset.get("records", []), 1):
        lines.extend(["", f"{dataset['singular'].upper()} {index}: {record['title']}", "-" * 90])
        for key, value in record.get("native", {}).items():
            if _is_filled(value):
                lines.append(f"{native_labels.get(key, _humanize(key))}: {_format_display(value)}")
        if record.get("custom"):
            lines.extend(["", "CAMPOS PERSONALIZADOS"])
            for key, value in record["custom"].items():
                if _is_filled(value):
                    lines.append(f"{custom_labels.get(key, _humanize(key))}: {_format_display(value)}")
        for section, items in record.get("nested", {}).items():
            if not items:
                continue
            lines.extend(["", str(section).upper()])
            for item_index, item in enumerate(items, 1):
                lines.append(f"Item {item_index}")
                for key, value in item.items():
                    if _is_filled(value):
                        lines.append(f"  {_humanize(key)}: {_format_display(value)}")
        lines.extend(["", "=" * 90])

    return "\n".join(lines).encode("utf-8-sig")


def build_json(dataset: Mapping[str, Any]) -> bytes:
    return json.dumps(dataset, ensure_ascii=False, indent=2).encode("utf-8")


FORMATTERS = {
    "pdf": (build_pdf, "application/pdf"),
    "xlsx": (build_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "csv": (build_csv, "text/csv; charset=utf-8"),
    "json": (build_json, "application/json; charset=utf-8"),
    "txt": (build_txt, "text/plain; charset=utf-8"),
}


@router.get("/{modulo}/{formato}")
def exportar_modulo(
    modulo: str,
    formato: str,
    request: Request,
    somente_preenchidos: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    modulo = str(modulo or "").strip().lower()
    formato = str(formato or "").strip().lower()

    if modulo not in MODULES:
        raise HTTPException(status_code=404, detail="Módulo de exportação não encontrado.")
    if formato not in FORMATTERS:
        raise HTTPException(status_code=400, detail="Formato inválido. Use PDF, XLSX, CSV, JSON ou TXT.")

    if not user_has_permission(db, current_user, modulo, "ver"):
        raise HTTPException(
            status_code=403,
            detail=f"Sem permissão para ver em {modulo}.",
        )

    empresa_id = int(current_user.empresa_id)
    dataset = _build_dataset(modulo, request, db, empresa_id, filled_only=bool(somente_preenchidos))

    formatter, media_type = FORMATTERS[formato]
    content = formatter(dataset)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{_safe_filename(modulo)}_{stamp}.{formato}"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "X-Valora-Export-Count": str(dataset["total"]),
    }
    return Response(content=content, media_type=media_type, headers=headers)
