from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend import models as core_models
from backend.database import SessionLocal
from backend.models_area_cliente_acesso import ClienteAcessoPortal

router = APIRouter(tags=["Área do Cliente - Acessos Admin"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


STATUS_ACESSO: Dict[str, str] = {
    "pendente": "Pendente",
    "usado": "Usado",
    "expirado": "Expirado",
    "revogado": "Revogado",
}

AREA_CLIENTE_PUBLIC_URL = os.getenv(
    "AREA_CLIENTE_PUBLIC_URL",
    "https://segsis.com.br/area-cliente",
)

PORTAL_TOKEN_PEPPER = (
    os.getenv("VALORACRM_PORTAL_TOKEN_SECRET")
    or os.getenv("SECRET_KEY")
    or "valoracrm-area-cliente-dev"
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> core_models.Usuario:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(core_models.Usuario).filter(core_models.Usuario.id == user_id_int).first()

    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return usuario


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def usuario_nome(usuario: core_models.Usuario) -> Optional[str]:
    return norm_str(getattr(usuario, "nome", None)) or norm_str(getattr(usuario, "email", None))


def cliente_nome(cliente: core_models.Cliente) -> str:
    return (
        norm_str(getattr(cliente, "nome", None))
        or norm_str(getattr(cliente, "nome_fantasia", None))
        or f"Cliente #{cliente.id}"
    )


def cliente_codigo(cliente: core_models.Cliente) -> str:
    return (
        norm_str(getattr(cliente, "codigo", None))
        or f"{int(cliente.id):04d}"
    )


def buscar_cliente_empresa(db: Session, cliente_id: int, empresa_id: int) -> core_models.Cliente:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == cliente_id)
        .filter(core_models.Cliente.empresa_id == empresa_id)
        .first()
    )

    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    return cliente


def gerar_token_seguro() -> str:
    return secrets.token_urlsafe(32)


def gerar_senha_provisoria() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def hash_token(token: str) -> str:
    raw = f"{PORTAL_TOKEN_PEPPER}:{token}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def hash_senha(senha: str) -> str:
    return pwd_context.hash(senha)


def build_link_publico(token: str, base_url: Optional[str] = None) -> str:
    url = (base_url or AREA_CLIENTE_PUBLIC_URL or "").strip()

    if not url:
        url = "https://segsis.com.br/area-cliente"

    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode({'acesso': token})}"


def montar_mensagem_cliente(
    cliente: core_models.Cliente,
    link_publico: str,
    senha_provisoria: str,
    expira_em: datetime,
) -> str:
    nome = cliente_nome(cliente)
    data_expiracao = expira_em.strftime("%d/%m/%Y às %H:%M")

    return (
        f"Olá, {nome}.\n\n"
        "Para continuar seu cadastro e preencher os dados necessários para emissão do contrato, acesse o link abaixo:\n\n"
        f"{link_publico}\n\n"
        f"Senha provisória: {senha_provisoria}\n\n"
        f"Esse acesso é temporário e expira em {data_expiracao}.\n\n"
        "Qualquer dúvida, fale com nossa equipe."
    )


def status_label(status_value: Optional[str]) -> str:
    status_norm = str(status_value or "").strip().lower()
    return STATUS_ACESSO.get(status_norm, status_norm or "Pendente")


def atualizar_acessos_expirados(
    db: Session,
    empresa_id: int,
    cliente_id: Optional[int] = None,
) -> None:
    query = (
        db.query(ClienteAcessoPortal)
        .filter(ClienteAcessoPortal.empresa_id == empresa_id)
        .filter(ClienteAcessoPortal.status == "pendente")
        .filter(ClienteAcessoPortal.expira_em < now_utc())
    )

    if cliente_id:
        query = query.filter(ClienteAcessoPortal.cliente_id == cliente_id)

    rows = query.all()

    if not rows:
        return

    for row in rows:
        row.status = "expirado"
        row.atualizado_em = now_utc()

    db.flush()


def revogar_acessos_pendentes_do_cliente(
    db: Session,
    empresa_id: int,
    cliente_id: int,
) -> int:
    rows = (
        db.query(ClienteAcessoPortal)
        .filter(ClienteAcessoPortal.empresa_id == empresa_id)
        .filter(ClienteAcessoPortal.cliente_id == cliente_id)
        .filter(ClienteAcessoPortal.status == "pendente")
        .all()
    )

    total = 0

    for row in rows:
        row.status = "revogado"
        row.revogado_em = now_utc()
        row.atualizado_em = now_utc()
        total += 1

    if total:
        db.flush()

    return total


class OpcaoOut(BaseModel):
    value: str
    label: str


class GerarAcessoPayload(BaseModel):
    expira_em_dias: int = Field(default=7, ge=1, le=90)
    base_url: Optional[str] = None
    revogar_anteriores: bool = True


class AcessoOut(ORMBaseModel):
    id: int
    empresa_id: int
    cliente_id: int
    cliente_nome: Optional[str] = None
    cliente_codigo: Optional[str] = None

    token_hint: Optional[str] = None

    status: str
    status_label: str

    expira_em: Optional[str] = None
    usado_em: Optional[str] = None
    revogado_em: Optional[str] = None
    ultimo_acesso_em: Optional[str] = None

    tentativas: int = 0

    criado_por_id: Optional[int] = None
    criado_por_nome: Optional[str] = None

    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None


class AcessoAtivoOut(BaseModel):
    ativo: bool
    acesso: Optional[AcessoOut] = None


class AcessoGeradoOut(AcessoOut):
    token: str
    senha_provisoria: str
    link_publico: str
    mensagem_whatsapp: str
    aviso: str = "A senha provisória aparece apenas agora. Copie e guarde antes de fechar."


def serialize_datetime(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def acesso_to_out(db: Session, row: ClienteAcessoPortal) -> AcessoOut:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == row.cliente_id)
        .first()
    )

    return AcessoOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        cliente_id=int(row.cliente_id),
        cliente_nome=cliente_nome(cliente) if cliente else None,
        cliente_codigo=cliente_codigo(cliente) if cliente else row.codigo_cliente,
        token_hint=row.token_hint,
        status=row.status,
        status_label=status_label(row.status),
        expira_em=serialize_datetime(row.expira_em),
        usado_em=serialize_datetime(row.usado_em),
        revogado_em=serialize_datetime(row.revogado_em),
        ultimo_acesso_em=serialize_datetime(row.ultimo_acesso_em),
        tentativas=int(row.tentativas or 0),
        criado_por_id=int(row.criado_por_id) if row.criado_por_id else None,
        criado_por_nome=row.criado_por_nome,
        criado_em=serialize_datetime(row.criado_em),
        atualizado_em=serialize_datetime(row.atualizado_em),
    )


def buscar_acesso_empresa(db: Session, acesso_id: int, empresa_id: int) -> ClienteAcessoPortal:
    acesso = (
        db.query(ClienteAcessoPortal)
        .filter(ClienteAcessoPortal.id == acesso_id)
        .filter(ClienteAcessoPortal.empresa_id == empresa_id)
        .first()
    )

    if not acesso:
        raise HTTPException(status_code=404, detail="Acesso não encontrado.")

    return acesso


@router.get("/api/area-cliente-acessos-admin/status", response_model=List[OpcaoOut])
def listar_status_acesso():
    return [
        OpcaoOut(value=value, label=label)
        for value, label in STATUS_ACESSO.items()
    ]


@router.get(
    "/api/area-cliente-acessos-admin/clientes/{cliente_id}/acessos",
    response_model=List[AcessoOut],
)
def listar_acessos_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        buscar_cliente_empresa(db, cliente_id, empresa_id)

        atualizar_acessos_expirados(db, empresa_id, cliente_id)
        db.commit()

        rows = (
            db.query(ClienteAcessoPortal)
            .filter(ClienteAcessoPortal.empresa_id == empresa_id)
            .filter(ClienteAcessoPortal.cliente_id == cliente_id)
            .order_by(ClienteAcessoPortal.criado_em.desc(), ClienteAcessoPortal.id.desc())
            .limit(100)
            .all()
        )

        return [acesso_to_out(db, row) for row in rows]

    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A tabela clientes_acessos_portal ainda não existe. Rode a query SQL da Parte 3A.",
        ) from exc


@router.get(
    "/api/area-cliente-acessos-admin/clientes/{cliente_id}/ativo",
    response_model=AcessoAtivoOut,
)
def obter_acesso_ativo_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        buscar_cliente_empresa(db, cliente_id, empresa_id)

        atualizar_acessos_expirados(db, empresa_id, cliente_id)
        db.commit()

        acesso = (
            db.query(ClienteAcessoPortal)
            .filter(ClienteAcessoPortal.empresa_id == empresa_id)
            .filter(ClienteAcessoPortal.cliente_id == cliente_id)
            .filter(ClienteAcessoPortal.status == "pendente")
            .order_by(ClienteAcessoPortal.criado_em.desc(), ClienteAcessoPortal.id.desc())
            .first()
        )

        if not acesso:
            return AcessoAtivoOut(ativo=False, acesso=None)

        return AcessoAtivoOut(
            ativo=True,
            acesso=acesso_to_out(db, acesso),
        )

    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A tabela clientes_acessos_portal ainda não existe. Rode a query SQL da Parte 3A.",
        ) from exc


@router.post(
    "/api/area-cliente-acessos-admin/clientes/{cliente_id}/gerar",
    response_model=AcessoGeradoOut,
    status_code=status.HTTP_201_CREATED,
)
def gerar_acesso_cliente(
    cliente_id: int,
    payload: GerarAcessoPayload,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)

        atualizar_acessos_expirados(db, empresa_id, cliente_id)

        if payload.revogar_anteriores:
            revogar_acessos_pendentes_do_cliente(db, empresa_id, cliente_id)

        token = gerar_token_seguro()
        senha_provisoria = gerar_senha_provisoria()
        expira_em = now_utc() + timedelta(days=int(payload.expira_em_dias or 7))

        link_publico = build_link_publico(
            token=token,
            base_url=payload.base_url,
        )

        acesso = ClienteAcessoPortal(
            empresa_id=empresa_id,
            cliente_id=int(cliente.id),
            token_hash=hash_token(token),
            token_hint=f"{token[:6]}...{token[-4:]}",
            senha_provisoria_hash=hash_senha(senha_provisoria),
            codigo_cliente=cliente_codigo(cliente),
            status="pendente",
            expira_em=expira_em,
            tentativas=0,
            criado_por_id=int(usuario.id),
            criado_por_nome=usuario_nome(usuario),
        )

        db.add(acesso)
        db.flush()

        db.commit()
        db.refresh(acesso)

        base = acesso_to_out(db, acesso)
        mensagem = montar_mensagem_cliente(
            cliente=cliente,
            link_publico=link_publico,
            senha_provisoria=senha_provisoria,
            expira_em=expira_em,
        )

        return AcessoGeradoOut(
            **base.model_dump() if hasattr(base, "model_dump") else base.dict(),
            token=token,
            senha_provisoria=senha_provisoria,
            link_publico=link_publico,
            mensagem_whatsapp=mensagem,
        )

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Já existe um acesso pendente para este cliente. Revogue o acesso anterior ou gere novamente revogando os anteriores.",
        ) from exc
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A tabela clientes_acessos_portal ainda não existe. Rode a query SQL da Parte 3A.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao gerar acesso provisório: {exc}",
        ) from exc


@router.post("/api/area-cliente-acessos-admin/{acesso_id}/revogar")
def revogar_acesso_cliente(
    acesso_id: int,
    motivo: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        acesso = buscar_acesso_empresa(db, acesso_id, empresa_id)

        if acesso.status != "pendente":
            return {
                "ok": True,
                "message": "O acesso não estava pendente.",
                "status": acesso.status,
                "status_label": status_label(acesso.status),
            }

        acesso.status = "revogado"
        acesso.revogado_em = now_utc()
        acesso.atualizado_em = now_utc()

        db.commit()

        return {
            "ok": True,
            "message": "Acesso revogado com sucesso.",
            "acesso_id": acesso_id,
            "motivo": motivo,
        }

    except HTTPException:
        db.rollback()
        raise
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A tabela clientes_acessos_portal ainda não existe. Rode a query SQL da Parte 3A.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao revogar acesso: {exc}",
        ) from exc