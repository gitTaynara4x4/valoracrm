from __future__ import annotations

import json
import re
import unicodedata
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/campos-propostas", tags=["Campos Propostas"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


try:
    from pydantic import ConfigDict  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True


def validar_usuario_empresa(request: Request, db: Session) -> int:
    return 1


def get_fields_set(payload) -> set:
    return set(
        getattr(payload, "model_fields_set", None)
        or getattr(payload, "__fields_set__", set())
    )


def slugify(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto or "campo"


def norm_tipo(tipo: str) -> str:
    t = (tipo or "").strip().lower()
    validos = {"texto", "textarea", "numero", "data", "select", "checkbox"}
    if t not in validos:
        raise HTTPException(status_code=422, detail=f"Tipo inválido: {tipo}")
    return t


def parse_opcoes_json(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except Exception:
        pass
    return []


def dump_opcoes_json(opcoes: Optional[List[str]]) -> Optional[str]:
    itens = [str(x).strip() for x in (opcoes or []) if str(x).strip()]
    if not itens:
        return None
    return json.dumps(itens, ensure_ascii=False)


class CampoPropostaBase(BaseModel):
    nome: str
    slug: Optional[str] = None
    tipo: str
    obrigatorio: bool = False
    ativo: bool = True
    opcoes: List[str] = Field(default_factory=list)
    ordem: int = 0


class CampoPropostaCreate(CampoPropostaBase):
    pass


class CampoPropostaUpdate(BaseModel):
    nome: Optional[str] = None
    slug: Optional[str] = None
    tipo: Optional[str] = None
    obrigatorio: Optional[bool] = None
    ativo: Optional[bool] = None
    opcoes: Optional[List[str]] = None
    ordem: Optional[int] = None


class CampoPropostaOut(_Cfg, BaseModel):
    id: int
    empresa_id: int
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool
    ativo: bool
    opcoes: List[str] = Field(default_factory=list)
    ordem: int


def campo_to_out(c: models.CampoProposta) -> CampoPropostaOut:
    return CampoPropostaOut(
        id=int(c.id),
        empresa_id=int(c.empresa_id),
        nome=c.nome,
        slug=c.slug,
        tipo=c.tipo,
        obrigatorio=bool(c.obrigatorio),
        ativo=bool(c.ativo),
        opcoes=parse_opcoes_json(c.opcoes_json),
        ordem=int(c.ordem or 0),
    )


def buscar_campo_empresa(db: Session, campo_id: int, empresa_id: int):
    return (
        db.query(models.CampoProposta)
        .filter(models.CampoProposta.id == campo_id)
        .filter(models.CampoProposta.empresa_id == empresa_id)
        .first()
    )


@router.get("", response_model=List[CampoPropostaOut])
def listar_campos_propostas(
    request: Request,
    somente_ativos: bool = False,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    q = (
        db.query(models.CampoProposta)
        .filter(models.CampoProposta.empresa_id == empresa_id)
    )

    if somente_ativos:
        q = q.filter(models.CampoProposta.ativo == True)  # noqa: E712

    rows = q.order_by(models.CampoProposta.ordem.asc(), models.CampoProposta.id.asc()).all()
    return [campo_to_out(c) for c in rows]


@router.post("", response_model=CampoPropostaOut, status_code=status.HTTP_201_CREATED)
def criar_campo_proposta(
    payload: CampoPropostaCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    nome = (payload.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=422, detail="Nome é obrigatório.")

    tipo = norm_tipo(payload.tipo)
    slug = slugify(payload.slug or nome)

    row = models.CampoProposta(
        empresa_id=empresa_id,
        nome=nome,
        slug=slug,
        tipo=tipo,
        obrigatorio=payload.obrigatorio,
        ativo=payload.ativo,
        opcoes_json=dump_opcoes_json(payload.opcoes),
        ordem=int(payload.ordem or 0),
    )

    try:
        db.add(row)
        db.commit()
        db.refresh(row)
        return campo_to_out(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse slug.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar campo: {e}")


@router.put("/{campo_id}", response_model=CampoPropostaOut)
def atualizar_campo_proposta(
    campo_id: int,
    payload: CampoPropostaUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    row = buscar_campo_empresa(db, campo_id, empresa_id)

    if not row:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")

    fields_set = get_fields_set(payload)

    if "nome" in fields_set and payload.nome is not None:
        nome = payload.nome.strip()
        if not nome:
            raise HTTPException(status_code=422, detail="Nome inválido.")
        row.nome = nome

    if "slug" in fields_set:
        row.slug = slugify(payload.slug or row.nome)

    if "tipo" in fields_set and payload.tipo is not None:
        row.tipo = norm_tipo(payload.tipo)

    if "obrigatorio" in fields_set and payload.obrigatorio is not None:
        row.obrigatorio = payload.obrigatorio

    if "ativo" in fields_set and payload.ativo is not None:
        row.ativo = payload.ativo

    if "opcoes" in fields_set:
        row.opcoes_json = dump_opcoes_json(payload.opcoes)

    if "ordem" in fields_set and payload.ordem is not None:
        row.ordem = int(payload.ordem)

    try:
        db.commit()
        db.refresh(row)
        return campo_to_out(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse slug.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar campo: {e}")


@router.delete("/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo_proposta(
    campo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    row = buscar_campo_empresa(db, campo_id, empresa_id)

    if not row:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")

    db.delete(row)
    db.commit()
    return None