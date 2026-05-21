from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend import models as core_models
from backend.database import SessionLocal
from backend.models_area_cliente import ClienteDadosComplementares, ClienteHistoricoAlteracao

router = APIRouter(tags=["Área do Cliente - Admin"])


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def norm_upper(value: Any, allowed: set[str], default: str) -> str:
    text = str(value or "").strip().upper()
    return text if text in allowed else default


def norm_lower(value: Any, allowed: set[str], default: str) -> str:
    text = str(value or "").strip().lower()
    return text if text in allowed else default


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


def serialize_date(value: Optional[date]) -> Optional[str]:
    return value.isoformat() if value else None


def serialize_datetime(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


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

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return usuario


def buscar_cliente_empresa(db: Session, cliente_id: int, empresa_id: int) -> core_models.Cliente:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == cliente_id, core_models.Cliente.empresa_id == empresa_id)
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    return cliente


class ClienteDadosComplementaresBase(BaseModel):
    tipo_pessoa: str = "PF"
    status_preenchimento: str = "rascunho"
    origem_preenchimento: Optional[str] = "admin"
    origem_solicitacao: Optional[str] = None

    nome_completo: Optional[str] = None
    cpf: Optional[str] = None
    rg: Optional[str] = None
    nacionalidade: Optional[str] = None
    profissao: Optional[str] = None
    estado_civil: Optional[str] = None
    data_nascimento: Optional[str] = None
    email_pessoal: Optional[str] = None
    telefone_pessoal: Optional[str] = None

    representante_nome: Optional[str] = None
    representante_cpf: Optional[str] = None
    representante_rg: Optional[str] = None
    representante_nacionalidade: Optional[str] = None
    representante_profissao: Optional[str] = None
    representante_estado_civil: Optional[str] = None
    representante_data_nascimento: Optional[str] = None
    representante_email_pessoal: Optional[str] = None
    representante_telefone_pessoal: Optional[str] = None

    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    email_empresa: Optional[str] = None
    telefone_whatsapp_empresa: Optional[str] = None

    imovel_cep: Optional[str] = None
    imovel_rua: Optional[str] = None
    imovel_numero: Optional[str] = None
    imovel_complemento: Optional[str] = None
    imovel_bairro: Optional[str] = None
    imovel_cidade: Optional[str] = None
    imovel_uf: Optional[str] = None

    contato_principal_nome: Optional[str] = None
    contato_principal_telefone: Optional[str] = None
    contato_principal_whatsapp: Optional[str] = None
    contato_principal_email: Optional[str] = None
    contato_principal_observacao: Optional[str] = None

    observacoes_contrato: Optional[str] = None
    motivo_alteracao: Optional[str] = None


class ClienteDadosComplementaresOut(ClienteDadosComplementaresBase, ORMBaseModel):
    id: Optional[int] = None
    empresa_id: int
    cliente_id: int
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None


class ClienteHistoricoAlteracaoOut(ORMBaseModel):
    id: int
    empresa_id: int
    cliente_id: int
    usuario_id: Optional[int] = None
    usuario_nome: Optional[str] = None
    tipo: str
    origem: Optional[str] = None
    canal_solicitacao: Optional[str] = None
    campo: Optional[str] = None
    valor_anterior: Optional[str] = None
    valor_novo: Optional[str] = None
    descricao: str
    criado_em: Optional[str] = None


DADOS_COMPLEMENTARES_FIELDS = [
    "tipo_pessoa",
    "status_preenchimento",
    "origem_preenchimento",
    "origem_solicitacao",
    "nome_completo",
    "cpf",
    "rg",
    "nacionalidade",
    "profissao",
    "estado_civil",
    "data_nascimento",
    "email_pessoal",
    "telefone_pessoal",
    "representante_nome",
    "representante_cpf",
    "representante_rg",
    "representante_nacionalidade",
    "representante_profissao",
    "representante_estado_civil",
    "representante_data_nascimento",
    "representante_email_pessoal",
    "representante_telefone_pessoal",
    "razao_social",
    "cnpj",
    "email_empresa",
    "telefone_whatsapp_empresa",
    "imovel_cep",
    "imovel_rua",
    "imovel_numero",
    "imovel_complemento",
    "imovel_bairro",
    "imovel_cidade",
    "imovel_uf",
    "contato_principal_nome",
    "contato_principal_telefone",
    "contato_principal_whatsapp",
    "contato_principal_email",
    "contato_principal_observacao",
    "observacoes_contrato",
]


FIELD_LABELS = {
    "tipo_pessoa": "Tipo de pessoa",
    "status_preenchimento": "Status do preenchimento",
    "origem_preenchimento": "Origem do preenchimento",
    "origem_solicitacao": "Origem da solicitação",
    "nome_completo": "Nome completo",
    "cpf": "CPF",
    "rg": "RG",
    "nacionalidade": "Nacionalidade",
    "profissao": "Profissão",
    "estado_civil": "Estado civil",
    "data_nascimento": "Data de nascimento",
    "email_pessoal": "E-mail pessoal",
    "telefone_pessoal": "Telefone pessoal",
    "representante_nome": "Nome do representante",
    "representante_cpf": "CPF do representante",
    "representante_rg": "RG do representante",
    "representante_nacionalidade": "Nacionalidade do representante",
    "representante_profissao": "Profissão do representante",
    "representante_estado_civil": "Estado civil do representante",
    "representante_data_nascimento": "Nascimento do representante",
    "representante_email_pessoal": "E-mail do representante",
    "representante_telefone_pessoal": "Telefone do representante",
    "razao_social": "Razão social",
    "cnpj": "CNPJ",
    "email_empresa": "E-mail da empresa",
    "telefone_whatsapp_empresa": "WhatsApp da empresa",
    "imovel_cep": "CEP do imóvel",
    "imovel_rua": "Rua do imóvel",
    "imovel_numero": "Número do imóvel",
    "imovel_complemento": "Complemento do imóvel",
    "imovel_bairro": "Bairro do imóvel",
    "imovel_cidade": "Cidade do imóvel",
    "imovel_uf": "UF do imóvel",
    "contato_principal_nome": "Contato principal",
    "contato_principal_telefone": "Telefone do contato principal",
    "contato_principal_whatsapp": "WhatsApp do contato principal",
    "contato_principal_email": "E-mail do contato principal",
    "contato_principal_observacao": "Observação do contato principal",
    "observacoes_contrato": "Observações para contrato",
}


def empty_out(cliente_id: int, empresa_id: int, cliente: core_models.Cliente) -> ClienteDadosComplementaresOut:
    tipo_cliente = str(getattr(cliente, "tipo_pessoa", "PF") or "PF").upper()

    return ClienteDadosComplementaresOut(
        id=None,
        empresa_id=empresa_id,
        cliente_id=cliente_id,
        tipo_pessoa=tipo_cliente,
        status_preenchimento="rascunho",
        origem_preenchimento="admin",
        origem_solicitacao=None,
        nome_completo=getattr(cliente, "nome", None),
        cpf=getattr(cliente, "cpf_cnpj", None) if tipo_cliente == "PF" else None,
        rg=getattr(cliente, "rg_ie", None),
        nacionalidade=None,
        profissao=None,
        estado_civil=None,
        data_nascimento=serialize_date(getattr(cliente, "data_nascimento", None)),
        email_pessoal=getattr(cliente, "email", None),
        telefone_pessoal=getattr(cliente, "telefone", None) or getattr(cliente, "whatsapp", None),
        representante_nome=None,
        representante_cpf=None,
        representante_rg=None,
        representante_nacionalidade=None,
        representante_profissao=None,
        representante_estado_civil=None,
        representante_data_nascimento=None,
        representante_email_pessoal=None,
        representante_telefone_pessoal=None,
        razao_social=getattr(cliente, "nome", None) if tipo_cliente == "PJ" else None,
        cnpj=getattr(cliente, "cpf_cnpj", None) if tipo_cliente == "PJ" else None,
        email_empresa=getattr(cliente, "email", None),
        telefone_whatsapp_empresa=getattr(cliente, "whatsapp", None) or getattr(cliente, "telefone", None),
        imovel_cep=getattr(cliente, "cep", None),
        imovel_rua=getattr(cliente, "endereco", None),
        imovel_numero=getattr(cliente, "numero", None),
        imovel_complemento=getattr(cliente, "complemento", None),
        imovel_bairro=getattr(cliente, "bairro", None),
        imovel_cidade=getattr(cliente, "cidade", None),
        imovel_uf=getattr(cliente, "estado", None),
        contato_principal_nome=getattr(cliente, "contato", None),
        contato_principal_telefone=getattr(cliente, "telefone", None),
        contato_principal_whatsapp=getattr(cliente, "whatsapp", None),
        contato_principal_email=getattr(cliente, "email", None),
        contato_principal_observacao=None,
        observacoes_contrato=None,
        motivo_alteracao=None,
        criado_em=None,
        atualizado_em=None,
    )


def row_to_out(row: ClienteDadosComplementares) -> ClienteDadosComplementaresOut:
    return ClienteDadosComplementaresOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        cliente_id=int(row.cliente_id),
        tipo_pessoa=row.tipo_pessoa or "PF",
        status_preenchimento=row.status_preenchimento or "rascunho",
        origem_preenchimento=row.origem_preenchimento,
        origem_solicitacao=row.origem_solicitacao,
        nome_completo=row.nome_completo,
        cpf=row.cpf,
        rg=row.rg,
        nacionalidade=row.nacionalidade,
        profissao=row.profissao,
        estado_civil=row.estado_civil,
        data_nascimento=serialize_date(row.data_nascimento),
        email_pessoal=row.email_pessoal,
        telefone_pessoal=row.telefone_pessoal,
        representante_nome=row.representante_nome,
        representante_cpf=row.representante_cpf,
        representante_rg=row.representante_rg,
        representante_nacionalidade=row.representante_nacionalidade,
        representante_profissao=row.representante_profissao,
        representante_estado_civil=row.representante_estado_civil,
        representante_data_nascimento=serialize_date(row.representante_data_nascimento),
        representante_email_pessoal=row.representante_email_pessoal,
        representante_telefone_pessoal=row.representante_telefone_pessoal,
        razao_social=row.razao_social,
        cnpj=row.cnpj,
        email_empresa=row.email_empresa,
        telefone_whatsapp_empresa=row.telefone_whatsapp_empresa,
        imovel_cep=row.imovel_cep,
        imovel_rua=row.imovel_rua,
        imovel_numero=row.imovel_numero,
        imovel_complemento=row.imovel_complemento,
        imovel_bairro=row.imovel_bairro,
        imovel_cidade=row.imovel_cidade,
        imovel_uf=row.imovel_uf,
        contato_principal_nome=row.contato_principal_nome,
        contato_principal_telefone=row.contato_principal_telefone,
        contato_principal_whatsapp=row.contato_principal_whatsapp,
        contato_principal_email=row.contato_principal_email,
        contato_principal_observacao=row.contato_principal_observacao,
        observacoes_contrato=row.observacoes_contrato,
        motivo_alteracao=None,
        criado_em=serialize_datetime(row.criado_em),
        atualizado_em=serialize_datetime(row.atualizado_em),
    )


def historico_to_out(row: ClienteHistoricoAlteracao) -> ClienteHistoricoAlteracaoOut:
    return ClienteHistoricoAlteracaoOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        cliente_id=int(row.cliente_id),
        usuario_id=int(row.usuario_id) if row.usuario_id else None,
        usuario_nome=row.usuario_nome,
        tipo=row.tipo,
        origem=row.origem,
        canal_solicitacao=row.canal_solicitacao,
        campo=row.campo,
        valor_anterior=row.valor_anterior,
        valor_novo=row.valor_novo,
        descricao=row.descricao,
        criado_em=serialize_datetime(row.criado_em),
    )


def snapshot(row: Optional[ClienteDadosComplementares]) -> Dict[str, Optional[str]]:
    if not row:
        return {}

    out: Dict[str, Optional[str]] = {}
    for field in DADOS_COMPLEMENTARES_FIELDS:
        value = getattr(row, field, None)
        if isinstance(value, date):
            out[field] = value.isoformat()
        elif value is None:
            out[field] = None
        else:
            out[field] = str(value)
    return out


def apply_payload(row: ClienteDadosComplementares, payload: ClienteDadosComplementaresBase) -> None:
    row.tipo_pessoa = norm_upper(payload.tipo_pessoa, {"PF", "PJ"}, "PF")
    row.status_preenchimento = norm_lower(
        payload.status_preenchimento,
        {"rascunho", "pendente", "completo", "aprovado"},
        "rascunho",
    )
    row.origem_preenchimento = norm_lower(
        payload.origem_preenchimento,
        {"admin", "portal", "link_cliente", "importacao"},
        "admin",
    )
    row.origem_solicitacao = norm_lower(
        payload.origem_solicitacao,
        {"interno", "whatsapp", "email", "telefone", "presencial", "portal", "link_cliente"},
        "interno",
    )

    row.nome_completo = norm_str(payload.nome_completo)
    row.cpf = norm_str(payload.cpf)
    row.rg = norm_str(payload.rg)
    row.nacionalidade = norm_str(payload.nacionalidade)
    row.profissao = norm_str(payload.profissao)
    row.estado_civil = norm_str(payload.estado_civil)
    row.data_nascimento = parse_date(payload.data_nascimento)
    row.email_pessoal = norm_str(payload.email_pessoal)
    row.telefone_pessoal = norm_str(payload.telefone_pessoal)

    row.representante_nome = norm_str(payload.representante_nome)
    row.representante_cpf = norm_str(payload.representante_cpf)
    row.representante_rg = norm_str(payload.representante_rg)
    row.representante_nacionalidade = norm_str(payload.representante_nacionalidade)
    row.representante_profissao = norm_str(payload.representante_profissao)
    row.representante_estado_civil = norm_str(payload.representante_estado_civil)
    row.representante_data_nascimento = parse_date(payload.representante_data_nascimento)
    row.representante_email_pessoal = norm_str(payload.representante_email_pessoal)
    row.representante_telefone_pessoal = norm_str(payload.representante_telefone_pessoal)

    row.razao_social = norm_str(payload.razao_social)
    row.cnpj = norm_str(payload.cnpj)
    row.email_empresa = norm_str(payload.email_empresa)
    row.telefone_whatsapp_empresa = norm_str(payload.telefone_whatsapp_empresa)

    row.imovel_cep = norm_str(payload.imovel_cep)
    row.imovel_rua = norm_str(payload.imovel_rua)
    row.imovel_numero = norm_str(payload.imovel_numero)
    row.imovel_complemento = norm_str(payload.imovel_complemento)
    row.imovel_bairro = norm_str(payload.imovel_bairro)
    row.imovel_cidade = norm_str(payload.imovel_cidade)
    row.imovel_uf = norm_str(payload.imovel_uf)

    row.contato_principal_nome = norm_str(payload.contato_principal_nome)
    row.contato_principal_telefone = norm_str(payload.contato_principal_telefone)
    row.contato_principal_whatsapp = norm_str(payload.contato_principal_whatsapp)
    row.contato_principal_email = norm_str(payload.contato_principal_email)
    row.contato_principal_observacao = norm_str(payload.contato_principal_observacao)

    row.observacoes_contrato = norm_str(payload.observacoes_contrato)


def criar_historico_diferencas(
    db: Session,
    empresa_id: int,
    cliente_id: int,
    usuario: core_models.Usuario,
    before: Dict[str, Optional[str]],
    after: Dict[str, Optional[str]],
    payload: ClienteDadosComplementaresBase,
    criando: bool,
) -> None:
    origem = norm_str(payload.origem_preenchimento) or "admin"
    canal = norm_str(payload.origem_solicitacao) or "interno"
    motivo = norm_str(payload.motivo_alteracao)

    if criando:
        descricao = motivo or "Dados complementares do cliente criados no ValoraCRM."
        db.add(
            ClienteHistoricoAlteracao(
                empresa_id=empresa_id,
                cliente_id=cliente_id,
                usuario_id=int(usuario.id),
                usuario_nome=norm_str(getattr(usuario, "nome", None)),
                tipo="dados_complementares",
                origem=origem,
                canal_solicitacao=canal,
                campo=None,
                valor_anterior=None,
                valor_novo=None,
                descricao=descricao,
            )
        )
        return

    for field in DADOS_COMPLEMENTARES_FIELDS:
        old = before.get(field)
        new = after.get(field)
        if (old or "") == (new or ""):
            continue

        label = FIELD_LABELS.get(field, field)
        descricao = motivo or f"Campo '{label}' alterado nos dados complementares do cliente."
        db.add(
            ClienteHistoricoAlteracao(
                empresa_id=empresa_id,
                cliente_id=cliente_id,
                usuario_id=int(usuario.id),
                usuario_nome=norm_str(getattr(usuario, "nome", None)),
                tipo="dados_complementares",
                origem=origem,
                canal_solicitacao=canal,
                campo=field,
                valor_anterior=old,
                valor_novo=new,
                descricao=descricao,
            )
        )


@router.get(
    "/api/area-cliente-admin/clientes/{cliente_id}/dados-base",
    response_model=ClienteDadosComplementaresOut,
)
def obter_dados_base_area_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
        row = (
            db.query(ClienteDadosComplementares)
            .filter(
                ClienteDadosComplementares.cliente_id == cliente_id,
                ClienteDadosComplementares.empresa_id == empresa_id,
            )
            .first()
        )
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura da Área do Cliente ainda não existe no banco. Rode a query SQL da Parte 1.",
        ) from exc

    if not row:
        return empty_out(cliente_id=cliente_id, empresa_id=empresa_id, cliente=cliente)

    return row_to_out(row)


@router.put(
    "/api/area-cliente-admin/clientes/{cliente_id}/dados-base",
    response_model=ClienteDadosComplementaresOut,
    status_code=status.HTTP_200_OK,
)
def salvar_dados_base_area_cliente(
    cliente_id: int,
    payload: ClienteDadosComplementaresBase,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        buscar_cliente_empresa(db, cliente_id, empresa_id)

        row = (
            db.query(ClienteDadosComplementares)
            .filter(
                ClienteDadosComplementares.cliente_id == cliente_id,
                ClienteDadosComplementares.empresa_id == empresa_id,
            )
            .first()
        )

        criando = row is None
        before = snapshot(row)

        if row is None:
            row = ClienteDadosComplementares(empresa_id=empresa_id, cliente_id=cliente_id)
            db.add(row)
            db.flush()

        apply_payload(row, payload)
        db.flush()

        after = snapshot(row)
        criar_historico_diferencas(
            db=db,
            empresa_id=empresa_id,
            cliente_id=cliente_id,
            usuario=usuario,
            before=before,
            after=after,
            payload=payload,
            criando=criando,
        )

        db.commit()
        db.refresh(row)
        return row_to_out(row)

    except HTTPException:
        db.rollback()
        raise
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura da Área do Cliente ainda não existe no banco. Rode a query SQL da Parte 1.",
        ) from exc


@router.get(
    "/api/area-cliente-admin/clientes/{cliente_id}/historico-alteracoes",
    response_model=List[ClienteHistoricoAlteracaoOut],
)
def listar_historico_alteracoes_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        buscar_cliente_empresa(db, cliente_id, empresa_id)
        rows = (
            db.query(ClienteHistoricoAlteracao)
            .filter(
                ClienteHistoricoAlteracao.cliente_id == cliente_id,
                ClienteHistoricoAlteracao.empresa_id == empresa_id,
            )
            .order_by(ClienteHistoricoAlteracao.criado_em.desc(), ClienteHistoricoAlteracao.id.desc())
            .limit(200)
            .all()
        )
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura da Área do Cliente ainda não existe no banco. Rode a query SQL da Parte 1.",
        ) from exc

    return [historico_to_out(row) for row in rows]