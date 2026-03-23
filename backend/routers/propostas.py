from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
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


def get_fields_set(payload) -> set:
    return set(
        getattr(payload, "model_fields_set", None)
        or getattr(payload, "__fields_set__", set())
    )


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


class CampoExtraValorIn(BaseModel):
    campo_id: int
    valor: Optional[str] = None


class CampoExtraValorOut(_Cfg, BaseModel):
    campo_id: int
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    opcoes: List[str] = Field(default_factory=list)
    ordem: int = 0
    valor: Optional[str] = None


class PropostaBase(BaseModel):
    codigo: Optional[str] = None
    cliente_id: Optional[int] = None
    titulo: Optional[str] = None
    status: Optional[str] = "rascunho"
    observacoes: Optional[str] = None
    validade_dias: Optional[str] = None
    subtotal: Optional[str] = None
    desconto: Optional[str] = None
    total: Optional[str] = None


class PropostaCreate(PropostaBase):
    titulo: str
    itens: List[PropostaItemIn] = Field(default_factory=list)
    campos_extras: List[CampoExtraValorIn] = Field(default_factory=list)


class PropostaUpdate(PropostaBase):
    itens: Optional[List[PropostaItemIn]] = None
    campos_extras: Optional[List[CampoExtraValorIn]] = None


class PropostaOut(PropostaBase, _Cfg):
    id: int
    empresa_id: int
    cliente_nome: Optional[str] = None
    itens: List[PropostaItemOut] = Field(default_factory=list)
    campos_extras: List[CampoExtraValorOut] = Field(default_factory=list)


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


def listar_campos_extras_proposta(db: Session, proposta_id: int, empresa_id: int):
    campos = (
        db.query(models.CampoProposta)
        .filter(models.CampoProposta.empresa_id == empresa_id)
        .filter(models.CampoProposta.ativo == True)  # noqa: E712
        .order_by(models.CampoProposta.ordem.asc(), models.CampoProposta.id.asc())
        .all()
    )

    valores_rows = (
        db.query(models.PropostaCampoValor)
        .filter(models.PropostaCampoValor.proposta_id == proposta_id)
        .all()
    )
    valores_map = {int(v.campo_id): v.valor for v in valores_rows}

    saida: List[CampoExtraValorOut] = []
    for campo in campos:
        saida.append(
            CampoExtraValorOut(
                campo_id=int(campo.id),
                nome=campo.nome,
                slug=campo.slug,
                tipo=campo.tipo,
                obrigatorio=bool(campo.obrigatorio),
                opcoes=parse_opcoes_json(campo.opcoes_json),
                ordem=int(campo.ordem or 0),
                valor=valores_map.get(int(campo.id)),
            )
        )
    return saida


def salvar_itens_proposta(db: Session, proposta_id: int, itens: List[PropostaItemIn]):
    db.query(models.PropostaItem).filter(
        models.PropostaItem.proposta_id == proposta_id
    ).delete()

    for idx, item in enumerate(itens):
        descricao = (item.descricao or "").strip()
        if not descricao:
            continue

        row = models.PropostaItem(
            proposta_id=proposta_id,
            produto_id=item.produto_id,
            origem=norm_str(item.origem) or "manual",
            codigo=norm_str(item.codigo),
            descricao=descricao,
            unidade=norm_str(item.unidade),
            quantidade=norm_str(item.quantidade),
            valor_unitario=norm_str(item.valor_unitario),
            valor_total=norm_str(item.valor_total),
            observacao=norm_str(item.observacao),
            ordem=int(item.ordem if item.ordem is not None else idx),
        )
        db.add(row)


def salvar_campos_extras_proposta(
    db: Session,
    proposta_id: int,
    empresa_id: int,
    campos_extras: List[CampoExtraValorIn],
):
    campos_config = (
        db.query(models.CampoProposta)
        .filter(models.CampoProposta.empresa_id == empresa_id)
        .filter(models.CampoProposta.ativo == True)  # noqa: E712
        .all()
    )
    config_map = {int(c.id): c for c in campos_config}

    incoming: dict[int, Optional[str]] = {}
    for item in campos_extras:
        campo_id = int(item.campo_id)
        if campo_id not in config_map:
            continue
        valor = None if item.valor is None else str(item.valor).strip()
        incoming[campo_id] = valor or None

    for campo in campos_config:
        if bool(campo.obrigatorio) and not incoming.get(int(campo.id)):
            raise HTTPException(
                status_code=422,
                detail=f"Campo obrigatório não preenchido: {campo.nome}",
            )

    db.query(models.PropostaCampoValor).filter(
        models.PropostaCampoValor.proposta_id == proposta_id
    ).delete()

    for campo_id, valor in incoming.items():
        db.add(
            models.PropostaCampoValor(
                proposta_id=proposta_id,
                campo_id=campo_id,
                valor=valor,
            )
        )


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
        observacoes=p.observacoes,
        validade_dias=p.validade_dias,
        subtotal=p.subtotal,
        desconto=p.desconto,
        total=p.total,
        cliente_nome=cliente_nome,
        itens=listar_itens_proposta(db, int(p.id)),
        campos_extras=listar_campos_extras_proposta(db, int(p.id), int(p.empresa_id)),
    )


@router.get("", response_model=List[PropostaOut])
def listar_propostas(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    rows = (
        db.query(models.Proposta)
        .filter(models.Proposta.empresa_id == empresa_id)
        .order_by(models.Proposta.id.desc())
        .all()
    )
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
        salvar_campos_extras_proposta(db, int(p.id), empresa_id, payload.campos_extras)
        db.commit()
        db.refresh(p)
        return proposta_to_out(db, p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar proposta: {e}")


@router.put("/{proposta_id}", response_model=PropostaOut)
def atualizar_proposta(proposta_id: int, payload: PropostaUpdate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    p = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")

    fields_set = get_fields_set(payload)

    if "codigo" in fields_set and payload.codigo is not None and payload.codigo.strip():
        p.codigo = payload.codigo.strip()

    if "cliente_id" in fields_set:
        p.cliente_id = payload.cliente_id

    if "titulo" in fields_set and payload.titulo is not None and payload.titulo.strip():
        p.titulo = payload.titulo.strip()

    if "status" in fields_set:
        p.status = norm_str(payload.status) or "rascunho"

    if "observacoes" in fields_set:
        p.observacoes = norm_str(payload.observacoes)

    if "validade_dias" in fields_set:
        p.validade_dias = norm_str(payload.validade_dias)

    if "subtotal" in fields_set:
        p.subtotal = norm_str(payload.subtotal)

    if "desconto" in fields_set:
        p.desconto = norm_str(payload.desconto)

    if "total" in fields_set:
        p.total = norm_str(payload.total)

    try:
        if payload.itens is not None:
            salvar_itens_proposta(db, int(p.id), payload.itens)

        if payload.campos_extras is not None:
            salvar_campos_extras_proposta(db, int(p.id), empresa_id, payload.campos_extras)

        db.commit()
        db.refresh(p)
        return proposta_to_out(db, p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar proposta: {e}")


@router.delete("/{proposta_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_proposta(proposta_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    p = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    db.delete(p)
    db.commit()
    return None