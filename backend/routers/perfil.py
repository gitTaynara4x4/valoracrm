# backend/routers/perfil.py
from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Cookie, UploadFile, File
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/perfil", tags=["Perfil"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# =========================================================
# CONFIGURAÇÃO DE UPLOAD DE FOTOS
# =========================================================
BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads" / "avatars"
# Garante que a pasta uploads/avatars exista no seu servidor
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# =========================================================
# Dependência DB
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================================================
# SCHEMAS
# =========================================================
class PerfilOut(BaseModel):
    id: int
    nome: str
    email: EmailStr
    telefone: Optional[str] = None
    cargo: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True
        orm_mode = True

class PerfilUpdate(BaseModel):
    nome: str
    email: EmailStr
    telefone: Optional[str] = None
    cargo: Optional[str] = None

class SenhaUpdate(BaseModel):
    senha_atual: str
    nova_senha: str
    confirma_senha: str


# =========================================================
# ENDPOINTS DE DADOS PESSOAIS
# =========================================================
@router.get("", response_model=PerfilOut)
def obter_meu_perfil(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == int(user_id)).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    return usuario


@router.put("", response_model=PerfilOut)
def atualizar_meu_perfil(
    payload: PerfilUpdate,
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == int(user_id)).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    email_limpo = payload.email.strip().lower()
    if email_limpo != usuario.email:
        existe = db.query(models.Usuario).filter(models.Usuario.email == email_limpo).first()
        if existe:
            raise HTTPException(status_code=409, detail="Este e-mail já está em uso por outro usuário.")

    usuario.nome = payload.nome.strip()
    usuario.email = email_limpo
    usuario.telefone = payload.telefone.strip() if payload.telefone else None
    usuario.cargo = payload.cargo.strip() if payload.cargo else None

    try:
        db.commit()
        db.refresh(usuario)
        return usuario
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Erro ao salvar os dados.")


@router.put("/senha")
def atualizar_minha_senha(
    payload: SenhaUpdate,
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == int(user_id)).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if not pwd_context.verify(payload.senha_atual, usuario.senha_hash):
        raise HTTPException(status_code=401, detail="Senha atual incorreta.")

    if len(payload.nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no mínimo 6 caracteres.")

    if payload.nova_senha != payload.confirma_senha:
        raise HTTPException(status_code=400, detail="As novas senhas não conferem.")

    usuario.senha_hash = pwd_context.hash(payload.nova_senha)
    db.commit()
    return {"ok": True, "mensagem": "Senha atualizada com sucesso."}


# =========================================================
# ENDPOINT DE UPLOAD DA FOTO (Faltava isso!)
# =========================================================
@router.post("/avatar")
def upload_avatar(
    file: UploadFile = File(...),
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    
    usuario = db.query(models.Usuario).filter(models.Usuario.id == int(user_id)).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    # Verifica a extensão
    extensao = file.filename.split(".")[-1].lower()
    if extensao not in ["jpg", "jpeg", "png", "webp"]:
        raise HTTPException(status_code=400, detail="Formato de imagem inválido. Use JPG, PNG ou WEBP.")

    # Cria nome único
    novo_nome = f"user_{usuario.id}_{uuid4().hex}.{extensao}"
    caminho_arquivo = UPLOAD_DIR / novo_nome

    # Salva o arquivo no disco
    with open(caminho_arquivo, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Atualiza a URL pública no BD
    url_publica = f"/uploads/avatars/{novo_nome}"
    usuario.avatar_url = url_publica
    
    db.commit()

    return {"ok": True, "avatar_url": url_publica}