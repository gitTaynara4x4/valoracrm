"""Filtros dinâmicos compartilhados pelas listagens do Valora CRM.

A regra fica centralizada aqui para que um campo exibido no "Localizar" nunca
seja silenciosamente ignorado pelo backend e para que campos de escolha usem
comparação exata (por exemplo, "Ativo" não pode encontrar "Inativo").
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Set

from fastapi import HTTPException, Request
from sqlalchemy import String, and_, cast, func, or_
from sqlalchemy.sql.sqltypes import Boolean, Date, DateTime, Float, Integer, Numeric
from sqlalchemy.orm import Session

_FIELD_RE = re.compile(r"[A-Za-z0-9_]{1,120}")

_EXACT_CUSTOM_TYPES: Set[str] = {
    "select",
    "lista",
    "radio",
    "checkbox",
    "boolean",
    "booleano",
    "numero",
    "number",
    "data",
    "date",
    "moeda",
    "percentual",
    "relacao_cliente",
    "relacao_fornecedor",
    "relacao_produto",
    "relacao_patrimonio",
    "relacao_cotacao",
    "relacao_proposta",
    "relacao_contrato",
}

_MULTI_CUSTOM_TYPES: Set[str] = {
    "multiselect",
    "multi_select",
    "multi-select",
    "lista_multipla",
    "lista_múltipla",
    "relacao_cliente_multi",
    "relacao_fornecedor_multi",
    "relacao_produto_multi",
    "relacao_patrimonio_multi",
    "relacao_cotacao_multi",
    "relacao_proposta_multi",
    "relacao_contrato_multi",
}

_DIGIT_CUSTOM_TYPES: Set[str] = {"telefone", "tel", "celular", "documento", "cpf", "cnpj"}

_TRUE_VALUES = {"true", "1", "sim", "yes", "ativo"}
_FALSE_VALUES = {"false", "0", "nao", "não", "no", "inativo"}


def _normalize_type(value: Any) -> str:
    text = str(value or "texto").strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def parse_bool(value: Any) -> Optional[bool]:
    text = str(value or "").strip().lower()
    if text in _TRUE_VALUES:
        return True
    if text in _FALSE_VALUES:
        return False
    return None


def parse_decimal(value: Any) -> Optional[Decimal]:
    text = str(value or "").strip().replace(" ", "")
    if not text:
        return None

    # Aceita 1.234,56 e 1,234.56 sem depender da localidade do servidor.
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def parse_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def dynamic_query_filters(request: Request, prefix: str) -> Dict[str, str]:
    """Lê parâmetros como filtro_custom_meu_campo de forma segura."""
    out: Dict[str, str] = {}
    needle = f"{prefix}_"

    for key, value in request.query_params.multi_items():
        if not key.startswith(needle):
            continue
        field = key[len(needle):].strip()
        text = str(value or "").strip()
        if not field or not text or not _FIELD_RE.fullmatch(field):
            continue
        out[field] = text

    return out


def _text_expr(column: Any):
    return func.trim(func.coalesce(cast(column, String), ""))


def _lower_text_expr(column: Any):
    return func.lower(_text_expr(column))


def _common_digits_expr(column: Any):
    """Remove máscaras comuns de documento/telefone em PostgreSQL e SQLite."""
    expr = func.coalesce(cast(column, String), "")
    for char in (".", "-", "/", "(", ")", " ", "+", ","):
        expr = func.replace(expr, char, "")
    return expr


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _exact_text_condition(column: Any, raw: str):
    return _lower_text_expr(column) == raw.strip().lower()


def _multi_value_condition(column: Any, raw: str):
    """Compara um item inteiro em JSON-array, sem casar substrings.

    Ex.: procurar "Ativo" não encontra ["Inativo"]. Também aceita bases
    antigas em que um campo múltiplo foi salvo como valor simples.
    """
    normalized = raw.strip().lower()
    json_token = json.dumps(raw.strip(), ensure_ascii=False).lower()
    escaped_token = _escape_like(json_token)
    lowered = _lower_text_expr(column)
    return or_(
        lowered == normalized,
        lowered.like(f"%{escaped_token}%", escape="\\"),
    )


def _custom_value_condition(column: Any, field_type: str, raw: str):
    normalized_type = _normalize_type(field_type)
    lowered = _lower_text_expr(column)

    if normalized_type in {"checkbox", "boolean", "booleano"}:
        parsed = parse_bool(raw)
        if parsed is None:
            raise HTTPException(status_code=400, detail=f"Valor booleano inválido: {raw}")
        values = _TRUE_VALUES if parsed else _FALSE_VALUES
        return lowered.in_(sorted(values))

    if normalized_type in _MULTI_CUSTOM_TYPES or normalized_type.endswith("_multi"):
        return _multi_value_condition(column, raw)

    if normalized_type in _EXACT_CUSTOM_TYPES or normalized_type.startswith("relacao_"):
        return _exact_text_condition(column, raw)

    if normalized_type in _DIGIT_CUSTOM_TYPES:
        digits = re.sub(r"\D+", "", raw)
        if digits:
            return _common_digits_expr(column).like(f"%{digits}%")

    # Texto livre continua aceitando trecho, mas sempre exige uma linha real e
    # preenchida no campo personalizado.
    return lowered.like(f"%{_escape_like(raw.strip().lower())}%", escape="\\")


def _system_value_condition(
    column: Any,
    attr: str,
    raw: str,
    *,
    exact_fields: Set[str],
    digit_fields: Set[str],
):
    column_type = getattr(column, "type", None)

    if isinstance(column_type, Boolean):
        parsed = parse_bool(raw)
        if parsed is None:
            raise HTTPException(status_code=400, detail=f"Valor booleano inválido para {attr}: {raw}")
        return column == parsed

    if isinstance(column_type, DateTime):
        parsed = parse_date(raw)
        if parsed is None:
            raise HTTPException(status_code=400, detail=f"Data inválida para {attr}: {raw}")
        return func.date(column) == parsed.isoformat()

    if isinstance(column_type, Date):
        parsed = parse_date(raw)
        if parsed is None:
            raise HTTPException(status_code=400, detail=f"Data inválida para {attr}: {raw}")
        return column == parsed

    if isinstance(column_type, (Integer, Numeric, Float)):
        parsed = parse_decimal(raw)
        if parsed is None:
            raise HTTPException(status_code=400, detail=f"Número inválido para {attr}: {raw}")
        return column == parsed

    if attr in digit_fields:
        digits = re.sub(r"\D+", "", raw)
        if digits:
            return _common_digits_expr(column).like(f"%{digits}%")

    if attr in exact_fields:
        return _exact_text_condition(column, raw)

    return _lower_text_expr(column).like(
        f"%{_escape_like(raw.strip().lower())}%",
        escape="\\",
    )


def apply_dynamic_filters(
    query: Any,
    *,
    request: Request,
    db: Session,
    empresa_id: int,
    parent_model: Any,
    custom_field_model: Any,
    custom_value_model: Any,
    custom_parent_fk: str,
    system_aliases: Optional[Mapping[str, str]] = None,
    exact_system_fields: Optional[Iterable[str]] = None,
    digit_system_fields: Optional[Iterable[str]] = None,
    strict_unknown: bool = True,
):
    """Aplica filtros nativos e personalizados com semântica consistente.

    Campos desconhecidos geram erro 400 por padrão. É melhor mostrar que um
    filtro ficou incompatível do que ignorá-lo e devolver registros errados.
    """
    aliases = dict(system_aliases or {})
    exact_fields = set(exact_system_fields or ())
    digit_fields = set(digit_system_fields or ())

    for field, raw in dynamic_query_filters(request, "filtro_sistema").items():
        attr = aliases.get(field, field)
        column = getattr(parent_model, attr, None)
        if column is None:
            if strict_unknown:
                raise HTTPException(status_code=400, detail=f"Filtro de sistema desconhecido: {field}")
            continue
        query = query.filter(
            _system_value_condition(
                column,
                attr,
                raw,
                exact_fields=exact_fields,
                digit_fields=digit_fields,
            )
        )

    custom_filters = dynamic_query_filters(request, "filtro_custom")
    if not custom_filters:
        return query

    fields = (
        db.query(custom_field_model)
        .filter(custom_field_model.empresa_id == empresa_id)
        .filter(custom_field_model.slug.in_(list(custom_filters.keys())))
        .order_by(custom_field_model.id.desc())
        .all()
    )
    fields_by_slug: Dict[str, list[Any]] = {}
    for field in fields:
        fields_by_slug.setdefault(str(field.slug), []).append(field)

    unknown = sorted(set(custom_filters) - set(fields_by_slug))
    if unknown and strict_unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Filtro personalizado não encontrado: {', '.join(unknown)}",
        )

    parent_column = getattr(custom_value_model, custom_parent_fk)
    value_column = custom_value_model.valor

    for slug, raw in custom_filters.items():
        slug_fields = fields_by_slug.get(slug)
        if not slug_fields:
            continue

        # Bases antigas podem conter definições duplicadas do mesmo slug. Cada
        # valor é comparado usando o tipo da definição à qual ele pertence, sem
        # perder registros ligados a um campo antigo.
        per_definition_conditions = [
            and_(
                custom_value_model.campo_id == field.id,
                _custom_value_condition(value_column, getattr(field, "tipo", "texto"), raw),
            )
            for field in slug_fields
        ]

        # O EXISTS garante que registros sem valor (mostrados como '-') nunca
        # passem quando há uma opção selecionada no filtro.
        value_is_filled = func.length(func.trim(func.coalesce(value_column, ""))) > 0
        exists_filter = (
            db.query(custom_value_model.id)
            .filter(parent_column == parent_model.id)
            .filter(value_is_filled)
            .filter(or_(*per_definition_conditions))
            .exists()
        )
        query = query.filter(exists_filter)

    return query


__all__: Sequence[str] = (
    "apply_dynamic_filters",
    "dynamic_query_filters",
    "parse_bool",
)
