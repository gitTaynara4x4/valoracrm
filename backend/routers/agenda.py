from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Literal, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend import agenda_push, models
from backend.security.permissions import get_current_user, get_db, user_has_permission


router = APIRouter(prefix="/api/agenda", tags=["Agenda e histórico"])

SAO_PAULO = ZoneInfo("America/Sao_Paulo")

EntityType = Literal["cliente", "fornecedor", "produto"]
ItemType = Literal[
    "registro",
    "lembrete",
    "enviar_proposta",
    "abrir_ordem_servico",
    "transferir_departamento",
]
AgendaStatus = Literal[
    "em_aberto",
    "em_andamento",
    "em_analise",
    "parado",
    "finalizado",
]

SCHEDULED_TYPES = {
    "lembrete",
    "enviar_proposta",
    "abrir_ordem_servico",
    "transferir_departamento",
}
ACTIVE_STATUSES = {"em_aberto", "em_andamento", "em_analise", "parado"}

_AGENDA_SCHEMA_READY = False
_AGENDA_SCHEMA_LOCK = Lock()

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
    status: Optional[AgendaStatus] = None
    motivo_status: Optional[str] = Field(default=None, max_length=180)
    informacoes_livres: Optional[str] = Field(default=None, max_length=12000)
    departamento_destino: Optional[str] = Field(default=None, max_length=180)


class AgendaItemUpdate(BaseModel):
    assunto: Optional[str] = Field(default=None, min_length=1, max_length=180)
    descricao: Optional[str] = Field(default=None, max_length=8000)
    agendado_para: Optional[datetime] = None
    status: Optional[AgendaStatus] = None
    motivo_status: Optional[str] = Field(default=None, max_length=180)
    informacoes_livres: Optional[str] = Field(default=None, max_length=12000)
    departamento_destino: Optional[str] = Field(default=None, max_length=180)


class AgendaStatusUpdate(BaseModel):
    status: AgendaStatus
    motivo_status: Optional[str] = Field(default=None, max_length=180)
    informacoes_livres: Optional[str] = Field(default=None, max_length=12000)


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=500)
    auth: str = Field(min_length=8, max_length=500)


class PushSubscriptionPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4000)
    keys: PushSubscriptionKeys
    plataforma: Optional[str] = Field(default=None, max_length=80)
    user_agent: Optional[str] = Field(default=None, max_length=700)


class PushUnsubscribePayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4000)


class PushTestPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4000)


def ensure_agenda_table(db: Session) -> None:
    """Cria/atualiza a estrutura uma única vez por processo.

    O módulo ainda não possui migrations Alembic próprias. Esta rotina é idempotente e
    mantém bancos já existentes compatíveis com os novos tipos e estados da agenda.
    """

    global _AGENDA_SCHEMA_READY
    if _AGENDA_SCHEMA_READY:
        return

    with _AGENDA_SCHEMA_LOCK:
        if _AGENDA_SCHEMA_READY:
            return
        try:
            # Evita corrida entre múltiplos workers tentando atualizar a mesma tabela.
            db.execute(text("SELECT pg_advisory_xact_lock(hashtext('valora_agenda_schema_v9'))"))
            db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS agenda_itens (
                        id BIGSERIAL PRIMARY KEY,
                        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                        entidade_tipo VARCHAR(30) NOT NULL,
                        entidade_id BIGINT NOT NULL,
                        entidade_nome VARCHAR(180) NOT NULL,
                        tipo VARCHAR(40) NOT NULL,
                        assunto VARCHAR(180) NOT NULL,
                        descricao TEXT NULL,
                        agendado_para TIMESTAMPTZ NULL,
                        status VARCHAR(30) NOT NULL DEFAULT 'registrado',
                        motivo_status VARCHAR(180) NULL,
                        informacoes_livres TEXT NULL,
                        departamento_destino VARCHAR(180) NULL,
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
                            CHECK (tipo IN (
                                'registro', 'lembrete', 'enviar_proposta',
                                'abrir_ordem_servico', 'transferir_departamento'
                            )),
                        CONSTRAINT ck_agenda_status
                            CHECK (status IN (
                                'registrado', 'em_aberto', 'em_andamento',
                                'em_analise', 'parado', 'finalizado', 'cancelado'
                            ))
                    )
                    """
                )
            )

            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS motivo_status VARCHAR(180) NULL"))
            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS informacoes_livres TEXT NULL"))
            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS departamento_destino VARCHAR(180) NULL"))
            db.execute(text("ALTER TABLE agenda_itens ALTER COLUMN tipo TYPE VARCHAR(40)"))
            db.execute(text("ALTER TABLE agenda_itens ALTER COLUMN status TYPE VARCHAR(30)"))

            # Remove as validações antigas antes de converter os valores legados.
            db.execute(text("ALTER TABLE agenda_itens DROP CONSTRAINT IF EXISTS ck_agenda_tipo"))
            db.execute(text("ALTER TABLE agenda_itens DROP CONSTRAINT IF EXISTS ck_agenda_status"))
            db.execute(text("UPDATE agenda_itens SET status = 'em_aberto' WHERE status = 'pendente'"))
            db.execute(text("UPDATE agenda_itens SET status = 'finalizado' WHERE status = 'concluido'"))

            db.execute(
                text(
                    """
                    ALTER TABLE agenda_itens
                    ADD CONSTRAINT ck_agenda_tipo
                    CHECK (tipo IN (
                        'registro', 'lembrete', 'enviar_proposta',
                        'abrir_ordem_servico', 'transferir_departamento'
                    ))
                    """
                )
            )
            db.execute(
                text(
                    """
                    ALTER TABLE agenda_itens
                    ADD CONSTRAINT ck_agenda_status
                    CHECK (status IN (
                        'registrado', 'em_aberto', 'em_andamento',
                        'em_analise', 'parado', 'finalizado', 'cancelado'
                    ))
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
            db.execute(text("DROP INDEX IF EXISTS ix_agenda_itens_responsavel_pendentes"))
            db.execute(
                text(
                    """
                    CREATE INDEX ix_agenda_itens_responsavel_pendentes
                    ON agenda_itens (empresa_id, responsavel_usuario_id, status, agendado_para)
                    WHERE tipo <> 'registro'
                      AND status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
                    """
                )
            )
            db.commit()
            _AGENDA_SCHEMA_READY = True
        except Exception:
            db.rollback()
            raise


def normalize_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=SAO_PAULO)
    return value.astimezone(timezone.utc)


def normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return value.strip() or None


def is_scheduled_type(item_type: str) -> bool:
    return item_type in SCHEDULED_TYPES


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


def validate_scheduled_item(item_type: str, agendado_para: Optional[datetime], departamento: Optional[str]) -> None:
    if not is_scheduled_type(item_type):
        return
    if agendado_para is None:
        raise HTTPException(status_code=400, detail="Informe a data e o horário do agendamento.")
    if item_type == "transferir_departamento" and not departamento:
        raise HTTPException(status_code=400, detail="Informe o departamento de destino.")


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
                  CASE
                    WHEN tipo <> 'registro'
                     AND status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
                    THEN 0 ELSE 1
                  END,
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
    descricao = normalize_optional_text(payload.descricao)
    motivo_status = normalize_optional_text(payload.motivo_status)
    informacoes_livres = normalize_optional_text(payload.informacoes_livres)
    departamento_destino = normalize_optional_text(payload.departamento_destino)
    agendado_para = normalize_datetime(payload.agendado_para)

    validate_scheduled_item(payload.tipo, agendado_para, departamento_destino)

    scheduled = is_scheduled_type(payload.tipo)
    status_value = payload.status or "em_aberto" if scheduled else "registrado"
    entidade_nome = str(
        getattr(entity, "nome", None)
        or getattr(entity, "razao_social", None)
        or getattr(entity, "descricao", None)
        or f"Cadastro #{entity.id}"
    )

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
                    motivo_status,
                    informacoes_livres,
                    departamento_destino,
                    concluido_em,
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
                    :motivo_status,
                    :informacoes_livres,
                    :departamento_destino,
                    :concluido_em,
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
                "motivo_status": motivo_status if scheduled else None,
                "informacoes_livres": informacoes_livres if scheduled else None,
                "departamento_destino": departamento_destino if scheduled else None,
                "concluido_em": datetime.now(timezone.utc) if status_value == "finalizado" else None,
                "responsavel_usuario_id": int(current_user.id) if scheduled else None,
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

    item_type = str(item.get("tipo") or "registro")
    scheduled = is_scheduled_type(item_type)

    assunto = item.get("assunto")
    if "assunto" in updates:
        assunto = str(updates.get("assunto") or "").strip()
        if not assunto:
            raise HTTPException(status_code=400, detail="O assunto é obrigatório.")

    descricao = item.get("descricao")
    if "descricao" in updates:
        descricao = normalize_optional_text(updates.get("descricao"))

    agendado_para = item.get("agendado_para")
    if "agendado_para" in updates:
        agendado_para = normalize_datetime(updates.get("agendado_para"))

    status_value = str(item.get("status") or ("em_aberto" if scheduled else "registrado"))
    if "status" in updates and updates.get("status") is not None:
        if not scheduled:
            raise HTTPException(status_code=400, detail="Registros de contato não possuem status de agendamento.")
        status_value = str(updates["status"])

    motivo_status = item.get("motivo_status")
    if "motivo_status" in updates:
        motivo_status = normalize_optional_text(updates.get("motivo_status"))

    informacoes_livres = item.get("informacoes_livres")
    if "informacoes_livres" in updates:
        informacoes_livres = normalize_optional_text(updates.get("informacoes_livres"))

    departamento_destino = item.get("departamento_destino")
    if "departamento_destino" in updates:
        departamento_destino = normalize_optional_text(updates.get("departamento_destino"))

    validate_scheduled_item(item_type, agendado_para, departamento_destino)

    reset_notificado = bool(
        "agendado_para" in updates
        or ("status" in updates and status_value in ACTIVE_STATUSES)
    )

    row = (
        db.execute(
            text(
                """
                UPDATE agenda_itens
                SET assunto = :assunto,
                    descricao = :descricao,
                    agendado_para = :agendado_para,
                    status = :status,
                    motivo_status = :motivo_status,
                    informacoes_livres = :informacoes_livres,
                    departamento_destino = :departamento_destino,
                    concluido_em = CASE
                        WHEN :status = 'finalizado' THEN COALESCE(concluido_em, NOW())
                        ELSE NULL
                    END,
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
                "descricao": descricao,
                "agendado_para": agendado_para,
                "status": status_value if scheduled else "registrado",
                "motivo_status": motivo_status if scheduled else None,
                "informacoes_livres": informacoes_livres if scheduled else None,
                "departamento_destino": departamento_destino if scheduled else None,
                "reset_notificado": reset_notificado,
                "item_id": item_id,
                "empresa_id": int(current_user.empresa_id),
            },
        )
        .mappings()
        .first()
    )
    if reset_notificado:
        agenda_push.reset_item_deliveries(db, item_id=item_id)
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

    if not is_scheduled_type(str(item.get("tipo") or "")):
        raise HTTPException(status_code=400, detail="Somente agendamentos e tarefas possuem status.")

    motivo_status = normalize_optional_text(payload.motivo_status)
    informacoes_livres = normalize_optional_text(payload.informacoes_livres)

    row = (
        db.execute(
            text(
                """
                UPDATE agenda_itens
                SET status = :status,
                    motivo_status = COALESCE(:motivo_status, motivo_status),
                    informacoes_livres = COALESCE(:informacoes_livres, informacoes_livres),
                    concluido_em = CASE
                        WHEN :status = 'finalizado' THEN COALESCE(concluido_em, NOW())
                        ELSE NULL
                    END,
                    notificado_em = CASE
                        WHEN :status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado') THEN NULL
                        ELSE notificado_em
                    END,
                    atualizado_em = NOW()
                WHERE id = :item_id AND empresa_id = :empresa_id
                RETURNING *
                """
            ),
            {
                "status": payload.status,
                "motivo_status": motivo_status,
                "informacoes_livres": informacoes_livres,
                "item_id": item_id,
                "empresa_id": int(current_user.empresa_id),
            },
        )
        .mappings()
        .first()
    )
    if payload.status in ACTIVE_STATUSES:
        agenda_push.reset_item_deliveries(db, item_id=item_id)
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
        AND tipo <> 'registro'
        AND status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
        AND agendado_para IS NOT NULL
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
                  AND tipo <> 'registro'
                  AND status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
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
        raise HTTPException(status_code=404, detail="Agendamento não encontrado.")
    db.commit()
    return serialize_row(row)

@router.get("/push/config")
def get_push_config(
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)
    try:
        material = agenda_push.get_vapid_material(db)
    except Exception as error:
        return {
            "supported": False,
            "public_key": None,
            "detail": str(error),
        }

    total = db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM agenda_push_assinaturas
            WHERE empresa_id = :empresa_id
              AND usuario_id = :usuario_id
              AND ativo = TRUE
            """
        ),
        {
            "empresa_id": int(current_user.empresa_id),
            "usuario_id": int(current_user.id),
        },
    ).scalar()
    return {
        "supported": True,
        "public_key": material["public_key"],
        "active_subscriptions": int(total or 0),
    }


@router.post("/push/assinaturas", status_code=status.HTTP_201_CREATED)
def save_push_subscription(
    payload: PushSubscriptionPayload,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)
    row = agenda_push.upsert_subscription(
        db,
        empresa_id=int(current_user.empresa_id),
        usuario_id=int(current_user.id),
        endpoint=payload.endpoint.strip(),
        p256dh=payload.keys.p256dh.strip(),
        auth=payload.keys.auth.strip(),
        plataforma=payload.plataforma,
        user_agent=payload.user_agent,
    )
    return {"ok": True, "subscription": row}


@router.delete("/push/assinaturas")
def remove_push_subscription(
    payload: PushUnsubscribePayload,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)
    removed = agenda_push.disable_subscription(
        db,
        empresa_id=int(current_user.empresa_id),
        usuario_id=int(current_user.id),
        endpoint=payload.endpoint.strip(),
    )
    return {"ok": True, "removed": removed}


@router.post("/push/teste")
def test_push_notification(
    payload: PushTestPayload,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
) -> Dict[str, Any]:
    ensure_agenda_table(db)
    result = agenda_push.send_test_to_user(
        db,
        empresa_id=int(current_user.empresa_id),
        usuario_id=int(current_user.id),
        endpoint=payload.endpoint.strip(),
    )
    if result["enviadas"] < 1:
        raise HTTPException(
            status_code=503,
            detail="Não foi possível enviar a notificação de teste para este dispositivo.",
        )
    return {"ok": True, **result}

