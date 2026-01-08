# /backend/routers/produtos.py
from __future__ import annotations

from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import String as SAString, cast
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

    # CLASSIFICAÇÃO
    prod_controlado: Optional[bool] = None
    tipo_fiscalizacao: Optional[str] = Field(default=None, max_length=120)
    dados_identificacao_controlado: Optional[str] = None
    observacoes_controlado: Optional[str] = None
    segmentos: Optional[List[str]] = None
    tipo_sistema: Optional[str] = Field(default=None, max_length=120)
    classe: Optional[str] = Field(default=None, max_length=120)
    categorias: Optional[str] = Field(default=None, max_length=120)
    subcategoria: Optional[str] = Field(default=None, max_length=120)

    # DISTRIBUIDORES
    fornecedores: Optional[List[str]] = None
    fornecedor: Optional[str] = Field(default=None, max_length=120)
    ultima_compra: Optional[date] = None

    # DADOS LOGÍSTICO
    tipo_armaz: Optional[str] = Field(default=None, max_length=30)
    armaz_localiz: Optional[str] = Field(default=None, max_length=60)
    tipo_logistico: Optional[str] = Field(default=None, max_length=30)
    peso_logistico: Optional[float] = None
    tamanho_logistico: Optional[str] = Field(default=None, max_length=60)
    embalagem_compra: Optional[str] = Field(default=None, max_length=60)
    embalagem_armazem: Optional[str] = Field(default=None, max_length=60)
    embalagem_saida: Optional[str] = Field(default=None, max_length=60)
    estoque_minimo: Optional[int] = None
    estoque_maximo: Optional[int] = None
    quantidade_atual: Optional[int] = None

    # DADOS TÉCNICOS
    possui_validade: Optional[bool] = None
    tipo_tecnico: Optional[str] = Field(default=None, max_length=60)
    peso_tecnico: Optional[float] = None
    tamanho_tecnico: Optional[str] = Field(default=None, max_length=60)
    cores_disponiveis: Optional[str] = None  # texto livre
    imagens_produto: Optional[str] = None    # texto livre (links / nomes)
    videos_produto: Optional[str] = None
    fichas_tecnica: Optional[str] = None
    manuais_instalacao: Optional[str] = None
    manuais_programacao: Optional[str] = None
    manuais_usuario: Optional[str] = None

    # DADOS FISCAIS
    classif_ncm_bbm: Optional[str] = Field(default=None, max_length=30)
    aliq_ipi_entrada: Optional[float] = None
    aliq_iva: Optional[float] = None
    cst_icms: Optional[str] = Field(default=None, max_length=10)
    cst_pis: Optional[str] = Field(default=None, max_length=10)
    cst_cofins: Optional[str] = Field(default=None, max_length=10)

    # FORMAÇÃO DE PREÇO
    valor_custo: Optional[float] = None
    mark_up: Optional[float] = None
    custo_efetivo: Optional[float] = None
    mc_lucro: Optional[float] = None
    imp_importacao: Optional[float] = None
    ipi: Optional[float] = None
    icms: Optional[float] = None
    simples: Optional[float] = None
    luc_presumido: Optional[float] = None

    # HISTÓRICO
    entrada_estoque: Optional[int] = None
    saida_estoque: Optional[int] = None
    destino: Optional[str] = None  # text


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
    q: Optional[str] = Query(default=None, description="Busca geral"),
    origem: Optional[str] = Query(default=None),
    fornecedor: Optional[str] = Query(default=None),
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

    if fornecedor:
        query = query.filter(models.Produto.fornecedor == fornecedor)

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
            | (models.Produto.fornecedor.ilike(like))
            | (cast(models.Produto.ultima_compra, SAString).ilike(like))
            | (models.Produto.tipo_armaz.ilike(like))
            | (models.Produto.armaz_localiz.ilike(like))
            | (models.Produto.tipo_logistico.ilike(like))
            | (models.Produto.tipo_tecnico.ilike(like))
            | (models.Produto.cores_disponiveis.ilike(like))
            | (models.Produto.classif_ncm_bbm.ilike(like))
            | (models.Produto.destino.ilike(like))
        )

    itens = query.order_by(models.Produto.id.asc()).offset(offset).limit(limit).all()
    return itens


@router.get("/{produto_id}", response_model=ProdutoOut)
def obter_produto(produto_id: int, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")
    return produto


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_produto(payload: ProdutoCreate, db: Session = Depends(get_db)):
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    if data.get("segmentos") is None:
        data.pop("segmentos", None)  # usa default do banco
    if data.get("fornecedores") is None:
        data.pop("fornecedores", None)  # usa default do banco
    produto = models.Produto(**data)

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

    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    if data.get("segmentos") is None:
        data.pop("segmentos", None)
    if data.get("fornecedores") is None:
        data.pop("fornecedores", None)
    for k, v in data.items():
        setattr(produto, k, v)

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
    if data.get("segmentos") is None:
        data.pop("segmentos", None)
    if data.get("fornecedores") is None:
        data.pop("fornecedores", None)
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
