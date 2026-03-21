# backend/routers/propostas.py
from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/propostas", tags=["Propostas"])

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

def norm_str(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip()
    return v or None

# =========================================================
# AUTH VIA COOKIE (COM BYPASS)
# =========================================================
def validar_usuario_empresa(request: Request, db: Session) -> int:
    # ========================================================
    # 🚧 BYPASS TEMPORÁRIO PARA TESTES DO FRONTEND 🚧
    # Retorna Empresa 1 para evitar o erro 401 Unauthorized
    # ========================================================
    return 1

def gerar_codigo_proposta(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(models.Proposta)
        .filter(models.Proposta.empresa_id == empresa_id)
        .order_by(models.Proposta.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"PROP-{proximo:04d}"

class PropostaItemIn(BaseModel):
    id: Optional[int] = None
    produto_id: Optional[int] = None
    origem: Optional[str] = "manual"
    codigo: Optional[str] = None
    descricao: str
    unidade: Optional[str] = None
    quantidade: Optional[str] = None
    valor_unitario: Optional[str] = None
    valor_total: Optional[str] = None
    observacao: Optional[str] = None
    ordem: Optional[int] = 0

class PropostaItemOut(PropostaItemIn, _Cfg):
    id: int

class PropostaBase(BaseModel):
    codigo: Optional[str] = None
    cliente_id: Optional[int] = None
    titulo: Optional[str] = None
    status: Optional[str] = "rascunho"
    modelo: Optional[str] = None
    observacoes: Optional[str] = None
    validade_dias: Optional[str] = None
    subtotal: Optional[str] = None
    desconto: Optional[str] = None
    total: Optional[str] = None

class PropostaCreate(PropostaBase):
    titulo: str
    itens: List[PropostaItemIn] = []

class PropostaUpdate(PropostaBase):
    itens: Optional[List[PropostaItemIn]] = None

class PropostaOut(PropostaBase, _Cfg):
    id: int
    empresa_id: int
    cliente_nome: Optional[str] = None
    itens: List[PropostaItemOut] = []

def item_to_out(i: models.PropostaItem) -> PropostaItemOut:
    return PropostaItemOut(
        id=int(i.id),
        produto_id=i.produto_id,
        origem=i.origem or "manual",
        codigo=i.codigo,
        descricao=i.descricao,
        unidade=i.unidade,
        quantidade=i.quantidade,
        valor_unitario=i.valor_unitario,
        valor_total=i.valor_total,
        observacao=i.observacao,
        ordem=int(i.ordem or 0),
    )

def buscar_proposta_empresa(db: Session, proposta_id: int, empresa_id: int):
    return (
        db.query(models.Proposta)
        .filter(models.Proposta.id == proposta_id)
        .filter(models.Proposta.empresa_id == empresa_id)
        .first()
    )

def listar_itens_proposta(db: Session, proposta_id: int):
    rows = (
        db.query(models.PropostaItem)
        .filter(models.PropostaItem.proposta_id == proposta_id)
        .order_by(models.PropostaItem.ordem.asc(), models.PropostaItem.id.asc())
        .all()
    )
    return [item_to_out(i) for i in rows]

def salvar_itens_proposta(db: Session, proposta_id: int, itens: List[PropostaItemIn]):
    db.query(models.PropostaItem).filter(
        models.PropostaItem.proposta_id == proposta_id
    ).delete()

    for idx, item in enumerate(itens):
        row = models.PropostaItem(
            proposta_id=proposta_id,
            produto_id=item.produto_id,
            origem=norm_str(item.origem) or "manual",
            codigo=norm_str(item.codigo),
            descricao=item.descricao.strip(),
            unidade=norm_str(item.unidade),
            quantidade=norm_str(item.quantidade),
            valor_unitario=norm_str(item.valor_unitario),
            valor_total=norm_str(item.valor_total),
            observacao=norm_str(item.observacao),
            ordem=int(item.ordem if item.ordem is not None else idx),
        )
        db.add(row)

def proposta_to_out(db: Session, p: models.Proposta) -> PropostaOut:
    cliente_nome = None
    if p.cliente_id:
        cliente = db.query(models.Cliente).filter(
            models.Cliente.id == p.cliente_id
        ).first()
        if cliente:
            cliente_nome = getattr(cliente, "nome", None)

    return PropostaOut(
        id=int(p.id),
        empresa_id=int(p.empresa_id),
        codigo=p.codigo or "",
        cliente_id=p.cliente_id,
        titulo=p.titulo or "",
        status=p.status or "rascunho",
        modelo=p.modelo,
        observacoes=p.observacoes,
        validade_dias=p.validade_dias,
        subtotal=p.subtotal,
        desconto=p.desconto,
        total=p.total,
        cliente_nome=cliente_nome,
        itens=listar_itens_proposta(db, int(p.id)),
    )

@router.get("", response_model=List[PropostaOut])
def listar_propostas(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    rows = db.query(models.Proposta).filter(models.Proposta.empresa_id == empresa_id).order_by(models.Proposta.id.desc()).all()
    return [proposta_to_out(db, p) for p in rows]

@router.get("/{proposta_id}", response_model=PropostaOut)
def obter_proposta(proposta_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    p = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return proposta_to_out(db, p)

@router.post("", response_model=PropostaOut, status_code=status.HTTP_201_CREATED)
def criar_proposta(payload: PropostaCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = (payload.codigo or "").strip() or gerar_codigo_proposta(db, empresa_id)

    p = models.Proposta(
        empresa_id=empresa_id,
        cliente_id=payload.cliente_id,
        codigo=codigo,
        titulo=payload.titulo.strip(),
        status=norm_str(payload.status) or "rascunho",
        modelo=norm_str(payload.modelo),
        observacoes=norm_str(payload.observacoes),
        validade_dias=norm_str(payload.validade_dias),
        subtotal=norm_str(payload.subtotal),
        desconto=norm_str(payload.desconto),
        total=norm_str(payload.total),
    )
    try:
        db.add(p)
        db.flush()
        salvar_itens_proposta(db, int(p.id), payload.itens)
        db.commit()
        db.refresh(p)
        return proposta_to_out(db, p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar proposta: {e}")

@router.put("/{proposta_id}", response_model=PropostaOut)
def atualizar_proposta(proposta_id: int, payload: PropostaUpdate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    p = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not p: raise HTTPException(status_code=404, detail="Proposta não encontrada")

    if payload.codigo is not None and payload.codigo.strip(): p.codigo = payload.codigo.strip()
    if payload.cliente_id is not None: p.cliente_id = payload.cliente_id
    if payload.titulo is not None and payload.titulo.strip(): p.titulo = payload.titulo.strip()
    if payload.status is not None: p.status = norm_str(payload.status) or "rascunho"
    if payload.modelo is not None: p.modelo = norm_str(payload.modelo)
    if payload.observacoes is not None: p.observacoes = norm_str(payload.observacoes)
    if payload.validade_dias is not None: p.validade_dias = norm_str(payload.validade_dias)
    if payload.subtotal is not None: p.subtotal = norm_str(payload.subtotal)
    if payload.desconto is not None: p.desconto = norm_str(payload.desconto)
    if payload.total is not None: p.total = norm_str(payload.total)

    try:
        if payload.itens is not None:
            salvar_itens_proposta(db, int(p.id), payload.itens)
        db.commit()
        db.refresh(p)
        return proposta_to_out(db, p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar proposta: {e}")

@router.delete("/{proposta_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_proposta(proposta_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    p = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not p: raise HTTPException(status_code=404, detail="Proposta não encontrada")
    db.delete(p)
    db.commit()
    return None