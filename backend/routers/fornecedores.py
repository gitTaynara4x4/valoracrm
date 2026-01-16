# backend/routers/fornecedores.py
from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend import models

router = APIRouter(prefix="/api/fornecedores", tags=["Fornecedores"])


# =========================
# Helpers
# =========================
def only_digits(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    d = "".join(ch for ch in s if ch.isdigit())
    return d or None


def norm_str(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip()
    return v or None


def norm_upper(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip().upper()
    return v or None


def date_to_dt_utc(d: Optional[date]) -> Optional[datetime]:
    if not d:
        return None
    return datetime.combine(d, time.min).replace(tzinfo=timezone.utc)


def gerar_codigo_fornecedor(db: Session) -> str:
    ultimo = db.query(models.Fornecedor).order_by(models.Fornecedor.id.desc()).first()
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"FOR-{proximo:04d}"


# =========================
# Schemas
# =========================
class FornecedorBase(BaseModel):
    data_cadastro: Optional[date] = None
    tipo: Optional[str] = None  # 'pf' | 'pj'
    nome: Optional[str] = None  # Nome identificação (Fornecedor)

    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None

    cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    end_pais: Optional[str] = None

    pessoa_contato: Optional[str] = None

    telefone_pabx: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None

    home_page: Optional[str] = None
    email_principal: Optional[str] = None
    redes_sociais: Optional[Dict[str, Any]] = None

    codigo: Optional[str] = None

    tipo_categoria: Optional[str] = None

    contato_representante_comercial: Optional[str] = None
    representante_telefone_whatsapp: Optional[str] = None
    representante_telefone_ramal: Optional[str] = None

    limite_creditos: Optional[Decimal] = None
    opcao_transportadoras_fretes: Optional[str] = None

    # Linha de produtos (texto) + RMA
    linha_produtos: Optional[str] = None
    contato_rma: Optional[str] = None
    informacoes_rma: Optional[str] = None

    # ✅ opcional: se existir na sua tabela, vai salvar/ler
    linha_produtos_ids: Optional[List[int]] = None


class FornecedorCreate(FornecedorBase):
    tipo: str
    nome: str


class FornecedorUpdate(FornecedorBase):
    pass


class FornecedorOut(BaseModel):
    id: int
    nome: str

    data_cadastro: datetime
    tipo: str

    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None

    cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    end_pais: Optional[str] = None

    pessoa_contato: Optional[str] = None
    telefone_pabx: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None

    home_page: Optional[str] = None
    email_principal: Optional[str] = None
    redes_sociais: Optional[Dict[str, Any]] = None

    codigo: str
    tipo_categoria: Optional[str] = None

    contato_representante_comercial: Optional[str] = None
    representante_telefone_whatsapp: Optional[str] = None
    representante_telefone_ramal: Optional[str] = None

    limite_creditos: Optional[Decimal] = None
    opcao_transportadoras_fretes: Optional[str] = None

    linha_produtos: Optional[str] = None
    contato_rma: Optional[str] = None
    informacoes_rma: Optional[str] = None

    # ✅ se existir no model
    linha_produtos_ids: Optional[List[int]] = None

    class Config:
        orm_mode = True


def fornecedor_to_out(f: models.Fornecedor) -> FornecedorOut:
    return FornecedorOut(
        id=int(f.id),
        nome=f.nome_identificacao,

        data_cadastro=f.data_cadastro,
        tipo=f.tipo_fornecedor,

        razao_social=f.razao_social,
        cnpj=f.cnpj,
        inscricao_estadual=f.inscricao_estadual,
        inscricao_municipal=f.inscricao_municipal,

        cep=f.end_cep,
        endereco_logradouro=f.end_rua,
        endereco_numero=f.end_numero,
        endereco_bairro=f.end_bairro,
        cidade=f.end_cidade,
        uf=f.end_estado,
        end_pais=f.end_pais,

        pessoa_contato=f.pessoa_contato,
        telefone_pabx=getattr(f, "telefone_pabx", None),
        telefone=getattr(f, "telefone", None),
        whatsapp=f.whatsapp_contato or f.whatsapp_principal,

        home_page=f.home_page,
        email_principal=f.email_principal,
        redes_sociais=f.redes_sociais,

        codigo=f.codigo_cadastro_fornecedor,
        tipo_categoria=getattr(f, "tipo_categoria", None),

        contato_representante_comercial=getattr(f, "contato_representante_comercial", None),
        representante_telefone_whatsapp=getattr(f, "representante_telefone_whatsapp", None),
        representante_telefone_ramal=getattr(f, "representante_telefone_ramal", None),

        limite_creditos=getattr(f, "limite_creditos", None),
        opcao_transportadoras_fretes=getattr(f, "opcao_transportadoras_fretes", None),

        linha_produtos=getattr(f, "linha_produtos", None),
        contato_rma=getattr(f, "contato_rma", None),
        informacoes_rma=getattr(f, "informacoes_rma", None),

        linha_produtos_ids=getattr(f, "linha_produtos_ids", None),
    )


# =========================
# Endpoints
# =========================
@router.get("", response_model=List[FornecedorOut])
@router.get("/", response_model=List[FornecedorOut], include_in_schema=False)
def listar_fornecedores(db: Session = Depends(get_db)):
    rows = db.query(models.Fornecedor).order_by(models.Fornecedor.nome_identificacao.asc()).all()
    return [fornecedor_to_out(f) for f in rows]


@router.get("/{fornecedor_id}", response_model=FornecedorOut)
@router.get("/{fornecedor_id}/", response_model=FornecedorOut, include_in_schema=False)
def obter_fornecedor(fornecedor_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Fornecedor).filter(models.Fornecedor.id == fornecedor_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return fornecedor_to_out(f)


@router.post("", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def criar_fornecedor(payload: FornecedorCreate, db: Session = Depends(get_db)):
    codigo = (payload.codigo or "").strip() or gerar_codigo_fornecedor(db)

    f = models.Fornecedor(
        codigo_cadastro_fornecedor=codigo,
        tipo_fornecedor=payload.tipo,
        nome_identificacao=payload.nome,

        razao_social=norm_str(payload.razao_social),
        cnpj=norm_str(payload.cnpj),
        inscricao_estadual=norm_str(payload.inscricao_estadual),
        inscricao_municipal=norm_str(payload.inscricao_municipal),

        end_cep=only_digits(payload.cep),
        end_rua=norm_str(payload.endereco_logradouro),
        end_numero=norm_str(payload.endereco_numero),
        end_bairro=norm_str(payload.endereco_bairro),
        end_cidade=norm_str(payload.cidade),
        end_estado=norm_upper(payload.uf),
        end_pais=norm_upper(payload.end_pais) or "BR",

        pessoa_contato=norm_str(payload.pessoa_contato),
        whatsapp_contato=norm_str(payload.whatsapp),
        whatsapp_principal=None,

        telefone_pabx=norm_str(payload.telefone_pabx),
        telefone=norm_str(payload.telefone),

        home_page=norm_str(payload.home_page),
        email_principal=norm_str(payload.email_principal),
        redes_sociais=payload.redes_sociais,

        tipo_categoria=norm_str(payload.tipo_categoria),
        contato_representante_comercial=norm_str(payload.contato_representante_comercial),
        representante_telefone_whatsapp=norm_str(payload.representante_telefone_whatsapp),
        representante_telefone_ramal=norm_str(payload.representante_telefone_ramal),

        limite_creditos=payload.limite_creditos,
        opcao_transportadoras_fretes=norm_str(payload.opcao_transportadoras_fretes),

        linha_produtos=norm_str(payload.linha_produtos),
        contato_rma=norm_str(payload.contato_rma),
        informacoes_rma=norm_str(payload.informacoes_rma),
    )

    # ✅ se existir na sua model/tabela, salva lista de ids
    if hasattr(f, "linha_produtos_ids") and payload.linha_produtos_ids is not None:
        setattr(f, "linha_produtos_ids", payload.linha_produtos_ids)

    dt = date_to_dt_utc(payload.data_cadastro)
    if dt:
        f.data_cadastro = dt

    try:
        db.add(f)
        db.commit()
        db.refresh(f)
        return fornecedor_to_out(f)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de fornecedor já existe.")


@router.put("/{fornecedor_id}", response_model=FornecedorOut)
@router.put("/{fornecedor_id}/", response_model=FornecedorOut, include_in_schema=False)
def atualizar_fornecedor(fornecedor_id: int, payload: FornecedorUpdate, db: Session = Depends(get_db)):
    f = db.query(models.Fornecedor).filter(models.Fornecedor.id == fornecedor_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")

    if payload.codigo is not None and payload.codigo.strip():
        f.codigo_cadastro_fornecedor = payload.codigo.strip()

    if payload.data_cadastro is not None:
        dt = date_to_dt_utc(payload.data_cadastro)
        if dt:
            f.data_cadastro = dt

    if payload.tipo is not None and payload.tipo.strip():
        f.tipo_fornecedor = payload.tipo.strip()

    if payload.nome is not None and payload.nome.strip():
        f.nome_identificacao = payload.nome.strip()

    if payload.razao_social is not None:
        f.razao_social = norm_str(payload.razao_social)
    if payload.cnpj is not None:
        f.cnpj = norm_str(payload.cnpj)
    if payload.inscricao_estadual is not None:
        f.inscricao_estadual = norm_str(payload.inscricao_estadual)
    if payload.inscricao_municipal is not None:
        f.inscricao_municipal = norm_str(payload.inscricao_municipal)

    if payload.cep is not None:
        f.end_cep = only_digits(payload.cep)
    if payload.endereco_logradouro is not None:
        f.end_rua = norm_str(payload.endereco_logradouro)
    if payload.endereco_numero is not None:
        f.end_numero = norm_str(payload.endereco_numero)
    if payload.endereco_bairro is not None:
        f.end_bairro = norm_str(payload.endereco_bairro)
    if payload.cidade is not None:
        f.end_cidade = norm_str(payload.cidade)
    if payload.uf is not None:
        f.end_estado = norm_upper(payload.uf)
    if payload.end_pais is not None:
        f.end_pais = norm_upper(payload.end_pais) or "BR"

    if payload.pessoa_contato is not None:
        f.pessoa_contato = norm_str(payload.pessoa_contato)
    if payload.whatsapp is not None:
        f.whatsapp_contato = norm_str(payload.whatsapp)

    if payload.telefone_pabx is not None:
        f.telefone_pabx = norm_str(payload.telefone_pabx)
    if payload.telefone is not None:
        f.telefone = norm_str(payload.telefone)

    if payload.home_page is not None:
        f.home_page = norm_str(payload.home_page)
    if payload.email_principal is not None:
        f.email_principal = norm_str(payload.email_principal)
    if payload.redes_sociais is not None:
        f.redes_sociais = payload.redes_sociais

    if payload.tipo_categoria is not None:
        f.tipo_categoria = norm_str(payload.tipo_categoria)

    if payload.contato_representante_comercial is not None:
        f.contato_representante_comercial = norm_str(payload.contato_representante_comercial)
    if payload.representante_telefone_whatsapp is not None:
        f.representante_telefone_whatsapp = norm_str(payload.representante_telefone_whatsapp)
    if payload.representante_telefone_ramal is not None:
        f.representante_telefone_ramal = norm_str(payload.representante_telefone_ramal)

    if payload.limite_creditos is not None:
        f.limite_creditos = payload.limite_creditos

    if payload.opcao_transportadoras_fretes is not None:
        f.opcao_transportadoras_fretes = norm_str(payload.opcao_transportadoras_fretes)

    if payload.linha_produtos is not None:
        f.linha_produtos = norm_str(payload.linha_produtos)
    if payload.contato_rma is not None:
        f.contato_rma = norm_str(payload.contato_rma)
    if payload.informacoes_rma is not None:
        f.informacoes_rma = norm_str(payload.informacoes_rma)

    # ✅ se existir na sua model/tabela, atualiza lista de ids
    if hasattr(f, "linha_produtos_ids") and payload.linha_produtos_ids is not None:
        setattr(f, "linha_produtos_ids", payload.linha_produtos_ids)

    try:
        db.commit()
        db.refresh(f)
        return fornecedor_to_out(f)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de fornecedor já existe.")


@router.delete("/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{fornecedor_id}/", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def excluir_fornecedor(fornecedor_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Fornecedor).filter(models.Fornecedor.id == fornecedor_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    db.delete(f)
    db.commit()
    return None
