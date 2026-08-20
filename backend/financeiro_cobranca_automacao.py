from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import smtplib
import ssl
from datetime import date, datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage
from typing import Any, Dict, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.services.zapschat_integration import ZapsChatIntegrationError, public_config as zapschat_public_config, send_whatsapp as zapschat_send_whatsapp

logger = logging.getLogger(__name__)

_AUTOMACAO_TASK: Optional[asyncio.Task] = None
_INTERVAL_SECONDS = max(60, int(os.getenv("COBRANCA_AUTOMACAO_INTERVAL_SECONDS", "300")))
_START_DELAY_SECONDS = max(5, int(os.getenv("COBRANCA_AUTOMACAO_START_DELAY_SECONDS", "30")))
_RETRY_MINUTES = max(1, int(os.getenv("COBRANCA_AUTOMACAO_RETRY_MINUTES", "30")))
_BATCH_SIZE = min(500, max(1, int(os.getenv("COBRANCA_AUTOMACAO_BATCH_SIZE", "100"))))
_HTTP_TIMEOUT_SECONDS = min(60, max(3, int(os.getenv("COBRANCA_HTTP_TIMEOUT_SECONDS", "20"))))
_APP_TZ = ZoneInfo(os.getenv("APP_TZ", "America/Sao_Paulo"))


class CobrancaDeliveryError(RuntimeError):
    def __init__(self, message: str, *, code: str = "delivery_error", retry_minutes: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.retry_minutes = retry_minutes


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "sim", "on"}


def _safe(value: Any) -> str:
    return str(value or "").strip()


def _digits(value: Any) -> str:
    return re.sub(r"\D+", "", _safe(value))


def _normalize_br_phone(value: Any) -> str:
    digits = _digits(value)
    if not digits:
        return ""
    if digits.startswith("55") and len(digits) in (12, 13):
        return digits
    if len(digits) in (10, 11):
        return f"55{digits}"
    return digits


def _money_br(value: Any) -> str:
    try:
        amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except Exception:
        amount = Decimal("0.00")
    formatted = f"{amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def _date_br(value: Any) -> str:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    raw = _safe(value)
    if not raw:
        return ""
    try:
        return date.fromisoformat(raw[:10]).strftime("%d/%m/%Y")
    except Exception:
        return raw


def _provider_url(canal: str) -> str:
    # WhatsApp usa exclusivamente a integração nativa com o ZapsChat.
    if canal == "sms":
        return _safe(os.getenv("COBRANCA_SMS_WEBHOOK_URL"))
    return ""


def _provider_token(canal: str) -> str:
    if canal == "sms":
        return _safe(os.getenv("COBRANCA_SMS_TOKEN"))
    return ""


def status_provedores(db: Optional[Session] = None, empresa_id: Optional[int] = None) -> Dict[str, Any]:
    smtp_user = _safe(os.getenv("SMTP_USER") or os.getenv("EMAIL_REMETENTE"))
    smtp_pass = _safe(os.getenv("SMTP_PASS") or os.getenv("EMAIL_SENHA"))
    smtp_from = _safe(os.getenv("SMTP_FROM") or smtp_user)

    whatsapp = {
        "configurado": False,
        "provider": "ZapsChat",
        "pareado": False,
        "instancia_id": None,
        "instancia_apelido": None,
        "instancia_numero": None,
        "instancia_connected": False,
    }
    if db is not None and empresa_id:
        try:
            zc = zapschat_public_config(db, int(empresa_id))
            whatsapp.update({
                "configurado": bool(zc.get("pareado") and zc.get("instancia_id") and zc.get("instancia_connected")),
                "pareado": bool(zc.get("pareado")),
                "instancia_id": zc.get("instancia_id"),
                "instancia_apelido": zc.get("instancia_apelido"),
                "instancia_numero": zc.get("instancia_numero"),
                "instancia_connected": bool(zc.get("instancia_connected")),
                "ultimo_erro": zc.get("ultimo_erro"),
            })
        except Exception:
            pass

    return {
        "automacao_ativa": not _env_bool("COBRANCA_AUTOMACAO_DISABLED", False),
        "intervalo_segundos": _INTERVAL_SECONDS,
        "email": {
            "configurado": bool(smtp_user and smtp_pass and smtp_from),
            "remetente": smtp_from or None,
            "host": _safe(os.getenv("SMTP_HOST") or "smtp.gmail.com"),
        },
        "whatsapp": whatsapp,
        "sms": {
            "configurado": bool(_provider_url("sms")),
            "provider": "HTTP/Webhook" if _provider_url("sms") else None,
        },
        "interno": {"configurado": True, "provider": "Valora CRM"},
    }


def _fallback_message(item: Dict[str, Any]) -> str:
    cliente = _safe(item.get("cliente_nome")) or "cliente"
    documento = _safe(item.get("documento")) or f"#{item.get('lancamento_id')}"
    vencimento = _date_br(item.get("data_vencimento"))
    saldo = _money_br(item.get("saldo_aberto"))
    dias = int(item.get("dias_atraso") or 0)
    deslocamento = int(item.get("deslocamento_dias") or 0)
    acao = _safe(item.get("acao")).lower()

    if deslocamento < 0:
        return (
            f"Olá, {cliente}. Lembramos que o título {documento}, no valor de {saldo}, "
            f"vence em {vencimento}. Caso o pagamento já tenha sido realizado, desconsidere esta mensagem."
        )
    if acao == "protesto":
        return (
            f"Olá, {cliente}. O título {documento}, vencido em {vencimento}, permanece em aberto "
            f"há {dias} dia(s), com saldo de {saldo}. Esta é uma notificação da etapa de possível envio a protesto. "
            "Caso o pagamento já tenha sido realizado, desconsidere e entre em contato com o financeiro."
        )
    if acao == "bloqueio":
        return (
            f"Olá, {cliente}. O título {documento}, vencido em {vencimento}, permanece em aberto "
            f"há {dias} dia(s), com saldo de {saldo}. Esta cobrança atingiu a etapa de bloqueio prevista pela empresa. "
            "Caso o pagamento já tenha sido realizado, desconsidere e entre em contato com o financeiro."
        )
    if acao == "alerta":
        return (
            f"Olá, {cliente}. Identificamos que o título {documento}, vencido em {vencimento}, "
            f"permanece em aberto há {dias} dia(s), com saldo de {saldo}. Por favor, regularize o pagamento ou fale com o financeiro."
        )
    return (
        f"Olá, {cliente}. Identificamos o título {documento}, vencido em {vencimento}, "
        f"em aberto há {dias} dia(s), com saldo de {saldo}. Caso o pagamento já tenha sido realizado, desconsidere esta mensagem."
    )


def renderizar_mensagem(item: Dict[str, Any]) -> str:
    template = _safe(item.get("mensagem")) or _fallback_message(item)
    contexto = {
        "cliente": _safe(item.get("cliente_nome")) or "Cliente",
        "documento": _safe(item.get("documento")) or f"#{item.get('lancamento_id')}",
        "descricao": _safe(item.get("lancamento_descricao")),
        "valor": _money_br(item.get("saldo_aberto")),
        "saldo": _money_br(item.get("saldo_aberto")),
        "vencimento": _date_br(item.get("data_vencimento")),
        "dias_atraso": str(int(item.get("dias_atraso") or 0)),
        "empresa": _safe(item.get("empresa_nome")) or "Financeiro",
        "etapa": _safe(item.get("etapa_nome")),
    }

    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip().lower()
        return contexto.get(key, match.group(0))

    return re.sub(r"\{([a-zA-Z0-9_]+)\}", replace, template).strip()


def _send_email(destino: str, assunto: str, mensagem: str) -> Dict[str, Any]:
    smtp_host = _safe(os.getenv("SMTP_HOST") or "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = _safe(os.getenv("SMTP_USER") or os.getenv("EMAIL_REMETENTE"))
    smtp_pass = _safe(os.getenv("SMTP_PASS") or os.getenv("EMAIL_SENHA"))
    smtp_from = _safe(os.getenv("SMTP_FROM") or smtp_user)
    smtp_tls = _env_bool("SMTP_TLS", True)
    smtp_ssl = _env_bool("SMTP_SSL", False)

    if not smtp_user or not smtp_pass or not smtp_from:
        raise CobrancaDeliveryError(
            "E-mail automático não configurado. Informe SMTP_USER/SMTP_PASS/SMTP_FROM (ou EMAIL_REMETENTE/EMAIL_SENHA).",
            code="provider_not_configured",
            retry_minutes=360,
        )
    if not destino or "@" not in destino:
        raise CobrancaDeliveryError("Cliente sem e-mail de cobrança válido.", code="invalid_destination", retry_minutes=360)

    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = smtp_from
    msg["To"] = destino
    msg.set_content(mensagem)

    try:
        if smtp_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=_HTTP_TIMEOUT_SECONDS, context=ssl.create_default_context()) as server:
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=_HTTP_TIMEOUT_SECONDS) as server:
                server.ehlo()
                if smtp_tls:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        raise CobrancaDeliveryError(f"Falha no SMTP: {str(exc)[:500]}", code="smtp_error") from exc
    return {"provider": "smtp", "message_id": _safe(msg.get("Message-ID")) or None, "response": "aceito pelo servidor SMTP"}


def _send_http(canal: str, destino: str, mensagem: str, item: Dict[str, Any]) -> Dict[str, Any]:
    url = _provider_url(canal)
    token = _provider_token(canal)
    if not url:
        env_name = "COBRANCA_SMS_WEBHOOK_URL"
        raise CobrancaDeliveryError(
            f"Canal {canal} sem provedor configurado. Informe {env_name} no ambiente.",
            code="provider_not_configured",
            retry_minutes=360,
        )

    telefone = _normalize_br_phone(destino)
    if len(telefone) < 12:
        raise CobrancaDeliveryError(f"Destino de {canal} inválido ou ausente.", code="invalid_destination", retry_minutes=360)

    payload = {
        "channel": canal,
        "to": telefone,
        "message": mensagem,
        "idempotency_key": f"valora-cobranca-{item.get('id')}",
        "metadata": {
            "source": "valora-crm",
            "empresa_id": item.get("empresa_id"),
            "cliente_id": item.get("cliente_id"),
            "lancamento_id": item.get("lancamento_id"),
            "envio_id": item.get("id"),
            "etapa_id": item.get("etapa_id"),
            "documento": item.get("documento"),
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "User-Agent": "ValoraCRM-Cobranca/1.0",
        "Idempotency-Key": payload["idempotency_key"],
    }
    if token:
        auth_header = _safe(os.getenv(f"COBRANCA_{canal.upper()}_AUTH_HEADER")) or "Authorization"
        auth_prefix = _safe(os.getenv(f"COBRANCA_{canal.upper()}_AUTH_PREFIX")) or "Bearer"
        headers[auth_header] = f"{auth_prefix} {token}".strip()

    req = urllib_request.Request(url=url, data=body, headers=headers, method="POST")
    try:
        with urllib_request.urlopen(req, timeout=_HTTP_TIMEOUT_SECONDS) as response:
            raw = response.read(65536).decode("utf-8", errors="replace")
            status_code = int(getattr(response, "status", 200))
            if status_code < 200 or status_code >= 300:
                raise CobrancaDeliveryError(f"Provedor {canal} retornou HTTP {status_code}: {raw[:500]}", code="provider_http_error")
    except urllib_error.HTTPError as exc:
        try:
            detail = exc.read(65536).decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        raise CobrancaDeliveryError(f"Provedor {canal} retornou HTTP {exc.code}: {detail[:500]}", code="provider_http_error") from exc
    except (urllib_error.URLError, TimeoutError, OSError) as exc:
        raise CobrancaDeliveryError(f"Falha ao acessar provedor {canal}: {str(exc)[:500]}", code="provider_connection_error") from exc

    message_id = None
    parsed: Any = None
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                message_id = _safe(parsed.get("message_id") or parsed.get("id") or parsed.get("messageId")) or None
        except Exception:
            parsed = None
    return {
        "provider": "http_webhook",
        "message_id": message_id,
        "response": raw[:4000] if raw else f"HTTP {status_code}",
    }


def _send_zapschat(db: Session, destino: str, mensagem: str, item: Dict[str, Any]) -> Dict[str, Any]:
    telefone = _normalize_br_phone(destino)
    if len(telefone) < 12:
        raise CobrancaDeliveryError(
            "Cliente sem WhatsApp/telefone válido para cobrança.",
            code="invalid_destination",
            retry_minutes=360,
        )
    try:
        data = zapschat_send_whatsapp(
            db,
            empresa_id=int(item.get("empresa_id") or 0),
            number=telefone,
            message=mensagem,
            idempotency_key=f"valora-cobranca-{item.get('empresa_id')}-{item.get('id')}",
            valora_cliente_id=item.get("cliente_id"),
            valora_lancamento_id=item.get("lancamento_id"),
            valora_envio_id=item.get("id"),
        )
    except ZapsChatIntegrationError as exc:
        retry = 5 if exc.status_code in {408, 409, 429, 502, 503, 504} else 360
        raise CobrancaDeliveryError(str(exc), code=exc.code, retry_minutes=retry) from exc

    msg_id = _safe(data.get("msg_id") or data.get("message_id")) or None
    return {
        "provider": "zapschat",
        "message_id": msg_id,
        "response": json.dumps(data, ensure_ascii=False, default=str)[:4000],
    }


def _send_internal(item: Dict[str, Any], mensagem: str) -> Dict[str, Any]:
    # O canal interno já é materializado e auditado pela própria fila do Valora.
    return {"provider": "valora_interno", "message_id": None, "response": mensagem[:4000]}


def _load_envio(db: Session, empresa_id: int, envio_id: int) -> Optional[Dict[str, Any]]:
    row = db.execute(text("""
        SELECT
            ce.*,
            l.cliente_id,
            l.status AS lancamento_status,
            l.descricao AS lancamento_descricao,
            l.documento,
            l.data_vencimento,
            l.valor_total,
            l.valor_pago,
            GREATEST(l.valor_total-l.valor_pago, 0) AS saldo_aberto,
            GREATEST(CURRENT_DATE-l.data_vencimento, 0) AS dias_atraso,
            c.nome AS cliente_nome,
            COALESCE(NULLIF(l.email_cobranca,''), NULLIF(c.email_cobranca,''), NULLIF(c.email,'')) AS email_destino_atual,
            COALESCE(NULLIF(l.whatsapp_cobranca,''), NULLIF(c.whatsapp,''), NULLIF(c.telefone,'')) AS telefone_destino_atual,
            emp.nome AS empresa_nome,
            e.nome AS etapa_nome,
            e.deslocamento_dias,
            e.acao,
            e.mensagem AS etapa_mensagem
        FROM public.financeiro_cobrancas_envios ce
        JOIN public.financeiro_lancamentos l
          ON l.id=ce.lancamento_id AND l.empresa_id=ce.empresa_id
        LEFT JOIN public.clientes c
          ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
        JOIN public.empresas emp ON emp.id=ce.empresa_id
        JOIN public.financeiro_reguas_cobranca_etapas e
          ON e.id=ce.etapa_id AND e.empresa_id=ce.empresa_id
        WHERE ce.empresa_id=:empresa_id AND ce.id=:envio_id
    """), {"empresa_id": empresa_id, "envio_id": envio_id}).first()
    if not row:
        return None
    item = dict(row._mapping)
    item["mensagem"] = item.get("mensagem") or item.get("etapa_mensagem")
    canal = _safe(item.get("canal")).lower()
    if canal == "email":
        item["contato_destino"] = _safe(item.get("email_destino_atual")) or _safe(item.get("contato_destino"))
    elif canal in {"whatsapp", "sms"}:
        item["contato_destino"] = _safe(item.get("telefone_destino_atual")) or _safe(item.get("contato_destino"))
    return item


def _mark_ignored(db: Session, item: Dict[str, Any], reason: str, usuario_id: Optional[int]) -> None:
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios
           SET status='ignorado', ignorado_em=COALESCE(ignorado_em, NOW()),
               erro=:erro, ultimo_erro_codigo='titulo_inativo',
               atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
    """), {
        "empresa_id": item["empresa_id"], "id": item["id"], "erro": reason[:2000], "usuario_id": usuario_id,
    })
    db.commit()


def _mark_error(db: Session, item: Dict[str, Any], exc: CobrancaDeliveryError, usuario_id: Optional[int], mensagem: Optional[str] = None) -> None:
    retry_minutes = int(exc.retry_minutes or _RETRY_MINUTES)
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios
           SET status='erro', erro=:erro, ultimo_erro_codigo=:codigo,
               mensagem=COALESCE(:mensagem, mensagem), contato_destino=:contato,
               tentativas=COALESCE(tentativas,0)+1,
               ultima_tentativa_em=NOW(),
               proxima_tentativa_em=NOW() + make_interval(mins => :retry_minutes),
               atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
    """), {
        "empresa_id": item["empresa_id"], "id": item["id"], "erro": str(exc)[:2000],
        "codigo": exc.code[:80], "retry_minutes": retry_minutes, "usuario_id": usuario_id,
        "mensagem": mensagem, "contato": item.get("contato_destino"),
    })
    db.commit()


def _mark_sent(db: Session, item: Dict[str, Any], result: Dict[str, Any], mensagem: str, usuario_id: Optional[int]) -> None:
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios
           SET status='enviado', enviado_em=COALESCE(enviado_em, NOW()),
               erro=NULL, ultimo_erro_codigo=NULL,
               mensagem=:mensagem, contato_destino=:contato,
               tentativas=COALESCE(tentativas,0)+1,
               ultima_tentativa_em=NOW(), proxima_tentativa_em=NULL,
               provider=:provider, provider_message_id=:provider_message_id,
               resposta_provider=:resposta_provider, automatico=TRUE,
               atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
    """), {
        "empresa_id": item["empresa_id"], "id": item["id"], "mensagem": mensagem,
        "contato": item.get("contato_destino"), "provider": result.get("provider"),
        "provider_message_id": result.get("message_id"), "resposta_provider": _safe(result.get("response"))[:4000] or None,
        "usuario_id": usuario_id,
    })
    db.commit()


def enviar_envio(db: Session, empresa_id: int, envio_id: int, *, usuario_id: Optional[int] = None, forcar: bool = False) -> Dict[str, Any]:
    item = _load_envio(db, empresa_id, envio_id)
    if not item:
        raise CobrancaDeliveryError("Item de cobrança não encontrado.", code="not_found")

    if item.get("lancamento_status") == "cancelado" or Decimal(str(item.get("saldo_aberto") or 0)) <= 0:
        _mark_ignored(db, item, "O título foi quitado ou cancelado antes do disparo automático.", usuario_id)
        return {"id": envio_id, "status": "ignorado", "motivo": "titulo_quitado_ou_cancelado"}

    if not forcar and _safe(item.get("status")).lower() not in {"pendente", "erro"}:
        return {"id": envio_id, "status": item.get("status"), "ignorado_processamento": True}

    if item.get("data_prevista") and item["data_prevista"] > datetime.now(_APP_TZ).date():
        return {"id": envio_id, "status": item.get("status"), "ignorado_processamento": True, "motivo": "ainda_nao_previsto"}

    canal = _safe(item.get("canal")).lower()
    mensagem = renderizar_mensagem(item)
    if not mensagem:
        raise CobrancaDeliveryError("Etapa de cobrança sem mensagem configurada.", code="empty_message", retry_minutes=360)

    try:
        if canal == "email":
            assunto = f"Cobrança - {item.get('documento') or item.get('lancamento_descricao') or 'Título em aberto'}"
            result = _send_email(_safe(item.get("contato_destino")), assunto, mensagem)
        elif canal == "whatsapp":
            result = _send_zapschat(db, _safe(item.get("contato_destino")), mensagem, item)
        elif canal == "sms":
            result = _send_http(canal, _safe(item.get("contato_destino")), mensagem, item)
        elif canal == "interno":
            result = _send_internal(item, mensagem)
        else:
            raise CobrancaDeliveryError(f"Canal de cobrança inválido: {canal}", code="invalid_channel", retry_minutes=360)
        _mark_sent(db, item, result, mensagem, usuario_id)
        return {"id": envio_id, "status": "enviado", "canal": canal, "provider": result.get("provider")}
    except CobrancaDeliveryError as exc:
        _mark_error(db, item, exc, usuario_id, mensagem)
        return {"id": envio_id, "status": "erro", "canal": canal, "erro": str(exc), "codigo": exc.code}


def materializar_fila_cobranca(db: Session, empresa_id: int, *, usuario_id: Optional[int] = None) -> int:
    # Pagamentos/cancelamentos sempre vencem a fila. Isso acontece antes de criar
    # novos envios e novamente no momento exato de cada disparo.
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios ce
           SET status='ignorado', ignorado_em=COALESCE(ce.ignorado_em, NOW()),
               erro='Título quitado ou cancelado antes do envio.', ultimo_erro_codigo='titulo_inativo',
               atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
          FROM public.financeiro_lancamentos l
         WHERE ce.empresa_id=:empresa_id
           AND ce.empresa_id=l.empresa_id AND ce.lancamento_id=l.id
           AND ce.status IN ('pendente','erro')
           AND (l.status='cancelado' OR l.valor_total <= l.valor_pago)
    """), {"empresa_id": empresa_id, "usuario_id": usuario_id})

    before = int(db.execute(text("SELECT COUNT(*) FROM public.financeiro_cobrancas_envios WHERE empresa_id=:empresa_id"), {"empresa_id": empresa_id}).scalar() or 0)

    db.execute(text("""
        WITH regua_padrao AS (
            SELECT id FROM public.financeiro_reguas_cobranca
            WHERE empresa_id=:empresa_id AND ativo=TRUE AND padrao=TRUE
            ORDER BY id LIMIT 1
        ), elegiveis AS (
            SELECT
                l.id AS lancamento_id, e.id AS etapa_id, e.canal, e.mensagem,
                (l.data_vencimento + e.deslocamento_dias) AS data_prevista,
                CASE
                    WHEN e.canal='email' THEN COALESCE(NULLIF(l.email_cobranca,''), NULLIF(c.email_cobranca,''), NULLIF(c.email,''))
                    WHEN e.canal IN ('whatsapp','sms') THEN COALESCE(NULLIF(l.whatsapp_cobranca,''), NULLIF(c.whatsapp,''), NULLIF(c.telefone,''))
                    ELSE NULL
                END AS contato_destino
            FROM public.financeiro_lancamentos l
            JOIN public.financeiro_reguas_cobranca r
              ON r.empresa_id=l.empresa_id
             AND r.id=COALESCE(l.regua_cobranca_id, (SELECT id FROM regua_padrao))
             AND r.ativo=TRUE
            JOIN public.financeiro_reguas_cobranca_etapas e
              ON e.empresa_id=r.empresa_id AND e.regua_id=r.id AND e.ativo=TRUE
            LEFT JOIN public.clientes c ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
            WHERE l.empresa_id=:empresa_id
              AND l.tipo='receber' AND l.status<>'cancelado' AND l.valor_total>l.valor_pago
              AND CURRENT_DATE >= (l.data_vencimento + e.deslocamento_dias)
        )
        INSERT INTO public.financeiro_cobrancas_envios (
            empresa_id, lancamento_id, etapa_id, canal, contato_destino, mensagem,
            data_prevista, status, criado_por_usuario_id, atualizado_por_usuario_id,
            criado_em, atualizado_em, automatico
        )
        SELECT :empresa_id, x.lancamento_id, x.etapa_id, x.canal, x.contato_destino, x.mensagem,
               x.data_prevista, 'pendente', :usuario_id, :usuario_id, NOW(), NOW(), TRUE
        FROM elegiveis x
        ON CONFLICT (empresa_id, lancamento_id, etapa_id) DO NOTHING
    """), {"empresa_id": empresa_id, "usuario_id": usuario_id})
    db.commit()

    after = int(db.execute(text("SELECT COUNT(*) FROM public.financeiro_cobrancas_envios WHERE empresa_id=:empresa_id"), {"empresa_id": empresa_id}).scalar() or 0)
    return max(0, after - before)


def executar_automacao_empresa(db: Session, empresa_id: int, *, usuario_id: Optional[int] = None, limit: int = _BATCH_SIZE) -> Dict[str, Any]:
    key = f"valora_cobranca_automacao_empresa_{empresa_id}"
    locked = bool(db.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": key}).scalar())
    if not locked:
        return {"ok": True, "empresa_id": empresa_id, "ocupado": True, "novos": 0, "processados": 0, "enviados": 0, "erros": 0, "ignorados": 0}

    try:
        novos = materializar_fila_cobranca(db, empresa_id, usuario_id=usuario_id)
        rows = db.execute(text("""
            SELECT ce.id
            FROM public.financeiro_cobrancas_envios ce
            JOIN public.financeiro_lancamentos l
              ON l.empresa_id=ce.empresa_id AND l.id=ce.lancamento_id
            WHERE ce.empresa_id=:empresa_id
              AND ce.status IN ('pendente','erro')
              AND ce.data_prevista<=CURRENT_DATE
              AND (ce.proxima_tentativa_em IS NULL OR ce.proxima_tentativa_em<=NOW())
              AND l.status<>'cancelado' AND l.valor_total>l.valor_pago
            ORDER BY ce.data_prevista ASC, ce.id ASC
            LIMIT :limit
        """), {"empresa_id": empresa_id, "limit": min(500, max(1, int(limit)))}).fetchall()

        enviados = erros = ignorados = 0
        resultados = []
        for row in rows:
            envio_id = int(row[0])
            item_key = f"valora_cobranca_envio_{empresa_id}_{envio_id}"
            item_locked = bool(db.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": item_key}).scalar())
            if not item_locked:
                continue
            try:
                resultado = enviar_envio(db, empresa_id, envio_id, usuario_id=usuario_id)
            except CobrancaDeliveryError as exc:
                resultado = {"id": envio_id, "status": "erro", "erro": str(exc), "codigo": exc.code}
                logger.warning("Falha ao preparar cobrança %s da empresa %s: %s", envio_id, empresa_id, exc)
            except Exception as exc:
                db.rollback()
                resultado = {"id": envio_id, "status": "erro", "erro": str(exc)[:500], "codigo": "unexpected_error"}
                logger.exception("Erro inesperado no envio %s da empresa %s", envio_id, empresa_id)
            finally:
                try:
                    db.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": item_key})
                    db.commit()
                except Exception:
                    db.rollback()
            resultados.append(resultado)
            if resultado.get("status") == "enviado":
                enviados += 1
            elif resultado.get("status") == "erro":
                erros += 1
            elif resultado.get("status") == "ignorado":
                ignorados += 1
        return {
            "ok": True, "empresa_id": empresa_id, "ocupado": False, "novos": novos,
            "processados": len(rows), "enviados": enviados, "erros": erros, "ignorados": ignorados,
            "resultados": resultados,
        }
    finally:
        try:
            db.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": key})
            db.commit()
        except Exception:
            db.rollback()


def processar_automacao_todas_empresas() -> Dict[str, Any]:
    db = SessionLocal()
    global_locked = False
    try:
        global_locked = bool(db.execute(text("SELECT pg_try_advisory_lock(hashtext('valora_cobranca_automacao_global_v1'))")).scalar())
        if not global_locked:
            return {"ok": True, "ocupado": True, "empresas": 0, "enviados": 0, "erros": 0}

        empresas = db.execute(text("SELECT id FROM public.empresas WHERE ativo=TRUE ORDER BY id")).fetchall()
        total_enviados = total_erros = total_processados = 0
        detalhes = []
        for row in empresas:
            empresa_id = int(row[0])
            try:
                resultado = executar_automacao_empresa(db, empresa_id, usuario_id=None)
                total_enviados += int(resultado.get("enviados") or 0)
                total_erros += int(resultado.get("erros") or 0)
                total_processados += int(resultado.get("processados") or 0)
                detalhes.append({k: resultado.get(k) for k in ("empresa_id", "novos", "processados", "enviados", "erros", "ignorados")})
            except Exception as exc:
                db.rollback()
                total_erros += 1
                detalhes.append({"empresa_id": empresa_id, "erro": str(exc)[:500]})
                logger.exception("Falha na automação de cobrança da empresa %s", empresa_id)
        return {
            "ok": True, "ocupado": False, "empresas": len(empresas), "processados": total_processados,
            "enviados": total_enviados, "erros": total_erros, "detalhes": detalhes,
        }
    finally:
        if global_locked:
            try:
                db.execute(text("SELECT pg_advisory_unlock(hashtext('valora_cobranca_automacao_global_v1'))"))
                db.commit()
            except Exception:
                db.rollback()
        db.close()


async def _automacao_loop() -> None:
    await asyncio.sleep(_START_DELAY_SECONDS)
    while True:
        try:
            await asyncio.to_thread(processar_automacao_todas_empresas)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Erro inesperado no disparador automático de cobranças.")
        await asyncio.sleep(_INTERVAL_SECONDS)


async def start_financeiro_cobranca_dispatcher() -> None:
    global _AUTOMACAO_TASK
    if _env_bool("COBRANCA_AUTOMACAO_DISABLED", False):
        logger.info("Automação de cobrança desabilitada por COBRANCA_AUTOMACAO_DISABLED.")
        return
    if _AUTOMACAO_TASK and not _AUTOMACAO_TASK.done():
        return
    _AUTOMACAO_TASK = asyncio.create_task(_automacao_loop(), name="valora-financeiro-cobranca-automatica")


async def stop_financeiro_cobranca_dispatcher() -> None:
    global _AUTOMACAO_TASK
    task = _AUTOMACAO_TASK
    _AUTOMACAO_TASK = None
    if not task:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
