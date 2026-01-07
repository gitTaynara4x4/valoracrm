# /backend/routers/produtos.py
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models


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
# Pydantic Schemas
# =========================================================
try:
    # Pydantic v2
    from pydantic import ConfigDict  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)

except Exception:
    # Pydantic v1
    class _Cfg:
        class Config:
            orm_mode = True


class ProdutoBase(BaseModel):
    # Identificação
    cod_ref_id: Optional[str] = Field(default=None, max_length=50)
    codigo_barras: Optional[str] = Field(default=None, max_length=50)
    nome_generico: Optional[str] = Field(default=None, max_length=200)
    nome_produto: Optional[str] = None  # text
    fabricante: Optional[str] = Field(default=None, max_length=80)
    modelo: Optional[str] = Field(default=None, max_length=100)
    cod_ref_fabric: Optional[str] = Field(default=None, max_length=50)
    origem: Optional[str] = Field(default=None, max_length=30)

    # SITUAÇÃO (códigos)
    status_atual: Optional[int] = Field(default=None, ge=1, le=4)   # 1..4
    tipo_mercado: Optional[int] = Field(default=None, ge=1, le=2)   # 1..2
    utilizacao: Optional[int] = Field(default=None, ge=1, le=4)     # 1..4
    tipo_material: Optional[int] = Field(default=None, ge=1, le=3)  # 1..3

    # CLASSIFICAÇÃO (novos)
    prod_controlado: Optional[bool] = None
    segmentos: Optional[str] = Field(default=None, max_length=120)
    tipo_sistema: Optional[str] = Field(default=None, max_length=120)
    classe: Optional[str] = Field(default=None, max_length=120)
    categorias: Optional[str] = Field(default=None, max_length=120)
    subcategoria: Optional[str] = Field(default=None, max_length=120)


class ProdutoCreate(ProdutoBase):
    nome_produto: str = Field(..., min_length=1)


class ProdutoUpdate(ProdutoBase):
    pass


class ProdutoOut(ProdutoBase, _Cfg):
    id: int
    data_cadastro: datetime


# =========================================================
# Router
# =========================================================
router = APIRouter(prefix="/api/produtos", tags=["Produtos"])


# =========================================================
# CRUD
# =========================================================
@router.get("", response_model=List[ProdutoOut])
def listar_produtos(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None, description="Busca geral (produto, ref, barras, fabricante, situação, classificação)"),
    origem: Optional[str] = Query(default=None),
    status_atual: Optional[int] = Query(default=None, ge=1, le=4),
    tipo_mercado: Optional[int] = Query(default=None, ge=1, le=2),
    utilizacao: Optional[int] = Query(default=None, ge=1, le=4),
    tipo_material: Optional[int] = Query(default=None, ge=1, le=3),
    prod_controlado: Optional[bool] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
):
    query = db.query(models.Produto)

    if origem:
        query = query.filter(models.Produto.origem == origem)

    if status_atual is not None:
        query = query.filter(models.Produto.status_atual == status_atual)

    if tipo_mercado is not None:
        query = query.filter(models.Produto.tipo_mercado == tipo_mercado)

    if utilizacao is not None:
        query = query.filter(models.Produto.utilizacao == utilizacao)

    if tipo_material is not None:
        query = query.filter(models.Produto.tipo_material == tipo_material)

    if prod_controlado is not None:
        query = query.filter(models.Produto.prod_controlado == prod_controlado)

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (models.Produto.nome_produto.ilike(like))
            | (models.Produto.nome_generico.ilike(like))
            | (models.Produto.cod_ref_id.ilike(like))
            | (models.Produto.codigo_barras.ilike(like))
            | (models.Produto.fabricante.ilike(like))
            | (models.Produto.modelo.ilike(like))
            | (models.Produto.cod_ref_fabric.ilike(like))
            | (models.Produto.origem.ilike(like))
            | (models.Produto.segmentos.ilike(like))
            | (models.Produto.tipo_sistema.ilike(like))
            | (models.Produto.classe.ilike(like))
            | (models.Produto.categorias.ilike(like))
            | (models.Produto.subcategoria.ilike(like))
        )

    itens = (
        query.order_by(models.Produto.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return itens


@router.get("/{produto_id}", response_model=ProdutoOut)
def obter_produto(produto_id: int, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    return produto


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_produto(payload: ProdutoCreate, db: Session = Depends(get_db)):
    produto = models.Produto(
        cod_ref_id=payload.cod_ref_id,
        codigo_barras=payload.codigo_barras,
        nome_generico=payload.nome_generico,
        nome_produto=payload.nome_produto,
        fabricante=payload.fabricante,
        modelo=payload.modelo,
        cod_ref_fabric=payload.cod_ref_fabric,
        origem=payload.origem,

        status_atual=payload.status_atual,
        tipo_mercado=payload.tipo_mercado,
        utilizacao=payload.utilizacao,
        tipo_material=payload.tipo_material,

        prod_controlado=payload.prod_controlado,
        segmentos=payload.segmentos,
        tipo_sistema=payload.tipo_sistema,
        classe=payload.classe,
        categorias=payload.categorias,
        subcategoria=payload.subcategoria,
    )

    db.add(produto)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Erro ao salvar (integridade).")
    db.refresh(produto)
    return produto


@router.put("/{produto_id}", response_model=ProdutoOut)
def atualizar_produto(produto_id: int, payload: ProdutoCreate, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    produto.cod_ref_id = payload.cod_ref_id
    produto.codigo_barras = payload.codigo_barras
    produto.nome_generico = payload.nome_generico
    produto.nome_produto = payload.nome_produto
    produto.fabricante = payload.fabricante
    produto.modelo = payload.modelo
    produto.cod_ref_fabric = payload.cod_ref_fabric
    produto.origem = payload.origem

    produto.status_atual = payload.status_atual
    produto.tipo_mercado = payload.tipo_mercado
    produto.utilizacao = payload.utilizacao
    produto.tipo_material = payload.tipo_material

    produto.prod_controlado = payload.prod_controlado
    produto.segmentos = payload.segmentos
    produto.tipo_sistema = payload.tipo_sistema
    produto.classe = payload.classe
    produto.categorias = payload.categorias
    produto.subcategoria = payload.subcategoria

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Erro ao salvar (integridade).")
    db.refresh(produto)
    return produto


@router.patch("/{produto_id}", response_model=ProdutoOut)
def patch_produto(produto_id: int, payload: ProdutoUpdate, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(produto, k, v)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Erro ao salvar (integridade).")
    db.refresh(produto)
    return produto


@router.delete("/{produto_id}")
def excluir_produto(produto_id: int, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    db.delete(produto)
    db.commit()
    return {"ok": True, "id": produto_id}
