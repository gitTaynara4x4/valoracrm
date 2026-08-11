from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode, urlparse

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal


TARGET_EMAIL = str(os.getenv("VALORA_AUDIT_TARGET_EMAIL") or "nlsgv2010@gmail.com").strip().lower()

_STATIC_PREFIXES = (
    "/frontend/",
    "/uploads/",
)
_IGNORED_EXACT = {
    "/favicon.ico",
    "/valora-sw.js",
    "/manifest.webmanifest",
    "/ping",
}
_SENSITIVE_QUERY_KEYS = {
    "senha",
    "password",
    "passwd",
    "token",
    "secret",
    "codigo",
    "code",
    "challenge",
    "authorization",
}
_ALLOWED_CLIENT_EVENT_TYPES = {
    "click",
    "pesquisa",
    "filtro",
    "download",
    "presenca",
}
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_DOWNLOAD_MARKERS = (
    "download",
    "export",
    "excel",
    "xlsx",
    "xls",
    "csv",
    "pdf",
    "imprimir",
    "print",
)


def is_target_user(user: Any) -> bool:
    return str(getattr(user, "email", "") or "").strip().lower() == TARGET_EMAIL


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def _request_id(request: Request) -> str:
    value = str(getattr(request.state, "audit_request_id", "") or "").strip()
    if value:
        return value[:64]
    value = new_request_id()
    try:
        request.state.audit_request_id = value
    except Exception:
        pass
    return value


def _client_ip(request: Request) -> str:
    forwarded = str(request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded[:80]
    client = getattr(request, "client", None)
    return str(getattr(client, "host", "") or "")[:80]


def _safe_query_items(request: Request) -> list[tuple[str, str]]:
    safe_items: list[tuple[str, str]] = []
    for key, value in request.query_params.multi_items():
        if str(key).strip().lower() in _SENSITIVE_QUERY_KEYS:
            safe_items.append((key, "***"))
        else:
            safe_items.append((key, str(value)[:300]))
    return safe_items


def _safe_route(request: Request) -> str:
    path = str(request.url.path or "/")
    query = urlencode(_safe_query_items(request), doseq=True)
    return f"{path}?{query}" if query else path


def _page_from_request(request: Request) -> str:
    path = str(request.url.path or "/")
    if not path.startswith("/api/") and not any(path.startswith(prefix) for prefix in _STATIC_PREFIXES):
        return _clean_page(path)

    referer = str(request.headers.get("referer") or "").strip()
    if referer:
        try:
            return _clean_page(urlparse(referer).path or "/")
        except Exception:
            pass
    return ""


def _clean_page(path: str) -> str:
    path = str(path or "/").strip()
    if path.startswith("/frontend/") and path.endswith(".html"):
        path = "/" + path.rsplit("/", 1)[-1][:-5]
    if path == "/":
        return "inicio"
    return path.strip("/") or "inicio"


def _should_ignore(path: str) -> bool:
    if path in _IGNORED_EXACT:
        return True
    if any(path.startswith(prefix) for prefix in _STATIC_PREFIXES):
        return True
    if path.startswith("/api/auditoria-programadora"):
        return True
    return False


def _json(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def _user_values(user: Any) -> tuple[int, int, str, str]:
    return (
        int(getattr(user, "id")),
        int(getattr(user, "empresa_id")),
        str(getattr(user, "email", "") or "").strip().lower(),
        str(getattr(user, "nome", "") or "").strip(),
    )


def _safe_client_text(value: Any, limit: int = 180) -> str:
    text_value = re.sub(r"\s+", " ", str(value or "")).strip()
    return text_value[:limit]


def _safe_client_details(details: Any) -> dict[str, Any]:
    if not isinstance(details, dict):
        return {}

    allowed: dict[str, int] = {
        "rotulo": 220,
        "elemento": 120,
        "categoria": 80,
        "pagina_cliente": 180,
        "rota_cliente": 500,
        "valor": 220,
        "href": 500,
        "request_id_cliente": 80,
        "sessao_cliente": 100,
    }
    result: dict[str, Any] = {}
    for key, limit in allowed.items():
        if key not in details:
            continue
        value = details.get(key)
        if value is None:
            continue
        result[key] = _safe_client_text(value, limit)
    return result


def _infer_request_context(request: Request) -> dict[str, Any]:
    path = str(request.url.path or "/")
    parts = [part for part in path.strip("/").split("/") if part]
    if parts and parts[0] == "api":
        parts = parts[1:]

    module = parts[0] if parts else _page_from_request(request)
    entity_id: Optional[int] = None
    entity_type = module.rstrip("s") if module else ""

    for part in parts[1:]:
        raw = str(part).strip()
        if raw.isdigit():
            try:
                entity_id = int(raw)
                break
            except ValueError:
                pass

    return {
        "modulo": module or None,
        "entidade_tipo": entity_type or None,
        "entidade_id": entity_id,
    }


def _upsert_state(
    db: Session,
    *,
    user: Any,
    request: Request,
    status_code: Optional[int],
    session_active: bool = True,
    login: bool = False,
    logout: bool = False,
    page_override: Optional[str] = None,
    route_override: Optional[str] = None,
    method_override: Optional[str] = None,
) -> None:
    user_id, empresa_id, email, nome = _user_values(user)
    page = _clean_page(page_override) if page_override else _page_from_request(request)
    route = str(route_override or _safe_route(request))[:2000]
    now = datetime.now(timezone.utc)

    db.execute(
        text(
            """
            INSERT INTO auditoria_usuario_estado (
                usuario_id, empresa_id, usuario_email, usuario_nome,
                pagina_atual, rota_atual, metodo, status_code, ultimo_ip,
                user_agent, sessao_ativa, ultima_atividade, ultimo_login, ultimo_logout
            ) VALUES (
                :usuario_id, :empresa_id, :email, :nome,
                :pagina, :rota, :metodo, :status_code, :ip,
                :user_agent, :sessao_ativa, :agora, :ultimo_login, :ultimo_logout
            )
            ON CONFLICT (usuario_id) DO UPDATE SET
                empresa_id = EXCLUDED.empresa_id,
                usuario_email = EXCLUDED.usuario_email,
                usuario_nome = EXCLUDED.usuario_nome,
                pagina_atual = CASE
                    WHEN EXCLUDED.pagina_atual IS NULL OR EXCLUDED.pagina_atual = ''
                    THEN auditoria_usuario_estado.pagina_atual
                    ELSE EXCLUDED.pagina_atual
                END,
                rota_atual = CASE
                    WHEN EXCLUDED.rota_atual IS NULL OR EXCLUDED.rota_atual = ''
                    THEN auditoria_usuario_estado.rota_atual
                    ELSE EXCLUDED.rota_atual
                END,
                metodo = EXCLUDED.metodo,
                status_code = EXCLUDED.status_code,
                ultimo_ip = EXCLUDED.ultimo_ip,
                user_agent = EXCLUDED.user_agent,
                sessao_ativa = EXCLUDED.sessao_ativa,
                ultima_atividade = EXCLUDED.ultima_atividade,
                ultimo_login = COALESCE(EXCLUDED.ultimo_login, auditoria_usuario_estado.ultimo_login),
                ultimo_logout = COALESCE(EXCLUDED.ultimo_logout, auditoria_usuario_estado.ultimo_logout)
            """
        ),
        {
            "usuario_id": user_id,
            "empresa_id": empresa_id,
            "email": email,
            "nome": nome,
            "pagina": page,
            "rota": route,
            "metodo": str(method_override or request.method or "").upper()[:12],
            "status_code": int(status_code) if status_code is not None else None,
            "ip": _client_ip(request),
            "user_agent": str(request.headers.get("user-agent") or "")[:2000],
            "sessao_ativa": bool(session_active),
            "agora": now,
            "ultimo_login": now if login else None,
            "ultimo_logout": now if logout else None,
        },
    )


def _insert_event(
    db: Session,
    *,
    user: Any,
    request: Request,
    tipo: str,
    status_code: Optional[int] = None,
    details: Any = None,
    page_override: Optional[str] = None,
    route_override: Optional[str] = None,
    method_override: Optional[str] = None,
) -> None:
    user_id, empresa_id, email, nome = _user_values(user)
    db.execute(
        text(
            """
            INSERT INTO auditoria_usuario_atividade (
                empresa_id, usuario_id, usuario_email, usuario_nome, tipo,
                pagina, rota, metodo, status_code, ip, user_agent, detalhes_json
            ) VALUES (
                :empresa_id, :usuario_id, :email, :nome, :tipo,
                :pagina, :rota, :metodo, :status_code, :ip, :user_agent, :detalhes
            )
            """
        ),
        {
            "empresa_id": empresa_id,
            "usuario_id": user_id,
            "email": email,
            "nome": nome,
            "tipo": str(tipo)[:40],
            "pagina": _clean_page(page_override) if page_override else _page_from_request(request),
            "rota": str(route_override or _safe_route(request))[:2000],
            "metodo": str(method_override or request.method or "").upper()[:12],
            "status_code": int(status_code) if status_code is not None else None,
            "ip": _client_ip(request),
            "user_agent": str(request.headers.get("user-agent") or "")[:2000],
            "detalhes": _json(details),
        },
    )


def record_authenticated_request(user: Any, request: Request, status_code: int) -> None:
    """Registra a trilha do usuário monitorado sem capturar corpo, teclas ou senhas."""
    if not is_target_user(user):
        return

    path = str(request.url.path or "/")
    if _should_ignore(path) or path.startswith("/api/auth"):
        return

    db = SessionLocal()
    try:
        method = str(request.method or "GET").upper()
        is_page_navigation = method in {"GET", "HEAD"} and not path.startswith("/api/")
        is_embed_load = is_page_navigation and "__valora_embed" in request.query_params

        # O shell do Valora pré-carrega páginas em iframes. Esses GETs não significam
        # que o usuário realmente abriu a tela, então não alteram o estado nem a timeline.
        if not is_embed_load:
            _upsert_state(db, user=user, request=request, status_code=status_code, session_active=True)

        is_write = method in _WRITE_METHODS and path.startswith("/api/")
        lower_path = path.lower()
        is_download = method in {"GET", "POST"} and any(marker in lower_path for marker in _DOWNLOAD_MARKERS)
        context = _infer_request_context(request)
        details = {
            "resultado": "ok" if int(status_code) < 400 else "erro",
            "request_id": _request_id(request),
            **context,
        }

        if int(status_code) >= 400:
            details["status_code"] = int(status_code)
            details["acesso_negado"] = int(status_code) in {401, 403}
            _insert_event(
                db,
                user=user,
                request=request,
                tipo="erro_api" if path.startswith("/api/") else "erro_pagina",
                status_code=status_code,
                details=details,
            )
        elif is_download:
            _insert_event(
                db,
                user=user,
                request=request,
                tipo="download_exportacao",
                status_code=status_code,
                details=details,
            )
        elif is_page_navigation and not is_embed_load:
            _insert_event(
                db,
                user=user,
                request=request,
                tipo="navegacao",
                status_code=status_code,
                details=details,
            )
        elif is_write:
            details["observacao"] = (
                "O corpo da requisição não é armazenado; alterações de campos aparecem "
                "na auditoria de dados quando o módulo as registra."
            )
            _insert_event(
                db,
                user=user,
                request=request,
                tipo="alteracao_api",
                status_code=status_code,
                details=details,
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[AUDITORIA USUÁRIO] Falha ao registrar requisição: {exc}")
    finally:
        db.close()


def record_client_event(
    db: Session,
    *,
    user: Any,
    request: Request,
    tipo: str,
    details: Optional[dict[str, Any]] = None,
) -> bool:
    """Registra telemetria explícita do próprio Valora (cliques, busca, filtro e presença)."""
    if not is_target_user(user):
        return False

    normalized = str(tipo or "").strip().lower()
    if normalized not in _ALLOWED_CLIENT_EVENT_TYPES:
        return False

    safe = _safe_client_details(details or {})
    page = safe.get("pagina_cliente") or _page_from_request(request)
    route = safe.get("rota_cliente") or page

    base_details: dict[str, Any] = {
        **safe,
        "resultado": "ok",
        "request_id": _request_id(request),
    }

    _upsert_state(
        db,
        user=user,
        request=request,
        status_code=200,
        session_active=True,
        page_override=str(page or ""),
        route_override=str(route or ""),
        method_override="CLIENT",
    )
    _insert_event(
        db,
        user=user,
        request=request,
        tipo=normalized,
        status_code=200,
        details=base_details,
        page_override=str(page or ""),
        route_override=str(route or ""),
        method_override="CLIENT",
    )
    db.commit()
    return True


def record_auth_event(db: Session, user: Any, request: Request, tipo: str) -> None:
    if not is_target_user(user):
        return

    normalized = str(tipo or "").strip().lower()
    if normalized not in {"login", "logout"}:
        return

    try:
        is_logout = normalized == "logout"
        _upsert_state(
            db,
            user=user,
            request=request,
            status_code=200,
            session_active=not is_logout,
            login=normalized == "login",
            logout=is_logout,
        )
        _insert_event(
            db,
            user=user,
            request=request,
            tipo=normalized,
            status_code=200,
            details={"resultado": "ok", "request_id": _request_id(request)},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[AUDITORIA USUÁRIO] Falha ao registrar {normalized}: {exc}")


def record_login_failure(db: Session, user: Any, request: Request, *, status_code: int, reason: str) -> None:
    """Registra tentativa de login falha sem guardar a senha ou o token informado."""
    if not is_target_user(user):
        return
    try:
        _insert_event(
            db,
            user=user,
            request=request,
            tipo="login_falhou",
            status_code=int(status_code),
            details={
                "resultado": "erro",
                "motivo": _safe_client_text(reason, 180),
                "request_id": _request_id(request),
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[AUDITORIA USUÁRIO] Falha ao registrar tentativa de login: {exc}")
