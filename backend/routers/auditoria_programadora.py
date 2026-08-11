from __future__ import annotations

import hmac
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.audit import json_load
from backend.database import SessionLocal
from backend.security.permissions import get_current_user
from backend.security.session import create_temporary_token, unsign_payload
from backend.user_activity import TARGET_EMAIL, is_target_user, record_client_event


router = APIRouter(prefix="/api/auditoria-programadora", tags=["Auditoria Programadora"])

DEV_COOKIE = "valora_dev_audit"
DEV_PURPOSE = "valora_dev_audit"
DEV_PASSWORD = str(os.getenv("VALORA_DEV_AUDIT_PASSWORD") or "1015")
DEV_UNLOCK_SECONDS = 8 * 60 * 60

_SENSITIVE_KEYS = ("senha", "password", "passwd", "token", "secret", "authorization", "challenge")


class UnlockIn(BaseModel):
    senha: str
    pagina_sessao: str


class ClientEventIn(BaseModel):
    tipo: str = Field(min_length=1, max_length=40)
    detalhes: dict[str, Any] = Field(default_factory=dict)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _uses_https(request: Request) -> bool:
    configured = os.getenv("COOKIE_SECURE")
    if configured is not None and configured.strip():
        return configured.strip().lower() in {"1", "true", "yes", "on"}
    forwarded = str(request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip().lower()
    if forwarded:
        return forwarded == "https"
    return str(request.url.scheme or "").lower() == "https"


def _cookie_domain() -> Optional[str]:
    return os.getenv("COOKIE_DOMAIN") or None


def _cookie_samesite() -> str:
    return os.getenv("COOKIE_SAMESITE", "lax").strip().lower()


def _require_unlock(
    request: Request,
    current_user=Depends(get_current_user),
    valora_dev_audit: Optional[str] = Cookie(default=None, alias=DEV_COOKIE),
):
    payload = unsign_payload(valora_dev_audit or "", expected_purpose=DEV_PURPOSE)
    if not payload:
        raise HTTPException(status_code=403, detail="Área da programadora bloqueada.")

    try:
        same_user = int(payload.get("uid")) == int(current_user.id)
        same_company = int(payload.get("eid")) == int(current_user.empresa_id)
    except (TypeError, ValueError):
        same_user = same_company = False

    page_session = str(request.headers.get("x-valora-audit-session") or "").strip()
    token_session = str(payload.get("sid") or "").strip()
    same_page_session = bool(page_session) and hmac.compare_digest(page_session, token_session)

    if not same_user or not same_company or not same_page_session:
        raise HTTPException(status_code=403, detail="Área da programadora bloqueada para esta abertura da página.")
    return current_user


def _mask_sensitive(value: Any, field_name: str = "") -> Any:
    key = str(field_name or "").lower()
    if any(marker in key for marker in _SENSITIVE_KEYS):
        return "••••••"
    if isinstance(value, dict):
        return {str(k): _mask_sensitive(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_mask_sensitive(item) for item in value]
    return value


def _parse_details(raw: Any) -> Any:
    if raw in (None, ""):
        return None
    if isinstance(raw, (dict, list)):
        return _mask_sensitive(raw)
    try:
        return _mask_sensitive(json.loads(str(raw)))
    except Exception:
        return str(raw)


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _device_info(user_agent: str) -> dict[str, str]:
    ua = str(user_agent or "")
    lower = ua.lower()

    if "edg/" in lower:
        browser = "Microsoft Edge"
    elif "opr/" in lower or "opera" in lower:
        browser = "Opera"
    elif "firefox/" in lower:
        browser = "Firefox"
    elif "chrome/" in lower or "crios/" in lower:
        browser = "Chrome"
    elif "safari/" in lower:
        browser = "Safari"
    else:
        browser = "Navegador desconhecido"

    if "windows" in lower:
        system = "Windows"
    elif "android" in lower:
        system = "Android"
    elif "iphone" in lower or "ipad" in lower or "ios" in lower:
        system = "iOS"
    elif "mac os" in lower or "macintosh" in lower:
        system = "macOS"
    elif "linux" in lower:
        system = "Linux"
    else:
        system = "Sistema desconhecido"

    if "ipad" in lower or "tablet" in lower:
        device = "Tablet"
    elif "mobile" in lower or "android" in lower or "iphone" in lower:
        device = "Celular"
    else:
        device = "Computador"

    return {"navegador": browser, "sistema": system, "dispositivo": device}


def _severity_for_activity(tipo: str, status_code: Optional[int], details: Any) -> str:
    if int(status_code or 0) >= 400 or str(tipo).startswith("erro") or tipo == "login_falhou":
        return "erro"
    if tipo in {"download", "download_exportacao"}:
        return "importante"
    if tipo == "click" and isinstance(details, dict):
        category = str(details.get("categoria") or "").lower()
        if category in {"excluir", "remover", "finalizar", "permissao", "financeiro"}:
            return "importante"
    if tipo in {"alteracao_api"}:
        return "alteracao"
    return "normal"


def _severity_for_change(row: Any) -> str:
    action = str(row.get("acao") or "").lower()
    module = str(row.get("modulo") or "").lower()
    if action in {"removido", "excluido", "excluído", "apagado"}:
        return "importante"
    if module in {"usuarios", "empresa", "financeiro", "contas-pagar", "contas-receber"}:
        return "importante"
    return "alteracao"


def _module_times(rows: list[Any], now: datetime, state: Any) -> list[dict[str, Any]]:
    totals: dict[str, float] = defaultdict(float)
    clean_rows = [row for row in rows if row.get("criado_em") and row.get("pagina")]
    for index, row in enumerate(clean_rows):
        current = row.get("criado_em")
        if current is None:
            continue
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        else:
            current = current.astimezone(timezone.utc)

        if index + 1 < len(clean_rows):
            nxt = clean_rows[index + 1].get("criado_em")
            if nxt is None:
                continue
            if nxt.tzinfo is None:
                nxt = nxt.replace(tzinfo=timezone.utc)
            else:
                nxt = nxt.astimezone(timezone.utc)
            seconds = max(0.0, min((nxt - current).total_seconds(), 45.0))
        else:
            online = bool(state and state.get("sessao_ativa"))
            seconds = max(0.0, min((now - current).total_seconds(), 45.0)) if online else 0.0

        page = str(row.get("pagina") or "").strip("/") or "inicio"
        totals[page] += seconds

    result = [
        {"pagina": page, "segundos": int(round(seconds))}
        for page, seconds in totals.items()
        if seconds >= 1
    ]
    result.sort(key=lambda item: item["segundos"], reverse=True)
    return result[:10]


def _build_session_events(rows: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        ua = str(row.get("user_agent") or "")
        details = _parse_details(row.get("detalhes_json"))
        result.append(
            {
                "tipo": row.get("tipo"),
                "criado_em": _iso(row.get("criado_em")),
                "ip": row.get("ip"),
                "status_code": row.get("status_code"),
                "detalhes": details,
                **_device_info(ua),
            }
        )
    return result


@router.post("/desbloquear")
def unlock(
    data: UnlockIn,
    request: Request,
    current_user=Depends(get_current_user),
):
    supplied = str(data.senha or "")
    if not hmac.compare_digest(supplied.encode("utf-8"), DEV_PASSWORD.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Senha da programadora incorreta.")

    page_session = str(data.pagina_sessao or "").strip()
    if len(page_session) < 16 or len(page_session) > 160:
        raise HTTPException(status_code=400, detail="Sessão da página inválida.")

    token = create_temporary_token(
        DEV_PURPOSE,
        user_id=int(current_user.id),
        empresa_id=int(current_user.empresa_id),
        max_age=DEV_UNLOCK_SECONDS,
        extra={"scope": "auditoria-programadora", "sid": page_session},
    )
    response = JSONResponse({"ok": True, "target_email": TARGET_EMAIL})
    response.set_cookie(
        DEV_COOKIE,
        token,
        max_age=DEV_UNLOCK_SECONDS,
        expires=DEV_UNLOCK_SECONDS,
        httponly=True,
        secure=_uses_https(request),
        samesite=_cookie_samesite(),
        path="/",
        domain=_cookie_domain(),
    )
    return response


@router.post("/bloquear")
def lock(request: Request, current_user=Depends(get_current_user)):
    response = JSONResponse({"ok": True})
    response.delete_cookie(
        DEV_COOKIE,
        path="/",
        domain=_cookie_domain(),
        secure=_uses_https(request),
        httponly=True,
        samesite=_cookie_samesite(),
    )
    return response


@router.get("/status")
def unlock_status(current_user=Depends(_require_unlock)):
    return {"ok": True, "unlocked": True, "target_email": TARGET_EMAIL}


@router.post("/telemetria")
def telemetry(
    data: ClientEventIn,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recebe somente interações explícitas do Valora; nunca recebe senha ou formulário comum."""
    if not is_target_user(current_user):
        return {"ok": True, "recorded": False}
    try:
        recorded = record_client_event(
            db,
            user=current_user,
            request=request,
            tipo=data.tipo,
            details=data.detalhes,
        )
        return {"ok": True, "recorded": bool(recorded)}
    except Exception as exc:
        db.rollback()
        print(f"[AUDITORIA USUÁRIO] Falha na telemetria: {exc}")
        return {"ok": True, "recorded": False}


@router.get("/eventos")
def events(
    limit: int = 300,
    current_user=Depends(_require_unlock),
    db: Session = Depends(get_db),
):
    limit = max(20, min(int(limit), 500))
    email = TARGET_EMAIL

    state = db.execute(
        text(
            """
            SELECT s.usuario_id, s.empresa_id, s.usuario_email, s.usuario_nome,
                   s.pagina_atual, s.rota_atual, s.metodo, s.status_code,
                   s.ultimo_ip, s.user_agent, s.sessao_ativa, s.ultima_atividade,
                   s.ultimo_login, s.ultimo_logout
            FROM auditoria_usuario_estado s
            WHERE LOWER(s.usuario_email) = :email
            ORDER BY s.ultima_atividade DESC
            LIMIT 1
            """
        ),
        {"email": email},
    ).mappings().first()

    activity_rows = db.execute(
        text(
            """
            SELECT id, usuario_id, empresa_id, usuario_email, usuario_nome,
                   tipo, pagina, rota, metodo, status_code, ip, user_agent,
                   detalhes_json, criado_em
            FROM auditoria_usuario_atividade
            WHERE LOWER(usuario_email) = :email
              AND tipo <> 'presenca'
            ORDER BY criado_em DESC, id DESC
            LIMIT :activity_limit
            """
        ),
        {"email": email, "activity_limit": min(limit * 2, 1000)},
    ).mappings().all()

    change_rows = db.execute(
        text(
            """
            SELECT a.id, a.empresa_id, a.modulo, a.entidade_tipo, a.entidade_id,
                   a.secao, a.campo, a.campo_nome, a.acao,
                   a.valor_anterior_json, a.valor_novo_json,
                   a.usuario_id, a.usuario_nome, a.origem, a.criado_em
            FROM auditoria_alteracoes a
            JOIN usuarios u ON u.id = a.usuario_id
            WHERE LOWER(u.email) = :email
            ORDER BY a.criado_em DESC, a.id DESC
            LIMIT :limit
            """
        ),
        {"email": email, "limit": limit},
    ).mappings().all()

    merged: list[dict[str, Any]] = []
    for row in activity_rows:
        details = _parse_details(row.get("detalhes_json"))
        merged.append(
            {
                "key": f"atividade:{row['id']}",
                "fonte": "atividade",
                "tipo": row.get("tipo"),
                "severidade": _severity_for_activity(str(row.get("tipo") or ""), row.get("status_code"), details),
                "usuario_nome": row.get("usuario_nome"),
                "usuario_email": row.get("usuario_email"),
                "pagina": row.get("pagina"),
                "rota": row.get("rota"),
                "metodo": row.get("metodo"),
                "status_code": row.get("status_code"),
                "ip": row.get("ip"),
                "dispositivo": _device_info(str(row.get("user_agent") or "")),
                "detalhes": details,
                "criado_em": _iso(row.get("criado_em")),
            }
        )

    for row in change_rows:
        field_name = str(row.get("campo") or row.get("campo_nome") or "")
        merged.append(
            {
                "key": f"alteracao:{row['id']}",
                "fonte": "alteracao_dados",
                "tipo": "alteracao_campo",
                "severidade": _severity_for_change(row),
                "usuario_nome": row.get("usuario_nome"),
                "usuario_email": email,
                "modulo": row.get("modulo"),
                "entidade_tipo": row.get("entidade_tipo"),
                "entidade_id": row.get("entidade_id"),
                "secao": row.get("secao"),
                "campo": row.get("campo"),
                "campo_nome": row.get("campo_nome"),
                "acao": row.get("acao"),
                "origem": row.get("origem"),
                "valor_anterior": _mask_sensitive(json_load(row.get("valor_anterior_json")), field_name),
                "valor_novo": _mask_sensitive(json_load(row.get("valor_novo_json")), field_name),
                "criado_em": _iso(row.get("criado_em")),
            }
        )

    merged.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
    merged = merged[:limit]

    counts = db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*)
                 FROM auditoria_usuario_atividade aa
                WHERE LOWER(aa.usuario_email)=:email
                  AND aa.tipo <> 'presenca'
                  AND aa.criado_em >= date_trunc('day', NOW())) AS atividades_hoje,
              (SELECT COUNT(*)
                 FROM auditoria_alteracoes ac
                 JOIN usuarios u2 ON u2.id=ac.usuario_id
                WHERE LOWER(u2.email)=:email
                  AND ac.criado_em >= date_trunc('day', NOW())) AS alteracoes_hoje,
              (SELECT COUNT(*)
                 FROM auditoria_usuario_atividade ae
                WHERE LOWER(ae.usuario_email)=:email
                  AND (ae.status_code >= 400 OR ae.tipo IN ('erro_api','erro_pagina','login_falhou'))
                  AND ae.criado_em >= date_trunc('day', NOW())) AS erros_hoje,
              (SELECT COUNT(*)
                 FROM auditoria_usuario_atividade al
                WHERE LOWER(al.usuario_email)=:email
                  AND al.tipo='login'
                  AND al.criado_em >= date_trunc('day', NOW())) AS entradas_hoje,
              (SELECT COUNT(*)
                 FROM auditoria_usuario_atividade ad
                WHERE LOWER(ad.usuario_email)=:email
                  AND ad.tipo IN ('download','download_exportacao')
                  AND ad.criado_em >= date_trunc('day', NOW())) AS downloads_hoje
            """
        ),
        {"email": email},
    ).mappings().first()

    target_user = db.execute(
        text(
            """
            SELECT id, empresa_id, nome, email, cargo, papel, ativo, criado_em, atualizado_em
            FROM usuarios
            WHERE LOWER(email)=:email
            ORDER BY ativo DESC, id ASC
            LIMIT 1
            """
        ),
        {"email": email},
    ).mappings().first()

    session_rows = db.execute(
        text(
            """
            SELECT tipo, status_code, ip, user_agent, detalhes_json, criado_em
            FROM auditoria_usuario_atividade
            WHERE LOWER(usuario_email)=:email
              AND tipo IN ('login','logout','login_falhou')
            ORDER BY criado_em DESC, id DESC
            LIMIT 24
            """
        ),
        {"email": email},
    ).mappings().all()

    today_rows = db.execute(
        text(
            """
            SELECT pagina, tipo, criado_em
            FROM auditoria_usuario_atividade
            WHERE LOWER(usuario_email)=:email
              AND criado_em >= date_trunc('day', NOW())
              AND tipo IN ('presenca','navegacao','click','pesquisa','filtro','alteracao_api','download','download_exportacao')
              AND pagina IS NOT NULL AND pagina <> ''
            ORDER BY criado_em ASC, id ASC
            """
        ),
        {"email": email},
    ).mappings().all()

    now = datetime.now(timezone.utc)
    online = False
    if state and state.get("ultima_atividade"):
        last = state.get("ultima_atividade")
        try:
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            online = bool(state.get("sessao_ativa")) and (now - last.astimezone(timezone.utc)).total_seconds() <= 75
        except Exception:
            online = False

    state_data = None
    if state:
        state_data = {
            **{k: state.get(k) for k in (
                "usuario_id", "empresa_id", "usuario_email", "usuario_nome",
                "pagina_atual", "rota_atual", "metodo", "status_code", "ultimo_ip", "sessao_ativa"
            )},
            "ultima_atividade": _iso(state.get("ultima_atividade")),
            "ultimo_login": _iso(state.get("ultimo_login")),
            "ultimo_logout": _iso(state.get("ultimo_logout")),
            "online": online,
            "dispositivo": _device_info(str(state.get("user_agent") or "")),
        }

    user_data = None
    if target_user:
        user_data = {
            **{k: target_user.get(k) for k in ("id", "empresa_id", "nome", "email", "cargo", "papel", "ativo")},
            "criado_em": _iso(target_user.get("criado_em")),
            "atualizado_em": _iso(target_user.get("atualizado_em")),
        }

    last_action = next((item for item in merged if item.get("tipo") not in {"navegacao"}), None)
    critical = [item for item in merged if item.get("severidade") in {"erro", "importante"}][:8]

    return {
        "ok": True,
        "target_email": email,
        "usuario": user_data,
        "estado": state_data,
        "resumo": {
            "atividades_hoje": int((counts or {}).get("atividades_hoje") or 0),
            "alteracoes_hoje": int((counts or {}).get("alteracoes_hoje") or 0),
            "erros_hoje": int((counts or {}).get("erros_hoje") or 0),
            "entradas_hoje": int((counts or {}).get("entradas_hoje") or 0),
            "downloads_hoje": int((counts or {}).get("downloads_hoje") or 0),
            "eventos_retornados": len(merged),
        },
        "ultima_acao": last_action,
        "tempo_modulos": _module_times(list(today_rows), now, state),
        "sessoes": _build_session_events(list(session_rows)),
        "criticos": critical,
        "eventos": merged,
    }
