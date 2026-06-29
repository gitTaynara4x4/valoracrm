# backend/routers/integracoes_zapschat.py
from __future__ import annotations

import os
import re
from typing import Any, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal

router = APIRouter(prefix="/api/integracoes/zapschat", tags=["Integrações - ZapChats"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _normalize_br_phone(value: Any) -> str:
    digits = _digits(value)
    if not digits:
        return ""

    if digits.startswith("55") and len(digits) in (12, 13):
        return digits

    if len(digits) in (10, 11):
        return f"55{digits}"

    return digits


def _zapschat_base_url() -> str:
    """
    Configure no .ENV do Valora quando o ZapChats estiver em outro host/porta:
      ZAPSCHAT_BASE_URL=http://127.0.0.1:8000
    Se vazio, devolve URL relativa para uso com proxy reverso no mesmo domínio.
    """
    return str(os.getenv("ZAPSCHAT_BASE_URL") or "").strip().rstrip("/")


def _get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> models.Usuario:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        uid = int(str(user_id).strip())
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == uid).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return usuario


@router.get("/abrir-cliente/{cliente_id}")
def abrir_cliente_zapschat(
    cliente_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    cliente = (
        db.query(models.Cliente)
        .filter(
            models.Cliente.id == int(cliente_id),
            models.Cliente.empresa_id == int(usuario.empresa_id),
        )
        .first()
    )

    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    telefone_raw = getattr(cliente, "whatsapp", None) or getattr(cliente, "telefone", None) or ""
    telefone = _normalize_br_phone(telefone_raw)

    if not telefone or len(telefone) < 10:
        raise HTTPException(status_code=400, detail="Este cliente não tem WhatsApp/telefone válido.")

    params = {
        "telefone": telefone,
        "origem": "valora",
        "cliente_id": str(cliente.id),
    }

    base = _zapschat_base_url()
    path = f"/zapschat/abrir-conversa?{urlencode(params)}"
    url = f"{base}{path}" if base else path

    return {
        "ok": True,
        "url": url,
        "telefone": telefone,
        "cliente_id": int(cliente.id),
        "cliente_nome": getattr(cliente, "nome", None),
        "target": "zapschat",
    }
