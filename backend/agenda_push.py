from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal

logger = logging.getLogger(__name__)

_PUSH_SCHEMA_READY = False
_PUSH_TASK: Optional[asyncio.Task] = None
_DISPATCH_INTERVAL_SECONDS = max(15, int(os.getenv("AGENDA_PUSH_INTERVAL_SECONDS", "30") or 30))
_VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:suporte@valoracrm.com.br")
_SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def ensure_push_schema(db: Session) -> None:
    """Cria as estruturas de Web Push uma única vez por processo.

    A rotina é idempotente e usa advisory lock para funcionar com mais de um worker.
    """

    global _PUSH_SCHEMA_READY
    if _PUSH_SCHEMA_READY:
        return

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('valora_agenda_push_schema_v1'))"))
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_config (
                id SMALLINT PRIMARY KEY,
                vapid_private_key TEXT NOT NULL,
                vapid_public_key VARCHAR(180) NOT NULL,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_agenda_push_config_id CHECK (id = 1)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_assinaturas (
                id BIGSERIAL PRIMARY KEY,
                empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                plataforma VARCHAR(80) NULL,
                user_agent VARCHAR(700) NULL,
                ativo BOOLEAN NOT NULL DEFAULT TRUE,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ultimo_sucesso_em TIMESTAMPTZ NULL,
                ultimo_erro TEXT NULL,
                CONSTRAINT uq_agenda_push_endpoint UNIQUE (endpoint)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_agenda_push_assinaturas_usuario
            ON agenda_push_assinaturas (empresa_id, usuario_id, ativo)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_entregas (
                agenda_item_id BIGINT NOT NULL REFERENCES agenda_itens(id) ON DELETE CASCADE,
                assinatura_id BIGINT NOT NULL REFERENCES agenda_push_assinaturas(id) ON DELETE CASCADE,
                agendado_para TIMESTAMPTZ NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'processando',
                tentativas INTEGER NOT NULL DEFAULT 1,
                ultimo_erro TEXT NULL,
                enviado_em TIMESTAMPTZ NULL,
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (agenda_item_id, assinatura_id, agendado_para),
                CONSTRAINT ck_agenda_push_entrega_status
                    CHECK (status IN ('processando', 'enviado', 'erro'))
            )
            """
        )
    )
    db.commit()
    _PUSH_SCHEMA_READY = True


def get_vapid_material(db: Session) -> Dict[str, str]:
    """Retorna as chaves VAPID; gera e persiste automaticamente quando necessário."""

    env_private = (os.getenv("VAPID_PRIVATE_KEY") or "").strip()
    env_public = (os.getenv("VAPID_PUBLIC_KEY") or "").strip()
    if env_private and env_public:
        return {"private_key": env_private, "public_key": env_public, "subject": _VAPID_SUBJECT}

    ensure_push_schema(db)
    row = db.execute(
        text("SELECT vapid_private_key, vapid_public_key FROM agenda_push_config WHERE id = 1")
    ).mappings().first()
    if row:
        return {
            "private_key": str(row["vapid_private_key"]),
            "public_key": str(row["vapid_public_key"]),
            "subject": _VAPID_SUBJECT,
        }

    try:
        from py_vapid import Vapid02
    except ImportError as exc:  # pragma: no cover - depende da instalação do servidor
        raise RuntimeError("A dependência pywebpush não está instalada.") from exc

    vapid = Vapid02()
    vapid.generate_keys()
    numbers = vapid.public_key.public_numbers()
    raw_public = b"\x04" + numbers.x.to_bytes(32, "big") + numbers.y.to_bytes(32, "big")
    public_key = _b64url(raw_public)
    private_key = vapid.private_pem().decode("utf-8")

    db.execute(
        text(
            """
            INSERT INTO agenda_push_config (
                id, vapid_private_key, vapid_public_key, criado_em, atualizado_em
            ) VALUES (1, :private_key, :public_key, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {"private_key": private_key, "public_key": public_key},
    )
    db.commit()

    # Outro worker pode ter criado as chaves enquanto este aguardava o lock.
    row = db.execute(
        text("SELECT vapid_private_key, vapid_public_key FROM agenda_push_config WHERE id = 1")
    ).mappings().first()
    if not row:
        raise RuntimeError("Não foi possível preparar as chaves de notificação.")
    return {
        "private_key": str(row["vapid_private_key"]),
        "public_key": str(row["vapid_public_key"]),
        "subject": _VAPID_SUBJECT,
    }


def upsert_subscription(
    db: Session,
    *,
    empresa_id: int,
    usuario_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    plataforma: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_push_schema(db)
    row = db.execute(
        text(
            """
            INSERT INTO agenda_push_assinaturas (
                empresa_id, usuario_id, endpoint, p256dh, auth,
                plataforma, user_agent, ativo, criado_em, atualizado_em,
                ultimo_erro
            ) VALUES (
                :empresa_id, :usuario_id, :endpoint, :p256dh, :auth,
                :plataforma, :user_agent, TRUE, NOW(), NOW(), NULL
            )
            ON CONFLICT (endpoint) DO UPDATE SET
                empresa_id = EXCLUDED.empresa_id,
                usuario_id = EXCLUDED.usuario_id,
                p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                plataforma = EXCLUDED.plataforma,
                user_agent = EXCLUDED.user_agent,
                ativo = TRUE,
                atualizado_em = NOW(),
                ultimo_erro = NULL
            RETURNING id, ativo, criado_em, atualizado_em
            """
        ),
        {
            "empresa_id": empresa_id,
            "usuario_id": usuario_id,
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
            "plataforma": (plataforma or "")[:80] or None,
            "user_agent": (user_agent or "")[:700] or None,
        },
    ).mappings().first()
    db.commit()
    return dict(row or {})


def reset_item_deliveries(db: Session, *, item_id: int) -> None:
    exists = db.execute(text("SELECT to_regclass('public.agenda_push_entregas')")).scalar()
    if not exists:
        return
    db.execute(
        text("DELETE FROM agenda_push_entregas WHERE agenda_item_id = :item_id"),
        {"item_id": item_id},
    )


def disable_subscription(db: Session, *, empresa_id: int, usuario_id: int, endpoint: str) -> bool:
    ensure_push_schema(db)
    result = db.execute(
        text(
            """
            UPDATE agenda_push_assinaturas
            SET ativo = FALSE, atualizado_em = NOW()
            WHERE empresa_id = :empresa_id
              AND usuario_id = :usuario_id
              AND endpoint = :endpoint
            """
        ),
        {"empresa_id": empresa_id, "usuario_id": usuario_id, "endpoint": endpoint},
    )
    db.commit()
    return bool(result.rowcount)


def _private_key_for_webpush(private_key: str) -> Any:
    if "BEGIN" not in private_key:
        return private_key
    from py_vapid import Vapid02

    return Vapid02.from_pem(private_key.encode("utf-8"))


def _send(subscription: Dict[str, str], payload: Dict[str, Any], vapid: Dict[str, str]) -> None:
    from pywebpush import webpush

    webpush(
        subscription_info={
            "endpoint": subscription["endpoint"],
            "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
        },
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        vapid_private_key=_private_key_for_webpush(vapid["private_key"]),
        vapid_claims={"sub": vapid["subject"]},
        ttl=86400,
        timeout=12,
        headers={"Urgency": "high"},
    )


def _response_status(error: Exception) -> Optional[int]:
    response = getattr(error, "response", None)
    try:
        return int(getattr(response, "status_code", 0) or 0) or None
    except (TypeError, ValueError):
        return None


def send_test_to_user(
    db: Session, *, empresa_id: int, usuario_id: int, endpoint: Optional[str] = None
) -> Dict[str, int]:
    ensure_push_schema(db)
    vapid = get_vapid_material(db)
    subscriptions = db.execute(
        text(
            """
            SELECT id, endpoint, p256dh, auth
            FROM agenda_push_assinaturas
            WHERE empresa_id = :empresa_id
              AND usuario_id = :usuario_id
              AND ativo = TRUE
              AND (:endpoint IS NULL OR endpoint = :endpoint)
            ORDER BY atualizado_em DESC
            """
        ),
        {"empresa_id": empresa_id, "usuario_id": usuario_id, "endpoint": endpoint},
    ).mappings().all()

    sent = 0
    failed = 0
    payload = {
        "title": "Notificações ativadas",
        "body": "Este dispositivo receberá os lembretes da Agenda Valora.",
        "url": "/dashboard?abrir_agenda=1",
        "tag": "valora-agenda-teste",
        "type": "agenda-test",
    }
    for row in subscriptions:
        try:
            _send(dict(row), payload, vapid)
            sent += 1
            db.execute(
                text(
                    """
                    UPDATE agenda_push_assinaturas
                    SET ultimo_sucesso_em = NOW(), ultimo_erro = NULL, atualizado_em = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": int(row["id"])},
            )
        except Exception as error:  # A biblioteca encapsula erros HTTP específicos.
            failed += 1
            status_code = _response_status(error)
            deactivate = status_code in {404, 410}
            db.execute(
                text(
                    """
                    UPDATE agenda_push_assinaturas
                    SET ativo = CASE WHEN :deactivate THEN FALSE ELSE ativo END,
                        ultimo_erro = :error,
                        atualizado_em = NOW()
                    WHERE id = :id
                    """
                ),
                {
                    "id": int(row["id"]),
                    "deactivate": deactivate,
                    "error": str(error)[:2000],
                },
            )
    db.commit()
    return {"enviadas": sent, "falhas": failed}


def _module_url(entity_type: str) -> str:
    return {
        "cliente": "/clientes?abrir_agenda=1",
        "fornecedor": "/fornecedores?abrir_agenda=1",
        "produto": "/produtos?abrir_agenda=1",
    }.get(entity_type, "/dashboard?abrir_agenda=1")


def dispatch_due_pushes() -> int:
    """Envia lembretes vencidos para todas as inscrições ativas do responsável."""

    db = SessionLocal()
    locked = False
    sent_count = 0
    try:
        # Import tardio evita ciclo durante a carga dos routers.
        from backend.routers.agenda import ensure_agenda_table

        ensure_agenda_table(db)
        ensure_push_schema(db)
        vapid = get_vapid_material(db)

        locked = bool(
            db.execute(text("SELECT pg_try_advisory_lock(hashtext('valora_agenda_push_dispatch_v1'))")).scalar()
        )
        if not locked:
            return 0

        rows = db.execute(
            text(
                """
                SELECT
                    a.id AS agenda_item_id,
                    a.entidade_tipo,
                    a.entidade_id,
                    a.entidade_nome,
                    a.tipo,
                    a.assunto,
                    a.descricao,
                    a.agendado_para,
                    s.id AS assinatura_id,
                    s.endpoint,
                    s.p256dh,
                    s.auth,
                    COALESCE(e.tentativas, 0) AS tentativas_anteriores
                FROM agenda_itens a
                INNER JOIN agenda_push_assinaturas s
                    ON s.empresa_id = a.empresa_id
                   AND s.usuario_id = a.responsavel_usuario_id
                   AND s.ativo = TRUE
                   AND s.criado_em <= a.agendado_para
                LEFT JOIN agenda_push_entregas e
                    ON e.agenda_item_id = a.id
                   AND e.assinatura_id = s.id
                   AND e.agendado_para = a.agendado_para
                WHERE a.tipo <> 'registro'
                  AND a.status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
                  AND a.agendado_para IS NOT NULL
                  AND a.agendado_para <= NOW()
                  AND (
                        e.agenda_item_id IS NULL
                        OR (
                            e.status = 'erro'
                            AND e.tentativas < 3
                            AND e.atualizado_em <= NOW() - INTERVAL '5 minutes'
                        )
                  )
                ORDER BY a.agendado_para ASC, a.id ASC, s.id ASC
                LIMIT 150
                """
            )
        ).mappings().all()

        for raw in rows:
            row = dict(raw)
            claim = db.execute(
                text(
                    """
                    INSERT INTO agenda_push_entregas (
                        agenda_item_id, assinatura_id, agendado_para,
                        status, tentativas, ultimo_erro, atualizado_em
                    ) VALUES (
                        :agenda_item_id, :assinatura_id, :agendado_para,
                        'processando', 1, NULL, NOW()
                    )
                    ON CONFLICT (agenda_item_id, assinatura_id, agendado_para)
                    DO UPDATE SET
                        status = 'processando',
                        tentativas = agenda_push_entregas.tentativas + 1,
                        ultimo_erro = NULL,
                        atualizado_em = NOW()
                    WHERE agenda_push_entregas.status = 'erro'
                      AND agenda_push_entregas.tentativas < 3
                      AND agenda_push_entregas.atualizado_em <= NOW() - INTERVAL '5 minutes'
                    RETURNING tentativas
                    """
                ),
                {
                    "agenda_item_id": int(row["agenda_item_id"]),
                    "assinatura_id": int(row["assinatura_id"]),
                    "agendado_para": row["agendado_para"],
                },
            ).mappings().first()
            db.commit()
            if not claim:
                continue

            when = row.get("agendado_para")
            when_text = when.astimezone(_SAO_PAULO).strftime("%d/%m/%Y às %H:%M") if isinstance(when, datetime) else "agora"
            entity_name = str(row.get("entidade_nome") or "Cadastro")
            body = f"{entity_name} • {when_text}"
            if row.get("descricao"):
                body = f"{body}\n{str(row['descricao']).strip()[:180]}"
            payload = {
                "title": str(row.get("assunto") or "Lembrete da agenda"),
                "body": body,
                "url": _module_url(str(row.get("entidade_tipo") or "")),
                "tag": f"valora-agenda-{int(row['agenda_item_id'])}-{int(when.timestamp()) if isinstance(when, datetime) else 0}",
                "type": "agenda-reminder",
                "agendaItemId": int(row["agenda_item_id"]),
                "entityType": str(row.get("entidade_tipo") or ""),
                "entityId": int(row.get("entidade_id") or 0),
            }

            try:
                _send(row, payload, vapid)
                sent_count += 1
                db.execute(
                    text(
                        """
                        UPDATE agenda_push_entregas
                        SET status = 'enviado', enviado_em = NOW(), ultimo_erro = NULL, atualizado_em = NOW()
                        WHERE agenda_item_id = :agenda_item_id
                          AND assinatura_id = :assinatura_id
                          AND agendado_para = :agendado_para
                        """
                    ),
                    {
                        "agenda_item_id": int(row["agenda_item_id"]),
                        "assinatura_id": int(row["assinatura_id"]),
                        "agendado_para": row["agendado_para"],
                    },
                )
                db.execute(
                    text(
                        """
                        UPDATE agenda_push_assinaturas
                        SET ultimo_sucesso_em = NOW(), ultimo_erro = NULL, atualizado_em = NOW()
                        WHERE id = :id
                        """
                    ),
                    {"id": int(row["assinatura_id"])},
                )
                db.execute(
                    text(
                        """
                        UPDATE agenda_itens
                        SET notificado_em = COALESCE(notificado_em, NOW()), atualizado_em = NOW()
                        WHERE id = :agenda_item_id
                        """
                    ),
                    {"agenda_item_id": int(row["agenda_item_id"])},
                )
            except Exception as error:
                status_code = _response_status(error)
                deactivate = status_code in {404, 410}
                error_text = str(error)[:2000]
                db.execute(
                    text(
                        """
                        UPDATE agenda_push_entregas
                        SET status = 'erro', ultimo_erro = :error, atualizado_em = NOW()
                        WHERE agenda_item_id = :agenda_item_id
                          AND assinatura_id = :assinatura_id
                          AND agendado_para = :agendado_para
                        """
                    ),
                    {
                        "error": error_text,
                        "agenda_item_id": int(row["agenda_item_id"]),
                        "assinatura_id": int(row["assinatura_id"]),
                        "agendado_para": row["agendado_para"],
                    },
                )
                db.execute(
                    text(
                        """
                        UPDATE agenda_push_assinaturas
                        SET ativo = CASE WHEN :deactivate THEN FALSE ELSE ativo END,
                            ultimo_erro = :error,
                            atualizado_em = NOW()
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": int(row["assinatura_id"]),
                        "deactivate": deactivate,
                        "error": error_text,
                    },
                )
                logger.warning("Falha ao enviar Web Push da agenda: %s", error_text)
            db.commit()

        return sent_count
    except Exception:
        db.rollback()
        logger.exception("Falha no despachante de notificações da agenda.")
        return sent_count
    finally:
        if locked:
            try:
                db.execute(text("SELECT pg_advisory_unlock(hashtext('valora_agenda_push_dispatch_v1'))"))
                db.commit()
            except Exception:
                db.rollback()
        db.close()


async def _dispatcher_loop() -> None:
    await asyncio.sleep(5)
    while True:
        try:
            await asyncio.to_thread(dispatch_due_pushes)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Erro inesperado no loop de notificações da agenda.")
        await asyncio.sleep(_DISPATCH_INTERVAL_SECONDS)


async def start_push_dispatcher() -> None:
    global _PUSH_TASK
    if os.getenv("AGENDA_PUSH_DISABLED", "").strip().lower() in {"1", "true", "yes", "sim"}:
        return
    if _PUSH_TASK and not _PUSH_TASK.done():
        return
    _PUSH_TASK = asyncio.create_task(_dispatcher_loop(), name="valora-agenda-push")


async def stop_push_dispatcher() -> None:
    global _PUSH_TASK
    task = _PUSH_TASK
    _PUSH_TASK = None
    if not task:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
