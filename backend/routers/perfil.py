from __future__ import annotations

from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.security.permissions import get_current_user, get_db


router = APIRouter(prefix="/api/perfil", tags=["Perfil"])
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads" / "avatars"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_AVATAR_BYTES = 2 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class PerfilOut(BaseModel):
    id: int
    nome: str
    email: EmailStr
    telefone: Optional[str] = None
    cargo: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class PerfilUpdate(BaseModel):
    nome: str
    email: EmailStr
    telefone: Optional[str] = None
    cargo: Optional[str] = None


class SenhaUpdate(BaseModel):
    senha_atual: str
    nova_senha: str
    confirma_senha: str


def _verify_password(plain: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        if stored.startswith("$pbkdf2-sha256$"):
            return pwd_context.verify(plain, stored)
    except Exception:
        return False
    return plain == stored


def _is_valid_image(binary: bytes, content_type: str) -> bool:
    if content_type in {"image/jpeg", "image/jpg"}:
        return binary.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return binary.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return len(binary) >= 12 and binary[:4] == b"RIFF" and binary[8:12] == b"WEBP"
    return False


def _local_avatar_path(url: Optional[str]) -> Optional[Path]:
    prefix = "/uploads/avatars/"
    if not url or not str(url).startswith(prefix):
        return None
    filename = Path(str(url)[len(prefix):]).name
    candidate = (UPLOAD_DIR / filename).resolve()
    if candidate.parent != UPLOAD_DIR.resolve():
        return None
    return candidate


def _delete_avatar_file(url: Optional[str]) -> None:
    path = _local_avatar_path(url)
    if path and path.exists() and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


@router.get("", response_model=PerfilOut)
def obter_meu_perfil(
    current_user: models.Usuario = Depends(get_current_user),
):
    return current_user


@router.put("", response_model=PerfilOut)
def atualizar_meu_perfil(
    payload: PerfilUpdate,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    nome = (payload.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome é obrigatório.")

    email_limpo = str(payload.email).strip().lower()
    if email_limpo != str(current_user.email or "").strip().lower():
        existe = (
            db.query(models.Usuario)
            .filter(
                models.Usuario.empresa_id == int(current_user.empresa_id),
                models.Usuario.email == email_limpo,
                models.Usuario.id != int(current_user.id),
            )
            .first()
        )
        if existe:
            raise HTTPException(
                status_code=409,
                detail="Este e-mail já está em uso por outro usuário desta empresa.",
            )

    current_user.nome = nome
    current_user.email = email_limpo
    current_user.telefone = (payload.telefone or "").strip() or None
    current_user.cargo = (payload.cargo or "").strip() or None

    try:
        db.commit()
        db.refresh(current_user)
        return current_user
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não foi possível salvar: e-mail já cadastrado.")


@router.put("/senha")
def atualizar_minha_senha(
    payload: SenhaUpdate,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    senha_atual = payload.senha_atual or ""
    nova_senha = payload.nova_senha or ""

    if not _verify_password(senha_atual, current_user.senha_hash):
        raise HTTPException(status_code=401, detail="Senha atual incorreta.")
    if len(nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no mínimo 6 caracteres.")
    if nova_senha != payload.confirma_senha:
        raise HTTPException(status_code=400, detail="As novas senhas não conferem.")
    if nova_senha == senha_atual:
        raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da senha atual.")

    current_user.senha_hash = pwd_context.hash(nova_senha)
    db.commit()
    return {"ok": True, "mensagem": "Senha atualizada com sucesso."}


@router.post("/avatar")
def upload_avatar(
    file: UploadFile = File(...),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content_type = str(file.content_type or "").lower()
    extension = ALLOWED_CONTENT_TYPES.get(content_type)
    if not extension:
        raise HTTPException(status_code=400, detail="Formato de imagem inválido. Use JPG, PNG ou WEBP.")

    binary = file.file.read(MAX_AVATAR_BYTES + 1)
    if not binary:
        raise HTTPException(status_code=400, detail="A imagem está vazia.")
    if len(binary) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="A foto deve ter no máximo 2MB.")
    if not _is_valid_image(binary, content_type):
        raise HTTPException(status_code=400, detail="O conteúdo do arquivo não corresponde a uma imagem válida.")

    old_url = current_user.avatar_url
    filename = f"user_{int(current_user.id)}_{uuid4().hex}.{extension}"
    file_path = UPLOAD_DIR / filename
    file_path.write_bytes(binary)

    current_user.avatar_url = f"/uploads/avatars/{filename}"
    try:
        db.commit()
        db.refresh(current_user)
    except Exception:
        db.rollback()
        try:
            file_path.unlink()
        except OSError:
            pass
        raise HTTPException(status_code=500, detail="Não foi possível salvar a foto de perfil.")

    _delete_avatar_file(old_url)
    return {"ok": True, "avatar_url": current_user.avatar_url}


@router.delete("/avatar", status_code=status.HTTP_200_OK)
def remover_avatar(
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    old_url = current_user.avatar_url
    current_user.avatar_url = None
    db.commit()
    _delete_avatar_file(old_url)
    return {"ok": True, "avatar_url": None}
