from __future__ import annotations

import shutil
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend import models as core_models
from backend.database import SessionLocal

router = APIRouter(tags=["Clientes e Campos"])

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads" / "clientes"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

Cliente = core_models.Cliente
ClienteEndereco = core_models.ClienteEndereco
ClienteReferenciaComercial = core_models.ClienteReferenciaComercial
ClienteReferenciaBancaria = core_models.ClienteReferenciaBancaria
ClienteSocio = core_models.ClienteSocio
ClienteOcorrencia = core_models.ClienteOcorrencia
ClienteAnexo = core_models.ClienteAnexo


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_empresa_id(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> int:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(core_models.Usuario).filter(core_models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return int(usuario.empresa_id)


def get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> core_models.Usuario:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(core_models.Usuario).filter(core_models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    return usuario


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


def pydantic_dump(obj: BaseModel) -> Dict[str, Any]:
    return obj.model_dump() if hasattr(obj, "model_dump") else obj.dict()


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def norm_upper(value: Any, allowed: set[str], default: str) -> str:
    text = str(value or "").strip().upper()
    if text not in allowed:
        return default
    return text


def parse_date(value: Any) -> Optional[date]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def parse_datetime(value: Any) -> Optional[datetime]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    variants = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%dT%H:%M",
    ]
    for fmt in variants:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def parse_decimal(value: Any) -> Optional[Decimal]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, Decimal):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        text = text.replace(".", "").replace(",", ".") if ("," in text and "." in text) else text.replace(",", ".")
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def slugify_campo_formulario(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()

    out = []
    last_underscore = False

    for ch in text:
        if ch.isalnum():
            out.append(ch)
            last_underscore = False
        else:
            if not last_underscore:
                out.append("_")
                last_underscore = True

    return "".join(out).strip("_")[:120]


def tipo_campo_cliente_from_formulario(tipo: Any) -> str:
    tipo_norm = str(tipo or "texto").strip().lower()

    mapa = {
        "texto": "texto",
        "textarea": "textarea",
        "numero": "numero",
        "data": "data",
        "select": "select",
        "checkbox": "checkbox",
        "email": "texto",
        "telefone": "texto",
        "moeda": "numero",
        "percentual": "numero",
    }

    return mapa.get(tipo_norm, "texto")


def sincronizar_campos_clientes_do_formulario(
    db: Session,
    empresa_id: int,
    *,
    commit: bool = False,
) -> None:
    """
    Mantém /api/campos-clientes compatível com o construtor de Formulários.

    O front atual de Clientes ainda lê campos extras pela tabela campos_clientes.
    Já a tela Formulários salva os campos na tabela formularios_campos.
    Esta função cria/atualiza automaticamente CampoCliente a partir do
    formulário padrão ativo do módulo clientes.
    """
    FormularioModelo = getattr(core_models, "FormularioModelo", None)
    FormularioCampo = getattr(core_models, "FormularioCampo", None)

    if FormularioModelo is None or FormularioCampo is None:
        return

    modelo = (
        db.query(FormularioModelo)
        .filter(FormularioModelo.empresa_id == empresa_id)
        .filter(FormularioModelo.modulo == "clientes")
        .filter(FormularioModelo.ativo == True)  # noqa: E712
        .order_by(FormularioModelo.padrao.desc(), FormularioModelo.id.desc())
        .first()
    )

    if not modelo:
        return

    campos_formulario = (
        db.query(FormularioCampo)
        .filter(FormularioCampo.formulario_id == modelo.id)
        .filter(FormularioCampo.origem == "personalizado")
        .order_by(FormularioCampo.ordem.asc(), FormularioCampo.id.asc())
        .all()
    )

    if not campos_formulario:
        return

    existentes = (
        db.query(core_models.CampoCliente)
        .filter(core_models.CampoCliente.empresa_id == empresa_id)
        .all()
    )
    por_slug = {str(c.slug): c for c in existentes}

    changed = False

    for campo_form in campos_formulario:
        label = norm_str(getattr(campo_form, "label", None))
        if not label:
            continue

        slug = slugify_campo_formulario(label)
        if not slug:
            continue

        tipo = tipo_campo_cliente_from_formulario(getattr(campo_form, "tipo_campo", None))
        opcoes_json = getattr(campo_form, "opcoes_json", None)
        obrigatorio = bool(getattr(campo_form, "obrigatorio", False))
        ativo = bool(getattr(campo_form, "ativo", True))
        ordem = int(getattr(campo_form, "ordem", 0) or 0)

        campo_cliente = por_slug.get(slug)

        if campo_cliente:
            if campo_cliente.nome != label:
                campo_cliente.nome = label
                changed = True
            if campo_cliente.tipo != tipo:
                campo_cliente.tipo = tipo
                changed = True
            if bool(campo_cliente.obrigatorio) != obrigatorio:
                campo_cliente.obrigatorio = obrigatorio
                changed = True
            if bool(campo_cliente.ativo) != ativo:
                campo_cliente.ativo = ativo
                changed = True
            if (campo_cliente.opcoes_json or None) != (opcoes_json or None):
                campo_cliente.opcoes_json = opcoes_json
                changed = True
            if int(campo_cliente.ordem or 0) != ordem:
                campo_cliente.ordem = ordem
                changed = True
        else:
            campo_cliente = core_models.CampoCliente(
                empresa_id=empresa_id,
                nome=label,
                slug=slug,
                tipo=tipo,
                obrigatorio=obrigatorio,
                ativo=ativo,
                opcoes_json=opcoes_json,
                ordem=ordem,
            )
            db.add(campo_cliente)
            por_slug[slug] = campo_cliente
            changed = True

    if changed:
        db.flush()
        if commit:
            db.commit()


class EnderecoBase(BaseModel):
    tipo_endereco: str = "entrega"
    descricao: Optional[str] = None
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    pais: Optional[str] = None
    codigo_ibge_cidade: Optional[str] = None
    codigo_ibge_uf: Optional[str] = None
    email_destino: Optional[str] = None


class EnderecoIn(EnderecoBase):
    id: Optional[int] = None


class EnderecoOut(EnderecoBase, ORMBaseModel):
    id: int


class ReferenciaComercialBase(BaseModel):
    empresa_nome: str
    telefone: Optional[str] = None
    data_ultima_compra: Optional[str] = None
    valor_ultima_compra: Optional[str] = None
    valor_prestacao: Optional[str] = None
    vencimento_ultima_parcela: Optional[str] = None
    observacoes: Optional[str] = None


class ReferenciaComercialIn(ReferenciaComercialBase):
    id: Optional[int] = None


class ReferenciaComercialOut(ReferenciaComercialBase, ORMBaseModel):
    id: int


class ReferenciaBancariaBase(BaseModel):
    banco: str
    agencia: Optional[str] = None
    conta_corrente: Optional[str] = None
    gerente: Optional[str] = None
    telefone_agencia: Optional[str] = None
    limite_credito: Optional[str] = None
    status: Optional[str] = None
    observacoes: Optional[str] = None


class ReferenciaBancariaIn(ReferenciaBancariaBase):
    id: Optional[int] = None


class ReferenciaBancariaOut(ReferenciaBancariaBase, ORMBaseModel):
    id: int


class SocioBase(BaseModel):
    nome: str
    cpf: Optional[str] = None
    rg: Optional[str] = None
    data_nascimento: Optional[str] = None
    telefone: Optional[str] = None
    cargo: Optional[str] = None
    participacao_percentual: Optional[str] = None


class SocioIn(SocioBase):
    id: Optional[int] = None


class SocioOut(SocioBase, ORMBaseModel):
    id: int


class OcorrenciaBase(BaseModel):
    data_movimento: Optional[str] = None
    tipo: Optional[str] = None
    status: Optional[str] = None
    descricao: str


class OcorrenciaIn(OcorrenciaBase):
    id: Optional[int] = None


class OcorrenciaOut(OcorrenciaBase, ORMBaseModel):
    id: int
    usuario_nome: Optional[str] = None


class AnexoOut(ORMBaseModel):
    id: int
    descricao: Optional[str] = None
    tipo_documento: Optional[str] = None
    arquivo_nome: str
    arquivo_path: str
    usuario_nome: Optional[str] = None
    criado_em: Optional[datetime] = None


class ClienteBaseSchema(BaseModel):
    codigo: Optional[str] = None
    tipo_pessoa: str = "PF"
    situacao: str = "ativo"

    nome: str
    nome_fantasia: Optional[str] = None

    cpf_cnpj: Optional[str] = None
    rg_ie: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    suframa: Optional[str] = None
    data_nascimento: Optional[str] = None
    codigo_referencia: Optional[str] = None
    retencao_percentual: Optional[str] = None

    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    email_nfe: Optional[str] = None
    email_cobranca: Optional[str] = None
    email_fiscal: Optional[str] = None
    site: Optional[str] = None
    contato: Optional[str] = None

    parceiro_comercial: Optional[str] = None
    percentual_comissao: Optional[str] = None
    percentual_desconto: Optional[str] = None
    regiao: Optional[str] = None
    segmento: Optional[str] = None
    modalidade_pagamento: Optional[str] = None
    classificacao: Optional[str] = None

    cep: Optional[str] = None
    endereco: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    pais: Optional[str] = None
    codigo_ibge_cidade: Optional[str] = None
    codigo_ibge_uf: Optional[str] = None

    observacoes: Optional[str] = None

    enderecos: List[EnderecoIn] = Field(default_factory=list)
    referencias_comerciais: List[ReferenciaComercialIn] = Field(default_factory=list)
    referencias_bancarias: List[ReferenciaBancariaIn] = Field(default_factory=list)
    socios: List[SocioIn] = Field(default_factory=list)
    ocorrencias: List[OcorrenciaIn] = Field(default_factory=list)

    custom_fields: Optional[Dict[str, Any]] = None


class ClienteCreate(ClienteBaseSchema):
    pass


class ClienteUpdate(ClienteBaseSchema):
    pass


class ClienteListOut(ORMBaseModel):
    id: int
    empresa_id: int
    codigo: str
    tipo_pessoa: str
    situacao: str
    nome: str
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class ClienteOut(ClienteListOut):
    rg_ie: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    suframa: Optional[str] = None
    data_nascimento: Optional[str] = None
    codigo_referencia: Optional[str] = None
    retencao_percentual: Optional[str] = None
    fax: Optional[str] = None
    email_nfe: Optional[str] = None
    email_cobranca: Optional[str] = None
    email_fiscal: Optional[str] = None
    site: Optional[str] = None
    contato: Optional[str] = None
    parceiro_comercial: Optional[str] = None
    percentual_comissao: Optional[str] = None
    percentual_desconto: Optional[str] = None
    regiao: Optional[str] = None
    segmento: Optional[str] = None
    modalidade_pagamento: Optional[str] = None
    classificacao: Optional[str] = None
    cep: Optional[str] = None
    endereco: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    pais: Optional[str] = None
    codigo_ibge_cidade: Optional[str] = None
    codigo_ibge_uf: Optional[str] = None
    observacoes: Optional[str] = None

    enderecos: List[EnderecoOut] = Field(default_factory=list)
    referencias_comerciais: List[ReferenciaComercialOut] = Field(default_factory=list)
    referencias_bancarias: List[ReferenciaBancariaOut] = Field(default_factory=list)
    socios: List[SocioOut] = Field(default_factory=list)
    ocorrencias: List[OcorrenciaOut] = Field(default_factory=list)
    anexos: List[AnexoOut] = Field(default_factory=list)
    historico: Dict[str, Any] = Field(default_factory=dict)


class CampoClienteBase(BaseModel):
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    ativo: bool = True
    opcoes_json: Optional[str] = None
    ordem: int = 0


class CampoClienteCreate(CampoClienteBase):
    pass


class CampoClienteUpdate(CampoClienteBase):
    pass


class CampoClienteOut(CampoClienteBase, ORMBaseModel):
    id: int
    empresa_id: int


def gerar_codigo_cliente(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(Cliente)
        .filter(Cliente.empresa_id == empresa_id)
        .order_by(Cliente.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"CLI-{proximo:04d}"


def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, core_models.CampoCliente]:
    sincronizar_campos_clientes_do_formulario(db, empresa_id, commit=False)

    campos = db.query(core_models.CampoCliente).filter(core_models.CampoCliente.empresa_id == empresa_id).all()
    return {str(c.slug): c for c in campos}


def buscar_custom_fields_cliente(db: Session, empresa_id: int, cliente_id: int) -> Dict[str, Any]:
    rows = (
        db.query(core_models.ClienteCampoValor, core_models.CampoCliente)
        .join(core_models.CampoCliente, core_models.CampoCliente.id == core_models.ClienteCampoValor.campo_id)
        .filter(core_models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(core_models.CampoCliente.empresa_id == empresa_id)
        .all()
    )

    out: Dict[str, Any] = {}
    for valor_row, campo_row in rows:
        out[str(campo_row.slug)] = valor_row.valor
    return out


def salvar_custom_fields_cliente(
    db: Session,
    empresa_id: int,
    cliente_id: int,
    custom_fields: Optional[Dict[str, Any]],
) -> None:
    payload = custom_fields or {}
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    slugs_payload = set(payload.keys())
    slugs_validos = set(campos_map.keys())

    slugs_invalidos = sorted(slugs_payload - slugs_validos)
    if slugs_invalidos:
        raise HTTPException(status_code=400, detail=f"Campos personalizados inválidos: {', '.join(slugs_invalidos)}")

    valores_existentes = (
        db.query(core_models.ClienteCampoValor)
        .join(core_models.CampoCliente, core_models.CampoCliente.id == core_models.ClienteCampoValor.campo_id)
        .filter(core_models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(core_models.CampoCliente.empresa_id == empresa_id)
        .all()
    )
    existentes_por_campo_id = {int(v.campo_id): v for v in valores_existentes}

    for slug, raw_value in payload.items():
        campo = campos_map[slug]
        campo_id = int(campo.id)
        value_str = None if raw_value is None else str(raw_value).strip()

        if not value_str:
            existente = existentes_por_campo_id.get(campo_id)
            if existente:
                db.delete(existente)
            continue

        existente = existentes_por_campo_id.get(campo_id)
        if existente:
            existente.valor = value_str
        else:
            db.add(core_models.ClienteCampoValor(cliente_id=cliente_id, campo_id=campo_id, valor=value_str))


def sync_enderecos(db: Session, cliente_id: int, payload: List[EnderecoIn]) -> None:
    db.query(ClienteEndereco).filter(ClienteEndereco.cliente_id == cliente_id).delete()
    for item in payload:
        db.add(
            ClienteEndereco(
                cliente_id=cliente_id,
                tipo_endereco=norm_str(item.tipo_endereco) or "entrega",
                descricao=norm_str(item.descricao),
                cep=norm_str(item.cep),
                logradouro=norm_str(item.logradouro),
                numero=norm_str(item.numero),
                complemento=norm_str(item.complemento),
                bairro=norm_str(item.bairro),
                cidade=norm_str(item.cidade),
                estado=norm_str(item.estado),
                pais=norm_str(item.pais),
                codigo_ibge_cidade=norm_str(item.codigo_ibge_cidade),
                codigo_ibge_uf=norm_str(item.codigo_ibge_uf),
                email_destino=norm_str(item.email_destino),
            )
        )


def sync_refs_comerciais(db: Session, cliente_id: int, payload: List[ReferenciaComercialIn]) -> None:
    db.query(ClienteReferenciaComercial).filter(ClienteReferenciaComercial.cliente_id == cliente_id).delete()
    for item in payload:
        nome = norm_str(item.empresa_nome)
        if not nome:
            continue
        db.add(
            ClienteReferenciaComercial(
                cliente_id=cliente_id,
                empresa_nome=nome,
                telefone=norm_str(item.telefone),
                data_ultima_compra=parse_date(item.data_ultima_compra),
                valor_ultima_compra=parse_decimal(item.valor_ultima_compra),
                valor_prestacao=parse_decimal(item.valor_prestacao),
                vencimento_ultima_parcela=parse_date(item.vencimento_ultima_parcela),
                observacoes=norm_str(item.observacoes),
            )
        )


def sync_refs_bancarias(db: Session, cliente_id: int, payload: List[ReferenciaBancariaIn]) -> None:
    db.query(ClienteReferenciaBancaria).filter(ClienteReferenciaBancaria.cliente_id == cliente_id).delete()
    for item in payload:
        banco = norm_str(item.banco)
        if not banco:
            continue
        db.add(
            ClienteReferenciaBancaria(
                cliente_id=cliente_id,
                banco=banco,
                agencia=norm_str(item.agencia),
                conta_corrente=norm_str(item.conta_corrente),
                gerente=norm_str(item.gerente),
                telefone_agencia=norm_str(item.telefone_agencia),
                limite_credito=parse_decimal(item.limite_credito),
                status=norm_str(item.status),
                observacoes=norm_str(item.observacoes),
            )
        )


def sync_socios(db: Session, cliente_id: int, payload: List[SocioIn]) -> None:
    db.query(ClienteSocio).filter(ClienteSocio.cliente_id == cliente_id).delete()
    for item in payload:
        nome = norm_str(item.nome)
        if not nome:
            continue
        db.add(
            ClienteSocio(
                cliente_id=cliente_id,
                nome=nome,
                cpf=norm_str(item.cpf),
                rg=norm_str(item.rg),
                data_nascimento=parse_date(item.data_nascimento),
                telefone=norm_str(item.telefone),
                cargo=norm_str(item.cargo),
                participacao_percentual=parse_decimal(item.participacao_percentual),
            )
        )


def sync_ocorrencias(
    db: Session,
    cliente_id: int,
    payload: List[OcorrenciaIn],
    current_user: core_models.Usuario,
) -> None:
    db.query(ClienteOcorrencia).filter(ClienteOcorrencia.cliente_id == cliente_id).delete()
    for item in payload:
        descricao = norm_str(item.descricao)
        if not descricao:
            continue
        db.add(
            ClienteOcorrencia(
                cliente_id=cliente_id,
                data_movimento=parse_datetime(item.data_movimento) or datetime.utcnow(),
                tipo=norm_str(item.tipo),
                status=norm_str(item.status),
                usuario_id=int(current_user.id),
                usuario_nome=norm_str(getattr(current_user, "nome", None)),
                descricao=descricao,
            )
        )


def serialize_decimal(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return f"{value:.2f}"


def serialize_date(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def serialize_datetime(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def listar_enderecos(db: Session, cliente_id: int) -> List[EnderecoOut]:
    rows = (
        db.query(ClienteEndereco)
        .filter(ClienteEndereco.cliente_id == cliente_id)
        .order_by(ClienteEndereco.id.asc())
        .all()
    )
    return [
        EnderecoOut(
            id=int(r.id),
            tipo_endereco=r.tipo_endereco,
            descricao=r.descricao,
            cep=r.cep,
            logradouro=r.logradouro,
            numero=r.numero,
            complemento=r.complemento,
            bairro=r.bairro,
            cidade=r.cidade,
            estado=r.estado,
            pais=r.pais,
            codigo_ibge_cidade=r.codigo_ibge_cidade,
            codigo_ibge_uf=r.codigo_ibge_uf,
            email_destino=r.email_destino,
        )
        for r in rows
    ]


def listar_refs_comerciais(db: Session, cliente_id: int) -> List[ReferenciaComercialOut]:
    rows = (
        db.query(ClienteReferenciaComercial)
        .filter(ClienteReferenciaComercial.cliente_id == cliente_id)
        .order_by(ClienteReferenciaComercial.id.asc())
        .all()
    )
    return [
        ReferenciaComercialOut(
            id=int(r.id),
            empresa_nome=r.empresa_nome,
            telefone=r.telefone,
            data_ultima_compra=serialize_date(r.data_ultima_compra),
            valor_ultima_compra=serialize_decimal(r.valor_ultima_compra),
            valor_prestacao=serialize_decimal(r.valor_prestacao),
            vencimento_ultima_parcela=serialize_date(r.vencimento_ultima_parcela),
            observacoes=r.observacoes,
        )
        for r in rows
    ]


def listar_refs_bancarias(db: Session, cliente_id: int) -> List[ReferenciaBancariaOut]:
    rows = (
        db.query(ClienteReferenciaBancaria)
        .filter(ClienteReferenciaBancaria.cliente_id == cliente_id)
        .order_by(ClienteReferenciaBancaria.id.asc())
        .all()
    )
    return [
        ReferenciaBancariaOut(
            id=int(r.id),
            banco=r.banco,
            agencia=r.agencia,
            conta_corrente=r.conta_corrente,
            gerente=r.gerente,
            telefone_agencia=r.telefone_agencia,
            limite_credito=serialize_decimal(r.limite_credito),
            status=r.status,
            observacoes=r.observacoes,
        )
        for r in rows
    ]


def listar_socios(db: Session, cliente_id: int) -> List[SocioOut]:
    rows = db.query(ClienteSocio).filter(ClienteSocio.cliente_id == cliente_id).order_by(ClienteSocio.id.asc()).all()
    return [
        SocioOut(
            id=int(r.id),
            nome=r.nome,
            cpf=r.cpf,
            rg=r.rg,
            data_nascimento=serialize_date(r.data_nascimento),
            telefone=r.telefone,
            cargo=r.cargo,
            participacao_percentual=serialize_decimal(r.participacao_percentual),
        )
        for r in rows
    ]


def listar_ocorrencias(db: Session, cliente_id: int) -> List[OcorrenciaOut]:
    rows = (
        db.query(ClienteOcorrencia)
        .filter(ClienteOcorrencia.cliente_id == cliente_id)
        .order_by(ClienteOcorrencia.data_movimento.desc(), ClienteOcorrencia.id.desc())
        .all()
    )
    return [
        OcorrenciaOut(
            id=int(r.id),
            data_movimento=serialize_datetime(r.data_movimento),
            tipo=r.tipo,
            status=r.status,
            descricao=r.descricao,
            usuario_nome=r.usuario_nome,
        )
        for r in rows
    ]


def listar_anexos(db: Session, cliente_id: int) -> List[AnexoOut]:
    rows = (
        db.query(ClienteAnexo)
        .filter(ClienteAnexo.cliente_id == cliente_id)
        .order_by(ClienteAnexo.id.desc())
        .all()
    )
    return [
        AnexoOut(
            id=int(r.id),
            descricao=r.descricao,
            tipo_documento=r.tipo_documento,
            arquivo_nome=r.arquivo_nome,
            arquivo_path=r.arquivo_path,
            usuario_nome=r.usuario_nome,
            criado_em=r.criado_em,
        )
        for r in rows
    ]


def montar_historico_cliente(db: Session, cliente: Cliente) -> Dict[str, Any]:
    historico: Dict[str, Any] = {
        "ultimas_propostas": [],
        "resumo": {
            "total_propostas": 0,
            "propostas_aprovadas": 0,
        },
        "ultimas_ocorrencias": [],
    }

    try:
        proposta_model = getattr(core_models, "Proposta", None)
        if proposta_model is not None:
            propostas = (
                db.query(proposta_model)
                .filter(proposta_model.empresa_id == cliente.empresa_id, proposta_model.cliente_id == cliente.id)
                .order_by(proposta_model.id.desc())
                .limit(10)
                .all()
            )
            historico["ultimas_propostas"] = [
                {
                    "id": int(getattr(p, "id")),
                    "codigo": getattr(p, "codigo", None),
                    "titulo": getattr(p, "titulo", None),
                    "status": getattr(p, "status", None),
                    "total": getattr(p, "total", None),
                }
                for p in propostas
            ]
            historico["resumo"]["total_propostas"] = len(propostas)
            historico["resumo"]["propostas_aprovadas"] = sum(
                1 for p in propostas if str(getattr(p, "status", "")).lower() == "aprovada"
            )
    except Exception:
        pass

    try:
        historico["ultimas_ocorrencias"] = [pydantic_dump(o) for o in listar_ocorrencias(db, int(cliente.id))[:10]]
    except Exception:
        historico["ultimas_ocorrencias"] = []

    return historico


def cliente_to_list_out(db: Session, c: Cliente) -> ClienteListOut:
    return ClienteListOut(
        id=int(c.id),
        empresa_id=int(c.empresa_id),
        codigo=c.codigo or "",
        tipo_pessoa=c.tipo_pessoa or "PF",
        situacao=c.situacao or "ativo",
        nome=c.nome or "",
        nome_fantasia=c.nome_fantasia,
        cpf_cnpj=c.cpf_cnpj,
        telefone=c.telefone,
        whatsapp=c.whatsapp,
        email=c.email,
        cidade=c.cidade,
        estado=c.estado,
        custom_fields=buscar_custom_fields_cliente(db, int(c.empresa_id), int(c.id)),
    )


def cliente_to_out(db: Session, c: Cliente) -> ClienteOut:
    return ClienteOut(
        **pydantic_dump(cliente_to_list_out(db, c)),
        rg_ie=c.rg_ie,
        inscricao_municipal=c.inscricao_municipal,
        suframa=c.suframa,
        data_nascimento=serialize_date(c.data_nascimento),
        codigo_referencia=c.codigo_referencia,
        retencao_percentual=serialize_decimal(c.retencao_percentual),
        fax=c.fax,
        email_nfe=c.email_nfe,
        email_cobranca=c.email_cobranca,
        email_fiscal=c.email_fiscal,
        site=c.site,
        contato=c.contato,
        parceiro_comercial=c.parceiro_comercial,
        percentual_comissao=serialize_decimal(c.percentual_comissao),
        percentual_desconto=serialize_decimal(c.percentual_desconto),
        regiao=c.regiao,
        segmento=c.segmento,
        modalidade_pagamento=c.modalidade_pagamento,
        classificacao=c.classificacao,
        cep=c.cep,
        endereco=c.endereco,
        numero=c.numero,
        complemento=c.complemento,
        bairro=c.bairro,
        pais=c.pais,
        codigo_ibge_cidade=c.codigo_ibge_cidade,
        codigo_ibge_uf=c.codigo_ibge_uf,
        observacoes=c.observacoes,
        enderecos=listar_enderecos(db, int(c.id)),
        referencias_comerciais=listar_refs_comerciais(db, int(c.id)),
        referencias_bancarias=listar_refs_bancarias(db, int(c.id)),
        socios=listar_socios(db, int(c.id)),
        ocorrencias=listar_ocorrencias(db, int(c.id)),
        anexos=listar_anexos(db, int(c.id)),
        historico=montar_historico_cliente(db, c),
    )


def buscar_cliente_empresa(db: Session, cliente_id: int, empresa_id: int) -> Optional[Cliente]:
    return (
        db.query(Cliente)
        .filter(Cliente.id == cliente_id, Cliente.empresa_id == empresa_id)
        .first()
    )


def apply_cliente_payload(cliente: Cliente, payload: ClienteBaseSchema) -> None:
    tipo_pessoa = norm_upper(payload.tipo_pessoa, {"PF", "PJ"}, "PF")
    cliente.codigo = (payload.codigo or "").strip() or cliente.codigo
    cliente.tipo_pessoa = tipo_pessoa
    cliente.situacao = norm_str(payload.situacao) or "ativo"
    cliente.nome = payload.nome.strip()
    cliente.nome_fantasia = norm_str(payload.nome_fantasia)
    cliente.cpf_cnpj = norm_str(payload.cpf_cnpj)
    cliente.rg_ie = norm_str(payload.rg_ie)
    cliente.inscricao_municipal = norm_str(payload.inscricao_municipal)
    cliente.suframa = norm_str(payload.suframa)
    cliente.data_nascimento = parse_date(payload.data_nascimento)
    cliente.codigo_referencia = norm_str(payload.codigo_referencia)
    cliente.retencao_percentual = parse_decimal(payload.retencao_percentual)
    cliente.telefone = norm_str(payload.telefone)
    cliente.whatsapp = norm_str(payload.whatsapp)
    cliente.fax = norm_str(payload.fax)
    cliente.email = norm_str(payload.email)
    cliente.email_nfe = norm_str(payload.email_nfe)
    cliente.email_cobranca = norm_str(payload.email_cobranca)
    cliente.email_fiscal = norm_str(payload.email_fiscal)
    cliente.site = norm_str(payload.site)
    cliente.contato = norm_str(payload.contato)
    cliente.parceiro_comercial = norm_str(payload.parceiro_comercial)
    cliente.percentual_comissao = parse_decimal(payload.percentual_comissao)
    cliente.percentual_desconto = parse_decimal(payload.percentual_desconto)
    cliente.regiao = norm_str(payload.regiao)
    cliente.segmento = norm_str(payload.segmento)
    cliente.modalidade_pagamento = norm_str(payload.modalidade_pagamento)
    cliente.classificacao = norm_str(payload.classificacao)
    cliente.cep = norm_str(payload.cep)
    cliente.endereco = norm_str(payload.endereco)
    cliente.numero = norm_str(payload.numero)
    cliente.complemento = norm_str(payload.complemento)
    cliente.bairro = norm_str(payload.bairro)
    cliente.cidade = norm_str(payload.cidade)
    cliente.estado = norm_str(payload.estado)
    cliente.pais = norm_str(payload.pais)
    cliente.codigo_ibge_cidade = norm_str(payload.codigo_ibge_cidade)
    cliente.codigo_ibge_uf = norm_str(payload.codigo_ibge_uf)
    cliente.observacoes = norm_str(payload.observacoes)


@router.get("/api/campos-clientes", response_model=List[CampoClienteOut])
def listar_campos(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        sincronizar_campos_clientes_do_formulario(db, empresa_id, commit=True)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Formulários/Campos ainda não existe no banco. Rode a query SQL/migration antes de abrir Clientes.",
        ) from exc

    rows = (
        db.query(core_models.CampoCliente)
        .filter(core_models.CampoCliente.empresa_id == empresa_id)
        .order_by(core_models.CampoCliente.ordem.asc(), core_models.CampoCliente.id.asc())
        .all()
    )
    return rows


@router.get("/api/campos-clientes/{campo_id}", response_model=CampoClienteOut)
def obter_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(core_models.CampoCliente)
        .filter(core_models.CampoCliente.id == campo_id, core_models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    return campo


@router.post("/api/campos-clientes", response_model=CampoClienteOut, status_code=status.HTTP_201_CREATED)
def criar_campo(
    payload: CampoClienteCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    data = pydantic_dump(payload)
    novo_campo = core_models.CampoCliente(empresa_id=empresa_id, **data)

    try:
        db.add(novo_campo)
        db.commit()
        db.refresh(novo_campo)
        return novo_campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.put("/api/campos-clientes/{campo_id}", response_model=CampoClienteOut)
def atualizar_campo(
    campo_id: int,
    payload: CampoClienteUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(core_models.CampoCliente)
        .filter(core_models.CampoCliente.id == campo_id, core_models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    data = pydantic_dump(payload)
    for key, value in data.items():
        setattr(campo, key, value)

    try:
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.delete("/api/campos-clientes/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(core_models.CampoCliente)
        .filter(core_models.CampoCliente.id == campo_id, core_models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    db.delete(campo)
    db.commit()
    return None


@router.get("/api/clientes", response_model=List[ClienteListOut])
def listar_clientes(
    busca: Optional[str] = Query(default=None),
    situacao: Optional[str] = Query(default=None),
    tipo_pessoa: Optional[str] = Query(default=None),
    cidade: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        query = db.query(Cliente).filter(Cliente.empresa_id == empresa_id)

        if norm_str(situacao):
            query = query.filter(Cliente.situacao == str(situacao).strip().lower())

        tipo_norm = norm_str(tipo_pessoa)
        if tipo_norm:
            query = query.filter(Cliente.tipo_pessoa == tipo_norm.upper())

        if norm_str(cidade):
            query = query.filter(Cliente.cidade.ilike(f"%{str(cidade).strip()}%"))

        texto = norm_str(busca)
        if texto:
            q = f"%{texto}%"
            query = query.filter(
                (Cliente.codigo.ilike(q))
                | (Cliente.nome.ilike(q))
                | (Cliente.nome_fantasia.ilike(q))
                | (Cliente.cpf_cnpj.ilike(q))
                | (Cliente.telefone.ilike(q))
                | (Cliente.whatsapp.ilike(q))
                | (Cliente.email.ilike(q))
                | (Cliente.cidade.ilike(q))
            )

        rows = query.order_by(Cliente.nome.asc(), Cliente.id.asc()).all()
        return [cliente_to_list_out(db, c) for c in rows]
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura nova de clientes ainda não existe no banco. Rode a query SQL antes de abrir esta tela.",
        ) from exc


@router.get("/api/clientes/{cliente_id}", response_model=ClienteOut)
def obter_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
    except OperationalError as exc:
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Clientes antes de usar esta rota.") from exc

    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return cliente_to_out(db, cliente)


@router.get("/api/clientes/{cliente_id}/historico")
def obter_historico_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return montar_historico_cliente(db, cliente)


@router.post("/api/clientes", response_model=ClienteOut, status_code=status.HTTP_201_CREATED)
def criar_cliente(
    payload: ClienteCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
    current_user: core_models.Usuario = Depends(get_current_user),
):
    try:
        codigo = (payload.codigo or "").strip() or gerar_codigo_cliente(db, empresa_id)
        cliente = Cliente(empresa_id=empresa_id, codigo=codigo, nome=payload.nome.strip())
        apply_cliente_payload(cliente, payload)

        db.add(cliente)
        db.flush()

        sync_enderecos(db, int(cliente.id), payload.enderecos)
        sync_refs_comerciais(db, int(cliente.id), payload.referencias_comerciais)
        sync_refs_bancarias(db, int(cliente.id), payload.referencias_bancarias)
        sync_socios(db, int(cliente.id), payload.socios)
        sync_ocorrencias(db, int(cliente.id), payload.ocorrencias, current_user)
        salvar_custom_fields_cliente(db, empresa_id, int(cliente.id), payload.custom_fields)

        db.commit()
        db.refresh(cliente)
        return cliente_to_out(db, cliente)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Clientes antes de criar registros.") from exc
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe cliente com este código para a empresa.")


@router.put("/api/clientes/{cliente_id}", response_model=ClienteOut)
def atualizar_cliente(
    cliente_id: int,
    payload: ClienteUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
    current_user: core_models.Usuario = Depends(get_current_user),
):
    cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    try:
        if norm_str(payload.codigo):
            cliente.codigo = str(payload.codigo).strip()

        apply_cliente_payload(cliente, payload)
        sync_enderecos(db, int(cliente.id), payload.enderecos)
        sync_refs_comerciais(db, int(cliente.id), payload.referencias_comerciais)
        sync_refs_bancarias(db, int(cliente.id), payload.referencias_bancarias)
        sync_socios(db, int(cliente.id), payload.socios)
        sync_ocorrencias(db, int(cliente.id), payload.ocorrencias, current_user)
        salvar_custom_fields_cliente(db, empresa_id, int(cliente.id), payload.custom_fields)

        db.commit()
        db.refresh(cliente)
        return cliente_to_out(db, cliente)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Clientes antes de atualizar registros.") from exc
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe cliente com este código para a empresa.")


@router.delete("/api/clientes/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    db.delete(cliente)
    db.commit()
    return None


@router.post("/api/clientes/{cliente_id}/anexos/upload", response_model=AnexoOut, status_code=status.HTTP_201_CREATED)
def upload_anexo_cliente(
    cliente_id: int,
    arquivo: UploadFile = File(...),
    descricao: Optional[str] = None,
    tipo_documento: Optional[str] = None,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
    current_user: core_models.Usuario = Depends(get_current_user),
):
    cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    if not arquivo.filename:
        raise HTTPException(status_code=400, detail="Arquivo inválido.")

    ext = Path(arquivo.filename).suffix.lower()
    safe_stem = Path(arquivo.filename).stem[:80].replace(" ", "_")
    file_name = f"cliente_{cliente_id}_{int(datetime.utcnow().timestamp())}_{safe_stem}{ext}"
    destino = UPLOAD_DIR / file_name

    with destino.open("wb") as buffer:
        shutil.copyfileobj(arquivo.file, buffer)

    anexo = ClienteAnexo(
        cliente_id=cliente_id,
        descricao=norm_str(descricao),
        tipo_documento=norm_str(tipo_documento),
        arquivo_nome=arquivo.filename,
        arquivo_path=f"/uploads/clientes/{file_name}",
        usuario_id=int(current_user.id),
        usuario_nome=norm_str(getattr(current_user, "nome", None)),
    )

    db.add(anexo)
    db.commit()
    db.refresh(anexo)

    return AnexoOut(
        id=int(anexo.id),
        descricao=anexo.descricao,
        tipo_documento=anexo.tipo_documento,
        arquivo_nome=anexo.arquivo_nome,
        arquivo_path=anexo.arquivo_path,
        usuario_nome=anexo.usuario_nome,
        criado_em=anexo.criado_em,
    )


@router.delete("/api/clientes/anexos/{anexo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_anexo_cliente(
    anexo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    anexo = (
        db.query(ClienteAnexo)
        .join(Cliente, Cliente.id == ClienteAnexo.cliente_id)
        .filter(ClienteAnexo.id == anexo_id, Cliente.empresa_id == empresa_id)
        .first()
    )
    if not anexo:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")

    path = BASE_DIR / anexo.arquivo_path.lstrip("/")
    if path.exists() and path.is_file():
        try:
            path.unlink()
        except OSError:
            pass

    db.delete(anexo)
    db.commit()
    return None