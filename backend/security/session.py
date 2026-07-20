from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict, Optional


SESSION_COOKIE_NAME = "valora_session"
SESSION_PURPOSE = "valora_session"


def _load_secret() -> bytes:
    configured = (
        os.getenv("VALORA_SESSION_SECRET")
        or os.getenv("SESSION_SECRET")
        or os.getenv("SECRET_KEY")
        or ""
    ).strip()

    if configured:
        return configured.encode("utf-8")

    # Mantém o projeto funcionando em desenvolvimento sem deixar a sessão
    # previsível. Em produção deve ser configurado VALORA_SESSION_SECRET.
    generated = secrets.token_urlsafe(64)
    print(
        "[SEGURANÇA] VALORA_SESSION_SECRET não configurado. "
        "Foi gerado um segredo temporário; sessões serão invalidadas ao reiniciar."
    )
    return generated.encode("utf-8")


_SECRET = _load_secret()


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def sign_payload(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded = _b64encode(body)
    signature = hmac.new(_SECRET, encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64encode(signature)}"


def unsign_payload(
    token: str,
    *,
    expected_purpose: Optional[str] = None,
    now: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    try:
        encoded, signature_text = str(token or "").split(".", 1)
        received_signature = _b64decode(signature_text)
        expected_signature = hmac.new(
            _SECRET,
            encoded.encode("ascii"),
            hashlib.sha256,
        ).digest()

        if not hmac.compare_digest(received_signature, expected_signature):
            return None

        payload = json.loads(_b64decode(encoded).decode("utf-8"))
        if not isinstance(payload, dict):
            return None

        current_time = int(now if now is not None else time.time())
        expires_at = int(payload.get("exp") or 0)
        if expires_at <= current_time:
            return None

        if expected_purpose and payload.get("purpose") != expected_purpose:
            return None

        return payload
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    except Exception:
        return None


def create_session_token(user_id: int, empresa_id: int, max_age: int) -> str:
    now = int(time.time())
    return sign_payload(
        {
            "purpose": SESSION_PURPOSE,
            "uid": int(user_id),
            "eid": int(empresa_id),
            "iat": now,
            "exp": now + int(max_age),
            "nonce": secrets.token_urlsafe(12),
        }
    )


def decode_session_token(token: str) -> Optional[Dict[str, Any]]:
    payload = unsign_payload(token, expected_purpose=SESSION_PURPOSE)
    if not payload:
        return None

    try:
        payload["uid"] = int(payload["uid"])
        payload["eid"] = int(payload["eid"])
    except (KeyError, TypeError, ValueError):
        return None

    return payload


def create_temporary_token(
    purpose: str,
    *,
    user_id: int,
    empresa_id: int,
    max_age: int,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    now = int(time.time())
    payload: Dict[str, Any] = {
        "purpose": str(purpose),
        "uid": int(user_id),
        "eid": int(empresa_id),
        "iat": now,
        "exp": now + int(max_age),
        "nonce": secrets.token_urlsafe(12),
    }
    if extra:
        payload.update(extra)
    return sign_payload(payload)
