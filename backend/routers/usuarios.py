from __future__ import annotations

import base64
import binascii
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.database import SessionLocal
from backend import models

router = APIRouter(tags=["Usuários"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
BASE_DIR = Path(__file__).resolve().parents[2]
AVATAR_DIR = BASE_DIR / "uploads" / "usuarios" / "avatares"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_MIMES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

MODULOS_VALIDOS = {
    "dashboard",
    "clientes",
    "fornecedores",
    "produtos",
    "patrimonio",
    "cotacoes",
    "propostas",
    "contratos",
    "usuarios",
    "empresa",
    "configuracoes",
}

PAPEIS_VALIDOS = {"owner", "admin", "colaborador", "visualizador"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> models.Usuario:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    if hasattr(usuario, "ativo") and usuario.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return usuario


def get_empresa_id(current_user: models.Usuario = Depends(get_current_user)) -> int:
    return int(current_user.empresa_id)


try:
    from pydantic import ConfigDict  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True


def norm_str(value: Optional[str]) -> Optional[str]:
    v = (value or "").strip()
    return v or None


def normalize_papel(value: Optional[str]) -> str:
    papel = (value or "colaborador").strip().lower()
    if papel not in PAPEIS_VALIDOS:
        return "colaborador"
    return papel


def normalize_email(value: Optional[str]) -> str:
    email = (value or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="E-mail é obrigatório.")

    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
        raise HTTPException(status_code=400, detail="Informe um e-mail válido. Exemplo: nome@empresa.com.br")

    return email


def hash_senha(senha: str) -> str:
    senha_limpa = (senha or "").strip()
    if len(senha_limpa) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 6 caracteres.")
    return pwd_context.hash(senha_limpa)


def is_owner(user: models.Usuario) -> bool:
    return str(getattr(user, "papel", "") or "").strip().lower() == "owner"


def is_admin(user: models.Usuario) -> bool:
    return str(getattr(user, "papel", "") or "").strip().lower() == "admin"


def count_active_owners(db: Session, empresa_id: int) -> int:
    return (
        db.query(models.Usuario)
        .filter(
            models.Usuario.empresa_id == empresa_id,
            models.Usuario.papel == "owner",
            models.Usuario.ativo == True,
        )
        .count()
    )


def ensure_can_assign_role(current_user: models.Usuario, papel_destino: str) -> None:
    papel = normalize_papel(papel_destino)

    if is_owner(current_user):
        return

    if is_admin(current_user) and papel in {"colaborador", "visualizador"}:
        return

    if is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin só pode criar/editar colaborador ou visualizador.")

    raise HTTPException(status_code=403, detail="Sem permissão para gerenciar usuários.")


def ensure_can_manage_target(current_user: models.Usuario, target_user: models.Usuario) -> None:
    if int(current_user.empresa_id) != int(target_user.empresa_id):
        raise HTTPException(status_code=403, detail="Você não pode gerenciar usuário de outra empresa.")

    if is_owner(current_user):
        return

    if is_admin(current_user) and str(target_user.papel) in {"colaborador", "visualizador"}:
        return

    if int(current_user.id) == int(target_user.id):
        return

    raise HTTPException(status_code=403, detail="Você não pode gerenciar este usuário.")


def processar_avatar_base64(foto_base64: Optional[str], empresa_id: int) -> Optional[str]:
    if not foto_base64:
        return None

    raw = foto_base64.strip()
    mime = "image/png"
    data = raw

    match = re.match(r"^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$", raw, flags=re.IGNORECASE | re.DOTALL)
    if match:
        mime = match.group(1).lower()
        data = match.group(2)

    if mime not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(status_code=400, detail="Formato de imagem não permitido. Use JPG, PNG ou WEBP.")

    try:
        binary = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Imagem inválida.")

    if len(binary) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="A foto deve ter no máximo 2MB.")

    ext = ALLOWED_IMAGE_MIMES[mime]
    filename = f"empresa_{empresa_id}_{uuid4().hex}.{ext}"
    path = AVATAR_DIR / filename
    path.write_bytes(binary)

    return f"/uploads/usuarios/avatares/{filename}"


def buscar_usuario_empresa(db: Session, usuario_id: int, empresa_id: int):
    return (
        db.query(models.Usuario)
        .filter(models.Usuario.id == usuario_id, models.Usuario.empresa_id == empresa_id)
        .first()
    )


def build_permissoes_dict(db: Session, usuario_id: int) -> dict:
    rows = (
        db.query(models.UsuarioPermissao)
        .filter(models.UsuarioPermissao.usuario_id == usuario_id)
        .all()
    )

    mapa = {
        modulo: {
            "pode_ver": False,
            "pode_criar": False,
            "pode_editar": False,
            "pode_excluir": False,
        }
        for modulo in MODULOS_VALIDOS
    }

    for row in rows:
        modulo = str(row.modulo or "").strip().lower()
        if modulo not in mapa:
            continue
        mapa[modulo] = {
            "pode_ver": bool(row.pode_ver),
            "pode_criar": bool(row.pode_criar),
            "pode_editar": bool(row.pode_editar),
            "pode_excluir": bool(row.pode_excluir),
        }

    return mapa


def usuario_to_out(db: Session, u: models.Usuario) -> "UsuarioOut":
    avatar_url = getattr(u, "avatar_url", None)

    return UsuarioOut(
        id=int(u.id),
        empresa_id=int(u.empresa_id),
        nome=getattr(u, "nome", None) or "",
        email=getattr(u, "email", None) or "",
        telefone=getattr(u, "telefone", None),
        cargo=getattr(u, "cargo", None),
        papel=getattr(u, "papel", "colaborador") or "colaborador",
        ativo=bool(getattr(u, "ativo", True)),
        avatar_url=avatar_url,
        foto_url=avatar_url,
        permissoes=build_permissoes_dict(db, int(u.id)),
        criado_em=getattr(u, "criado_em", None),
        atualizado_em=getattr(u, "atualizado_em", None),
    )


def salvar_permissoes_do_usuario(db: Session, usuario: models.Usuario, permissoes: Optional[List["PermissaoUsuarioIn"]]) -> None:
    papel = normalize_papel(getattr(usuario, "papel", None))
    if papel in {"owner", "admin"}:
        db.query(models.UsuarioPermissao).filter(models.UsuarioPermissao.usuario_id == int(usuario.id)).delete()
        return

    if permissoes is None:
        return

    vistos = set()
    normalizadas = []

    for item in permissoes:
        modulo = str(item.modulo or "").strip().lower()
        if modulo not in MODULOS_VALIDOS:
            raise HTTPException(status_code=400, detail=f"Módulo inválido: {modulo}")
        if modulo in vistos:
            raise HTTPException(status_code=400, detail=f"Módulo repetido: {modulo}")
        vistos.add(modulo)
        normalizadas.append(item)

    db.query(models.UsuarioPermissao).filter(models.UsuarioPermissao.usuario_id == int(usuario.id)).delete()

    for item in normalizadas:
        row = models.UsuarioPermissao(
            empresa_id=int(usuario.empresa_id),
            usuario_id=int(usuario.id),
            modulo=str(item.modulo).strip().lower(),
            pode_ver=bool(item.pode_ver),
            pode_criar=bool(item.pode_criar),
            pode_editar=bool(item.pode_editar),
            pode_excluir=bool(item.pode_excluir),
        )
        db.add(row)


class PermissaoUsuarioIn(BaseModel):
    modulo: str
    pode_ver: bool = False
    pode_criar: bool = False
    pode_editar: bool = False
    pode_excluir: bool = False


class UsuarioBase(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    cargo: Optional[str] = None
    papel: Optional[str] = "colaborador"
    ativo: Optional[bool] = True
    avatar_url: Optional[str] = None
    foto_url: Optional[str] = None
    foto_base64: Optional[str] = None
    permissoes: Optional[List[PermissaoUsuarioIn]] = None


class UsuarioCreate(UsuarioBase):
    senha: Optional[str] = None


class UsuarioUpdate(UsuarioBase):
    senha: Optional[str] = None


class UsuarioOut(UsuarioBase, _Cfg):
    id: int
    empresa_id: int
    permissoes: dict = Field(default_factory=dict)
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None


@router.get("/api/usuarios", response_model=List[UsuarioOut])
def listar_usuarios(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    rows = (
        db.query(models.Usuario)
        .filter(models.Usuario.empresa_id == empresa_id)
        .order_by(models.Usuario.nome.asc())
        .all()
    )
    return [usuario_to_out(db, u) for u in rows]


@router.get("/api/usuarios/{usuario_id}", response_model=UsuarioOut)
def obter_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return usuario_to_out(db, usuario)


@router.post("/api/usuarios", response_model=UsuarioOut, status_code=status.HTTP_201_CREATED)
def criar_usuario(
    payload: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    empresa_id = int(current_user.empresa_id)
    nome = (payload.nome or "").strip()
    email = normalize_email(payload.email)
    senha = (payload.senha or "").strip()
    papel = normalize_papel(payload.papel)

    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")

    if not senha:
        raise HTTPException(status_code=400, detail="Senha é obrigatória.")

    ensure_can_assign_role(current_user, papel)

    # E-mail é único SOMENTE dentro da empresa atual.
    # A mesma pessoa/e-mail pode existir em outra empresa/conta.
    existente = (
        db.query(models.Usuario)
        .filter(
            models.Usuario.empresa_id == empresa_id,
            models.Usuario.email == email,
        )
        .first()
    )
    if existente:
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail nesta empresa.")

    avatar_url = processar_avatar_base64(payload.foto_base64, empresa_id)

    usuario = models.Usuario(
        empresa_id=empresa_id,
        nome=nome,
        email=email,
        telefone=norm_str(payload.telefone),
        cargo=norm_str(payload.cargo),
        senha_hash=hash_senha(senha),
        papel=papel,
        ativo=bool(payload.ativo),
        avatar_url=avatar_url,
    )

    try:
        db.add(usuario)
        db.flush()
        salvar_permissoes_do_usuario(db, usuario, payload.permissoes)
        db.commit()
        db.refresh(usuario)
        return usuario_to_out(db, usuario)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail nesta empresa.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar usuário: {e}")


@router.put("/api/usuarios/{usuario_id}", response_model=UsuarioOut)
def atualizar_usuario(
    usuario_id: int,
    payload: UsuarioUpdate,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    empresa_id = int(current_user.empresa_id)
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    ensure_can_manage_target(current_user, usuario)

    novo_papel = normalize_papel(payload.papel) if payload.papel is not None else str(usuario.papel or "colaborador")
    ensure_can_assign_role(current_user, novo_papel)

    if int(current_user.id) == int(usuario.id):
        if payload.ativo is False:
            raise HTTPException(status_code=400, detail="Você não pode desativar seu próprio usuário.")
        if novo_papel != str(usuario.papel or "").strip().lower() and not is_owner(current_user):
            raise HTTPException(status_code=400, detail="Você não pode alterar seu próprio papel.")

    if str(usuario.papel or "").strip().lower() == "owner" and novo_papel != "owner":
        if count_active_owners(db, empresa_id) <= 1:
            raise HTTPException(status_code=400, detail="Não é possível rebaixar o último owner da empresa.")

    if payload.nome is not None:
        nome = payload.nome.strip()
        if not nome:
            raise HTTPException(status_code=400, detail="Nome é obrigatório.")
        usuario.nome = nome

    if payload.email is not None:
        email = normalize_email(payload.email)
        # E-mail é único SOMENTE dentro da empresa atual.
        existente = (
            db.query(models.Usuario)
            .filter(
                models.Usuario.empresa_id == empresa_id,
                models.Usuario.email == email,
                models.Usuario.id != usuario_id,
            )
            .first()
        )
        if existente:
            raise HTTPException(status_code=409, detail="Já existe outro usuário com este e-mail nesta empresa.")
        usuario.email = email

    if payload.telefone is not None:
        usuario.telefone = norm_str(payload.telefone)

    if payload.cargo is not None:
        usuario.cargo = norm_str(payload.cargo)

    if payload.senha is not None and payload.senha.strip():
        usuario.senha_hash = hash_senha(payload.senha)

    if payload.papel is not None:
        usuario.papel = novo_papel

    if payload.ativo is not None:
        usuario.ativo = bool(payload.ativo)

    if payload.foto_base64:
        usuario.avatar_url = processar_avatar_base64(payload.foto_base64, empresa_id)

    try:
        salvar_permissoes_do_usuario(db, usuario, payload.permissoes)
        db.commit()
        db.refresh(usuario)
        return usuario_to_out(db, usuario)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe outro usuário com este e-mail nesta empresa.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar usuário: {e}")


@router.delete("/api/usuarios/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user),
):
    empresa_id = int(current_user.empresa_id)
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    ensure_can_manage_target(current_user, usuario)

    if int(usuario.id) == int(current_user.id):
        raise HTTPException(status_code=400, detail="Você não pode excluir seu próprio usuário.")

    if str(usuario.papel or "").strip().lower() == "owner" and count_active_owners(db, empresa_id) <= 1:
        raise HTTPException(status_code=400, detail="Não é possível excluir o último owner da empresa.")

    db.delete(usuario)
    db.commit()
    return None
