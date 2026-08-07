from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session



def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def normalize(value: Any) -> Any:
    """Converte valores para uma forma JSON estável e comparável."""
    if isinstance(value, dict):
        return {str(key): normalize(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))}
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if value is None:
        return None
    return value


def json_dump(value: Any) -> str:
    return json.dumps(normalize(value), ensure_ascii=False, default=_json_default, sort_keys=True)


def json_load(value: Any, default: Any = None) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return default


def ensure_audit_schema(db: Session) -> None:
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


def _user_values(user: Any) -> tuple[Optional[int], str]:
    if user is None:
        return None, "Sistema"
    raw_id = getattr(user, "id", None)
    try:
        user_id = int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        user_id = None
    user_name = str(getattr(user, "nome", None) or "Sistema").strip() or "Sistema"
    return user_id, user_name


def _insert_change(
    db: Session,
    *,
    empresa_id: int,
    modulo: str,
    entidade_tipo: str,
    entidade_id: int,
    secao: Optional[str],
    campo: Optional[str],
    campo_nome: Optional[str],
    acao: str,
    before: Any,
    after: Any,
    user: Any = None,
    origem: str = "sistema",
) -> None:
    user_id, user_name = _user_values(user)
    db.execute(text("""
        INSERT INTO auditoria_alteracoes (
            empresa_id, modulo, entidade_tipo, entidade_id, secao, campo, campo_nome,
            acao, valor_anterior_json, valor_novo_json, usuario_id, usuario_nome, origem
        ) VALUES (
            :empresa_id, :modulo, :entidade_tipo, :entidade_id, :secao, :campo, :campo_nome,
            :acao, :anterior, :novo, :usuario_id, :usuario_nome, :origem
        )
    """), {
        "empresa_id": int(empresa_id),
        "modulo": str(modulo),
        "entidade_tipo": str(entidade_tipo),
        "entidade_id": int(entidade_id),
        "secao": secao,
        "campo": campo,
        "campo_nome": campo_nome,
        "acao": str(acao),
        "anterior": json_dump(before) if before is not None else None,
        "novo": json_dump(after) if after is not None else None,
        "usuario_id": user_id,
        "usuario_nome": user_name,
        "origem": str(origem or "sistema"),
    })


def record_change(
    db: Session,
    *,
    empresa_id: int,
    modulo: str,
    entidade_tipo: str,
    entidade_id: int,
    secao: Optional[str],
    campo: Optional[str],
    campo_nome: Optional[str],
    acao: str,
    before: Any,
    after: Any,
    user: Any = None,
    origem: str = "sistema",
) -> None:
    _insert_change(
        db,
        empresa_id=empresa_id,
        modulo=modulo,
        entidade_tipo=entidade_tipo,
        entidade_id=entidade_id,
        secao=secao,
        campo=campo,
        campo_nome=campo_nome,
        acao=acao,
        before=before,
        after=after,
        user=user,
        origem=origem,
    )


def record_section_changes(
    db: Session,
    *,
    empresa_id: int,
    modulo: str,
    entidade_tipo: str,
    entidade_id: int,
    before_sections: Optional[Dict[str, Any]],
    after_sections: Optional[Dict[str, Any]],
    user: Any = None,
    labels: Optional[Dict[str, str]] = None,
    field_labels: Optional[Dict[str, str]] = None,
    origem: str = "sistema",
) -> int:
    """Registra diferenças por seção e por campo.

    Dicionários são comparados campo a campo. Listas e outros valores complexos
    são registrados como uma única alteração da seção, preservando o estado
    anterior e o novo para auditoria.
    """
    before_sections = before_sections or {}
    after_sections = after_sections or {}
    labels = labels or {}
    field_labels = field_labels or {}
    changes = 0

    for section_key in sorted(set(before_sections) | set(after_sections)):
        before = normalize(before_sections.get(section_key))
        after = normalize(after_sections.get(section_key))
        if before == after:
            continue

        section_name = labels.get(section_key, section_key.replace("_", " ").title())
        if isinstance(before, dict) and isinstance(after, dict):
            for field in sorted(set(before) | set(after)):
                old_value = before.get(field)
                new_value = after.get(field)
                if old_value == new_value:
                    continue
                action = "adicionado" if old_value in (None, "", [], {}) and new_value not in (None, "", [], {}) else (
                    "removido" if new_value in (None, "", [], {}) and old_value not in (None, "", [], {}) else "alterado"
                )
                _insert_change(
                    db,
                    empresa_id=empresa_id,
                    modulo=modulo,
                    entidade_tipo=entidade_tipo,
                    entidade_id=entidade_id,
                    secao=section_name,
                    campo=str(field),
                    campo_nome=field_labels.get(str(field), str(field).replace("_", " ").title()),
                    acao=action,
                    before=old_value,
                    after=new_value,
                    user=user,
                    origem=origem,
                )
                changes += 1
        else:
            action = "adicionado" if before in (None, "", [], {}) else ("removido" if after in (None, "", [], {}) else "alterado")
            _insert_change(
                db,
                empresa_id=empresa_id,
                modulo=modulo,
                entidade_tipo=entidade_tipo,
                entidade_id=entidade_id,
                secao=section_name,
                campo=None,
                campo_nome=section_name,
                acao=action,
                before=before,
                after=after,
                user=user,
                origem=origem,
            )
            changes += 1

    return changes


def list_history(
    db: Session,
    *,
    empresa_id: int,
    modulo: str,
    entidade_tipo: str,
    entidade_id: int,
    limit: int = 200,
) -> list[dict]:
    rows = db.execute(text("""
        SELECT id, secao, campo, campo_nome, acao, valor_anterior_json,
               valor_novo_json, usuario_id, usuario_nome, origem, criado_em
        FROM auditoria_alteracoes
        WHERE empresa_id=:empresa_id AND modulo=:modulo
          AND entidade_tipo=:entidade_tipo AND entidade_id=:entidade_id
        ORDER BY criado_em DESC, id DESC
        LIMIT :limit
    """), {
        "empresa_id": int(empresa_id),
        "modulo": str(modulo),
        "entidade_tipo": str(entidade_tipo),
        "entidade_id": int(entidade_id),
        "limit": max(1, min(int(limit), 1000)),
    }).mappings().all()

    return [{
        **dict(row),
        "valor_anterior": json_load(row.get("valor_anterior_json")),
        "valor_novo": json_load(row.get("valor_novo_json")),
        "criado_em": row.get("criado_em").isoformat() if row.get("criado_em") else None,
    } for row in rows]


def count_history(
    db: Session,
    *,
    empresa_id: int,
    modulo: str,
    entidade_tipo: str,
    entidade_id: int,
) -> int:
    total = db.execute(text("""
        SELECT COUNT(*)
        FROM auditoria_alteracoes
        WHERE empresa_id=:empresa_id AND modulo=:modulo
          AND entidade_tipo=:entidade_tipo AND entidade_id=:entidade_id
    """), {
        "empresa_id": int(empresa_id),
        "modulo": str(modulo),
        "entidade_tipo": str(entidade_tipo),
        "entidade_id": int(entidade_id),
    }).scalar()
    return int(total or 0)
