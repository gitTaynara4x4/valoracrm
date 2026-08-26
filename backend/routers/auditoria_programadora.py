from __future__ import annotations

import bisect
import hmac
import json
import os
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

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
LOCAL_TZ = ZoneInfo(os.getenv("VALORA_AUDIT_TIMEZONE") or "America/Sao_Paulo")
ONLINE_SECONDS = 75
SESSION_GAP_SECONDS = 30 * 60
ACTIVE_GAP_SECONDS = 75
ACTIVE_SLICE_SECONDS = 45

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


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value))
        except Exception:
            return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: Any) -> Optional[str]:
    dt = _as_utc(value)
    return dt.isoformat() if dt else (str(value) if value is not None else None)


def _local(value: Any) -> Optional[datetime]:
    dt = _as_utc(value)
    return dt.astimezone(LOCAL_TZ) if dt else None


def _local_day(value: Any) -> Optional[str]:
    dt = _local(value)
    return dt.date().isoformat() if dt else None


def _day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


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
    if tipo in {"download", "download_exportacao", "exclusao_api"}:
        return "importante"
    if tipo == "click" and isinstance(details, dict):
        category = str(details.get("categoria") or "").lower()
        if category in {"excluir", "remover", "finalizar", "permissao", "financeiro"}:
            return "importante"
    if tipo in {"alteracao_api", "cadastro_api", "edicao_api"}:
        return "alteracao"
    return "normal"


def _severity_for_change(row: Any) -> str:
    action = str(row.get("acao") or "").lower()
    module = str(row.get("modulo") or "").lower()
    field = str(row.get("campo") or row.get("campo_nome") or "").lower()
    if action in {"removido", "excluido", "excluído", "apagado"}:
        return "importante"
    if module in {"usuarios", "empresa", "financeiro", "contas-pagar", "contas-receber"}:
        return "importante"
    if any(marker in field for marker in ("valor", "saldo", "permiss", "status", "vencimento", "cnpj", "cpf")):
        return "importante"
    return "alteracao"


def _operation_from_activity(tipo: str, details: Any) -> str:
    details = details if isinstance(details, dict) else {}
    operation = str(details.get("operacao") or "").strip().lower()
    if operation:
        return operation
    if tipo == "cadastro_api":
        return "criar"
    if tipo == "edicao_api":
        return "editar"
    if tipo == "exclusao_api":
        return "excluir"
    return ""


def _activity_to_event(row: Any) -> dict[str, Any]:
    details = _parse_details(row.get("detalhes_json"))
    tipo = str(row.get("tipo") or "")
    return {
        "key": f"atividade:{row['id']}",
        "fonte": "atividade",
        "tipo": tipo,
        "severidade": _severity_for_activity(tipo, row.get("status_code"), details),
        "usuario_nome": row.get("usuario_nome"),
        "usuario_email": row.get("usuario_email"),
        "pagina": row.get("pagina"),
        "rota": row.get("rota"),
        "metodo": row.get("metodo"),
        "status_code": row.get("status_code"),
        "ip": row.get("ip"),
        "dispositivo": _device_info(str(row.get("user_agent") or "")),
        "detalhes": details,
        "operacao": _operation_from_activity(tipo, details),
        "criado_em": _iso(row.get("criado_em")),
    }


def _nearest_activity_context(change_dt: Any, activity_rows_asc: list[Any], activity_timestamps: list[float]) -> tuple[str, str]:
    dt = _as_utc(change_dt)
    if not dt or not activity_rows_asc:
        return "", ""
    ts = dt.timestamp()
    pos = bisect.bisect_left(activity_timestamps, ts)
    candidates: list[Any] = []
    for idx in (pos - 2, pos - 1, pos, pos + 1):
        if 0 <= idx < len(activity_rows_asc):
            candidates.append(activity_rows_asc[idx])
    best = None
    best_delta = 999999.0
    for row in candidates:
        row_dt = _as_utc(row.get("criado_em"))
        if not row_dt:
            continue
        delta = abs((row_dt - dt).total_seconds())
        if delta <= 45 and delta < best_delta and row.get("pagina"):
            best = row
            best_delta = delta
    if not best:
        return "", ""
    return str(best.get("pagina") or ""), str(best.get("rota") or "")


def _change_to_event(row: Any, email: str, page: str = "", route: str = "") -> dict[str, Any]:
    field_name = str(row.get("campo") or row.get("campo_nome") or "")
    return {
        "key": f"alteracao:{row['id']}",
        "fonte": "alteracao_dados",
        "tipo": "alteracao_campo",
        "severidade": _severity_for_change(row),
        "usuario_nome": row.get("usuario_nome"),
        "usuario_email": email,
        "pagina": page or None,
        "pagina_origem": page or None,
        "rota_origem": route or None,
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


def _module_name(event: dict[str, Any]) -> str:
    details = event.get("detalhes") if isinstance(event.get("detalhes"), dict) else {}
    value = event.get("modulo") or details.get("modulo") or event.get("pagina") or "Valora"
    return str(value or "Valora").strip("/") or "Valora"


def _event_page(event: dict[str, Any]) -> str:
    return str(event.get("pagina") or event.get("pagina_origem") or _module_name(event) or "Valora").strip("/") or "Valora"


def _event_countable(tipo: str) -> bool:
    return tipo not in {"presenca", "pagina_saida"}


def _build_activity_count_summary(activity_rows: list[Any], change_rows: list[Any], start_utc: datetime, end_utc: datetime) -> dict[str, int]:
    counts = defaultdict(int)
    for row in activity_rows:
        dt = _as_utc(row.get("criado_em"))
        if not dt or not (start_utc <= dt < end_utc):
            continue
        tipo = str(row.get("tipo") or "")
        details = _parse_details(row.get("detalhes_json"))
        if _event_countable(tipo):
            counts["atividades"] += 1
        if tipo == "click":
            counts["cliques"] += 1
        elif tipo == "pesquisa":
            counts["pesquisas"] += 1
        elif tipo == "filtro":
            counts["filtros"] += 1
        elif tipo == "modal_aberto":
            counts["modais"] += 1
        elif tipo in {"download", "download_exportacao"}:
            counts["downloads"] += 1
            if tipo == "download_exportacao":
                counts["exportacoes"] += 1
        elif tipo == "login":
            counts["entradas"] += 1
        elif tipo == "logout":
            counts["saidas"] += 1
        elif tipo == "login_falhou":
            counts["login_falhou"] += 1
        elif tipo.startswith("erro") or int(row.get("status_code") or 0) >= 400:
            counts["erros"] += 1

        operation = _operation_from_activity(tipo, details)
        if operation == "criar":
            counts["cadastros"] += 1
        elif operation == "editar":
            counts["edicoes_api"] += 1
        elif operation == "excluir":
            counts["exclusoes"] += 1

    for row in change_rows:
        dt = _as_utc(row.get("criado_em"))
        if dt and start_utc <= dt < end_utc:
            counts["alteracoes"] += 1
    return {key: int(value) for key, value in counts.items()}


def _latest_presence_state(activity_rows: list[Any]) -> str:
    for row in sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        if str(row.get("tipo") or "") != "presenca":
            continue
        details = _parse_details(row.get("detalhes_json"))
        if isinstance(details, dict):
            state = str(details.get("estado_atividade") or "").lower()
            if state in {"ativo", "ocioso"}:
                return state
    return ""


def _current_page_since(activity_rows: list[Any], page: str, fallback: Any) -> Optional[datetime]:
    page = str(page or "").strip("/")
    candidates: list[datetime] = []
    for row in activity_rows:
        if str(row.get("pagina") or "").strip("/") != page:
            continue
        if str(row.get("tipo") or "") in {"navegacao", "navegacao_cliente"}:
            dt = _as_utc(row.get("criado_em"))
            if dt:
                candidates.append(dt)
    if candidates:
        return max(candidates)
    return _as_utc(fallback)


def _split_seconds_by_day(start: datetime, end: datetime) -> list[tuple[str, float]]:
    if end <= start:
        return []
    result: list[tuple[str, float]] = []
    cursor = start.astimezone(LOCAL_TZ)
    local_end = end.astimezone(LOCAL_TZ)
    while cursor < local_end:
        next_midnight = datetime.combine(cursor.date() + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
        segment_end = min(local_end, next_midnight)
        result.append((cursor.date().isoformat(), max(0.0, (segment_end - cursor).total_seconds())))
        cursor = segment_end
    return result


def _activity_detail(row: Any) -> dict[str, Any]:
    details = _parse_details(row.get("detalhes_json"))
    return details if isinstance(details, dict) else {}


def _is_idle_row(row: Any) -> bool:
    tipo = str(row.get("tipo") or "")
    if tipo == "inatividade":
        return True
    if tipo == "retorno_atividade":
        return False
    details = _activity_detail(row)
    return str(details.get("estado_atividade") or "").lower() == "ocioso"


def _build_sessions(activity_rows: list[Any], change_events: list[dict[str, Any]], now: datetime) -> tuple[list[dict[str, Any]], dict[str, float], list[dict[str, Any]]]:
    rows = [r for r in activity_rows if _as_utc(r.get("criado_em")) and str(r.get("tipo") or "") != "login_falhou"]
    rows.sort(key=lambda r: (_as_utc(r.get("criado_em")), int(r.get("id") or 0)))

    sessions_raw: list[list[Any]] = []
    current: list[Any] = []
    closed = False
    for row in rows:
        dt = _as_utc(row.get("criado_em"))
        tipo = str(row.get("tipo") or "")
        if current:
            prev_dt = _as_utc(current[-1].get("criado_em"))
            gap = (dt - prev_dt).total_seconds() if dt and prev_dt else 0
            if tipo == "login" or closed or gap > SESSION_GAP_SECONDS:
                sessions_raw.append(current)
                current = []
                closed = False
        current.append(row)
        if tipo == "logout":
            closed = True
    if current:
        sessions_raw.append(current)

    global_page_seconds: dict[str, float] = defaultdict(float)
    inactivity: list[dict[str, Any]] = []
    sessions: list[dict[str, Any]] = []

    for index, group in enumerate(sessions_raw):
        if not group:
            continue
        first_dt = _as_utc(group[0].get("criado_em"))
        last_dt = _as_utc(group[-1].get("criado_em"))
        if not first_dt or not last_dt:
            continue
        session_id = f"sessao-{int(first_dt.timestamp())}-{int(group[0].get('id') or index)}"
        active_seconds = 0.0
        idle_seconds = 0.0
        page_seconds: dict[str, float] = defaultdict(float)
        module_seconds: dict[str, float] = defaultdict(float)
        session_inactivity: list[dict[str, Any]] = []

        explicit_idle_start: Optional[datetime] = None
        for pos, row in enumerate(group):
            dt = _as_utc(row.get("criado_em"))
            tipo = str(row.get("tipo") or "")
            if tipo == "inatividade" and dt:
                explicit_idle_start = dt
            elif tipo == "retorno_atividade" and dt and explicit_idle_start and dt > explicit_idle_start:
                period = {
                    "inicio": explicit_idle_start.isoformat(),
                    "fim": dt.isoformat(),
                    "segundos": int((dt - explicit_idle_start).total_seconds()),
                    "pagina": row.get("pagina") or group[max(0, pos - 1)].get("pagina"),
                    "sessao_id": session_id,
                    "origem": "cliente",
                }
                session_inactivity.append(period)
                explicit_idle_start = None

            if pos + 1 >= len(group):
                continue
            nxt = group[pos + 1]
            nxt_dt = _as_utc(nxt.get("criado_em"))
            if not dt or not nxt_dt or nxt_dt <= dt:
                continue
            gap = min((nxt_dt - dt).total_seconds(), SESSION_GAP_SECONDS)
            page = str(row.get("pagina") or "Valora").strip("/") or "Valora"
            details = _activity_detail(row)
            module = str(details.get("modulo") or page).strip("/") or page

            row_idle = _is_idle_row(row)
            if row_idle:
                active_part = 0.0
                idle_part = gap
            elif gap <= ACTIVE_GAP_SECONDS:
                active_part = gap
                idle_part = 0.0
            else:
                active_part = min(ACTIVE_SLICE_SECONDS, gap)
                idle_part = max(0.0, gap - active_part)
                gap_idle_start = dt + timedelta(seconds=active_part)
                # Só cria período implícito quando não há um explícito cobrindo o mesmo trecho.
                if not any(abs((_as_utc(p["inicio"]) - gap_idle_start).total_seconds()) < 90 for p in session_inactivity if _as_utc(p.get("inicio"))):
                    session_inactivity.append({
                        "inicio": gap_idle_start.isoformat(),
                        "fim": nxt_dt.isoformat(),
                        "segundos": int(idle_part),
                        "pagina": page,
                        "sessao_id": session_id,
                        "origem": "intervalo",
                    })

            active_seconds += active_part
            idle_seconds += idle_part
            page_seconds[page] += active_part
            module_seconds[module] += active_part
            global_page_seconds[page] += active_part

        if explicit_idle_start and last_dt > explicit_idle_start:
            session_inactivity.append({
                "inicio": explicit_idle_start.isoformat(),
                "fim": last_dt.isoformat(),
                "segundos": int((last_dt - explicit_idle_start).total_seconds()),
                "pagina": group[-1].get("pagina"),
                "sessao_id": session_id,
                "origem": "cliente",
            })

        inactivity.extend(session_inactivity)
        start_ts = first_dt.timestamp() - 1
        end_ts = last_dt.timestamp() + 1
        seq = []
        for row in group:
            if str(row.get("tipo") or "") == "presenca":
                continue
            event = _activity_to_event(row)
            event["sessao_id"] = session_id
            seq.append(event)
        for change in change_events:
            change_dt = _as_utc(change.get("criado_em"))
            if change_dt and start_ts <= change_dt.timestamp() <= end_ts:
                copied = dict(change)
                copied["sessao_id"] = session_id
                seq.append(copied)
        seq.sort(key=lambda item: item.get("criado_em") or "")

        user_agent = str(group[-1].get("user_agent") or group[0].get("user_agent") or "")
        ip_values = []
        for row in group:
            ip = str(row.get("ip") or "").strip()
            if ip and ip not in ip_values:
                ip_values.append(ip)
        duration = max(0, int((last_dt - first_dt).total_seconds()))
        sessions.append({
            "id": session_id,
            "inicio": first_dt.isoformat(),
            "fim": last_dt.isoformat(),
            "duracao_segundos": duration,
            "tempo_ativo_segundos": int(round(active_seconds)),
            "tempo_ocioso_segundos": int(round(idle_seconds)),
            "login_registrado": any(str(r.get("tipo") or "") == "login" for r in group),
            "logout_registrado": any(str(r.get("tipo") or "") == "logout" for r in group),
            "ip": ip_values[-1] if ip_values else "",
            "ips": ip_values,
            "dispositivo": _device_info(user_agent),
            "pagina_inicial": group[0].get("pagina"),
            "pagina_final": group[-1].get("pagina"),
            "quantidade_acoes": len([r for r in group if _event_countable(str(r.get("tipo") or ""))]),
            "tempo_paginas": [
                {"pagina": key, "segundos": int(round(value))}
                for key, value in sorted(page_seconds.items(), key=lambda pair: pair[1], reverse=True)
                if value >= 1
            ],
            "tempo_modulos": [
                {"modulo": key, "segundos": int(round(value))}
                for key, value in sorted(module_seconds.items(), key=lambda pair: pair[1], reverse=True)
                if value >= 1
            ],
            "inatividades": sorted(session_inactivity, key=lambda item: item.get("inicio") or ""),
            "eventos": seq[-160:],
        })

    sessions.sort(key=lambda item: item.get("inicio") or "", reverse=True)
    inactivity.sort(key=lambda item: item.get("inicio") or "", reverse=True)
    return sessions, global_page_seconds, inactivity


def _compute_time_analytics(activity_rows: list[Any]) -> tuple[dict[str, float], dict[str, float], dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    rows = [r for r in activity_rows if _as_utc(r.get("criado_em")) and str(r.get("tipo") or "") != "login_falhou"]
    rows.sort(key=lambda r: (_as_utc(r.get("criado_em")), int(r.get("id") or 0)))
    page_seconds: dict[str, float] = defaultdict(float)
    module_seconds: dict[str, float] = defaultdict(float)
    daily_time: dict[str, dict[str, float]] = defaultdict(lambda: {"ativo": 0.0, "ocioso": 0.0})
    daily_page: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for i in range(len(rows) - 1):
        row = rows[i]
        nxt = rows[i + 1]
        dt = _as_utc(row.get("criado_em"))
        nxt_dt = _as_utc(nxt.get("criado_em"))
        if not dt or not nxt_dt or nxt_dt <= dt:
            continue
        raw_gap = (nxt_dt - dt).total_seconds()
        if raw_gap > SESSION_GAP_SECONDS:
            continue
        gap = raw_gap
        page = str(row.get("pagina") or "Valora").strip("/") or "Valora"
        details = _activity_detail(row)
        module = str(details.get("modulo") or page).strip("/") or page
        if _is_idle_row(row):
            active_part = 0.0
            idle_part = gap
        elif gap <= ACTIVE_GAP_SECONDS:
            active_part = gap
            idle_part = 0.0
        else:
            active_part = min(ACTIVE_SLICE_SECONDS, gap)
            idle_part = max(0.0, gap - active_part)

        if active_part > 0:
            page_seconds[page] += active_part
            module_seconds[module] += active_part
            active_end = dt + timedelta(seconds=active_part)
            for day_key, seconds in _split_seconds_by_day(dt, active_end):
                daily_time[day_key]["ativo"] += seconds
                daily_page[day_key][page] += seconds
        if idle_part > 0:
            idle_start = dt + timedelta(seconds=active_part)
            for day_key, seconds in _split_seconds_by_day(idle_start, nxt_dt):
                daily_time[day_key]["ocioso"] += seconds

    return page_seconds, module_seconds, daily_time, daily_page


def _daily_metrics(activity_rows: list[Any], change_rows: list[Any], days: int, now_local: datetime, daily_time: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    start_day = now_local.date() - timedelta(days=days - 1)
    metrics: dict[str, dict[str, Any]] = {}
    for offset in range(days):
        key = (start_day + timedelta(days=offset)).isoformat()
        metrics[key] = {
            "data": key,
            "atividades": 0,
            "cliques": 0,
            "pesquisas": 0,
            "filtros": 0,
            "alteracoes": 0,
            "cadastros": 0,
            "exclusoes": 0,
            "downloads": 0,
            "modais": 0,
            "erros": 0,
            "entradas": 0,
            "saidas": 0,
            "primeira_atividade": None,
            "ultima_atividade": None,
            "tempo_ativo_segundos": int(round(daily_time.get(key, {}).get("ativo", 0))),
            "tempo_ocioso_segundos": int(round(daily_time.get(key, {}).get("ocioso", 0))),
        }

    for row in activity_rows:
        key = _local_day(row.get("criado_em"))
        if key not in metrics:
            continue
        item = metrics[key]
        tipo = str(row.get("tipo") or "")
        dt = _iso(row.get("criado_em"))
        if dt and (item["primeira_atividade"] is None or dt < item["primeira_atividade"]):
            item["primeira_atividade"] = dt
        if dt and (item["ultima_atividade"] is None or dt > item["ultima_atividade"]):
            item["ultima_atividade"] = dt
        if _event_countable(tipo):
            item["atividades"] += 1
        if tipo == "click":
            item["cliques"] += 1
        elif tipo == "pesquisa":
            item["pesquisas"] += 1
        elif tipo == "filtro":
            item["filtros"] += 1
        elif tipo == "modal_aberto":
            item["modais"] += 1
        elif tipo in {"download", "download_exportacao"}:
            item["downloads"] += 1
        elif tipo == "login":
            item["entradas"] += 1
        elif tipo == "logout":
            item["saidas"] += 1
        elif tipo.startswith("erro") or int(row.get("status_code") or 0) >= 400:
            item["erros"] += 1
        operation = _operation_from_activity(tipo, _parse_details(row.get("detalhes_json")))
        if operation == "criar":
            item["cadastros"] += 1
        elif operation == "excluir":
            item["exclusoes"] += 1

    for row in change_rows:
        key = _local_day(row.get("criado_em"))
        if key in metrics:
            metrics[key]["alteracoes"] += 1

    return [metrics[key] for key in sorted(metrics)]


def _sum_daily(items: list[dict[str, Any]], start_day: date, end_day: date) -> dict[str, int]:
    numeric_keys = (
        "atividades", "cliques", "pesquisas", "filtros", "alteracoes", "cadastros",
        "exclusoes", "downloads", "modais", "erros", "entradas", "saidas",
        "tempo_ativo_segundos", "tempo_ocioso_segundos",
    )
    result = {key: 0 for key in numeric_keys}
    for item in items:
        try:
            current = date.fromisoformat(str(item.get("data")))
        except Exception:
            continue
        if start_day <= current <= end_day:
            for key in numeric_keys:
                result[key] += int(item.get(key) or 0)
    return result


def _comparison(current: dict[str, int], previous: dict[str, int]) -> dict[str, Any]:
    result: dict[str, Any] = {"atual": current, "anterior": previous, "variacao": {}}
    for key, value in current.items():
        old = int(previous.get(key) or 0)
        if old == 0:
            pct = 100.0 if value > 0 else 0.0
        else:
            pct = ((value - old) / old) * 100.0
        result["variacao"][key] = round(pct, 1)
    return result



def _hourly_heatmap(activity_rows: list[Any], change_rows: list[Any]) -> list[dict[str, Any]]:
    """Agrega atividade por hora local sem materializar eventos completos."""
    hours = {hour: {"hora": hour, "atividades": 0, "alteracoes": 0, "total": 0} for hour in range(24)}
    for row in activity_rows:
        tipo = str(row.get("tipo") or "")
        if not _event_countable(tipo) or tipo == "presenca":
            continue
        dt = _as_utc(row.get("criado_em"))
        if not dt:
            continue
        hour = dt.astimezone(LOCAL_TZ).hour
        hours[hour]["atividades"] += 1
        hours[hour]["total"] += 1
    for row in change_rows:
        dt = _as_utc(row.get("criado_em"))
        if not dt:
            continue
        hour = dt.astimezone(LOCAL_TZ).hour
        hours[hour]["alteracoes"] += 1
        hours[hour]["total"] += 1
    return [hours[hour] for hour in range(24)]


def _light_session_highlights(activity_rows: list[Any]) -> dict[str, Any]:
    """Resume sessões em O(n), sem anexar eventos/alterações a cada sessão."""
    rows = [r for r in activity_rows if _as_utc(r.get("criado_em")) and str(r.get("tipo") or "") != "login_falhou"]
    rows.sort(key=lambda r: (_as_utc(r.get("criado_em")), int(r.get("id") or 0)))
    groups: list[list[Any]] = []
    current: list[Any] = []
    closed = False
    for row in rows:
        dt = _as_utc(row.get("criado_em"))
        tipo = str(row.get("tipo") or "")
        if current:
            previous = _as_utc(current[-1].get("criado_em"))
            gap = (dt - previous).total_seconds() if dt and previous else 0
            if tipo == "login" or closed or gap > SESSION_GAP_SECONDS:
                groups.append(current)
                current = []
                closed = False
        current.append(row)
        if tipo == "logout":
            closed = True
    if current:
        groups.append(current)

    summaries: list[dict[str, Any]] = []
    for idx, group in enumerate(groups):
        first = _as_utc(group[0].get("criado_em"))
        last = _as_utc(group[-1].get("criado_em"))
        if not first or not last:
            continue
        count = sum(1 for r in group if _event_countable(str(r.get("tipo") or "")) and str(r.get("tipo") or "") != "presenca")
        duration = max(0, int((last - first).total_seconds()))
        summaries.append({
            "id": f"sessao-{int(first.timestamp())}-{int(group[0].get('id') or idx)}",
            "inicio": first.isoformat(),
            "fim": last.isoformat(),
            "duracao_segundos": duration,
            "quantidade_acoes": count,
            "pagina_inicial": group[0].get("pagina"),
            "pagina_final": group[-1].get("pagina"),
            "ip": group[-1].get("ip") or group[0].get("ip") or "",
            "dispositivo": _device_info(str(group[-1].get("user_agent") or group[0].get("user_agent") or "")),
        })
    longest = max(summaries, key=lambda item: (item["duracao_segundos"], item["quantidade_acoes"]), default=None)
    return {"quantidade": len(summaries), "mais_longa": longest}


def _dashboard_anomalies(current: dict[str, int], previous: dict[str, int], activity_rows: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    def add(kind: str, title: str, detail: str, severity: str = "atencao") -> None:
        result.append({"tipo": kind, "titulo": title, "detalhe": detail, "severidade": severity})

    cur_errors = int(current.get("erros") or 0)
    old_errors = int(previous.get("erros") or 0)
    if cur_errors >= 3 and cur_errors >= max(old_errors + 2, old_errors * 1.5):
        add("erros", "Erros acima do padrão", f"{cur_errors} erros no período contra {old_errors} no comparativo.", "alta")

    cur_deletes = int(current.get("exclusoes") or 0)
    old_deletes = int(previous.get("exclusoes") or 0)
    if cur_deletes >= 2 and cur_deletes >= max(old_deletes + 2, old_deletes * 2):
        add("exclusoes", "Exclusões acima do padrão", f"{cur_deletes} exclusões no período contra {old_deletes} no comparativo.", "alta")

    cur_changes = int(current.get("alteracoes") or 0)
    old_changes = int(previous.get("alteracoes") or 0)
    if cur_changes >= 10 and cur_changes >= max(old_changes + 8, old_changes * 1.8):
        add("alteracoes", "Volume alto de alterações", f"{cur_changes} alterações, acima das {old_changes} do período comparado.")

    active = int(current.get("tempo_ativo_segundos") or 0)
    idle = int(current.get("tempo_ocioso_segundos") or 0)
    if active + idle >= 3600 and idle / max(1, active + idle) >= 0.60:
        pct = round((idle / max(1, active + idle)) * 100)
        add("ociosidade", "Ociosidade elevada", f"{pct}% do tempo acompanhado ficou ocioso.")

    off_hours = 0
    failed_logins = 0
    for row in activity_rows:
        dt = _as_utc(row.get("criado_em"))
        if not dt:
            continue
        tipo = str(row.get("tipo") or "")
        if tipo == "login_falhou":
            failed_logins += 1
        if _event_countable(tipo) and tipo != "presenca":
            hour = dt.astimezone(LOCAL_TZ).hour
            if hour < 6 or hour >= 22:
                off_hours += 1
    if failed_logins >= 3:
        add("login", "Múltiplas falhas de login", f"Foram registradas {failed_logins} tentativas de login com falha.", "alta")
    if off_hours >= 5:
        add("horario", "Atividade fora do horário comum", f"{off_hours} ações ocorreram entre 22h e 6h.")
    return result[:8]


def _critical_change_lists(activity_rows: list[Any], change_rows: list[Any], email: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    critical_changes: list[dict[str, Any]] = []
    deletions: list[dict[str, Any]] = []
    for row in change_rows:
        event = _change_to_event(row, email, "", "")
        action = str(row.get("acao") or "").lower()
        if event.get("severidade") == "importante":
            critical_changes.append(event)
        if action in {"removido", "excluido", "excluído", "apagado", "excluir", "delete", "deleted"}:
            deletions.append(event)
    for row in activity_rows:
        tipo = str(row.get("tipo") or "")
        details = _activity_detail(row)
        if _operation_from_activity(tipo, details) == "excluir":
            deletions.append(_activity_to_event(row))
    critical_changes.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
    deletions.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
    return critical_changes[:10], deletions[:10]


def _dashboard_summary_text(
    period_days: int,
    current: dict[str, int],
    ranking_modules: list[dict[str, Any]],
    most_active_day: Optional[dict[str, Any]],
    peak_hour: Optional[dict[str, Any]],
    longest_session: Optional[dict[str, Any]],
    anomalies: list[dict[str, Any]],
) -> str:
    parts = [
        f"No período de {period_days} dia{'s' if period_days != 1 else ''}, foram registradas {int(current.get('atividades') or 0)} ações e {int(current.get('alteracoes') or 0)} alterações.",
    ]
    if ranking_modules:
        top = ranking_modules[0]
        parts.append(f"O módulo com mais tempo foi {str(top.get('modulo') or 'Valora')}.")
    if most_active_day:
        parts.append(f"O dia mais ativo teve {int(most_active_day.get('total') or 0)} registros.")
    if peak_hour:
        parts.append(f"O pico de atividade ocorreu às {int(peak_hour.get('hora') or 0):02d}h, com {int(peak_hour.get('total') or 0)} registros.")
    if longest_session:
        minutes = max(1, round(int(longest_session.get('duracao_segundos') or 0) / 60))
        parts.append(f"A sessão mais longa durou aproximadamente {minutes} minuto{'s' if minutes != 1 else ''}.")
    if anomalies:
        parts.append(f"Foram identificados {len(anomalies)} ponto{'s' if len(anomalies) != 1 else ''} fora do padrão para revisão.")
    else:
        parts.append("Nenhum comportamento relevante fora do padrão foi identificado pelos critérios atuais.")
    return " ".join(parts)

def _login_history(activity_rows: list[Any]) -> list[dict[str, Any]]:
    result = []
    for row in sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        tipo = str(row.get("tipo") or "")
        if tipo not in {"login", "logout", "login_falhou"}:
            continue
        details = _parse_details(row.get("detalhes_json"))
        result.append({
            "tipo": tipo,
            "criado_em": _iso(row.get("criado_em")),
            "ip": row.get("ip"),
            "status_code": row.get("status_code"),
            "dispositivo": _device_info(str(row.get("user_agent") or "")),
            "detalhes": details,
        })
        if len(result) >= 60:
            break
    return result


def _recent_inactivity_light(activity_rows: list[Any], limit: int = 80) -> list[dict[str, Any]]:
    """Calcula períodos recentes de inatividade sem montar sessões/eventos completos."""
    rows = [r for r in activity_rows if _as_utc(r.get("criado_em"))]
    rows.sort(key=lambda r: (_as_utc(r.get("criado_em")), int(r.get("id") or 0)))
    periods: list[dict[str, Any]] = []
    explicit_start: Optional[tuple[datetime, str]] = None

    for pos, row in enumerate(rows):
        dt = _as_utc(row.get("criado_em"))
        if not dt:
            continue
        tipo = str(row.get("tipo") or "")
        page = str(row.get("pagina") or "Valora").strip("/") or "Valora"

        if tipo == "inatividade":
            explicit_start = (dt, page)
        elif tipo == "retorno_atividade" and explicit_start and dt > explicit_start[0]:
            start_dt, start_page = explicit_start
            periods.append({
                "inicio": start_dt.isoformat(),
                "fim": dt.isoformat(),
                "segundos": int((dt - start_dt).total_seconds()),
                "pagina": start_page or page,
                "origem": "cliente",
            })
            explicit_start = None

        if pos + 1 >= len(rows):
            continue
        next_dt = _as_utc(rows[pos + 1].get("criado_em"))
        if not next_dt or next_dt <= dt:
            continue
        gap = (next_dt - dt).total_seconds()
        if gap <= ACTIVE_GAP_SECONDS or gap > SESSION_GAP_SECONDS or _is_idle_row(row):
            continue
        implicit_start = dt + timedelta(seconds=min(ACTIVE_SLICE_SECONDS, gap))
        if explicit_start and explicit_start[0] <= implicit_start <= next_dt:
            continue
        idle_seconds = int((next_dt - implicit_start).total_seconds())
        if idle_seconds >= 60:
            periods.append({
                "inicio": implicit_start.isoformat(),
                "fim": next_dt.isoformat(),
                "segundos": idle_seconds,
                "pagina": page,
                "origem": "intervalo",
            })

    # Remove duplicatas aproximadas e devolve só os períodos mais recentes.
    unique: dict[tuple[int, str], dict[str, Any]] = {}
    for item in periods:
        start_dt = _as_utc(item.get("inicio"))
        if not start_dt:
            continue
        key = (int(start_dt.timestamp() // 30), str(item.get("pagina") or ""))
        current = unique.get(key)
        if current is None or int(item.get("segundos") or 0) > int(current.get("segundos") or 0):
            unique[key] = item
    result = sorted(unique.values(), key=lambda item: item.get("inicio") or "", reverse=True)
    return result[:max(1, min(int(limit), 200))]


def _fetch_activity_rows(
    db: Session,
    email: str,
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 20000,
) -> list[Any]:
    where_since = "AND criado_em >= :since" if since else ""
    where_until = "AND criado_em < :until" if until else ""
    params: dict[str, Any] = {"email": email, "limit": max(20, min(int(limit), 30000))}
    if since:
        params["since"] = since
    if until:
        params["until"] = until
    return list(db.execute(
        text(f"""
            SELECT id, usuario_id, empresa_id, usuario_email, usuario_nome,
                   tipo, pagina, rota, metodo, status_code, ip, user_agent,
                   detalhes_json, criado_em
            FROM auditoria_usuario_atividade
            WHERE LOWER(usuario_email) = :email
              {where_since}
              {where_until}
            ORDER BY criado_em DESC, id DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all())


def _fetch_change_rows(
    db: Session,
    email: str,
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 10000,
) -> list[Any]:
    where_since = "AND a.criado_em >= :since" if since else ""
    where_until = "AND a.criado_em < :until" if until else ""
    params: dict[str, Any] = {"email": email, "limit": max(20, min(int(limit), 15000))}
    if since:
        params["since"] = since
    if until:
        params["until"] = until
    return list(db.execute(
        text(f"""
            SELECT a.id, a.empresa_id, a.modulo, a.entidade_tipo, a.entidade_id,
                   a.secao, a.campo, a.campo_nome, a.acao,
                   a.valor_anterior_json, a.valor_novo_json,
                   a.usuario_id, a.usuario_nome, a.origem, a.criado_em
            FROM auditoria_alteracoes a
            JOIN usuarios u ON u.id = a.usuario_id
            WHERE LOWER(u.email) = :email
              {where_since}
              {where_until}
            ORDER BY a.criado_em DESC, a.id DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all())


def _get_state(db: Session, email: str) -> Any:
    return db.execute(
        text("""
            SELECT s.usuario_id, s.empresa_id, s.usuario_email, s.usuario_nome,
                   s.pagina_atual, s.rota_atual, s.metodo, s.status_code,
                   s.ultimo_ip, s.user_agent, s.sessao_ativa, s.ultima_atividade,
                   s.ultimo_login, s.ultimo_logout
            FROM auditoria_usuario_estado s
            WHERE LOWER(s.usuario_email) = :email
            ORDER BY s.ultima_atividade DESC
            LIMIT 1
        """),
        {"email": email},
    ).mappings().first()


def _get_target_user(db: Session, email: str) -> Any:
    return db.execute(
        text("""
            SELECT id, empresa_id, nome, email, cargo, papel, ativo, criado_em, atualizado_em
            FROM usuarios
            WHERE LOWER(email)=:email
            ORDER BY ativo DESC, id ASC
            LIMIT 1
        """),
        {"email": email},
    ).mappings().first()


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
    """Recebe somente telemetria explícita do Valora; senhas e formulários comuns não são capturados."""
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
    limit: int = 700,
    current_user=Depends(_require_unlock),
    db: Session = Depends(get_db),
):
    limit = max(50, min(int(limit), 1200))
    email = TARGET_EMAIL
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(LOCAL_TZ)
    today_start, tomorrow_start = _day_bounds_utc(now_local.date())

    state = _get_state(db, email)
    target_user = _get_target_user(db, email)
    # Busca um pouco mais do que o limite porque presença é usada no estado, mas não entra na timeline.
    activity_rows = _fetch_activity_rows(db, email, since=now - timedelta(days=14), limit=min(limit * 4, 5000))
    change_rows = _fetch_change_rows(db, email, since=now - timedelta(days=14), limit=min(limit * 2, 2400))

    activity_asc = sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc))
    activity_ts = [(_as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp() for r in activity_asc]

    merged: list[dict[str, Any]] = []
    for row in activity_rows:
        if str(row.get("tipo") or "") == "presenca":
            continue
        merged.append(_activity_to_event(row))
    for row in change_rows:
        page, route = _nearest_activity_context(row.get("criado_em"), activity_asc, activity_ts)
        merged.append(_change_to_event(row, email, page, route))

    merged.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
    merged = merged[:limit]

    counts = _build_activity_count_summary(activity_rows, change_rows, today_start, tomorrow_start)

    online = False
    last_activity = _as_utc(state.get("ultima_atividade")) if state else None
    if state and last_activity:
        online = bool(state.get("sessao_ativa")) and (now - last_activity).total_seconds() <= ONLINE_SECONDS

    activity_state = _latest_presence_state(activity_rows)
    current_since = _current_page_since(activity_rows, state.get("pagina_atual") if state else "", state.get("ultima_atividade") if state else None)
    page_elapsed = 0
    if online and current_since:
        page_elapsed = max(0, int((now - current_since).total_seconds()))

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
            "estado_atividade": activity_state or ("ativo" if online else "offline"),
            "pagina_desde": current_since.isoformat() if current_since else None,
            "segundos_pagina_atual": page_elapsed,
            "dispositivo": _device_info(str(state.get("user_agent") or "")),
        }

    user_data = None
    if target_user:
        user_data = {
            **{k: target_user.get(k) for k in ("id", "empresa_id", "nome", "email", "cargo", "papel", "ativo")},
            "criado_em": _iso(target_user.get("criado_em")),
            "atualizado_em": _iso(target_user.get("atualizado_em")),
        }

    last_action = next((item for item in merged if item.get("tipo") not in {"navegacao", "navegacao_cliente", "pagina_saida"}), None)
    critical = [item for item in merged if item.get("severidade") in {"erro", "importante"}][:12]

    return {
        "ok": True,
        "target_email": email,
        "usuario": user_data,
        "estado": state_data,
        "resumo": {
            "atividades_hoje": counts.get("atividades", 0),
            "alteracoes_hoje": counts.get("alteracoes", 0),
            "erros_hoje": counts.get("erros", 0) + counts.get("login_falhou", 0),
            "entradas_hoje": counts.get("entradas", 0),
            "downloads_hoje": counts.get("downloads", 0),
            "cliques_hoje": counts.get("cliques", 0),
            "pesquisas_hoje": counts.get("pesquisas", 0),
            "filtros_hoje": counts.get("filtros", 0),
            "cadastros_hoje": counts.get("cadastros", 0),
            "exclusoes_hoje": counts.get("exclusoes", 0),
            "modais_hoje": counts.get("modais", 0),
            "eventos_retornados": len(merged),
        },
        "ultima_acao": last_action,
        "criticos": critical,
        "eventos": merged,
    }


@router.get("/analise")
def analytics(
    dias: int = 60,
    secao: str = "resumo",
    inicio: Optional[date] = None,
    fim: Optional[date] = None,
    comparar_inicio: Optional[date] = None,
    comparar_fim: Optional[date] = None,
    current_user=Depends(_require_unlock),
    db: Session = Depends(get_db),
):
    """Entrega a auditoria em partes para não carregar/renderizar tudo de uma vez.

    resumo: cards, comparações, calendário e rankings.
    timeline: histórico detalhado somente quando a aba é aberta.
    alteracoes: alterações/cadastros/exclusões somente quando a aba é aberta.
    sessoes: sessões, logins e inatividades somente quando a aba é aberta.
    """
    days = max(7, min(int(dias), 120))
    section = str(secao or "resumo").strip().lower()
    if section not in {"resumo", "dashboard", "timeline", "alteracoes", "sessoes"}:
        section = "resumo"

    email = TARGET_EMAIL
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(LOCAL_TZ)
    start_day = now_local.date() - timedelta(days=days - 1)
    since, _ = _day_bounds_utc(start_day)

    if section == "dashboard":
        # Dashboard usa intervalos exatos. O período selecionado e o comparativo
        # são consultados separadamente para permitir comparação manual sem
        # buscar todos os dias existentes entre os dois intervalos.
        today_local = now_local.date()
        requested_start_day = inicio or fim or today_local
        requested_end_day = fim or inicio or today_local
        start_selected = min(requested_start_day, today_local)
        end_day = min(requested_end_day, today_local)
        if start_selected > end_day:
            start_selected, end_day = end_day, start_selected
        max_span_days = 90
        requested_span = (end_day - start_selected).days + 1
        span_days = requested_span
        if span_days > max_span_days:
            start_selected = end_day - timedelta(days=max_span_days - 1)
            span_days = max_span_days

        custom_compare = bool(comparar_inicio or comparar_fim)
        if custom_compare:
            requested_compare_start = comparar_inicio or comparar_fim or today_local
            requested_compare_end = comparar_fim or comparar_inicio or today_local
            compare_start = min(requested_compare_start, today_local)
            compare_end = min(requested_compare_end, today_local)
            if compare_start > compare_end:
                compare_start, compare_end = compare_end, compare_start
            compare_span = (compare_end - compare_start).days + 1
            if compare_span > max_span_days:
                compare_start = compare_end - timedelta(days=max_span_days - 1)
                compare_span = max_span_days
        else:
            compare_end = start_selected - timedelta(days=1)
            compare_start = compare_end - timedelta(days=span_days - 1)
            compare_span = span_days

        selected_start_utc, _ = _day_bounds_utc(start_selected)
        _, selected_end_utc = _day_bounds_utc(end_day)
        compare_start_utc, _ = _day_bounds_utc(compare_start)
        _, compare_end_utc = _day_bounds_utc(compare_end)

        selected_activity = _fetch_activity_rows(db, email, since=selected_start_utc, until=selected_end_utc, limit=30000)
        selected_changes = _fetch_change_rows(db, email, since=selected_start_utc, until=selected_end_utc, limit=15000)
        previous_activity = _fetch_activity_rows(db, email, since=compare_start_utc, until=compare_end_utc, limit=30000)
        previous_changes = _fetch_change_rows(db, email, since=compare_start_utc, until=compare_end_utc, limit=15000)

        selected_page_seconds, selected_module_seconds, selected_daily_time, _ = _compute_time_analytics(selected_activity)
        _, _, previous_daily_time, _ = _compute_time_analytics(previous_activity)
        selected_anchor = datetime.combine(end_day, time.max, tzinfo=LOCAL_TZ)
        previous_anchor = datetime.combine(compare_end, time.max, tzinfo=LOCAL_TZ)
        selected_daily = _daily_metrics(selected_activity, selected_changes, span_days, selected_anchor, selected_daily_time)
        previous_daily = _daily_metrics(previous_activity, previous_changes, compare_span, previous_anchor, previous_daily_time)
        selected_sum = _sum_daily(selected_daily, start_selected, end_day)
        previous_sum = _sum_daily(previous_daily, compare_start, compare_end)

        page_counts: dict[str, int] = defaultdict(int)
        module_counts: dict[str, int] = defaultdict(int)
        for row in selected_activity:
            tipo = str(row.get("tipo") or "")
            if tipo == "presenca":
                continue
            page = str(row.get("pagina") or "Valora").strip("/") or "Valora"
            details = _activity_detail(row)
            module = str(details.get("modulo") or page).strip("/") or page
            page_counts[page] += 1
            module_counts[module] += 1
        for row in selected_changes:
            module = str(row.get("modulo") or row.get("entidade_tipo") or "Valora").strip("/") or "Valora"
            module_counts[module] += 1

        ranking_pages = [
            {"pagina": key, "segundos": int(round(selected_page_seconds.get(key, 0))), "acoes": int(page_counts.get(key, 0))}
            for key in sorted(set(page_counts) | set(selected_page_seconds), key=lambda k: (selected_page_seconds.get(k, 0), page_counts.get(k, 0)), reverse=True)
        ][:20]
        ranking_modules = [
            {"modulo": key, "segundos": int(round(selected_module_seconds.get(key, 0))), "acoes": int(module_counts.get(key, 0))}
            for key in sorted(set(module_counts) | set(selected_module_seconds), key=lambda k: (selected_module_seconds.get(k, 0), module_counts.get(k, 0)), reverse=True)
        ][:20]

        critical_events: list[dict[str, Any]] = []
        for row in selected_activity:
            event = _activity_to_event(row)
            if event.get("severidade") in {"erro", "importante"}:
                critical_events.append(event)
        for row in selected_changes:
            event = _change_to_event(row, email, str(row.get("modulo") or ""), "")
            if event.get("severidade") == "importante":
                critical_events.append(event)
        critical_events.sort(key=lambda item: item.get("criado_em") or "", reverse=True)

        heatmap = _hourly_heatmap(selected_activity, selected_changes)
        peak_hour = max(heatmap, key=lambda item: item.get("total") or 0, default=None)
        if peak_hour and not int(peak_hour.get("total") or 0):
            peak_hour = None

        day_candidates = []
        for item in selected_daily:
            copy = dict(item)
            copy["total"] = int(copy.get("atividades") or 0) + int(copy.get("alteracoes") or 0)
            day_candidates.append(copy)
        most_active_day = max(day_candidates, key=lambda item: item.get("total") or 0, default=None)
        if most_active_day and not int(most_active_day.get("total") or 0):
            most_active_day = None

        session_highlights = _light_session_highlights(selected_activity)
        anomalies = _dashboard_anomalies(selected_sum, previous_sum, selected_activity)
        critical_changes, deletions = _critical_change_lists(selected_activity, selected_changes, email)
        summary_text = _dashboard_summary_text(
            span_days,
            selected_sum,
            ranking_modules,
            most_active_day,
            peak_hour,
            session_highlights.get("mais_longa"),
            anomalies,
        )

        return {
            "ok": True,
            "secao": section,
            "periodo": {
                "dias": span_days,
                "inicio": start_selected.isoformat(),
                "fim": end_day.isoformat(),
                "timezone": str(LOCAL_TZ),
                "limitado": requested_span > max_span_days,
            },
            "periodo_anterior": {
                "inicio": compare_start.isoformat(),
                "fim": compare_end.isoformat(),
                "dias": compare_span,
                "personalizado": custom_compare,
            },
            "atual": selected_sum,
            "comparacao": _comparison(selected_sum, previous_sum),
            "resumo_diario": selected_daily,
            "ranking_paginas": ranking_pages,
            "ranking_modulos": ranking_modules,
            "criticos": critical_events[:12],
            "mapa_horario": heatmap,
            "horario_pico": peak_hour,
            "dia_mais_ativo": most_active_day,
            "sessoes_destaque": session_highlights,
            "anomalias": anomalies,
            "alteracoes_criticas": critical_changes,
            "exclusoes_recentes": deletions,
            "resumo_automatico": summary_text,
        }

    # Histórico detalhado é carregado sob demanda. Assim a abertura da tela não
    # transporta milhares de eventos que estão em abas escondidas.
    if section == "timeline":
        activity_rows = _fetch_activity_rows(db, email, since=since, limit=8000)
        change_rows = _fetch_change_rows(db, email, since=since, limit=3000)
        activity_asc = sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc))
        activity_ts = [(_as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp() for r in activity_asc]
        change_events: list[dict[str, Any]] = []
        for row in change_rows:
            page, route = _nearest_activity_context(row.get("criado_em"), activity_asc, activity_ts)
            change_events.append(_change_to_event(row, email, page, route))

        period_events = [
            _activity_to_event(row)
            for row in activity_rows
            if str(row.get("tipo") or "") != "presenca"
        ] + change_events
        period_events.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
        period_events = period_events[:5000]
        filters_pages = sorted({_event_page(event) for event in period_events if _event_page(event)})
        filters_modules = sorted({_module_name(event) for event in period_events if _module_name(event)})
        return {
            "ok": True,
            "secao": section,
            "periodo": {"dias": days, "inicio": start_day.isoformat(), "fim": now_local.date().isoformat(), "timezone": str(LOCAL_TZ)},
            "eventos_periodo": period_events,
            "filtros": {"paginas": filters_pages, "modulos": filters_modules},
        }

    if section == "alteracoes":
        activity_rows = _fetch_activity_rows(db, email, since=since, limit=6000)
        change_rows = _fetch_change_rows(db, email, since=since, limit=3000)
        activity_asc = sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc))
        activity_ts = [(_as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp() for r in activity_asc]
        change_events: list[dict[str, Any]] = []
        for row in change_rows:
            page, route = _nearest_activity_context(row.get("criado_em"), activity_asc, activity_ts)
            change_events.append(_change_to_event(row, email, page, route))
        change_events.sort(key=lambda item: item.get("criado_em") or "", reverse=True)
        changes = change_events[:1500]
        filters_pages = sorted({_event_page(event) for event in changes if _event_page(event)})
        filters_modules = sorted({_module_name(event) for event in changes if _module_name(event)})
        return {
            "ok": True,
            "secao": section,
            "periodo": {"dias": days, "inicio": start_day.isoformat(), "fim": now_local.date().isoformat(), "timezone": str(LOCAL_TZ)},
            "alteracoes": changes,
            "filtros": {"paginas": filters_pages, "modulos": filters_modules},
        }

    if section == "sessoes":
        activity_rows = _fetch_activity_rows(db, email, since=since, limit=15000)
        change_rows = _fetch_change_rows(db, email, since=since, limit=3000)
        activity_asc = sorted(activity_rows, key=lambda r: _as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc))
        activity_ts = [(_as_utc(r.get("criado_em")) or datetime.min.replace(tzinfo=timezone.utc)).timestamp() for r in activity_asc]
        change_events: list[dict[str, Any]] = []
        for row in change_rows:
            page, route = _nearest_activity_context(row.get("criado_em"), activity_asc, activity_ts)
            change_events.append(_change_to_event(row, email, page, route))
        sessions, _session_pages, inactivity = _build_sessions(activity_rows, change_events, now)
        return {
            "ok": True,
            "secao": section,
            "periodo": {"dias": days, "inicio": start_day.isoformat(), "fim": now_local.date().isoformat(), "timezone": str(LOCAL_TZ)},
            "sessoes": sessions[:30],
            "historico_login": _login_history(activity_rows),
            "inatividades": [item for item in inactivity if int(item.get("segundos") or 0) >= 60][:80],
        }

    # Resumo/estatísticas: mantém os cálculos dos 60 dias, mas não serializa
    # eventos, alterações nem sessões completos.
    activity_rows = _fetch_activity_rows(db, email, since=since, limit=30000)
    change_rows = _fetch_change_rows(db, email, since=since, limit=15000)

    page_seconds, module_seconds, daily_time, _daily_page = _compute_time_analytics(activity_rows)
    today_start_utc, tomorrow_start_utc = _day_bounds_utc(now_local.date())
    today_activity_rows = [
        row for row in activity_rows
        if (_as_utc(row.get("criado_em")) and today_start_utc <= _as_utc(row.get("criado_em")) < tomorrow_start_utc)
    ]
    today_page_seconds, today_module_seconds, _today_daily_time, _today_daily_page = _compute_time_analytics(today_activity_rows)
    daily = _daily_metrics(activity_rows, change_rows, days, now_local, daily_time)

    today = now_local.date()
    yesterday = today - timedelta(days=1)
    current_week_start = today - timedelta(days=today.weekday())
    previous_week_end = current_week_start - timedelta(days=1)
    previous_week_start = previous_week_end - timedelta(days=6)

    today_sum = _sum_daily(daily, today, today)
    yesterday_sum = _sum_daily(daily, yesterday, yesterday)
    current_week_sum = _sum_daily(daily, current_week_start, today)
    previous_week_sum = _sum_daily(daily, previous_week_start, previous_week_end)

    page_counts: dict[str, int] = defaultdict(int)
    module_counts: dict[str, int] = defaultdict(int)
    filters_pages: set[str] = set()
    filters_modules: set[str] = set()
    for row in activity_rows:
        tipo = str(row.get("tipo") or "")
        if tipo == "presenca":
            continue
        page = str(row.get("pagina") or "Valora").strip("/") or "Valora"
        details = _activity_detail(row)
        module = str(details.get("modulo") or page).strip("/") or page
        page_counts[page] += 1
        module_counts[module] += 1
        filters_pages.add(page)
        filters_modules.add(module)
    # Para o resumo não precisamos procurar a página exata de cada alteração.
    # Contabilizar pelo módulo evita milhares de cruzamentos desnecessários.
    for row in change_rows:
        module = str(row.get("modulo") or row.get("entidade_tipo") or "Valora").strip("/") or "Valora"
        module_counts[module] += 1
        filters_modules.add(module)

    ranking_pages = [
        {"pagina": key, "segundos": int(round(page_seconds.get(key, 0))), "acoes": int(page_counts.get(key, 0))}
        for key in sorted(set(page_counts) | set(page_seconds), key=lambda k: (page_seconds.get(k, 0), page_counts.get(k, 0)), reverse=True)
    ][:20]
    ranking_modules = [
        {"modulo": key, "segundos": int(round(module_seconds.get(key, 0))), "acoes": int(module_counts.get(key, 0))}
        for key in sorted(set(module_counts) | set(module_seconds), key=lambda k: (module_seconds.get(k, 0), module_counts.get(k, 0)), reverse=True)
    ][:20]

    today_item = next((item for item in daily if item.get("data") == today.isoformat()), None) or {}
    calendar = []
    max_activity = max([int(item.get("atividades") or 0) for item in daily] or [0])
    for item in daily:
        count = int(item.get("atividades") or 0)
        intensity = 0 if count <= 0 or max_activity <= 0 else max(1, min(4, int(round((count / max_activity) * 4))))
        calendar.append({
            "data": item.get("data"),
            "atividades": count,
            "tempo_ativo_segundos": int(item.get("tempo_ativo_segundos") or 0),
            "intensidade": intensity,
        })

    return {
        "ok": True,
        "secao": section,
        "periodo": {"dias": days, "inicio": start_day.isoformat(), "fim": today.isoformat(), "timezone": str(LOCAL_TZ)},
        "hoje": {
            **today_item,
            "primeiro_acesso": today_item.get("primeira_atividade"),
            "ultima_atividade": today_item.get("ultima_atividade"),
        },
        "comparacoes": {
            "hoje_ontem": _comparison(today_sum, yesterday_sum),
            "semana_atual_anterior": _comparison(current_week_sum, previous_week_sum),
        },
        "ranking_paginas": ranking_pages,
        "ranking_modulos": ranking_modules,
        "tempo_modulos_hoje": [
            {"modulo": key, "segundos": int(round(value))}
            for key, value in sorted(today_module_seconds.items(), key=lambda pair: pair[1], reverse=True)
            if value >= 1
        ][:20],
        "tempo_paginas_hoje": [
            {"pagina": key, "segundos": int(round(value))}
            for key, value in sorted(today_page_seconds.items(), key=lambda pair: pair[1], reverse=True)
            if value >= 1
        ][:20],
        "tempo_paginas": [
            {"pagina": key, "segundos": int(round(value))}
            for key, value in sorted(page_seconds.items(), key=lambda pair: pair[1], reverse=True)
            if value >= 1
        ][:30],
        "tempo_modulos": [
            {"modulo": key, "segundos": int(round(value))}
            for key, value in sorted(module_seconds.items(), key=lambda pair: pair[1], reverse=True)
            if value >= 1
        ][:30],
        "inatividades": _recent_inactivity_light(activity_rows, 20),
        "calendario": calendar,
        "resumo_diario": list(reversed(daily[-30:])),
        "filtros": {
            "paginas": sorted(filters_pages),
            "modulos": sorted(filters_modules),
        },
    }

