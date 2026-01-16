# backend/routers/clientes.py
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend import models

router = APIRouter(prefix="/api/clientes", tags=["Clientes"])


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


def norm_tipo(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip().lower()
    if v in ("pf", "pj"):
        return v
    return None


def date_to_dt_utc(d: Optional[date]) -> Optional[datetime]:
    """
    Converte date -> datetime UTC (00:00).
    OBS: No front, use ISO.slice(0,10) no input type=date para não virar -1 dia por timezone.
    """
    if not d:
        return None
    return datetime.combine(d, time.min).replace(tzinfo=timezone.utc)


def gerar_codigo_cliente(db: Session) -> str:
    ultimo = db.query(models.Cliente).order_by(models.Cliente.id.desc()).first()
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"CLI-{proximo:04d}"


def build_onde_conheceu(onde: Optional[str], outro: Optional[str]) -> Optional[str]:
    onde = (onde or "").strip()
    outro = (outro or "").strip()
    if not onde and not outro:
        return None
    if onde == "outro" and outro:
        return f"outro: {outro}"
    return onde or outro or None


def field_sent(model: BaseModel, name: str) -> bool:
    """
    Detecta se o campo foi enviado no payload.
    - Pydantic v1: __fields_set__
    - Pydantic v2: model_fields_set
    """
    fs = getattr(model, "__fields_set__", None)
    if fs is not None:
        return name in fs
    fs = getattr(model, "model_fields_set", None)
    return name in fs if fs is not None else False


# =========================
# Schemas
# =========================
class ClienteBase(BaseModel):
    # básico
    codigo: Optional[str] = None
    data_cadastro: Optional[date] = None
    tipo: Optional[str] = None  # pf | pj
    nome: Optional[str] = None
    whatsapp: Optional[str] = None

    # endereço (front)
    cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None

    # perfil/origem (front)
    tipo_imovel: Optional[str] = None
    onde_conheceu: Optional[str] = None
    onde_conheceu_outro: Optional[str] = None

    # contato
    pessoa_contato: Optional[str] = None
    email_principal: Optional[str] = None

    whatsapp_principal: Optional[str] = None
    end_pais: Optional[str] = None

    # PJ
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    responsavel_contratante: Optional[str] = None
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


class ClienteCreate(ClienteBase):
    tipo: str
    nome: str


class ClienteUpdate(ClienteBase):
    pass


class ClienteOut(BaseModel):
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

    # contato/dados completos
    pessoa_contato: Optional[str] = None
    email_principal: Optional[str] = None
    whatsapp_principal: Optional[str] = None
    end_pais: Optional[str] = None

    # PJ
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    responsavel_contratante: Optional[str] = None
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


def cliente_to_out(c: models.Cliente) -> ClienteOut:
    # tenta extrair "onde_conheceu_outro" se estiver salvando como "outro: xxx"
    onde = c.onde_conheceu_empresa
    onde_base = onde
    onde_outro = None
    if isinstance(onde, str) and onde.startswith("outro:"):
        onde_base = "outro"
        onde_outro = onde.split(":", 1)[1].strip() or None

    # ✅ garante pf/pj sempre
    tipo = norm_tipo(getattr(c, "tipo_cliente", None)) or "pf"

    return ClienteOut(
        id=int(c.id),

        codigo=c.codigo_cadastro_cliente,
        data_cadastro=c.data_cadastro,
        tipo=tipo,
        nome=c.nome_identificacao,
        whatsapp=c.whatsapp_contato or c.whatsapp_principal,

        cep=c.end_cep,
        endereco_logradouro=c.end_rua,
        endereco_numero=c.end_numero,
        endereco_bairro=c.end_bairro,
        cidade=c.end_cidade,
        uf=c.end_estado,

        tipo_imovel=c.tipo_imovel,
        onde_conheceu=onde_base,
        onde_conheceu_outro=onde_outro,

        pessoa_contato=c.pessoa_contato,
        email_principal=c.email_principal,
        whatsapp_principal=c.whatsapp_principal,
        end_pais=c.end_pais,

        razao_social=c.razao_social,
        cnpj=c.cnpj,
        inscricao_estadual=c.inscricao_estadual,
        inscricao_municipal=c.inscricao_municipal,
        responsavel_contratante=getattr(c, "responsavel_contratante", None),
        cpf_responsavel_administrador=c.cpf_responsavel_administrador,

        rg=c.rg,
        data_nascimento=c.data_nascimento,
        estado_civil=c.estado_civil,
        profissao=c.profissao,

        cep_cobranca=c.cep_cobranca,

        home_page=c.home_page,
        redes_sociais=c.redes_sociais,
    )


# =========================
# Endpoints
# =========================
@router.get("", response_model=List[ClienteOut])
@router.get("/", response_model=List[ClienteOut], include_in_schema=False)
def listar_clientes(db: Session = Depends(get_db)):
    rows = db.query(models.Cliente).order_by(models.Cliente.nome_identificacao.asc()).all()
    return [cliente_to_out(c) for c in rows]


@router.get("/{cliente_id}", response_model=ClienteOut)
@router.get("/{cliente_id}/", response_model=ClienteOut, include_in_schema=False)
def obter_cliente(cliente_id: int, db: Session = Depends(get_db)):
    c = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return cliente_to_out(c)


@router.post("", response_model=ClienteOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ClienteOut, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def criar_cliente(payload: ClienteCreate, db: Session = Depends(get_db)):
    codigo = (payload.codigo or "").strip() or gerar_codigo_cliente(db)
    onde = build_onde_conheceu(payload.onde_conheceu, payload.onde_conheceu_outro)

    tipo = norm_tipo(payload.tipo) or "pf"

    c = models.Cliente(
        codigo_cadastro_cliente=codigo,
        tipo_cliente=tipo,
        nome_identificacao=payload.nome,

        pessoa_contato=norm_str(payload.pessoa_contato),
        whatsapp_contato=norm_str(payload.whatsapp),
        email_principal=norm_str(payload.email_principal),

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
        responsavel_contratante=norm_str(payload.responsavel_contratante),
        cpf_responsavel_administrador=norm_str(payload.cpf_responsavel_administrador),

        # PF
        rg=norm_str(payload.rg),
        data_nascimento=payload.data_nascimento,
        estado_civil=norm_str(payload.estado_civil),
        profissao=norm_str(payload.profissao),

        whatsapp_principal=norm_str(payload.whatsapp_principal),

        cep_cobranca=only_digits(payload.cep_cobranca),

        home_page=norm_str(payload.home_page),
        redes_sociais=payload.redes_sociais,
    )

    dt = date_to_dt_utc(payload.data_cadastro)
    if dt:
        c.data_cadastro = dt

    try:
        db.add(c)
        db.commit()
        db.refresh(c)
        return cliente_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de cliente já existe.")


@router.put("/{cliente_id}", response_model=ClienteOut)
@router.put("/{cliente_id}/", response_model=ClienteOut, include_in_schema=False)
def atualizar_cliente(cliente_id: int, payload: ClienteUpdate, db: Session = Depends(get_db)):
    c = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    if payload.codigo is not None and payload.codigo.strip():
        c.codigo_cadastro_cliente = payload.codigo.strip()

    if payload.data_cadastro is not None:
        dt = date_to_dt_utc(payload.data_cadastro)
        if dt:
            c.data_cadastro = dt

    if payload.tipo is not None:
        t = norm_tipo(payload.tipo)
        if t:
            c.tipo_cliente = t

    if payload.nome is not None and payload.nome.strip():
        c.nome_identificacao = payload.nome.strip()

    if payload.whatsapp is not None:
        c.whatsapp_contato = norm_str(payload.whatsapp)

    # endereço
    if payload.cep is not None:
        c.end_cep = only_digits(payload.cep)

    if payload.endereco_logradouro is not None:
        c.end_rua = norm_str(payload.endereco_logradouro)

    if payload.endereco_numero is not None:
        c.end_numero = norm_str(payload.endereco_numero)

    if payload.endereco_bairro is not None:
        c.end_bairro = norm_str(payload.endereco_bairro)

    if payload.cidade is not None:
        c.end_cidade = norm_str(payload.cidade)

    if payload.uf is not None:
        c.end_estado = norm_upper(payload.uf)

    if payload.end_pais is not None:
        c.end_pais = norm_upper(payload.end_pais) or "BR"

    # perfil/origem
    if payload.tipo_imovel is not None:
        c.tipo_imovel = norm_str(payload.tipo_imovel)

    if payload.onde_conheceu is not None or payload.onde_conheceu_outro is not None:
        onde = build_onde_conheceu(payload.onde_conheceu, payload.onde_conheceu_outro)
        c.onde_conheceu_empresa = norm_str(onde)

    # contato / dados completos
    if payload.pessoa_contato is not None:
        c.pessoa_contato = norm_str(payload.pessoa_contato)

    if payload.email_principal is not None:
        c.email_principal = norm_str(payload.email_principal)

    if payload.whatsapp_principal is not None:
        c.whatsapp_principal = norm_str(payload.whatsapp_principal)

    # PJ
    if payload.razao_social is not None:
        c.razao_social = norm_str(payload.razao_social)
    if payload.cnpj is not None:
        c.cnpj = norm_str(payload.cnpj)
    if payload.inscricao_estadual is not None:
        c.inscricao_estadual = norm_str(payload.inscricao_estadual)
    if payload.inscricao_municipal is not None:
        c.inscricao_municipal = norm_str(payload.inscricao_municipal)
    if payload.responsavel_contratante is not None:
        c.responsavel_contratante = norm_str(payload.responsavel_contratante)
    if payload.cpf_responsavel_administrador is not None:
        c.cpf_responsavel_administrador = norm_str(payload.cpf_responsavel_administrador)

    # PF
    if payload.rg is not None:
        c.rg = norm_str(payload.rg)
    if payload.data_nascimento is not None:
        c.data_nascimento = payload.data_nascimento
    if payload.estado_civil is not None:
        c.estado_civil = norm_str(payload.estado_civil)
    if payload.profissao is not None:
        c.profissao = norm_str(payload.profissao)

    # cobrança / web
    if payload.cep_cobranca is not None:
        c.cep_cobranca = only_digits(payload.cep_cobranca)

    if payload.home_page is not None:
        c.home_page = norm_str(payload.home_page)

    # ✅ IMPORTANTE: permitir limpar redes_sociais (null)
    if field_sent(payload, "redes_sociais"):
        c.redes_sociais = payload.redes_sociais

    try:
        db.commit()
        db.refresh(c)
        return cliente_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de cliente já existe.")


@router.delete("/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{cliente_id}/", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def excluir_cliente(cliente_id: int, db: Session = Depends(get_db)):
    c = db.query(models.Cliente).filter(models.Cliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    db.delete(c)
    db.commit()
    return None
