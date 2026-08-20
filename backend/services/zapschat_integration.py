from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from urllib import error as urllib_error
from urllib import request as urllib_request
from sqlalchemy import text
from sqlalchemy.orm import Session


class ZapsChatIntegrationError(RuntimeError):
    def __init__(self, message: str, *, code: str = "zapschat_error", status_code: int = 502):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _safe(value: Any) -> str:
    return str(value or "").strip()


def configured_base_url() -> str:
    return _safe(os.getenv("ZAPSCHAT_BASE_URL")).rstrip("/")


def _row_dict(row) -> Optional[Dict[str, Any]]:
    return dict(row._mapping) if row else None


def get_config(db: Session, empresa_id: int) -> Optional[Dict[str, Any]]:
    row = db.execute(
        text(
            """
            SELECT * FROM integracoes_zapschat_empresas
            WHERE empresa_id=:empresa_id
            LIMIT 1
            """
        ),
        {"empresa_id": int(empresa_id)},
    ).first()
    return _row_dict(row)


def public_config(db: Session, empresa_id: int) -> Dict[str, Any]:
    row = get_config(db, empresa_id)
    base_url = configured_base_url() or _safe((row or {}).get("base_url"))
    return {
        "configurado_servidor": bool(base_url),
        "pareado": bool(row and row.get("ativo") and row.get("api_token")),
        "zapschat_empresa_id": (row or {}).get("zapschat_empresa_id"),
        "zapschat_empresa_nome": (row or {}).get("zapschat_empresa_nome"),
        "instancia_id": (row or {}).get("instancia_id"),
        "instancia_apelido": (row or {}).get("instancia_apelido"),
        "instancia_nome": (row or {}).get("instancia_nome"),
        "instancia_numero": (row or {}).get("instancia_numero"),
        "instancia_connected": bool((row or {}).get("instancia_connected")),
        "ativo": bool((row or {}).get("ativo")),
        "pareado_em": (row or {}).get("pareado_em"),
        "ultima_verificacao_em": (row or {}).get("ultima_verificacao_em"),
        "ultimo_erro": (row or {}).get("ultimo_erro"),
    }


def _request(
    method: str,
    path: str,
    *,
    base_url: str,
    token: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 12.0,
) -> Dict[str, Any]:
    url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    headers = {"Accept": "application/json", "User-Agent": "ValoraCRM-ZapsChat/1.0"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib_request.Request(url=url, data=body, headers=headers, method=method.upper())
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            status_code = int(getattr(response, "status", 200) or 200)
            raw = response.read(1024 * 1024).decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        status_code = int(exc.code or 500)
        try:
            raw = exc.read(1024 * 1024).decode("utf-8", errors="replace")
        except Exception:
            raw = ""
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {"detail": raw[:1000]}
        detail = data.get("detail") if isinstance(data, dict) else None
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("error") or json.dumps(detail, ensure_ascii=False)
        message = _safe(detail) or f"ZapsChat retornou HTTP {status_code}."
        raise ZapsChatIntegrationError(message, code="zapschat_http_error", status_code=status_code) from exc
    except (urllib_error.URLError, TimeoutError, OSError) as exc:
        raise ZapsChatIntegrationError(
            f"Não foi possível acessar o ZapsChat: {str(exc)[:300]}",
            code="zapschat_connection_error",
            status_code=502,
        ) from exc

    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {"detail": raw[:1000]}
    if status_code < 200 or status_code >= 300:
        detail = data.get("detail") if isinstance(data, dict) else None
        message = _safe(detail) or f"ZapsChat retornou HTTP {status_code}."
        raise ZapsChatIntegrationError(message, code="zapschat_http_error", status_code=status_code)
    return data if isinstance(data, dict) else {"data": data}


def pair_company(db: Session, *, empresa_id: int, empresa_nome: str, usuario_id: int, codigo: str) -> Dict[str, Any]:
    base_url = configured_base_url()
    if not base_url:
        raise ZapsChatIntegrationError(
            "O endereço do ZapsChat ainda não foi configurado no servidor do Valora. Defina ZAPSCHAT_BASE_URL no ambiente.",
            code="zapschat_base_url_missing",
            status_code=503,
        )
    data = _request(
        "POST",
        "/api/integracoes/valora/parear",
        base_url=base_url,
        payload={
            "codigo": codigo,
            "valora_empresa_id": int(empresa_id),
            "valora_empresa_nome": empresa_nome,
        },
    )
    token = _safe(data.get("token"))
    external_id = data.get("zapschat_empresa_id")
    if not token or not external_id:
        raise ZapsChatIntegrationError("O ZapsChat não retornou os dados necessários para concluir o pareamento.")

    db.execute(
        text(
            """
            INSERT INTO integracoes_zapschat_empresas (
                empresa_id, base_url, api_token, zapschat_empresa_id, zapschat_empresa_nome,
                instancia_id, instancia_apelido, instancia_nome, instancia_numero, instancia_connected,
                ativo, pareado_em, ultima_verificacao_em, ultimo_erro,
                criado_por_usuario_id, atualizado_por_usuario_id, criado_em, atualizado_em
            ) VALUES (
                :empresa_id, :base_url, :api_token, :zapschat_empresa_id, :zapschat_empresa_nome,
                NULL, NULL, NULL, NULL, FALSE,
                TRUE, NOW(), NOW(), NULL,
                :usuario_id, :usuario_id, NOW(), NOW()
            )
            ON CONFLICT (empresa_id) DO UPDATE SET
                base_url=EXCLUDED.base_url,
                api_token=EXCLUDED.api_token,
                zapschat_empresa_id=EXCLUDED.zapschat_empresa_id,
                zapschat_empresa_nome=EXCLUDED.zapschat_empresa_nome,
                instancia_id=NULL,
                instancia_apelido=NULL,
                instancia_nome=NULL,
                instancia_numero=NULL,
                instancia_connected=FALSE,
                ativo=TRUE,
                pareado_em=NOW(),
                ultima_verificacao_em=NOW(),
                ultimo_erro=NULL,
                atualizado_por_usuario_id=:usuario_id,
                atualizado_em=NOW()
            """
        ),
        {
            "empresa_id": int(empresa_id),
            "base_url": base_url,
            "api_token": token,
            "zapschat_empresa_id": int(external_id),
            "zapschat_empresa_nome": _safe(data.get("zapschat_empresa_nome")) or None,
            "usuario_id": int(usuario_id),
        },
    )
    db.commit()
    return public_config(db, empresa_id)


def _require_active_config(db: Session, empresa_id: int) -> Dict[str, Any]:
    row = get_config(db, empresa_id)
    if not row or not row.get("ativo") or not row.get("api_token"):
        raise ZapsChatIntegrationError(
            "O WhatsApp do ZapsChat ainda não foi conectado a esta empresa no Valora.",
            code="zapschat_not_paired",
            status_code=409,
        )
    base_url = configured_base_url() or _safe(row.get("base_url"))
    if not base_url:
        raise ZapsChatIntegrationError("ZAPSCHAT_BASE_URL não configurado no servidor.", code="zapschat_base_url_missing", status_code=503)
    row["base_url_efetiva"] = base_url
    return row


def list_instances(db: Session, empresa_id: int, *, refresh_saved: bool = True) -> Dict[str, Any]:
    config = _require_active_config(db, empresa_id)
    data = _request(
        "GET",
        "/api/integracoes/valora/instancias",
        base_url=config["base_url_efetiva"],
        token=config["api_token"],
    )
    items = list(data.get("instancias") or [])
    selected_id = config.get("instancia_id")
    selected = next((i for i in items if int(i.get("id") or 0) == int(selected_id or 0)), None)
    if refresh_saved:
        if selected:
            db.execute(
                text(
                    """
                    UPDATE integracoes_zapschat_empresas
                       SET instancia_apelido=:apelido, instancia_nome=:nome,
                           instancia_numero=:numero, instancia_connected=:connected,
                           ultima_verificacao_em=NOW(), ultimo_erro=NULL, atualizado_em=NOW()
                     WHERE empresa_id=:empresa_id
                    """
                ),
                {
                    "empresa_id": int(empresa_id),
                    "apelido": _safe(selected.get("apelido")) or None,
                    "nome": _safe(selected.get("instance_name")) or None,
                    "numero": _safe(selected.get("numero_instancia")) or None,
                    "connected": bool(selected.get("connected")),
                },
            )
        else:
            db.execute(
                text(
                    """
                    UPDATE integracoes_zapschat_empresas
                       SET instancia_connected=FALSE, ultima_verificacao_em=NOW(),
                           ultimo_erro=CASE WHEN instancia_id IS NULL THEN NULL ELSE 'A instância selecionada não foi encontrada no ZapsChat.' END,
                           atualizado_em=NOW()
                     WHERE empresa_id=:empresa_id
                    """
                ),
                {"empresa_id": int(empresa_id)},
            )
        db.commit()
    return {
        "ok": True,
        "empresa_id": data.get("empresa_id"),
        "empresa_nome": data.get("empresa_nome"),
        "instancias": items,
        "selecionada": selected,
    }


def select_instance(db: Session, *, empresa_id: int, usuario_id: int, instancia_id: int) -> Dict[str, Any]:
    data = list_instances(db, empresa_id, refresh_saved=False)
    selected = next((i for i in data.get("instancias", []) if int(i.get("id") or 0) == int(instancia_id)), None)
    if not selected:
        raise ZapsChatIntegrationError("A instância escolhida não pertence à empresa conectada.", code="zapschat_invalid_instance", status_code=422)
    if not bool(selected.get("connected")):
        raise ZapsChatIntegrationError(
            "Esta instância está desconectada. Conecte o WhatsApp no ZapsChat antes de escolhê-la para cobranças.",
            code="zapschat_instance_disconnected",
            status_code=409,
        )
    db.execute(
        text(
            """
            UPDATE integracoes_zapschat_empresas
               SET instancia_id=:instancia_id, instancia_apelido=:apelido, instancia_nome=:nome,
                   instancia_numero=:numero, instancia_connected=TRUE,
                   ultima_verificacao_em=NOW(), ultimo_erro=NULL,
                   atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
             WHERE empresa_id=:empresa_id
            """
        ),
        {
            "empresa_id": int(empresa_id),
            "instancia_id": int(instancia_id),
            "apelido": _safe(selected.get("apelido")) or None,
            "nome": _safe(selected.get("instance_name")) or None,
            "numero": _safe(selected.get("numero_instancia")) or None,
            "usuario_id": int(usuario_id),
        },
    )
    db.commit()
    return public_config(db, empresa_id)


def test_connection(db: Session, empresa_id: int) -> Dict[str, Any]:
    config = _require_active_config(db, empresa_id)
    try:
        status = _request(
            "GET",
            "/api/integracoes/valora/status",
            base_url=config["base_url_efetiva"],
            token=config["api_token"],
            timeout=8.0,
        )
        instances = list_instances(db, empresa_id, refresh_saved=True)
        return {"ok": True, "status": status, "instancias": instances.get("instancias", []), "selecionada": instances.get("selecionada")}
    except ZapsChatIntegrationError as exc:
        db.execute(
            text(
                """
                UPDATE integracoes_zapschat_empresas
                   SET ultima_verificacao_em=NOW(), ultimo_erro=:erro, instancia_connected=FALSE, atualizado_em=NOW()
                 WHERE empresa_id=:empresa_id
                """
            ),
            {"empresa_id": int(empresa_id), "erro": str(exc)[:2000]},
        )
        db.commit()
        raise


def disconnect(db: Session, *, empresa_id: int, usuario_id: int) -> None:
    config = get_config(db, empresa_id)
    if config and config.get("ativo") and config.get("api_token"):
        base_url = configured_base_url() or _safe(config.get("base_url"))
        if base_url:
            try:
                _request(
                    "DELETE",
                    "/api/integracoes/valora/conexao",
                    base_url=base_url,
                    token=config["api_token"],
                    timeout=8.0,
                )
            except ZapsChatIntegrationError as exc:
                # 401 significa que o segredo já não é válido no ZapsChat; nesse
                # caso é seguro limpar a configuração local. Outros erros mantêm
                # o token local para permitir uma nova tentativa de revogação.
                if int(exc.status_code or 0) != 401:
                    raise

    db.execute(
        text(
            """
            UPDATE integracoes_zapschat_empresas
               SET ativo=FALSE, api_token='', instancia_id=NULL, instancia_apelido=NULL,
                   instancia_nome=NULL, instancia_numero=NULL, instancia_connected=FALSE,
                   ultimo_erro=NULL, atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
             WHERE empresa_id=:empresa_id
            """
        ),
        {"empresa_id": int(empresa_id), "usuario_id": int(usuario_id)},
    )
    db.commit()


def send_whatsapp(
    db: Session,
    *,
    empresa_id: int,
    number: str,
    message: str,
    idempotency_key: str,
    valora_cliente_id: Optional[int] = None,
    valora_lancamento_id: Optional[int] = None,
    valora_envio_id: Optional[int] = None,
) -> Dict[str, Any]:
    config = _require_active_config(db, empresa_id)
    instancia_id = config.get("instancia_id")
    if not instancia_id:
        raise ZapsChatIntegrationError(
            "Nenhuma instância do ZapsChat foi escolhida para cobranças. Abra Financeiro > Cobrança > Configurar WhatsApp.",
            code="zapschat_instance_missing",
            status_code=409,
        )
    payload = {
        "instancia_id": int(instancia_id),
        "number": number,
        "text": message,
        "idempotency_key": idempotency_key,
        "valora_empresa_id": int(empresa_id),
        "valora_cliente_id": valora_cliente_id,
        "valora_lancamento_id": valora_lancamento_id,
        "valora_envio_id": valora_envio_id,
    }
    try:
        data = _request(
            "POST",
            "/api/integracoes/valora/mensagens/texto",
            base_url=config["base_url_efetiva"],
            token=config["api_token"],
            payload=payload,
            timeout=25.0,
        )
    except ZapsChatIntegrationError as exc:
        # Espelha no Valora os estados que exigem ação humana. Em especial,
        # nunca troca para outra instância quando o número selecionado cai.
        if int(exc.status_code or 0) == 401:
            db.execute(
                text(
                    """
                    UPDATE integracoes_zapschat_empresas
                       SET ativo=FALSE, api_token='', instancia_connected=FALSE,
                           ultima_verificacao_em=NOW(), ultimo_erro=:erro, atualizado_em=NOW()
                     WHERE empresa_id=:empresa_id
                    """
                ),
                {"empresa_id": int(empresa_id), "erro": str(exc)[:2000]},
            )
        else:
            db.execute(
                text(
                    """
                    UPDATE integracoes_zapschat_empresas
                       SET instancia_connected=CASE WHEN :desconectada THEN FALSE ELSE instancia_connected END,
                           ultima_verificacao_em=NOW(), ultimo_erro=:erro, atualizado_em=NOW()
                     WHERE empresa_id=:empresa_id
                    """
                ),
                {
                    "empresa_id": int(empresa_id),
                    "erro": str(exc)[:2000],
                    "desconectada": int(exc.status_code or 0) in {403, 409},
                },
            )
        db.commit()
        raise

    db.execute(
        text(
            """
            UPDATE integracoes_zapschat_empresas
               SET instancia_connected=TRUE, ultima_verificacao_em=NOW(), ultimo_erro=NULL, atualizado_em=NOW()
             WHERE empresa_id=:empresa_id
            """
        ),
        {"empresa_id": int(empresa_id)},
    )
    db.commit()
    return data
