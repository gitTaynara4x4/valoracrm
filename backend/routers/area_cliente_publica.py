from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend import models as core_models
from backend.database import SessionLocal
from backend.models_area_cliente import ClienteDadosComplementares, ClienteHistoricoAlteracao
from backend.models_area_cliente_acesso import ClienteAcessoPortal

router = APIRouter(tags=["Área do Cliente - Pública"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

PORTAL_TOKEN_PEPPER = (
    os.getenv("VALORACRM_PORTAL_TOKEN_SECRET")
    or os.getenv("SECRET_KEY")
    or "valoracrm-area-cliente-dev"
)

SESSION_TTL_MINUTES = int(os.getenv("AREA_CLIENTE_SESSION_TTL_MINUTES", "120"))

MAX_TENTATIVAS = int(os.getenv("AREA_CLIENTE_MAX_TENTATIVAS", "8"))


DADOS_FIELDS = [
    "tipo_pessoa",
    "status_preenchimento",
    "origem_preenchimento",

    "nome_completo",
    "cpf",
    "rg",
    "nacionalidade",
    "profissao",
    "estado_civil",
    "data_nascimento",
    "email_pessoal",
    "telefone_pessoal",

    "razao_social",
    "cnpj",
    "email_empresa",
    "telefone_whatsapp_empresa",

    "representante_nome",
    "representante_cpf",
    "representante_rg",
    "representante_nacionalidade",
    "representante_profissao",
    "representante_estado_civil",
    "representante_data_nascimento",
    "representante_email_pessoal",
    "representante_telefone_pessoal",

    "endereco_rua",
    "endereco_numero",
    "endereco_bairro",
    "endereco_cidade",
    "endereco_uf",
    "endereco_cep",

    "observacoes_contrato",
]


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


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_aware_utc(value: Any) -> Optional[datetime]:
    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)

        return value.astimezone(timezone.utc)

    return None


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


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


def serialize_date(value: Any) -> Optional[str]:
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()

    if isinstance(value, date):
        return value.isoformat()

    return str(value)


def serialize_datetime(value: Any) -> Optional[str]:
    if not value:
        return None

    if isinstance(value, datetime):
        return value.isoformat()

    return str(value)


def model_dump_compat(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()

    return model.dict()


def allowed_model_fields(model_cls: Any) -> set[str]:
    try:
        return set(model_cls.__table__.columns.keys())
    except Exception:
        return set()


def safe_model_create(model_cls: Any, values: Dict[str, Any]):
    allowed = allowed_model_fields(model_cls)
    clean = {key: value for key, value in values.items() if key in allowed}
    return model_cls(**clean)


def set_if_exists(obj: Any, field: str, value: Any) -> None:
    if hasattr(obj, field):
        setattr(obj, field, value)


def cliente_nome(cliente: core_models.Cliente) -> str:
    return (
        norm_str(getattr(cliente, "nome", None))
        or norm_str(getattr(cliente, "nome_fantasia", None))
        or norm_str(getattr(cliente, "razao_social", None))
        or f"Cliente #{cliente.id}"
    )


def cliente_codigo(cliente: core_models.Cliente) -> str:
    return (
        norm_str(getattr(cliente, "codigo", None))
        or f"CLI-{int(cliente.id):04d}"
    )


def cliente_documento(cliente: core_models.Cliente) -> Optional[str]:
    return (
        norm_str(getattr(cliente, "cpf_cnpj", None))
        or norm_str(getattr(cliente, "cpf", None))
        or norm_str(getattr(cliente, "cnpj", None))
        or norm_str(getattr(cliente, "documento", None))
    )


def cliente_email(cliente: core_models.Cliente) -> Optional[str]:
    return (
        norm_str(getattr(cliente, "email", None))
        or norm_str(getattr(cliente, "email_pessoal", None))
        or norm_str(getattr(cliente, "email_empresa", None))
    )


def cliente_telefone(cliente: core_models.Cliente) -> Optional[str]:
    return (
        norm_str(getattr(cliente, "telefone", None))
        or norm_str(getattr(cliente, "celular", None))
        or norm_str(getattr(cliente, "whatsapp", None))
        or norm_str(getattr(cliente, "telefone_pessoal", None))
    )


def hash_token(token: str) -> str:
    raw = f"{PORTAL_TOKEN_PEPPER}:{token}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def verificar_senha(senha: str, senha_hash: str) -> bool:
    try:
        return pwd_context.verify(senha, senha_hash)
    except Exception:
        return False


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + padding).encode("utf-8"))


def session_secret() -> bytes:
    return f"{PORTAL_TOKEN_PEPPER}:portal-session".encode("utf-8")


def gerar_session_token(acesso: ClienteAcessoPortal) -> str:
    exp = now_utc() + timedelta(minutes=SESSION_TTL_MINUTES)

    payload = {
        "sid": secrets.token_urlsafe(12),
        "acesso_id": int(acesso.id),
        "empresa_id": int(acesso.empresa_id),
        "cliente_id": int(acesso.cliente_id),
        "exp": int(exp.timestamp()),
    }

    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = b64url_encode(payload_raw)

    assinatura = hmac.new(
        session_secret(),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    return f"{payload_b64}.{b64url_encode(assinatura)}"


def ler_session_token(session_token: str) -> Dict[str, Any]:
    token = norm_str(session_token)

    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Sessão pública inválida.")

    payload_b64, assinatura_b64 = token.split(".", 1)

    assinatura_esperada = hmac.new(
        session_secret(),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    try:
        assinatura_recebida = b64url_decode(assinatura_b64)
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão pública inválida.")

    if not hmac.compare_digest(assinatura_esperada, assinatura_recebida):
        raise HTTPException(status_code=401, detail="Sessão pública inválida.")

    try:
        payload = json.loads(b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão pública inválida.")

    exp = int(payload.get("exp") or 0)

    if exp < int(now_utc().timestamp()):
        raise HTTPException(status_code=401, detail="Sessão pública expirada.")

    return payload


def buscar_acesso_por_token(db: Session, token: str) -> ClienteAcessoPortal:
    token_norm = norm_str(token)

    if not token_norm:
        raise HTTPException(status_code=422, detail="Token de acesso não informado.")

    token_hash = hash_token(token_norm)

    acesso = (
        db.query(ClienteAcessoPortal)
        .filter(ClienteAcessoPortal.token_hash == token_hash)
        .first()
    )

    if not acesso:
        raise HTTPException(status_code=404, detail="Acesso não encontrado.")

    return acesso


def buscar_acesso_por_session(db: Session, session_token: str) -> ClienteAcessoPortal:
    payload = ler_session_token(session_token)

    acesso_id = int(payload.get("acesso_id") or 0)
    empresa_id = int(payload.get("empresa_id") or 0)
    cliente_id = int(payload.get("cliente_id") or 0)

    acesso = (
        db.query(ClienteAcessoPortal)
        .filter(ClienteAcessoPortal.id == acesso_id)
        .filter(ClienteAcessoPortal.empresa_id == empresa_id)
        .filter(ClienteAcessoPortal.cliente_id == cliente_id)
        .first()
    )

    if not acesso:
        raise HTTPException(status_code=401, detail="Acesso público não encontrado.")

    validar_acesso_pendente(acesso)

    return acesso


def validar_acesso_pendente(acesso: ClienteAcessoPortal) -> None:
    status_atual = str(acesso.status or "").strip().lower()

    expira_em = to_aware_utc(acesso.expira_em)

    if status_atual == "revogado":
        raise HTTPException(status_code=403, detail="Este acesso foi revogado.")

    if status_atual == "usado":
        raise HTTPException(status_code=403, detail="Este acesso já foi usado.")

    if status_atual == "expirado":
        raise HTTPException(status_code=403, detail="Este acesso expirou.")

    if expira_em and expira_em < now_utc():
        acesso.status = "expirado"
        acesso.atualizado_em = now_utc()
        raise HTTPException(status_code=403, detail="Este acesso expirou.")

    if status_atual != "pendente":
        raise HTTPException(status_code=403, detail="Este acesso não está disponível.")


def buscar_cliente(db: Session, acesso: ClienteAcessoPortal) -> core_models.Cliente:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == acesso.cliente_id)
        .filter(core_models.Cliente.empresa_id == acesso.empresa_id)
        .first()
    )

    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    return cliente


def buscar_ou_criar_dados(
    db: Session,
    empresa_id: int,
    cliente_id: int,
) -> ClienteDadosComplementares:
    dados = (
        db.query(ClienteDadosComplementares)
        .filter(ClienteDadosComplementares.empresa_id == empresa_id)
        .filter(ClienteDadosComplementares.cliente_id == cliente_id)
        .first()
    )

    if dados:
        return dados

    dados = safe_model_create(
        ClienteDadosComplementares,
        {
            "empresa_id": empresa_id,
            "cliente_id": cliente_id,
            "tipo_pessoa": "PF",
            "status_preenchimento": "pendente_cliente",
            "origem_preenchimento": "portal",
        },
    )

    db.add(dados)
    db.flush()

    return dados


def dados_to_dict(dados: Optional[ClienteDadosComplementares]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}

    if not dados:
        for field in DADOS_FIELDS:
            out[field] = None
        return out

    out["id"] = int(dados.id) if getattr(dados, "id", None) else None
    out["empresa_id"] = int(dados.empresa_id) if getattr(dados, "empresa_id", None) else None
    out["cliente_id"] = int(dados.cliente_id) if getattr(dados, "cliente_id", None) else None

    for field in DADOS_FIELDS:
        value = getattr(dados, field, None)

        if isinstance(value, (date, datetime)):
            out[field] = serialize_date(value)
        else:
            out[field] = value

    out["criado_em"] = serialize_datetime(getattr(dados, "criado_em", None))
    out["atualizado_em"] = serialize_datetime(getattr(dados, "atualizado_em", None))

    return out


def cliente_to_dict(cliente: core_models.Cliente) -> Dict[str, Any]:
    return {
        "id": int(cliente.id),
        "empresa_id": int(cliente.empresa_id),
        "codigo": cliente_codigo(cliente),
        "nome": cliente_nome(cliente),
        "documento": cliente_documento(cliente),
        "email": cliente_email(cliente),
        "telefone": cliente_telefone(cliente),
    }


def acesso_to_dict(acesso: ClienteAcessoPortal) -> Dict[str, Any]:
    return {
        "id": int(acesso.id),
        "empresa_id": int(acesso.empresa_id),
        "cliente_id": int(acesso.cliente_id),
        "token_hint": acesso.token_hint,
        "codigo_cliente": acesso.codigo_cliente,
        "status": acesso.status,
        "expira_em": serialize_datetime(acesso.expira_em),
        "ultimo_acesso_em": serialize_datetime(acesso.ultimo_acesso_em),
        "tentativas": int(acesso.tentativas or 0),
    }


def aplicar_payload_dados(
    dados: ClienteDadosComplementares,
    payload: Dict[str, Any],
    finalizar: bool,
) -> Dict[str, tuple[Any, Any]]:
    alterados: Dict[str, tuple[Any, Any]] = {}

    for field in DADOS_FIELDS:
        if field not in payload:
            continue

        if not hasattr(dados, field):
            continue

        raw_value = payload.get(field)

        if "data" in field:
            new_value = parse_date(raw_value)
        else:
            new_value = norm_str(raw_value)

        old_value = getattr(dados, field, None)

        old_cmp = serialize_date(old_value) if isinstance(old_value, (date, datetime)) else (old_value or "")
        new_cmp = serialize_date(new_value) if isinstance(new_value, (date, datetime)) else (new_value or "")

        if str(old_cmp or "") != str(new_cmp or ""):
            alterados[field] = (old_value, new_value)
            setattr(dados, field, new_value)

    set_if_exists(dados, "origem_preenchimento", "portal")

    if finalizar:
        set_if_exists(dados, "status_preenchimento", "em_analise")
    else:
        current_status = norm_str(getattr(dados, "status_preenchimento", None))
        if not current_status or current_status == "rascunho":
            set_if_exists(dados, "status_preenchimento", "pendente_cliente")

    set_if_exists(dados, "atualizado_em", now_utc())

    return alterados


def criar_historico_portal(
    db: Session,
    empresa_id: int,
    cliente_id: int,
    cliente_nome_value: str,
    descricao: str,
    campo: Optional[str] = None,
    valor_anterior: Optional[Any] = None,
    valor_novo: Optional[Any] = None,
) -> None:
    def fmt(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, (date, datetime)):
            return serialize_date(value)
        return str(value)

    row = safe_model_create(
        ClienteHistoricoAlteracao,
        {
            "empresa_id": empresa_id,
            "cliente_id": cliente_id,
            "usuario_id": None,
            "usuario_nome": cliente_nome_value,
            "tipo": "dados_complementares",
            "campo": campo,
            "valor_anterior": fmt(valor_anterior),
            "valor_novo": fmt(valor_novo),
            "descricao": descricao,
            "origem": "portal",
            "canal": "publico",
        },
    )

    db.add(row)


class LinkStatusOut(BaseModel):
    valido: bool
    status: str
    mensagem: str
    token_hint: Optional[str] = None
    expira_em: Optional[str] = None


class AutenticarPortalPayload(BaseModel):
    acesso: Optional[str] = None
    token: Optional[str] = None
    senha_provisoria: str


class PortalAutenticadoOut(BaseModel):
    ok: bool
    session_token: str
    session_expira_em_minutos: int
    acesso: Dict[str, Any]
    cliente: Dict[str, Any]
    dados: Dict[str, Any]


class SalvarDadosPortalPayload(BaseModel):
    session_token: str
    finalizar: bool = False

    tipo_pessoa: Optional[str] = None
    status_preenchimento: Optional[str] = None
    origem_preenchimento: Optional[str] = None

    nome_completo: Optional[str] = None
    cpf: Optional[str] = None
    rg: Optional[str] = None
    nacionalidade: Optional[str] = None
    profissao: Optional[str] = None
    estado_civil: Optional[str] = None
    data_nascimento: Optional[Any] = None
    email_pessoal: Optional[str] = None
    telefone_pessoal: Optional[str] = None

    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    email_empresa: Optional[str] = None
    telefone_whatsapp_empresa: Optional[str] = None

    representante_nome: Optional[str] = None
    representante_cpf: Optional[str] = None
    representante_rg: Optional[str] = None
    representante_nacionalidade: Optional[str] = None
    representante_profissao: Optional[str] = None
    representante_estado_civil: Optional[str] = None
    representante_data_nascimento: Optional[Any] = None
    representante_email_pessoal: Optional[str] = None
    representante_telefone_pessoal: Optional[str] = None

    endereco_rua: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_bairro: Optional[str] = None
    endereco_cidade: Optional[str] = None
    endereco_uf: Optional[str] = None
    endereco_cep: Optional[str] = None

    observacoes_contrato: Optional[str] = None


class SalvarDadosPortalOut(BaseModel):
    ok: bool
    finalizado: bool
    acesso: Dict[str, Any]
    cliente: Dict[str, Any]
    dados: Dict[str, Any]


@router.get("/api/area-cliente-publica/status", response_model=LinkStatusOut)
def status_link_publico(
    acesso: str = Query(...),
    db: Session = Depends(get_db),
):
    try:
        acesso_row = buscar_acesso_por_token(db, acesso)

        expira_em = to_aware_utc(acesso_row.expira_em)
        status_atual = str(acesso_row.status or "").strip().lower()

        if status_atual == "pendente" and expira_em and expira_em < now_utc():
            acesso_row.status = "expirado"
            acesso_row.atualizado_em = now_utc()
            db.commit()
            status_atual = "expirado"

        if status_atual != "pendente":
            return LinkStatusOut(
                valido=False,
                status=status_atual,
                mensagem="Este acesso não está disponível.",
                token_hint=acesso_row.token_hint,
                expira_em=serialize_datetime(acesso_row.expira_em),
            )

        return LinkStatusOut(
            valido=True,
            status="pendente",
            mensagem="Acesso válido. Informe a senha provisória para continuar.",
            token_hint=acesso_row.token_hint,
            expira_em=serialize_datetime(acesso_row.expira_em),
        )

    except HTTPException:
        raise
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura pública da Área do Cliente ainda não está pronta no banco.",
        ) from exc


@router.post("/api/area-cliente-publica/autenticar", response_model=PortalAutenticadoOut)
def autenticar_portal_cliente(
    payload: AutenticarPortalPayload,
    db: Session = Depends(get_db),
):
    token = norm_str(payload.acesso) or norm_str(payload.token)
    senha = norm_str(payload.senha_provisoria)

    if not token:
        raise HTTPException(status_code=422, detail="Token de acesso não informado.")

    if not senha:
        raise HTTPException(status_code=422, detail="Senha provisória não informada.")

    try:
        acesso = buscar_acesso_por_token(db, token)

        try:
            validar_acesso_pendente(acesso)
        except HTTPException:
            db.commit()
            raise

        if int(acesso.tentativas or 0) >= MAX_TENTATIVAS:
            acesso.status = "revogado"
            acesso.revogado_em = now_utc()
            acesso.atualizado_em = now_utc()
            db.commit()
            raise HTTPException(
                status_code=403,
                detail="Acesso bloqueado por excesso de tentativas.",
            )

        if not verificar_senha(senha, acesso.senha_provisoria_hash):
            acesso.tentativas = int(acesso.tentativas or 0) + 1
            acesso.ultimo_acesso_em = now_utc()
            acesso.atualizado_em = now_utc()
            db.commit()

            raise HTTPException(
                status_code=401,
                detail="Senha provisória incorreta.",
            )

        cliente = buscar_cliente(db, acesso)
        dados = buscar_ou_criar_dados(
            db=db,
            empresa_id=int(acesso.empresa_id),
            cliente_id=int(acesso.cliente_id),
        )

        acesso.ultimo_acesso_em = now_utc()
        acesso.atualizado_em = now_utc()

        db.commit()
        db.refresh(acesso)
        db.refresh(dados)

        session_token = gerar_session_token(acesso)

        return PortalAutenticadoOut(
            ok=True,
            session_token=session_token,
            session_expira_em_minutos=SESSION_TTL_MINUTES,
            acesso=acesso_to_dict(acesso),
            cliente=cliente_to_dict(cliente),
            dados=dados_to_dict(dados),
        )

    except HTTPException:
        raise
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura pública da Área do Cliente ainda não está pronta no banco.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao autenticar acesso público: {exc}",
        ) from exc


@router.get("/api/area-cliente-publica/dados", response_model=PortalAutenticadoOut)
def obter_dados_portal_cliente(
    session_token: str = Query(...),
    db: Session = Depends(get_db),
):
    try:
        acesso = buscar_acesso_por_session(db, session_token)
        cliente = buscar_cliente(db, acesso)
        dados = buscar_ou_criar_dados(
            db=db,
            empresa_id=int(acesso.empresa_id),
            cliente_id=int(acesso.cliente_id),
        )

        db.commit()
        db.refresh(dados)

        return PortalAutenticadoOut(
            ok=True,
            session_token=session_token,
            session_expira_em_minutos=SESSION_TTL_MINUTES,
            acesso=acesso_to_dict(acesso),
            cliente=cliente_to_dict(cliente),
            dados=dados_to_dict(dados),
        )

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao carregar dados do portal: {exc}",
        ) from exc


@router.put("/api/area-cliente-publica/dados", response_model=SalvarDadosPortalOut)
def salvar_dados_portal_cliente(
    payload: SalvarDadosPortalPayload,
    db: Session = Depends(get_db),
):
    try:
        acesso = buscar_acesso_por_session(db, payload.session_token)
        cliente = buscar_cliente(db, acesso)

        dados = buscar_ou_criar_dados(
            db=db,
            empresa_id=int(acesso.empresa_id),
            cliente_id=int(acesso.cliente_id),
        )

        payload_dict = model_dump_compat(payload)
        payload_dict.pop("session_token", None)
        finalizar = bool(payload_dict.pop("finalizar", False))

        payload_dict.pop("status_preenchimento", None)
        payload_dict.pop("origem_preenchimento", None)

        alterados = aplicar_payload_dados(
            dados=dados,
            payload=payload_dict,
            finalizar=finalizar,
        )

        cliente_nome_value = cliente_nome(cliente)

        if alterados:
            criar_historico_portal(
                db=db,
                empresa_id=int(acesso.empresa_id),
                cliente_id=int(acesso.cliente_id),
                cliente_nome_value=cliente_nome_value,
                descricao="Cliente atualizou os dados complementares pelo portal.",
            )

        if finalizar:
            acesso.status = "usado"
            acesso.usado_em = now_utc()
            acesso.atualizado_em = now_utc()

            criar_historico_portal(
                db=db,
                empresa_id=int(acesso.empresa_id),
                cliente_id=int(acesso.cliente_id),
                cliente_nome_value=cliente_nome_value,
                descricao="Cliente finalizou o preenchimento dos dados pelo portal.",
                campo="status_preenchimento",
                valor_anterior=None,
                valor_novo="em_analise",
            )

        db.commit()
        db.refresh(acesso)
        db.refresh(dados)

        return SalvarDadosPortalOut(
            ok=True,
            finalizado=finalizar,
            acesso=acesso_to_dict(acesso),
            cliente=cliente_to_dict(cliente),
            dados=dados_to_dict(dados),
        )

    except HTTPException:
        db.rollback()
        raise
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura pública da Área do Cliente ainda não está pronta no banco.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao salvar dados pelo portal: {exc}",
        ) from exc