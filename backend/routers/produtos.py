# /backend/routers/produtos.py
from __future__ import annotations

from datetime import datetime, date
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import String as SAString, cast, or_
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
# Helpers
# =========================================================
def parse_bool_ptbr(v: Any) -> Optional[bool]:
    """
    Aceita:
    - bool
    - "sim"/"não" (pt-BR)
    - "true"/"false"
    - "1"/"0"
    - "", None -> None
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return v

    s = str(v).strip().lower()
    if not s:
        return None

    if s in {"sim", "s", "true", "1", "yes", "y", "on"}:
        return True
    if s in {"nao", "não", "n", "false", "0", "no", "off"}:
        return False

    # se veio qualquer outra coisa, deixa None pra não “inventar”
    return None


def model_columns(model) -> set[str]:
    try:
        return set(model.__table__.columns.keys())  # type: ignore
    except Exception:
        # fallback
        return set(dir(model))


# =========================================================
# Pydantic Schemas (compat v1/v2)
# =========================================================
try:
    # Pydantic v2
    from pydantic import ConfigDict, field_validator  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)

    _USE_V2 = True
except Exception:
    # Pydantic v1
    from pydantic import validator  # type: ignore

    class _Cfg:
        class Config:
            orm_mode = True

    _USE_V2 = False


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

    # SITUAÇÃO (strings no front)
    status_atual: Optional[str] = Field(default=None, max_length=60)
    tipo_mercado: Optional[str] = Field(default=None, max_length=60)
    utilizacao: Optional[str] = Field(default=None, max_length=80)
    tipo_material: Optional[str] = Field(default=None, max_length=80)

    # CLASSIFICAÇÃO
    # ✅ aceita "Sim/Não" vindos do front e converte pra bool
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
    ultimo_fornecedor: Optional[str] = Field(default=None, max_length=120)

    # DADOS LOGÍSTICO
    tipo_armaz: Optional[str] = Field(default=None, max_length=30)
    armaz_localiz: Optional[str] = Field(default=None, max_length=60)
    armaz_predio: Optional[str] = Field(default=None, max_length=30)
    armaz_corredor: Optional[str] = Field(default=None, max_length=30)
    armaz_prateleira: Optional[str] = Field(default=None, max_length=30)

    tipo_logistico: Optional[str] = Field(default=None, max_length=30)
    peso_logistico: Optional[float] = None
    peso_logistico_unidade: Optional[str] = Field(default=None, max_length=12)
    tamanho_logistico: Optional[str] = Field(default=None, max_length=60)
    embalagem_compra: Optional[str] = Field(default=None, max_length=60)
    embalagem_armazem: Optional[str] = Field(default=None, max_length=60)
    embalagem_saida: Optional[str] = Field(default=None, max_length=60)
    estoque_minimo: Optional[int] = None
    estoque_maximo: Optional[int] = None
    quantidade_atual: Optional[int] = None

    # DADOS TÉCNICOS
    # ✅ aceita "Sim/Não" vindos do front e converte pra bool
    possui_validade: Optional[bool] = None
    tipo_tecnico: Optional[str] = Field(default=None, max_length=60)
    cores_disponiveis: Optional[str] = None
    imagens_produto: Optional[str] = None
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

    # MOVIMENTAÇÕES (opcional: só salva se existir coluna no model)
    movimentacoes: Optional[List[Dict[str, Any]]] = None

    # ====== validators compat ======
    if _USE_V2:
        @field_validator("prod_controlado", "possui_validade", mode="before")  # type: ignore
        @classmethod
        def _v_parse_bool(cls, v):
            return parse_bool_ptbr(v)
    else:
        @validator("prod_controlado", "possui_validade", pre=True)  # type: ignore
        def _v_parse_bool(cls, v):
            return parse_bool_ptbr(v)


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


def _clean_payload_for_model(data: dict) -> dict:
    """
    Remove campos que não existem no SQLAlchemy model,
    evitando erro: __init__ got an unexpected keyword argument.
    """
    cols = model_columns(models.Produto)

    # remove quaisquer chaves que o model não tem
    data = {k: v for k, v in (data or {}).items() if k in cols or hasattr(models.Produto, k)}

    # movimentacoes é opcional (só salva se existir no model)
    if not hasattr(models.Produto, "movimentacoes"):
        data.pop("movimentacoes", None)

    # Se segmentos/fornecedores forem None, deixa o default do banco (se existir)
    if data.get("segmentos") is None:
        data.pop("segmentos", None)
    if data.get("fornecedores") is None:
        data.pop("fornecedores", None)

    return data


# =========================================================
# CRUD
# =========================================================
@router.get("", response_model=List[ProdutoOut])
def listar_produtos(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None, description="Busca geral"),
    origem: Optional[str] = Query(default=None),
    fornecedor: Optional[str] = Query(default=None),
    status_atual: Optional[str] = Query(default=None),
    tipo_mercado: Optional[str] = Query(default=None),
    utilizacao: Optional[str] = Query(default=None),
    tipo_material: Optional[str] = Query(default=None),
    prod_controlado: Optional[bool] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
):
    query = db.query(models.Produto)

    if origem:
        query = query.filter(models.Produto.origem == origem)

    if fornecedor:
        query = query.filter(models.Produto.fornecedor == fornecedor)

    if status_atual:
        query = query.filter(models.Produto.status_atual == status_atual)

    if tipo_mercado:
        query = query.filter(models.Produto.tipo_mercado == tipo_mercado)

    if utilizacao:
        query = query.filter(models.Produto.utilizacao == utilizacao)

    if tipo_material:
        query = query.filter(models.Produto.tipo_material == tipo_material)

    if prod_controlado is not None:
        query = query.filter(models.Produto.prod_controlado == prod_controlado)

    if q:
        like = f"%{q.strip()}%"

        clauses = [
            models.Produto.nome_produto.ilike(like),
            models.Produto.nome_generico.ilike(like),
            models.Produto.cod_ref_id.ilike(like),
            models.Produto.codigo_barras.ilike(like),
            models.Produto.fabricante.ilike(like),
            models.Produto.modelo.ilike(like),
            models.Produto.cod_ref_fabric.ilike(like),
            models.Produto.origem.ilike(like),
            models.Produto.tipo_sistema.ilike(like),
            models.Produto.classe.ilike(like),
            models.Produto.categorias.ilike(like),
            models.Produto.subcategoria.ilike(like),
            models.Produto.fornecedor.ilike(like),
            models.Produto.tipo_armaz.ilike(like),
            models.Produto.armaz_localiz.ilike(like),
            models.Produto.tipo_logistico.ilike(like),
            models.Produto.tipo_tecnico.ilike(like),
            models.Produto.cores_disponiveis.ilike(like),
            models.Produto.classif_ncm_bbm.ilike(like),
        ]

        # JSON / array: cast pra texto (se existir no model)
        if hasattr(models.Produto, "segmentos"):
            clauses.append(cast(models.Produto.segmentos, SAString).ilike(like))
        if hasattr(models.Produto, "ultima_compra"):
            clauses.append(cast(models.Produto.ultima_compra, SAString).ilike(like))

        query = query.filter(or_(*clauses))

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
    data = _clean_payload_for_model(data)

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
def atualizar_produto(produto_id: int, payload: ProdutoUpdate, db: Session = Depends(get_db)):
    produto = db.query(models.Produto).filter(models.Produto.id == produto_id).first()
    if not produto:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    data = _clean_payload_for_model(data)

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

    data = (
        payload.model_dump(exclude_unset=True)
        if hasattr(payload, "model_dump")
        else payload.dict(exclude_unset=True)
    )
    data = _clean_payload_for_model(data)

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
