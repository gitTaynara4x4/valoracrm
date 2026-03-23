from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(tags=["Usuários"])


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
    db: Session = Depends(get_db)
) -> int:
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


def norm_str(value: Optional[str]) -> Optional[str]:
    v = (value or "").strip()
    return v or None


# =========================================================
# SCHEMAS (ATUALIZADOS COM PAPEL, ATIVO E FOTO)
# =========================================================
class UsuarioBase(BaseModel):
    nome: Optional[str] = None
    email: Optional[EmailStr] = None
    telefone: Optional[str] = None
    cargo: Optional[str] = None
    papel: Optional[str] = "colaborador"
    ativo: Optional[bool] = True
    foto_url: Optional[str] = None
    foto_base64: Optional[str] = None # Campo temporário para receber a imagem do frontend


class UsuarioCreate(UsuarioBase):
    nome: str
    email: EmailStr
    senha: str


class UsuarioUpdate(UsuarioBase):
    senha: Optional[str] = None


class UsuarioOut(UsuarioBase, _Cfg):
    id: int
    empresa_id: int


# =========================================================
# APOIO
# =========================================================
def buscar_usuario_empresa(db: Session, usuario_id: int, empresa_id: int):
    return (
        db.query(models.Usuario)
        .filter(models.Usuario.id == usuario_id, models.Usuario.empresa_id == empresa_id)
        .first()
    )


def usuario_to_out(u: models.Usuario) -> UsuarioOut:
    return UsuarioOut(
        id=int(u.id),
        empresa_id=int(u.empresa_id),
        nome=getattr(u, "nome", None) or "",
        email=getattr(u, "email", None) or "",
        telefone=getattr(u, "telefone", None),
        cargo=getattr(u, "cargo", None),
        papel=getattr(u, "papel", "colaborador"),
        ativo=getattr(u, "ativo", True),
        foto_url=getattr(u, "foto_url", None),
    )


# =========================================================
# ROTAS
# =========================================================
@router.get("/api/usuarios", response_model=List[UsuarioOut])
def listar_usuarios(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    rows = (
        db.query(models.Usuario)
        .filter(models.Usuario.empresa_id == empresa_id)
        .order_by(models.Usuario.nome.asc())
        .all()
    )
    return [usuario_to_out(u) for u in rows]


@router.get("/api/usuarios/{usuario_id}", response_model=UsuarioOut)
def obter_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return usuario_to_out(usuario)


@router.post("/api/usuarios", response_model=UsuarioOut, status_code=status.HTTP_201_CREATED)
def criar_usuario(
    payload: UsuarioCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    email = payload.email.strip().lower()

    existente = (
      db.query(models.Usuario)
      .filter(models.Usuario.empresa_id == empresa_id, models.Usuario.email == email)
      .first()
    )
    if existente:
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail.")

    usuario = models.Usuario(
        empresa_id=empresa_id,
        nome=payload.nome.strip(),
        email=email,
        telefone=norm_str(payload.telefone),
        cargo=norm_str(payload.cargo),
        senha=payload.senha.strip(),
        papel=payload.papel,
        ativo=payload.ativo,
        # Se você tiver uma lógica para processar o base64, salvar no S3/Local e gerar a URL, ela entra aqui
        # foto_url = processar_imagem(payload.foto_base64) 
    )

    try:
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        return usuario_to_out(usuario)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não foi possível criar o usuário.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar usuário: {e}")


@router.put("/api/usuarios/{usuario_id}", response_model=UsuarioOut)
def atualizar_usuario(
    usuario_id: int,
    payload: UsuarioUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if payload.nome is not None and payload.nome.strip():
        usuario.nome = payload.nome.strip()

    if payload.email is not None and payload.email.strip():
        email = payload.email.strip().lower()

        existente = (
            db.query(models.Usuario)
            .filter(
                models.Usuario.empresa_id == empresa_id,
                models.Usuario.email == email,
                models.Usuario.id != usuario_id
            )
            .first()
        )
        if existente:
            raise HTTPException(status_code=409, detail="Já existe outro usuário com este e-mail.")

        usuario.email = email

    if payload.telefone is not None:
        usuario.telefone = norm_str(payload.telefone)

    if payload.cargo is not None:
        usuario.cargo = norm_str(payload.cargo)

    if payload.senha is not None and payload.senha.strip():
        usuario.senha = payload.senha.strip()

    if payload.papel is not None:
        usuario.papel = payload.papel
        
    if payload.ativo is not None:
        usuario.ativo = payload.ativo

    # Se você tiver uma lógica para processar o base64
    # if payload.foto_base64 is not None:
    #     usuario.foto_url = processar_imagem(payload.foto_base64)

    try:
        db.commit()
        db.refresh(usuario)
        return usuario_to_out(usuario)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não foi possível atualizar o usuário.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar usuário: {e}")


@router.delete("/api/usuarios/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
    user_id: Optional[str] = Cookie(default=None),
):
    usuario = buscar_usuario_empresa(db, usuario_id, empresa_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    # impede excluir o próprio usuário logado
    try:
        current_user_id = int(str(user_id).strip()) if user_id else None
    except Exception:
        current_user_id = None

    if current_user_id and int(usuario.id) == current_user_id:
        raise HTTPException(status_code=400, detail="Você não pode excluir seu próprio usuário.")

    db.delete(usuario)
    db.commit()
    return None