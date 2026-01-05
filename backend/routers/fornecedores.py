# backend/routers/fornecedores.py
from __future__ import annotations

from datetime import date, datetime, time, timezone
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


def build_onde_conheceu(onde: Optional[str], outro: Optional[str]) -> Optional[str]:
    onde = (onde or "").strip()
    outro = (outro or "").strip()
    if not onde and not outro:
        return None
    if onde == "outro" and outro:
        return f"outro: {outro}"
    return onde or outro or None


# =========================
# Schemas
# =========================
class FornecedorBase(BaseModel):
    # básico
    codigo: Optional[str] = None
    data_cadastro: Optional[date] = None
    tipo: Optional[str] = None  # pf | pj
    nome: Optional[str] = None
    whatsapp: Optional[str] = None

    # endereço
    cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None

    # perfil/origem
    tipo_imovel: Optional[str] = None
    onde_conheceu: Optional[str] = None
    onde_conheceu_outro: Optional[str] = None

    # avançados (no seu front só aparece no editar)
    pessoa_contato: Optional[str] = None
    whatsapp_principal: Optional[str] = None
    email_principal: Optional[str] = None
    end_pais: Optional[str] = None

    # PJ
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    cpf_responsavel_administrador: Optional[str] = None

    # PF
    rg: Optional[str] = None
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None

    # cobrança
    cep_cobranca: Optional[str] = None

    # web / redes
    home_page: Optional[str] = None
    redes_sociais: Optional[Dict[str, Any]] = None


class FornecedorCreate(FornecedorBase):
    tipo: str
    nome: str


class FornecedorUpdate(FornecedorBase):
    pass


class FornecedorOut(BaseModel):
    id: int

    # básico
    codigo: str
    data_cadastro: datetime
    tipo: str
    nome: str
    whatsapp: Optional[str] = None

    # endereço
    cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None

    # perfil/origem
    tipo_imovel: Optional[str] = None
    onde_conheceu: Optional[str] = None
    onde_conheceu_outro: Optional[str] = None

    # avançados
    pessoa_contato: Optional[str] = None
    whatsapp_principal: Optional[str] = None
    email_principal: Optional[str] = None
    end_pais: Optional[str] = None

    # PJ
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    cpf_responsavel_administrador: Optional[str] = None

    # PF
    rg: Optional[str] = None
    data_nascimento: Optional[date] = None
    estado_civil: Optional[str] = None
    profissao: Optional[str] = None

    # cobrança
    cep_cobranca: Optional[str] = None

    # web/redes
    home_page: Optional[str] = None
    redes_sociais: Optional[Dict[str, Any]] = None

    class Config:
        orm_mode = True


def fornecedor_to_out(f: models.Fornecedor) -> FornecedorOut:
    onde = f.onde_conheceu_empresa
    onde_base = onde
    onde_outro = None
    if isinstance(onde, str) and onde.startswith("outro:"):
        onde_base = "outro"
        onde_outro = onde.split(":", 1)[1].strip() or None

    return FornecedorOut(
        id=int(f.id),

        codigo=f.codigo_cadastro_fornecedor,
        data_cadastro=f.data_cadastro,
        tipo=f.tipo_fornecedor,
        nome=f.nome_identificacao,
        whatsapp=f.whatsapp_contato or f.whatsapp_principal,

        cep=f.end_cep,
        endereco_logradouro=f.end_rua,
        endereco_numero=f.end_numero,
        endereco_bairro=f.end_bairro,
        cidade=f.end_cidade,
        uf=f.end_estado,

        tipo_imovel=f.tipo_imovel,
        onde_conheceu=onde_base,
        onde_conheceu_outro=onde_outro,

        pessoa_contato=f.pessoa_contato,
        whatsapp_principal=f.whatsapp_principal,
        email_principal=f.email_principal,
        end_pais=f.end_pais,

        razao_social=f.razao_social,
        cnpj=f.cnpj,
        inscricao_estadual=f.inscricao_estadual,
        inscricao_municipal=f.inscricao_municipal,
        cpf_responsavel_administrador=f.cpf_responsavel_administrador,

        rg=f.rg,
        data_nascimento=f.data_nascimento,
        estado_civil=f.estado_civil,
        profissao=f.profissao,

        cep_cobranca=f.cep_cobranca,

        home_page=f.home_page,
        redes_sociais=f.redes_sociais,
    )


# =========================
# Endpoints
# =========================

# Aceita /api/fornecedores e /api/fornecedores/
@router.get("", response_model=List[FornecedorOut])
@router.get("/", response_model=List[FornecedorOut], include_in_schema=False)
def listar_fornecedores(db: Session = Depends(get_db)):
    rows = db.query(models.Fornecedor).order_by(models.Fornecedor.nome_identificacao.asc()).all()
    return [fornecedor_to_out(f) for f in rows]


# Aceita /api/fornecedores/123 e /api/fornecedores/123/
@router.get("/{fornecedor_id}", response_model=FornecedorOut)
@router.get("/{fornecedor_id}/", response_model=FornecedorOut, include_in_schema=False)
def obter_fornecedor(fornecedor_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Fornecedor).filter(models.Fornecedor.id == fornecedor_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return fornecedor_to_out(f)


# Aceita /api/fornecedores e /api/fornecedores/
@router.post("", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def criar_fornecedor(payload: FornecedorCreate, db: Session = Depends(get_db)):
    codigo = (payload.codigo or "").strip() or gerar_codigo_fornecedor(db)
    onde = build_onde_conheceu(payload.onde_conheceu, payload.onde_conheceu_outro)

    f = models.Fornecedor(
        codigo_cadastro_fornecedor=codigo,
        tipo_fornecedor=payload.tipo,
        nome_identificacao=payload.nome,

        pessoa_contato=norm_str(payload.pessoa_contato),
        whatsapp_contato=norm_str(payload.whatsapp),

        end_cep=only_digits(payload.cep),
        end_rua=norm_str(payload.endereco_logradouro),
        end_numero=norm_str(payload.endereco_numero),
        end_bairro=norm_str(payload.endereco_bairro),
        end_cidade=norm_str(payload.cidade),
        end_estado=norm_upper(payload.uf),
        end_pais=norm_upper(payload.end_pais) or "BR",

        tipo_imovel=norm_str(payload.tipo_imovel),
        onde_conheceu_empresa=norm_str(onde),

        # PJ
        razao_social=norm_str(payload.razao_social),
        cnpj=norm_str(payload.cnpj),
        inscricao_estadual=norm_str(payload.inscricao_estadual),
        inscricao_municipal=norm_str(payload.inscricao_municipal),
        cpf_responsavel_administrador=norm_str(payload.cpf_responsavel_administrador),

        # PF
        rg=norm_str(payload.rg),
        data_nascimento=payload.data_nascimento,
        estado_civil=norm_str(payload.estado_civil),
        profissao=norm_str(payload.profissao),

        whatsapp_principal=norm_str(payload.whatsapp_principal),
        email_principal=norm_str(payload.email_principal),

        cep_cobranca=only_digits(payload.cep_cobranca),

        home_page=norm_str(payload.home_page),
        redes_sociais=payload.redes_sociais,
    )

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


# Aceita /api/fornecedores/123 e /api/fornecedores/123/
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

    if payload.whatsapp is not None:
        f.whatsapp_contato = norm_str(payload.whatsapp)

    # endereço
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

    # perfil/origem
    if payload.tipo_imovel is not None:
        f.tipo_imovel = norm_str(payload.tipo_imovel)

    if payload.onde_conheceu is not None or payload.onde_conheceu_outro is not None:
        onde = build_onde_conheceu(payload.onde_conheceu, payload.onde_conheceu_outro)
        f.onde_conheceu_empresa = norm_str(onde)

    # avançados
    if payload.pessoa_contato is not None:
        f.pessoa_contato = norm_str(payload.pessoa_contato)
    if payload.whatsapp_principal is not None:
        f.whatsapp_principal = norm_str(payload.whatsapp_principal)
    if payload.email_principal is not None:
        f.email_principal = norm_str(payload.email_principal)

    # PJ
    if payload.razao_social is not None:
        f.razao_social = norm_str(payload.razao_social)
    if payload.cnpj is not None:
        f.cnpj = norm_str(payload.cnpj)
    if payload.inscricao_estadual is not None:
        f.inscricao_estadual = norm_str(payload.inscricao_estadual)
    if payload.inscricao_municipal is not None:
        f.inscricao_municipal = norm_str(payload.inscricao_municipal)
    if payload.cpf_responsavel_administrador is not None:
        f.cpf_responsavel_administrador = norm_str(payload.cpf_responsavel_administrador)

    # PF
    if payload.rg is not None:
        f.rg = norm_str(payload.rg)
    if payload.data_nascimento is not None:
        f.data_nascimento = payload.data_nascimento
    if payload.estado_civil is not None:
        f.estado_civil = norm_str(payload.estado_civil)
    if payload.profissao is not None:
        f.profissao = norm_str(payload.profissao)

    # cobrança / web
    if payload.cep_cobranca is not None:
        f.cep_cobranca = only_digits(payload.cep_cobranca)
    if payload.home_page is not None:
        f.home_page = norm_str(payload.home_page)
    if payload.redes_sociais is not None:
        f.redes_sociais = payload.redes_sociais

    try:
        db.commit()
        db.refresh(f)
        return fornecedor_to_out(f)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de fornecedor já existe.")


# Aceita /api/fornecedores/123 e /api/fornecedores/123/
@router.delete("/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{fornecedor_id}/", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def excluir_fornecedor(fornecedor_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Fornecedor).filter(models.Fornecedor.id == fornecedor_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    db.delete(f)
    db.commit()
    return None
