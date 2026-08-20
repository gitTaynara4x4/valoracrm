from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urljoin

from backend.security.session import sign_payload, unsign_payload

TOKEN_PURPOSE = "proposta_cliente_publica"
DEFAULT_LINK_DAYS = 30


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def link_days() -> int:
    value = _safe_int(os.getenv("PROPOSTA_CLIENTE_LINK_DIAS"), DEFAULT_LINK_DAYS)
    return min(max(value, 1), 180)


def create_public_token(*, budget_id: int, company_id: int, version: int, expires_at: datetime) -> str:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    else:
        expires_at = expires_at.astimezone(timezone.utc)

    return sign_payload(
        {
            "purpose": TOKEN_PURPOSE,
            "oid": int(budget_id),
            "eid": int(company_id),
            "ver": int(version),
            "exp": int(expires_at.timestamp()),
        }
    )


def decode_public_token(token: str) -> Optional[Dict[str, int]]:
    payload = unsign_payload(str(token or "").strip(), expected_purpose=TOKEN_PURPOSE)
    if not payload:
        return None
    try:
        return {
            "budget_id": int(payload["oid"]),
            "company_id": int(payload["eid"]),
            "version": int(payload["ver"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


def build_public_url(token: str, request_base_url: str = "") -> str:
    """Monta o link que o CLIENTE recebe.

    A proposta é administrada pelo Valora, mas a experiência pública pertence
    à SEG. Por isso o endereço preferencial é sempre o domínio da SEG.
    """
    configured = str(
        os.getenv("SEG_PROPOSTA_PUBLIC_URL")
        or os.getenv("SEG_PUBLIC_BASE_URL")
        or "https://segsis.com.br/proposta"
    ).strip()

    if "{token}" in configured:
        return configured.replace("{token}", token)

    base = configured.rstrip("/")
    if not base.endswith("/proposta"):
        base += "/proposta"
    return f"{base}/{token}"
