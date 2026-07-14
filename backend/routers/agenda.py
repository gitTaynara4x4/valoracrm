from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend import models
from backend.security.permissions import get_current_user, get_db, user_has_permission


router = APIRouter(prefix="/api/agenda", tags=["Agenda e histórico"])

SAO_PAULO = ZoneInfo("America/Sao_Paulo")

EntityType = Literal["cliente", "fornecedor", "produto"]
ItemType = Literal["registro", "lembrete"]

ENTITY_CONFIG: Dict[str, Tuple[str, Any]] = {
    "cliente": ("clientes", models.Cliente),
    "fornecedor": ("fornecedores", models.Fornecedor),
    "produto": ("produtos", models.Produto),
}


class AgendaItemCreate(BaseModel):
    entidade_tipo: EntityType
    entidade_id: int = Field(gt=0)
    tipo: ItemType = "registro"
    assunto: str = Field(min_length=1, max_length=180)
    descricao: Optional[str] = Field(default=None, max_length=8000)
    agendado_para: Optional[datetime] = None


class AgendaItemUpdate(BaseModel):
    assunto: Optional[str] = Field(default=None, min_length=1, max_length=180)
    descricao: Optional[str] = Field(default=None, max_length=8000)
    agendado_para: Optional[datetime] = None


class AgendaStatusUpdate(BaseModel):
    status: Literal["pendente", "concluido", "cancelado"]


def ensure_agenda_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_itens (
                id BIGSERIAL PRIMARY KEY,
                empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                entidade_tipo VARCHAR(30) NOT NULL,
                entidade_id BIGINT NOT NULL,
                entidade_nome VARCHAR(180) NOT NULL,
                tipo VARCHAR(20) NOT NULL,
                assunto VARCHAR(180) NOT NULL,
                descricao TEXT NULL,
                agendado_para TIMESTAMPTZ NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'registrado',
                responsavel_usuario_id BIGINT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
                criado_por_usuario_id BIGINT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
                criado_por_nome VARCHAR(120) NULL,
                notificado_em TIMESTAMPTZ NULL,
                concluido_em TIMESTAMPTZ NULL,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_agenda_entidade_tipo
                    CHECK (entidade_tipo IN ('cliente', 'fornecedor', 'produto')),
                CONSTRAINT ck_agenda_tipo
                    CHECK (tipo IN ('registro', 'lembrete')),
                CONSTRAINT ck_agenda_status
                    CHECK (status IN ('registrado', 'pendente', 'concluido', 'cancelado'))
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_agenda_itens_entidade
            ON agenda_itens (empresa_id, entidade_tipo, entidade_id, criado_em DESC)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_agenda_itens_responsavel_pendentes
            ON agenda_itens (empresa_id, responsavel_usuario_id, status, agendado_para)
            WHERE tipo = 'lembrete'
            """
        )
    )
    db.commit()


def normalize_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=SAO_PAULO)
    return value.astimezone(timezone.utc)


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def serialize_row(row: Any) -> Dict[str, Any]:
    data = dict(row)
    for key in (
        "agendado_para",
        "notificado_em",
        "concluido_em",
        "criado_em",
        "atualizado_em",
    ):
        data[key] = iso(data.get(key))
    return data


def require_entity_permission(db: Session, user: models.Usuario, entidade_tipo: str, action: str) -> None:
    config = ENTITY_CONFIG.get(entidade_tipo)
    if not config:
        raise HTTPException(status_code=400, detail="Tipo de cadastro inválido.")
    module, _ = config
    if not user_has_permission(db, user, module, action):
        raise HTTPException(
            status_code=403,
            detail=f"Sem permissão para {action} em {module}.",
        )


def get_entity(db: Session, user: models.Usuario, entidade_tipo: str, entidade_id: int) -> Any:
    config = ENTITY_CONFIG.get(entidade_tipo)
    if not config:
        raise HTTPException(status_code=400, detail="Tipo de cadastro inválido.")

    _, model = config
    entity = (
        db.query(model)
        .filter(model.id == entidade_id, model.empresa_id == int(user.empresa_id))
        .first()
    )
    if not entity:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    return entity


def get_item(db: Session, user: models.Usuario, item_id: int) -> Dict[str, Any]:
    ensure_agenda_table(db)
    row = (
        db.execute(
            text(
                """
                SELECT *
                FROM agenda_itens
                WHERE id = :item_id AND empresa_id = :empresa_id
                """
            ),
            {"item_id": item_id, "empresa_id": int(user.empresa_id)},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Item de agenda não encontrado.")
    return dict(row)


@router.get("/entidade/{entidade_tipo}/{entidade_id}")
def list_entity_items(
    entidade_tipo: EntityType,
    entidade_id: int,
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    require_entity_permission(db, current_user, entidade_tipo, "ver")
    get_entity(db, current_user, entidade_tipo, entidade_id)
    ensure_agenda_table(db)

    rows = (
        db.execute(
            text(
                """
                SELECT *
                FROM agenda_itens
                WHERE empresa_id = :empresa_id
                  AND entidade_tipo = :entidade_tipo
                  AND entidade_id = :entidade_id
                ORDER BY
                  CASE WHEN tipo = 'lembrete' AND status = 'pendente' THEN 0 ELSE 1 END,
                  COALESCE(agendado_para, criado_em) DESC,
                  id DESC
                LIMIT :limit
                """
            ),
            {
                "empresa_id": int(current_user.empresa_id),
                "entidade_tipo": entidade_tipo,
                "entidade_id": entidade_id,
                "limit": limit,
            },
        )
        .mappings()
        .all()
    )
    return [serialize_row(row) for row in rows]


@router.post("/itens", status_code=status.HTTP_201_CREATED)
def create_item(
    payload: AgendaItemCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    require_entity_permission(db, current_user, payload.entidade_tipo, "editar")
    entity = get_entity(db, current_user, payload.entidade_tipo, payload.entidade_id)
    ensure_agenda_table(db)

    assunto = payload.assunto.strip()
    descricao = (payload.descricao or "").strip() or None
    agendado_para = normalize_datetime(payload.agendado_para)

    if payload.tipo == "lembrete" and agendado_para is None:
        raise HTTPException(status_code=400, detail="Informe a data e o horário do lembrete.")

    status_value = "pendente" if payload.tipo == "lembrete" else "registrado"
    entidade_nome = str(getattr(entity, "nome", None) or getattr(entity, "descricao", None) or f"Cadastro #{entity.id}")

    row = (
        db.execute(
            text(
                """
                INSERT INTO agenda_itens (
                    empresa_id,
                    entidade_tipo,
                    entidade_id,
                    entidade_nome,
                    tipo,
                    assunto,
                    descricao,
                    agendado_para,
                    status,
                    responsavel_usuario_id,
                    criado_por_usuario_id,
                    criado_por_nome
                ) VALUES (
                    :empresa_id,
                    :entidade_tipo,
                    :entidade_id,
                    :entidade_nome,
                    :tipo,
                    :assunto,
                    :descricao,
                    :agendado_para,
                    :status,
                    :responsavel_usuario_id,
                    :criado_por_usuario_id,
                    :criado_por_nome
                )
                RETURNING *
                """
            ),
            {
                "empresa_id": int(current_user.empresa_id),
                "entidade_tipo": payload.entidade_tipo,
                "entidade_id": int(payload.entidade_id),
                "entidade_nome": entidade_nome[:180],
                "tipo": payload.tipo,
                "assunto": assunto,
                "descricao": descricao,
                "agendado_para": agendado_para,
                "status": status_value,
                "responsavel_usuario_id": int(current_user.id) if payload.tipo == "lembrete" else None,
                "criado_por_usuario_id": int(current_user.id),
                "criado_por_nome": str(current_user.nome or "Usuário")[:120],
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    return serialize_row(row)


@router.patch("/itens/{item_id}")
def update_item(
    item_id: int,
    payload: AgendaItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    item = get_item(db, current_user, item_id)
    require_entity_permission(db, current_user, str(item["entidade_tipo"]), "editar")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return serialize_row(item)

    assunto = updates.get("assunto")
    if assunto is not None:
        assunto = assunto.strip()
        if not assunto:
            raise HTTPException(status_code=400, detail="O assunto é obrigatório.")

    descricao = updates.get("descricao")
    if descricao is not None:
        descricao = descricao.strip() or None

    agendado_para = item.get("agendado_para")
    if "agendado_para" in updates:
        agendado_para = normalize_datetime(updates.get("agendado_para"))
        if item.get("tipo") == "lembrete" and agendado_para is None:
            raise HTTPException(status_code=400, detail="Informe a data e o horário do lembrete.")

    row = (
        db.execute(
            text(
                """
                UPDATE agenda_itens
                SET assunto = COALESCE(:assunto, assunto),
                    descricao = :descricao,
                    agendado_para = :agendado_para,
                    notificado_em = CASE
                        WHEN :reset_notificado THEN NULL
                        ELSE notificado_em
                    END,
                    atualizado_em = NOW()
                WHERE id = :item_id AND empresa_id = :empresa_id
                RETURNING *
                """
            ),
            {
                "assunto": assunto,
                "descricao": descricao if "descricao" in updates else item.get("descricao"),
                "agendado_para": agendado_para,
                "reset_notificado": "agendado_para" in updates,
                "item_id": item_id,
                "empresa_id": int(current_user.empresa_id),
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    return serialize_row(row)


@router.patch("/itens/{item_id}/status")
def update_item_status(
    item_id: int,
    payload: AgendaStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    item = get_item(db, current_user, item_id)
    require_entity_permission(db, current_user, str(item["entidade_tipo"]), "editar")

    if item.get("tipo") != "lembrete":
        raise HTTPException(status_code=400, detail="Somente lembretes possuem status.")

    row = (
        db.execute(
            text(
                """
                UPDATE agenda_itens
                SET status = :status,
                    concluido_em = CASE WHEN :status = 'concluido' THEN NOW() ELSE NULL END,
                    notificado_em = CASE WHEN :status = 'pendente' THEN NULL ELSE notificado_em END,
                    atualizado_em = NOW()
                WHERE id = :item_id AND empresa_id = :empresa_id
                RETURNING *
                """
            ),
            {
                "status": payload.status,
                "item_id": item_id,
                "empresa_id": int(current_user.empresa_id),
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    return serialize_row(row)


@router.delete("/itens/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> None:
    item = get_item(db, current_user, item_id)
    require_entity_permission(db, current_user, str(item["entidade_tipo"]), "editar")

    role = str(getattr(current_user, "papel", "") or "").lower()
    is_creator = int(item.get("criado_por_usuario_id") or 0) == int(current_user.id)
    if role not in {"owner", "admin"} and not is_creator:
        raise HTTPException(status_code=403, detail="Você só pode excluir itens criados por você.")

    db.execute(
        text("DELETE FROM agenda_itens WHERE id = :item_id AND empresa_id = :empresa_id"),
        {"item_id": item_id, "empresa_id": int(current_user.empresa_id)},
    )
    db.commit()
    return None


@router.get("/notificacoes")
def list_notifications(
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)

    allowed_types = [
        entidade_tipo
        for entidade_tipo, (module, _) in ENTITY_CONFIG.items()
        if user_has_permission(db, current_user, module, "ver")
    ]
    if not allowed_types:
        return {
            "vencidos": [],
            "proximos": [],
            "novos_alertas": [],
            "total_pendentes": 0,
            "total_vencidos": 0,
        }

    type_params = {f"entidade_tipo_{index}": value for index, value in enumerate(allowed_types)}
    type_placeholders = ", ".join(f":{key}" for key in type_params)
    params = {
        "empresa_id": int(current_user.empresa_id),
        "usuario_id": int(current_user.id),
        "limit": limit,
        **type_params,
    }
    where_sql = f"""
        empresa_id = :empresa_id
        AND tipo = 'lembrete'
        AND status = 'pendente'
        AND responsavel_usuario_id = :usuario_id
        AND entidade_tipo IN ({type_placeholders})
    """

    count_row = (
        db.execute(
            text(
                f"""
                SELECT
                    COUNT(*) AS total_pendentes,
                    COUNT(*) FILTER (WHERE agendado_para <= NOW()) AS total_vencidos
                FROM agenda_itens
                WHERE {where_sql}
                """
            ),
            params,
        )
        .mappings()
        .first()
    )

    rows = (
        db.execute(
            text(
                f"""
                SELECT *
                FROM agenda_itens
                WHERE {where_sql}
                ORDER BY agendado_para ASC NULLS LAST, id ASC
                LIMIT :limit
                """
            ),
            params,
        )
        .mappings()
        .all()
    )

    now = datetime.now(timezone.utc)
    items = [serialize_row(row) for row in rows]
    vencidos: List[Dict[str, Any]] = []
    proximos: List[Dict[str, Any]] = []
    novos_alertas: List[Dict[str, Any]] = []

    for raw, serialized in zip(rows, items):
        when = raw.get("agendado_para")
        if when and when <= now:
            vencidos.append(serialized)
            if raw.get("notificado_em") is None:
                novos_alertas.append(serialized)
        else:
            proximos.append(serialized)

    return {
        "vencidos": vencidos,
        "proximos": proximos,
        "novos_alertas": novos_alertas,
        "total_pendentes": int((count_row or {}).get("total_pendentes") or 0),
        "total_vencidos": int((count_row or {}).get("total_vencidos") or 0),
    }


@router.post("/itens/{item_id}/marcar-notificado")
def mark_notified(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)
    row = (
        db.execute(
            text(
                """
                UPDATE agenda_itens
                SET notificado_em = COALESCE(notificado_em, NOW()),
                    atualizado_em = NOW()
                WHERE id = :item_id
                  AND empresa_id = :empresa_id
                  AND responsavel_usuario_id = :usuario_id
                  AND tipo = 'lembrete'
                  AND status = 'pendente'
                RETURNING *
                """
            ),
            {
                "item_id": item_id,
                "empresa_id": int(current_user.empresa_id),
                "usuario_id": int(current_user.id),
            },
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lembrete não encontrado.")
    db.commit()
    return serialize_row(row)
