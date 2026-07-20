# backend/routers/empresa.py
from __future__ import annotations

import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Cookie, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/empresa", tags=["Empresa"])

# =========================================================
# DEPENDÊNCIAS
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_empresa_id(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> int:
    """Retorna a empresa vinculada ao usuário autenticado."""
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

    return int(usuario.empresa_id)


# =========================================================
# COMPATIBILIDADE PYDANTIC V1 / V2
# =========================================================
try:
    from pydantic import ConfigDict  # type: ignore
    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True

# =========================================================
# SCHEMAS (Modelos de Entrada e Saída)
# =========================================================
class EmpresaUpdate(BaseModel):
    nome: Optional[str] = None
    cnpj: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    cep: Optional[str] = None
    estado: Optional[str] = None
    cidade: Optional[str] = None
    rua: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None

class EmpresaOut(BaseModel, _Cfg):
    id: int
    nome: str
    cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    cep: Optional[str] = None
    estado: Optional[str] = None
    cidade: Optional[str] = None
    rua: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    logo_url: Optional[str] = None
    plano: str
    ativo: bool

# =========================================================
# ROTAS
# =========================================================

@router.get("/atual", response_model=EmpresaOut)
def obter_empresa_atual(
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id)
):
    """Retorna todos os dados da empresa do usuário logado"""
    empresa = db.query(models.Empresa).filter(models.Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")
    return empresa


@router.put("", response_model=EmpresaOut)
def atualizar_empresa(
    payload: EmpresaUpdate, 
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id)
):
    """Atualiza os dados de contato e endereço da empresa"""
    empresa = db.query(models.Empresa).filter(models.Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    # Atualiza somente os campos enviados. Campo enviado vazio limpa o valor;
    # campo omitido permanece inalterado. Isso permite corrigir dados antigos
    # que tenham sido preenchidos por engano.
    data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    for key, value in data.items():
        cleaned = "" if value is None else str(value).strip()
        if key == "nome":
            if not cleaned:
                raise HTTPException(status_code=422, detail="O nome da empresa não pode ficar vazio.")
            setattr(empresa, key, cleaned)
        else:
            setattr(empresa, key, cleaned or None)

    try:
        db.commit()
        db.refresh(empresa)
        return empresa
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar empresa: {e}")


@router.post("/logo")
def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    """Salva a imagem na pasta do servidor e grava o caminho no banco de dados"""
    
    # 1. Pega a empresa no banco
    empresa = db.query(models.Empresa).filter(models.Empresa.id == empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada.")

    # 2. Cria a pasta de uploads se ela não existir
    upload_dir = "frontend/img/uploads/logos"
    os.makedirs(upload_dir, exist_ok=True)
    
    # 3. Salva o arquivo fisicamente
    file_extension = file.filename.split(".")[-1]
    file_name = f"logo_empresa_{empresa_id}.{file_extension}"
    file_path = os.path.join(upload_dir, file_name)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 4. Salva o caminho no Banco de Dados
    logo_url = f"/{file_path}"
    empresa.logo_url = logo_url
    
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Erro ao salvar logo no banco de dados.")
        
    # Retorna o caminho para o frontend mostrar na tela
    return {"logo_url": logo_url, "mensagem": "Logo atualizada com sucesso!"}