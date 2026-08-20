# backend/routers/integracoes_zapschat.py
from __future__ import annotations

import os
import re
from typing import Any, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal
from backend.security.permissions import (
    get_request_user,
    is_admin as _is_admin_user,
    is_owner as _is_owner_user,
)
from backend.services.zapschat_integration import (
    ZapsChatIntegrationError,
    disconnect as _disconnect_zapschat,
    list_instances as _list_zapschat_instances,
    pair_company as _pair_zapschat_company,
    public_config as _public_zapschat_config,
    select_instance as _select_zapschat_instance,
    test_connection as _test_zapschat_connection,
)

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
    request: Request,
    db: Session = Depends(get_db),
) -> models.Usuario:
    return get_request_user(request, db)


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

# -----------------------------------------------------------------------------
# Pareamento seguro Valora <-> ZapsChat para cobranças automáticas
# -----------------------------------------------------------------------------
class ZapsChatParearIn(BaseModel):
    codigo: str = Field(min_length=6, max_length=20)


class ZapsChatInstanciaIn(BaseModel):
    instancia_id: int = Field(gt=0)


def _pode_configurar(usuario: models.Usuario) -> bool:
    return bool(_is_owner_user(usuario) or _is_admin_user(usuario))


def _require_config_manager(usuario: models.Usuario) -> None:
    if not _pode_configurar(usuario):
        raise HTTPException(
            status_code=403,
            detail="Somente o proprietário ou administrador pode alterar a integração com o ZapsChat.",
        )


def _raise_integration_error(exc: ZapsChatIntegrationError) -> None:
    raise HTTPException(status_code=int(exc.status_code or 502), detail=str(exc)) from exc


@router.get("/configuracao")
def configuracao_zapschat(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    data = _public_zapschat_config(db, int(usuario.empresa_id))
    data["pode_configurar"] = _pode_configurar(usuario)
    return data


@router.post("/parear")
def parear_zapschat(
    payload: ZapsChatParearIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    _require_config_manager(usuario)
    empresa = db.query(models.Empresa).filter(models.Empresa.id == int(usuario.empresa_id)).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    codigo = re.sub(r"\D+", "", str(payload.codigo or ""))
    if len(codigo) != 8:
        raise HTTPException(status_code=422, detail="Digite os 8 números mostrados no ZapsChat.")
    try:
        data = _pair_zapschat_company(
            db,
            empresa_id=int(usuario.empresa_id),
            empresa_nome=str(empresa.nome or "Empresa Valora"),
            usuario_id=int(usuario.id),
            codigo=codigo,
        )
    except ZapsChatIntegrationError as exc:
        _raise_integration_error(exc)
    data["pode_configurar"] = True
    return data


@router.get("/instancias")
def listar_instancias_zapschat(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    _require_config_manager(usuario)
    try:
        return _list_zapschat_instances(db, int(usuario.empresa_id), refresh_saved=True)
    except ZapsChatIntegrationError as exc:
        _raise_integration_error(exc)


@router.put("/instancia")
def selecionar_instancia_zapschat(
    payload: ZapsChatInstanciaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    _require_config_manager(usuario)
    try:
        data = _select_zapschat_instance(
            db,
            empresa_id=int(usuario.empresa_id),
            usuario_id=int(usuario.id),
            instancia_id=int(payload.instancia_id),
        )
    except ZapsChatIntegrationError as exc:
        _raise_integration_error(exc)
    data["pode_configurar"] = True
    return data


@router.post("/testar")
def testar_integracao_zapschat(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    _require_config_manager(usuario)
    try:
        return _test_zapschat_connection(db, int(usuario.empresa_id))
    except ZapsChatIntegrationError as exc:
        _raise_integration_error(exc)


@router.delete("/configuracao")
def desconectar_integracao_zapschat(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(_get_current_user),
):
    _require_config_manager(usuario)
    _disconnect_zapschat(db, empresa_id=int(usuario.empresa_id), usuario_id=int(usuario.id))
    data = _public_zapschat_config(db, int(usuario.empresa_id))
    data["pode_configurar"] = True
    return data
