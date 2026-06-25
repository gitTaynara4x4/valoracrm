from __future__ import annotations

import os
import re
import shutil
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend import models as core_models
from backend.database import SessionLocal
from backend.models_contratos import Contrato, ContratoAnexo, ContratoHistoricoAlteracao

router = APIRouter(tags=["Contratos - Admin"])


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


TIPOS_CONTRATO: Dict[str, str] = {
    "monitoramento_eletronico_residencial": "Contrato de Monitoramento Eletrônico Residencial",
    "monitoramento_eletronico_comercial": "Contrato de Monitoramento Eletrônico Comercial",
    "monitoramento_eletronico_condominio": "Contrato de Monitoramento Eletrônico Condomínio",
    "outro": "Outro",
}

TIPO_SIGLAS: Dict[str, str] = {
    "monitoramento_eletronico_residencial": "MONRES",
    "monitoramento_eletronico_comercial": "MONCOM",
    "monitoramento_eletronico_condominio": "MONCOND",
    "outro": "OUT",
}

STATUS_CONTRATO: Dict[str, str] = {
    "rascunho": "Rascunho",
    "emitido": "Emitido",
    "enviado_assinatura": "Enviado para assinatura",
    "assinado": "Assinado",
    "cancelado": "Cancelado",
}

STATUS_PROPOSTA_APROVADA = {
    "aprovada",
    "aprovado",
    "aceita",
    "aceito",
    "fechada",
    "fechado",
    "ganha",
    "ganho",
}

TIPOS_DOCUMENTO_ANEXO: Dict[str, str] = {
    "contrato_assinado": "Contrato assinado",
    "contrato_emitido": "Contrato emitido",
    "documento_cliente": "Documento do cliente",
    "comprovante": "Comprovante",
    "outro": "Outro",
}

UPLOADS_CONTRATOS_DIR = Path("uploads") / "contratos"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

EXTENSOES_PERMITIDAS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".txt",
}

MIMES_PERMITIDOS_PREFIXOS = {
    "application/pdf",
    "image/",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "text/plain",
    "application/octet-stream",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


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


def serialize_date(value: Optional[Any]) -> Optional[str]:
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


def parse_decimal(value: Any) -> Optional[Decimal]:
    if value in (None, "", "null"):
        return None

    if isinstance(value, Decimal):
        return value

    text = str(value).strip()
    if not text:
        return None

    try:
        if "," in text and "." in text:
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", ".")
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def serialize_decimal(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"{Decimal(value):.2f}"
    except Exception:
        return str(value)


def fields_set(payload: BaseModel) -> set[str]:
    if hasattr(payload, "model_fields_set"):
        return set(getattr(payload, "model_fields_set"))
    return set(getattr(payload, "__fields_set__", set()))


def safe_code(value: Any, fallback: str) -> str:
    text = str(value or "").strip().upper()
    text = re.sub(r"[^A-Z0-9]+", "-", text)
    text = text.strip("-")
    return text or fallback


def safe_filename(value: Any, fallback: str = "arquivo") -> str:
    text = str(value or "").strip()
    text = text.replace("\\", "-").replace("/", "-")
    text = re.sub(r"[^A-Za-z0-9À-ÿ._ -]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or fallback


def usuario_nome(usuario: core_models.Usuario) -> Optional[str]:
    return norm_str(getattr(usuario, "nome", None)) or norm_str(getattr(usuario, "email", None))


def get_first_attr(obj: Any, names: List[str], default: Any = None) -> Any:
    if not obj:
        return default

    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value not in (None, ""):
                return value

    return default


def proposta_codigo(proposta: Any) -> Optional[str]:
    return norm_str(get_first_attr(proposta, ["codigo", "numero", "numero_proposta", "codigo_proposta"]))


def proposta_titulo(proposta: Any) -> Optional[str]:
    return norm_str(get_first_attr(proposta, ["titulo", "nome", "descricao", "assunto"]))


def proposta_total(proposta: Any) -> Optional[str]:
    value = get_first_attr(proposta, ["total", "valor_total", "valor", "valor_final"])
    return serialize_decimal(value)


def proposta_data_orcamento(proposta: Any) -> Optional[date]:
    value = get_first_attr(proposta, ["data_orcamento", "data_proposta", "data", "criado_em"])
    return parse_date(value)


def proposta_vendedor_nome(proposta: Any) -> Optional[str]:
    return norm_str(
        get_first_attr(
            proposta,
            ["vendedor_nome", "nome_vendedor", "vendedor", "usuario_nome", "responsavel_nome"],
        )
    )


def proposta_data_aprovacao(proposta: Any) -> Optional[date]:
    value = get_first_attr(
        proposta,
        ["data_aprovacao", "aprovado_em", "data_aceite", "data_fechamento", "atualizado_em"],
    )
    return parse_date(value)


def proposta_indicacao(proposta: Any) -> Optional[str]:
    return norm_str(get_first_attr(proposta, ["indicacao", "origem", "fonte", "campanha"]))


def buscar_cliente_empresa(db: Session, cliente_id: int, empresa_id: int) -> core_models.Cliente:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == cliente_id)
        .filter(core_models.Cliente.empresa_id == empresa_id)
        .first()
    )

    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    return cliente


def buscar_proposta_empresa(
    db: Session,
    proposta_id: Optional[int],
    empresa_id: int,
) -> Optional[core_models.Proposta]:
    if not proposta_id:
        return None

    proposta = (
        db.query(core_models.Proposta)
        .filter(core_models.Proposta.id == proposta_id)
        .filter(core_models.Proposta.empresa_id == empresa_id)
        .first()
    )

    if not proposta:
        raise HTTPException(status_code=404, detail="Proposta não encontrada.")

    return proposta


def validar_proposta_cliente(
    proposta: Optional[core_models.Proposta],
    cliente_id: int,
) -> None:
    if not proposta:
        return

    proposta_cliente_id = getattr(proposta, "cliente_id", None)
    if proposta_cliente_id and int(proposta_cliente_id) != int(cliente_id):
        raise HTTPException(
            status_code=422,
            detail="A proposta informada pertence a outro cliente.",
        )


def proposta_aprovada(proposta: Optional[core_models.Proposta]) -> bool:
    if not proposta:
        return False

    status_atual = str(getattr(proposta, "status", "") or "").strip().lower()
    return status_atual in STATUS_PROPOSTA_APROVADA


class ContratoCreate(BaseModel):
    cliente_id: int
    proposta_id: Optional[int] = None

    numero_contrato: Optional[str] = None
    tipo_contrato: str = "outro"
    status: str = "rascunho"

    valor_mensal: Optional[Any] = None
    data_pagamento: Optional[Any] = None
    data_inicio: Optional[Any] = None
    data_fim: Optional[Any] = None
    data_assinatura: Optional[Any] = None

    vendedor_nome: Optional[str] = None
    data_aprovacao: Optional[Any] = None
    indicacao: Optional[str] = None

    observacoes: Optional[str] = None


class ContratoUpdate(BaseModel):
    cliente_id: Optional[int] = None
    proposta_id: Optional[int] = None

    numero_contrato: Optional[str] = None
    tipo_contrato: Optional[str] = None
    status: Optional[str] = None

    valor_mensal: Optional[Any] = None
    data_pagamento: Optional[Any] = None
    data_inicio: Optional[Any] = None
    data_fim: Optional[Any] = None
    data_assinatura: Optional[Any] = None

    vendedor_nome: Optional[str] = None
    data_aprovacao: Optional[Any] = None
    indicacao: Optional[str] = None

    observacoes: Optional[str] = None
    motivo_alteracao: Optional[str] = None


class ContratoOut(ORMBaseModel):
    id: int
    empresa_id: int
    cliente_id: int
    cliente_nome: Optional[str] = None

    proposta_id: Optional[int] = None
    proposta_codigo: Optional[str] = None
    proposta_titulo: Optional[str] = None
    proposta_data: Optional[str] = None
    proposta_status: Optional[str] = None
    proposta_aprovada: bool = False

    numero_contrato: str
    tipo_contrato: str
    tipo_contrato_label: str
    status: str
    status_label: str

    valor_mensal: Optional[str] = None
    data_pagamento: Optional[str] = None
    data_inicio: Optional[str] = None
    data_fim: Optional[str] = None
    data_assinatura: Optional[str] = None

    vendedor_nome: Optional[str] = None
    data_aprovacao: Optional[str] = None
    indicacao: Optional[str] = None

    observacoes: Optional[str] = None

    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None


class ContratoHistoricoOut(ORMBaseModel):
    id: int
    empresa_id: int
    contrato_id: int
    cliente_id: int
    usuario_id: Optional[int] = None
    usuario_nome: Optional[str] = None
    tipo: str
    campo: Optional[str] = None
    valor_anterior: Optional[str] = None
    valor_novo: Optional[str] = None
    descricao: str
    criado_em: Optional[str] = None


class ContratoAnexoOut(ORMBaseModel):
    id: int
    empresa_id: int
    contrato_id: int
    cliente_id: int
    tipo_documento: Optional[str] = None
    tipo_documento_label: Optional[str] = None
    descricao: Optional[str] = None
    arquivo_nome: str
    arquivo_path: str
    arquivo_mime: Optional[str] = None
    arquivo_tamanho: Optional[int] = None
    download_url: Optional[str] = None
    usuario_id: Optional[int] = None
    usuario_nome: Optional[str] = None
    criado_em: Optional[str] = None


class OpcaoOut(BaseModel):
    value: str
    label: str


class SugestaoNumeroOut(BaseModel):
    numero_contrato: str


class PropostaAprovadaOut(BaseModel):
    id: int
    codigo: Optional[str] = None
    titulo: Optional[str] = None
    status: str
    cliente_id: Optional[int] = None
    total: Optional[str] = None
    data_orcamento: Optional[str] = None
    vendedor_nome: Optional[str] = None
    data_aprovacao: Optional[str] = None
    indicacao: Optional[str] = None
    criado_em: Optional[str] = None


class PropostaResumoOut(BaseModel):
    id: int
    cliente_id: Optional[int] = None
    cliente_nome: Optional[str] = None
    codigo: Optional[str] = None
    titulo: Optional[str] = None
    status: str
    total: Optional[str] = None
    data_orcamento: Optional[str] = None
    vendedor_nome: Optional[str] = None
    data_aprovacao: Optional[str] = None
    indicacao: Optional[str] = None
    criado_em: Optional[str] = None
    pode_importar: bool = False


def proposta_to_out(db: Session, proposta: core_models.Proposta) -> PropostaResumoOut:
    cliente_id = getattr(proposta, "cliente_id", None)
    cliente_nome = None

    if cliente_id:
        cliente = db.query(core_models.Cliente).filter(core_models.Cliente.id == cliente_id).first()
        cliente_nome = getattr(cliente, "nome", None) if cliente else None

    return PropostaResumoOut(
        id=int(proposta.id),
        cliente_id=int(cliente_id) if cliente_id else None,
        cliente_nome=cliente_nome,
        codigo=proposta_codigo(proposta),
        titulo=proposta_titulo(proposta),
        status=str(getattr(proposta, "status", "") or ""),
        total=proposta_total(proposta),
        data_orcamento=serialize_date(proposta_data_orcamento(proposta)),
        vendedor_nome=proposta_vendedor_nome(proposta),
        data_aprovacao=serialize_date(proposta_data_aprovacao(proposta)),
        indicacao=proposta_indicacao(proposta),
        criado_em=serialize_datetime(getattr(proposta, "criado_em", None)),
        pode_importar=proposta_aprovada(proposta),
    )


def montar_prefixo_numero_contrato(
    cliente: core_models.Cliente,
    tipo_contrato: str,
) -> str:
    tipo = norm_lower(tipo_contrato, set(TIPOS_CONTRATO.keys()), "outro")
    sigla = TIPO_SIGLAS.get(tipo, "OUT")

    cliente_codigo = safe_code(
        getattr(cliente, "codigo", None),
        fallback=f"CLI{int(cliente.id)}",
    )

    return f"{cliente_codigo}-{sigla}"


def garantir_tabela_codigos_sequenciais(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS codigos_sequenciais (
                empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                modulo VARCHAR(80) NOT NULL,
                ultimo_codigo BIGINT NOT NULL DEFAULT 0,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (empresa_id, modulo)
            )
            """
        )
    )


def maior_numero_contrato_existente(db: Session, empresa_id: int, prefixo: str) -> int:
    maior = 0
    pattern = re.compile(rf"^{re.escape(prefixo)}-(\d+)$")

    rows = (
        db.query(Contrato.numero_contrato)
        .filter(Contrato.empresa_id == empresa_id)
        .filter(Contrato.numero_contrato.like(f"{prefixo}-%"))
        .all()
    )

    for row in rows:
        numero_atual = row[0] if isinstance(row, tuple) else getattr(row, "numero_contrato", None)
        match = pattern.match(str(numero_atual or "").strip())
        if not match:
            continue

        try:
            maior = max(maior, int(match.group(1)))
        except (TypeError, ValueError):
            continue

    return maior


def garantir_sequencial_contrato(db: Session, empresa_id: int, prefixo: str) -> str:
    garantir_tabela_codigos_sequenciais(db)

    modulo = f"contratos:{prefixo}"
    maior_existente = maior_numero_contrato_existente(db, empresa_id, prefixo)

    db.execute(
        text(
            """
            INSERT INTO codigos_sequenciais (empresa_id, modulo, ultimo_codigo)
            VALUES (:empresa_id, :modulo, :ultimo_codigo)
            ON CONFLICT (empresa_id, modulo) DO UPDATE
            SET
                ultimo_codigo = GREATEST(codigos_sequenciais.ultimo_codigo, EXCLUDED.ultimo_codigo),
                atualizado_em = NOW()
            """
        ),
        {
            "empresa_id": empresa_id,
            "modulo": modulo,
            "ultimo_codigo": maior_existente,
        },
    )

    return modulo


def numero_contrato_existe(db: Session, empresa_id: int, numero_contrato: str) -> bool:
    return bool(
        db.query(Contrato.id)
        .filter(Contrato.empresa_id == empresa_id)
        .filter(Contrato.numero_contrato == numero_contrato)
        .first()
    )


def gerar_numero_contrato(
    db: Session,
    empresa_id: int,
    cliente: core_models.Cliente,
    tipo_contrato: str,
) -> str:
    """Mostra o próximo número provável, sem consumir sequência."""
    prefixo = montar_prefixo_numero_contrato(cliente, tipo_contrato)
    modulo = garantir_sequencial_contrato(db, empresa_id, prefixo)

    row = db.execute(
        text(
            """
            SELECT ultimo_codigo
            FROM codigos_sequenciais
            WHERE empresa_id = :empresa_id AND modulo = :modulo
            """
        ),
        {"empresa_id": empresa_id, "modulo": modulo},
    ).first()

    proximo = int(row[0] if row else 0) + 1
    return f"{prefixo}-{proximo:03d}"


def reservar_numero_contrato(
    db: Session,
    empresa_id: int,
    cliente: core_models.Cliente,
    tipo_contrato: str,
) -> str:
    """Consome a sequência no momento de salvar.

    Regra: número de contrato é do sistema, único e não deve reaproveitar
    número apagado. O front pode mostrar uma sugestão, mas o backend decide
    o número real no POST.
    """
    prefixo = montar_prefixo_numero_contrato(cliente, tipo_contrato)
    modulo = garantir_sequencial_contrato(db, empresa_id, prefixo)

    row = db.execute(
        text(
            """
            UPDATE codigos_sequenciais
            SET ultimo_codigo = ultimo_codigo + 1,
                atualizado_em = NOW()
            WHERE empresa_id = :empresa_id AND modulo = :modulo
            RETURNING ultimo_codigo
            """
        ),
        {"empresa_id": empresa_id, "modulo": modulo},
    ).first()

    if not row:
        raise HTTPException(status_code=500, detail="Não foi possível gerar o número do contrato.")

    contador = int(row[0])
    return f"{prefixo}-{contador:03d}"



def aplicar_snapshot_proposta(contrato: Contrato, proposta: Optional[core_models.Proposta]) -> None:
    if not proposta:
        contrato.proposta_codigo = None
        contrato.proposta_titulo = None
        contrato.proposta_data = None
        return

    contrato.proposta_codigo = proposta_codigo(proposta)
    contrato.proposta_titulo = proposta_titulo(proposta)
    contrato.proposta_data = proposta_data_orcamento(proposta)


def contrato_snapshot(row: Contrato) -> Dict[str, Optional[str]]:
    fields = [
        "cliente_id",
        "proposta_id",
        "numero_contrato",
        "tipo_contrato",
        "status",
        "valor_mensal",
        "data_pagamento",
        "data_inicio",
        "data_fim",
        "data_assinatura",
        "vendedor_nome",
        "data_aprovacao",
        "indicacao",
        "observacoes",
    ]

    out: Dict[str, Optional[str]] = {}
    for field in fields:
        value = getattr(row, field, None)
        if isinstance(value, date):
            out[field] = value.isoformat()
        elif isinstance(value, Decimal):
            out[field] = f"{value:.2f}"
        elif value is None:
            out[field] = None
        else:
            out[field] = str(value)

    return out


FIELD_LABELS = {
    "cliente_id": "Cliente",
    "proposta_id": "Proposta",
    "numero_contrato": "Número do contrato",
    "tipo_contrato": "Tipo de contrato",
    "status": "Status",
    "valor_mensal": "Valor mensal",
    "data_pagamento": "Data de pagamento",
    "data_inicio": "Data de início",
    "data_fim": "Data de fim",
    "data_assinatura": "Data de assinatura",
    "vendedor_nome": "Vendedor",
    "data_aprovacao": "Data de aprovação",
    "indicacao": "Indicação",
    "observacoes": "Observações",
}


def criar_historico(
    db: Session,
    contrato: Contrato,
    usuario: core_models.Usuario,
    descricao: str,
    campo: Optional[str] = None,
    valor_anterior: Optional[str] = None,
    valor_novo: Optional[str] = None,
) -> None:
    db.add(
        ContratoHistoricoAlteracao(
            empresa_id=int(contrato.empresa_id),
            contrato_id=int(contrato.id),
            cliente_id=int(contrato.cliente_id),
            usuario_id=int(usuario.id),
            usuario_nome=usuario_nome(usuario),
            tipo="contrato",
            campo=campo,
            valor_anterior=valor_anterior,
            valor_novo=valor_novo,
            descricao=descricao,
        )
    )


def criar_historico_diferencas(
    db: Session,
    contrato: Contrato,
    usuario: core_models.Usuario,
    before: Dict[str, Optional[str]],
    after: Dict[str, Optional[str]],
    motivo: Optional[str],
) -> None:
    for field, old in before.items():
        new = after.get(field)

        if (old or "") == (new or ""):
            continue

        label = FIELD_LABELS.get(field, field)
        descricao = motivo or f"Campo '{label}' alterado no contrato."

        criar_historico(
            db=db,
            contrato=contrato,
            usuario=usuario,
            descricao=descricao,
            campo=field,
            valor_anterior=old,
            valor_novo=new,
        )


def contrato_to_out(
    db: Session,
    row: Contrato,
) -> ContratoOut:
    cliente = (
        db.query(core_models.Cliente)
        .filter(core_models.Cliente.id == row.cliente_id)
        .first()
    )

    proposta = None
    if row.proposta_id:
        proposta = (
            db.query(core_models.Proposta)
            .filter(core_models.Proposta.id == row.proposta_id)
            .first()
        )

    tipo = row.tipo_contrato or "outro"
    status_atual = row.status or "rascunho"

    return ContratoOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        cliente_id=int(row.cliente_id),
        cliente_nome=getattr(cliente, "nome", None) if cliente else None,

        proposta_id=int(row.proposta_id) if row.proposta_id else None,
        proposta_codigo=row.proposta_codigo,
        proposta_titulo=row.proposta_titulo,
        proposta_data=serialize_date(row.proposta_data),
        proposta_status=getattr(proposta, "status", None) if proposta else None,
        proposta_aprovada=proposta_aprovada(proposta),

        numero_contrato=row.numero_contrato,
        tipo_contrato=tipo,
        tipo_contrato_label=TIPOS_CONTRATO.get(tipo, "Outro"),
        status=status_atual,
        status_label=STATUS_CONTRATO.get(status_atual, status_atual),

        valor_mensal=serialize_decimal(row.valor_mensal),
        data_pagamento=serialize_date(row.data_pagamento),
        data_inicio=serialize_date(row.data_inicio),
        data_fim=serialize_date(row.data_fim),
        data_assinatura=serialize_date(row.data_assinatura),

        vendedor_nome=row.vendedor_nome,
        data_aprovacao=serialize_date(row.data_aprovacao),
        indicacao=row.indicacao,

        observacoes=row.observacoes,

        criado_em=serialize_datetime(row.criado_em),
        atualizado_em=serialize_datetime(row.atualizado_em),
    )


def historico_to_out(row: ContratoHistoricoAlteracao) -> ContratoHistoricoOut:
    return ContratoHistoricoOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        contrato_id=int(row.contrato_id),
        cliente_id=int(row.cliente_id),
        usuario_id=int(row.usuario_id) if row.usuario_id else None,
        usuario_nome=row.usuario_nome,
        tipo=row.tipo,
        campo=row.campo,
        valor_anterior=row.valor_anterior,
        valor_novo=row.valor_novo,
        descricao=row.descricao,
        criado_em=serialize_datetime(row.criado_em),
    )


def anexo_to_out(row: ContratoAnexo) -> ContratoAnexoOut:
    tipo = row.tipo_documento or "outro"

    return ContratoAnexoOut(
        id=int(row.id),
        empresa_id=int(row.empresa_id),
        contrato_id=int(row.contrato_id),
        cliente_id=int(row.cliente_id),
        tipo_documento=tipo,
        tipo_documento_label=TIPOS_DOCUMENTO_ANEXO.get(tipo, "Outro"),
        descricao=row.descricao,
        arquivo_nome=row.arquivo_nome,
        arquivo_path=row.arquivo_path,
        arquivo_mime=row.arquivo_mime,
        arquivo_tamanho=int(row.arquivo_tamanho) if row.arquivo_tamanho else None,
        download_url=f"/api/contratos-admin/anexos/{int(row.id)}/download",
        usuario_id=int(row.usuario_id) if row.usuario_id else None,
        usuario_nome=row.usuario_nome,
        criado_em=serialize_datetime(row.criado_em),
    )


def buscar_contrato_empresa(db: Session, contrato_id: int, empresa_id: int) -> Contrato:
    contrato = (
        db.query(Contrato)
        .filter(Contrato.id == contrato_id)
        .filter(Contrato.empresa_id == empresa_id)
        .first()
    )

    if not contrato:
        raise HTTPException(status_code=404, detail="Contrato não encontrado.")

    return contrato


def buscar_anexo_empresa(db: Session, anexo_id: int, empresa_id: int) -> ContratoAnexo:
    anexo = (
        db.query(ContratoAnexo)
        .filter(ContratoAnexo.id == anexo_id)
        .filter(ContratoAnexo.empresa_id == empresa_id)
        .first()
    )

    if not anexo:
        raise HTTPException(status_code=404, detail="Anexo não encontrado.")

    return anexo


def validar_numero_unico(
    db: Session,
    empresa_id: int,
    numero_contrato: str,
    contrato_id: Optional[int] = None,
) -> None:
    query = (
        db.query(Contrato)
        .filter(Contrato.empresa_id == empresa_id)
        .filter(Contrato.numero_contrato == numero_contrato)
    )

    if contrato_id:
        query = query.filter(Contrato.id != contrato_id)

    if query.first():
        raise HTTPException(
            status_code=409,
            detail="Já existe um contrato com esse número nesta empresa.",
        )


def validar_upload(arquivo: UploadFile) -> tuple[str, str, str]:
    nome_original = safe_filename(arquivo.filename, fallback="arquivo")
    ext = Path(nome_original).suffix.lower()

    if not ext:
        raise HTTPException(status_code=422, detail="Arquivo sem extensão.")

    if ext not in EXTENSOES_PERMITIDAS:
        raise HTTPException(
            status_code=422,
            detail="Tipo de arquivo não permitido. Envie PDF, imagem, Word, Excel ou TXT.",
        )

    mime = arquivo.content_type or "application/octet-stream"

    mime_ok = any(
        mime == allowed or mime.startswith(allowed)
        for allowed in MIMES_PERMITIDOS_PREFIXOS
    )

    if not mime_ok:
        raise HTTPException(
            status_code=422,
            detail=f"Tipo MIME não permitido: {mime}",
        )

    return nome_original, ext, mime


def salvar_arquivo_upload(
    arquivo: UploadFile,
    empresa_id: int,
    contrato_id: int,
) -> tuple[str, int, str]:
    nome_original, ext, _mime = validar_upload(arquivo)

    base_dir = UPLOADS_CONTRATOS_DIR / f"empresa_{empresa_id}" / f"contrato_{contrato_id}"
    base_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    random_id = uuid.uuid4().hex[:10]
    nome_final = f"{timestamp}_{random_id}_{safe_filename(nome_original)}"
    destino = base_dir / nome_final

    total = 0

    try:
        with destino.open("wb") as buffer:
            while True:
                chunk = arquivo.file.read(1024 * 1024)
                if not chunk:
                    break

                total += len(chunk)

                if total > MAX_UPLOAD_BYTES:
                    try:
                        buffer.close()
                    except Exception:
                        pass

                    try:
                        destino.unlink(missing_ok=True)
                    except Exception:
                        pass

                    raise HTTPException(
                        status_code=413,
                        detail="Arquivo muito grande. Limite atual: 20 MB.",
                    )

                buffer.write(chunk)

    finally:
        try:
            arquivo.file.close()
        except Exception:
            pass

    return str(destino), total, nome_original


def remover_arquivo_fisico(path_value: Optional[str]) -> None:
    if not path_value:
        return

    try:
        path = Path(path_value)

        if path.exists() and path.is_file():
            path.unlink()
    except Exception:
        pass


@router.get("/api/contratos-admin/tipos", response_model=List[OpcaoOut])
def listar_tipos_contrato():
    return [OpcaoOut(value=value, label=label) for value, label in TIPOS_CONTRATO.items()]


@router.get("/api/contratos-admin/status", response_model=List[OpcaoOut])
def listar_status_contrato():
    return [OpcaoOut(value=value, label=label) for value, label in STATUS_CONTRATO.items()]


@router.get("/api/contratos-admin/anexos/tipos", response_model=List[OpcaoOut])
def listar_tipos_documento_anexo():
    return [OpcaoOut(value=value, label=label) for value, label in TIPOS_DOCUMENTO_ANEXO.items()]


@router.get("/api/contratos-admin/sugestao-numero", response_model=SugestaoNumeroOut)
def sugerir_numero_contrato(
    cliente_id: int = Query(...),
    tipo_contrato: str = Query("outro"),
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        cliente = buscar_cliente_empresa(db, cliente_id, empresa_id)
        tipo = norm_lower(tipo_contrato, set(TIPOS_CONTRATO.keys()), "outro")
        numero = gerar_numero_contrato(db, empresa_id, cliente, tipo)
        return SugestaoNumeroOut(numero_contrato=numero)
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc


@router.get("/api/contratos-admin/propostas-aprovadas", response_model=List[PropostaAprovadaOut])
def listar_propostas_aprovadas(
    cliente_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    query = db.query(core_models.Proposta).filter(core_models.Proposta.empresa_id == empresa_id)

    if cliente_id:
        buscar_cliente_empresa(db, cliente_id, empresa_id)
        query = query.filter(core_models.Proposta.cliente_id == cliente_id)

    rows = (
        query
        .filter(func.lower(core_models.Proposta.status).in_(list(STATUS_PROPOSTA_APROVADA)))
        .order_by(core_models.Proposta.criado_em.desc(), core_models.Proposta.id.desc())
        .limit(200)
        .all()
    )

    return [
        PropostaAprovadaOut(
            id=int(row.id),
            codigo=proposta_codigo(row),
            titulo=proposta_titulo(row),
            status=str(getattr(row, "status", "") or ""),
            cliente_id=int(row.cliente_id) if getattr(row, "cliente_id", None) else None,
            total=proposta_total(row),
            data_orcamento=serialize_date(proposta_data_orcamento(row)),
            vendedor_nome=proposta_vendedor_nome(row),
            data_aprovacao=serialize_date(proposta_data_aprovacao(row)),
            indicacao=proposta_indicacao(row),
            criado_em=serialize_datetime(getattr(row, "criado_em", None)),
        )
        for row in rows
    ]


@router.get("/api/contratos-admin/propostas/{proposta_id}/resumo", response_model=PropostaResumoOut)
def obter_resumo_proposta(
    proposta_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)
    proposta = buscar_proposta_empresa(db, proposta_id, empresa_id)
    return proposta_to_out(db, proposta)


@router.get("/api/contratos-admin", response_model=List[ContratoOut])
def listar_contratos(
    cliente_id: Optional[int] = Query(default=None),
    status_contrato: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        query = (
            db.query(Contrato)
            .outerjoin(core_models.Cliente, core_models.Cliente.id == Contrato.cliente_id)
            .filter(Contrato.empresa_id == empresa_id)
        )

        if cliente_id:
            query = query.filter(Contrato.cliente_id == cliente_id)

        if status_contrato:
            status_norm = norm_lower(status_contrato, set(STATUS_CONTRATO.keys()), "")
            if status_norm:
                query = query.filter(Contrato.status == status_norm)

        busca = norm_str(q)
        if busca:
            like = f"%{busca}%"
            query = query.filter(
                or_(
                    Contrato.numero_contrato.ilike(like),
                    Contrato.tipo_contrato.ilike(like),
                    Contrato.proposta_codigo.ilike(like),
                    Contrato.proposta_titulo.ilike(like),
                    core_models.Cliente.nome.ilike(like),
                    core_models.Cliente.cpf_cnpj.ilike(like),
                )
            )

        rows = (
            query
            .order_by(Contrato.criado_em.desc(), Contrato.id.desc())
            .limit(limit)
            .all()
        )

        return [contrato_to_out(db, row) for row in rows]

    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc


@router.get("/api/contratos-admin/{contrato_id}", response_model=ContratoOut)
def obter_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        contrato = buscar_contrato_empresa(db, contrato_id, empresa_id)
        return contrato_to_out(db, contrato)
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc


@router.post(
    "/api/contratos-admin",
    response_model=ContratoOut,
    status_code=status.HTTP_201_CREATED,
)
def criar_contrato(
    payload: ContratoCreate,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        cliente = buscar_cliente_empresa(db, payload.cliente_id, empresa_id)
        proposta = buscar_proposta_empresa(db, payload.proposta_id, empresa_id)
        validar_proposta_cliente(proposta, payload.cliente_id)

        tipo = norm_lower(payload.tipo_contrato, set(TIPOS_CONTRATO.keys()), "outro")
        status_atual = norm_lower(payload.status, set(STATUS_CONTRATO.keys()), "rascunho")

        numero = None
        for _tentativa in range(30):
            candidato = reservar_numero_contrato(db, empresa_id, cliente, tipo)
            if not numero_contrato_existe(db, empresa_id, candidato):
                numero = candidato
                break

        if not numero:
            raise HTTPException(
                status_code=409,
                detail="Não foi possível gerar um número livre para o contrato.",
            )

        vendedor_importado = proposta_vendedor_nome(proposta) if proposta else None
        data_aprovacao_importada = proposta_data_aprovacao(proposta) if proposta else None
        indicacao_importada = proposta_indicacao(proposta) if proposta else None

        contrato = Contrato(
            empresa_id=empresa_id,
            cliente_id=int(cliente.id),
            proposta_id=int(proposta.id) if proposta else None,
            numero_contrato=numero,
            tipo_contrato=tipo,
            status=status_atual,
            valor_mensal=parse_decimal(payload.valor_mensal),
            data_pagamento=parse_date(payload.data_pagamento),
            data_inicio=parse_date(payload.data_inicio),
            data_fim=parse_date(payload.data_fim),
            data_assinatura=parse_date(payload.data_assinatura),
            vendedor_nome=norm_str(payload.vendedor_nome) or vendedor_importado,
            data_aprovacao=parse_date(payload.data_aprovacao) or data_aprovacao_importada,
            indicacao=norm_str(payload.indicacao) or indicacao_importada,
            observacoes=norm_str(payload.observacoes),
        )

        aplicar_snapshot_proposta(contrato, proposta)

        db.add(contrato)
        db.flush()

        criar_historico(
            db=db,
            contrato=contrato,
            usuario=usuario,
            descricao="Contrato criado no ValoraCRM.",
        )

        db.commit()
        db.refresh(contrato)

        return contrato_to_out(db, contrato)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Não foi possível criar o contrato. Verifique se o número já existe.",
        ) from exc
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar contrato: {exc}") from exc


@router.put("/api/contratos-admin/{contrato_id}", response_model=ContratoOut)
def atualizar_contrato(
    contrato_id: int,
    payload: ContratoUpdate,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)
    changed_fields = fields_set(payload)

    try:
        contrato = buscar_contrato_empresa(db, contrato_id, empresa_id)
        before = contrato_snapshot(contrato)

        target_cliente_id = int(payload.cliente_id) if "cliente_id" in changed_fields and payload.cliente_id else int(contrato.cliente_id)
        cliente = buscar_cliente_empresa(db, target_cliente_id, empresa_id)

        target_proposta_id = payload.proposta_id if "proposta_id" in changed_fields else contrato.proposta_id
        proposta = buscar_proposta_empresa(db, target_proposta_id, empresa_id) if target_proposta_id else None
        validar_proposta_cliente(proposta, target_cliente_id)

        if "cliente_id" in changed_fields and payload.cliente_id:
            contrato.cliente_id = int(cliente.id)

        if "proposta_id" in changed_fields:
            contrato.proposta_id = int(proposta.id) if proposta else None
            aplicar_snapshot_proposta(contrato, proposta)

        # Número do contrato é código do sistema: único e imutável.
        # Mantemos qualquer numero_contrato recebido no payload apenas por compatibilidade
        # com telas antigas, mas ele não altera o registro.
        if "numero_contrato" in changed_fields:
            pass

        if "tipo_contrato" in changed_fields:
            contrato.tipo_contrato = norm_lower(payload.tipo_contrato, set(TIPOS_CONTRATO.keys()), "outro")

        if "status" in changed_fields:
            contrato.status = norm_lower(payload.status, set(STATUS_CONTRATO.keys()), "rascunho")

        if "valor_mensal" in changed_fields:
            contrato.valor_mensal = parse_decimal(payload.valor_mensal)

        if "data_pagamento" in changed_fields:
            contrato.data_pagamento = parse_date(payload.data_pagamento)

        if "data_inicio" in changed_fields:
            contrato.data_inicio = parse_date(payload.data_inicio)

        if "data_fim" in changed_fields:
            contrato.data_fim = parse_date(payload.data_fim)

        if "data_assinatura" in changed_fields:
            contrato.data_assinatura = parse_date(payload.data_assinatura)

        if "vendedor_nome" in changed_fields:
            contrato.vendedor_nome = norm_str(payload.vendedor_nome)

        if "data_aprovacao" in changed_fields:
            contrato.data_aprovacao = parse_date(payload.data_aprovacao)

        if "indicacao" in changed_fields:
            contrato.indicacao = norm_str(payload.indicacao)

        if "observacoes" in changed_fields:
            contrato.observacoes = norm_str(payload.observacoes)

        db.flush()

        after = contrato_snapshot(contrato)

        criar_historico_diferencas(
            db=db,
            contrato=contrato,
            usuario=usuario,
            before=before,
            after=after,
            motivo=norm_str(payload.motivo_alteracao),
        )

        db.commit()
        db.refresh(contrato)

        return contrato_to_out(db, contrato)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Não foi possível atualizar o contrato. Verifique se o número já existe.",
        ) from exc
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar contrato: {exc}") from exc


@router.get("/api/contratos-admin/{contrato_id}/historico", response_model=List[ContratoHistoricoOut])
def listar_historico_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        contrato = buscar_contrato_empresa(db, contrato_id, empresa_id)

        rows = (
            db.query(ContratoHistoricoAlteracao)
            .filter(ContratoHistoricoAlteracao.empresa_id == empresa_id)
            .filter(ContratoHistoricoAlteracao.contrato_id == contrato.id)
            .order_by(ContratoHistoricoAlteracao.criado_em.desc(), ContratoHistoricoAlteracao.id.desc())
            .limit(200)
            .all()
        )

        return [historico_to_out(row) for row in rows]

    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc


@router.get("/api/contratos-admin/{contrato_id}/anexos", response_model=List[ContratoAnexoOut])
def listar_anexos_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        contrato = buscar_contrato_empresa(db, contrato_id, empresa_id)

        rows = (
            db.query(ContratoAnexo)
            .filter(ContratoAnexo.empresa_id == empresa_id)
            .filter(ContratoAnexo.contrato_id == contrato.id)
            .order_by(ContratoAnexo.criado_em.desc(), ContratoAnexo.id.desc())
            .all()
        )

        return [anexo_to_out(row) for row in rows]

    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura de Contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc


@router.post(
    "/api/contratos-admin/{contrato_id}/anexos/upload",
    response_model=ContratoAnexoOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_anexo_contrato(
    contrato_id: int,
    arquivo: UploadFile = File(...),
    tipo_documento: str = Form(default="contrato_assinado"),
    descricao: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        contrato = buscar_contrato_empresa(db, contrato_id, empresa_id)

        tipo_norm = norm_lower(
            tipo_documento,
            set(TIPOS_DOCUMENTO_ANEXO.keys()),
            "outro",
        )

        arquivo_path, arquivo_tamanho, nome_original = salvar_arquivo_upload(
            arquivo=arquivo,
            empresa_id=empresa_id,
            contrato_id=int(contrato.id),
        )

        anexo = ContratoAnexo(
            empresa_id=empresa_id,
            contrato_id=int(contrato.id),
            cliente_id=int(contrato.cliente_id),
            tipo_documento=tipo_norm,
            descricao=norm_str(descricao),
            arquivo_nome=nome_original,
            arquivo_path=arquivo_path,
            arquivo_mime=arquivo.content_type or "application/octet-stream",
            arquivo_tamanho=arquivo_tamanho,
            usuario_id=int(usuario.id),
            usuario_nome=usuario_nome(usuario),
        )

        db.add(anexo)
        db.flush()

        criar_historico(
            db=db,
            contrato=contrato,
            usuario=usuario,
            descricao=f"Anexo enviado ao contrato: {nome_original}.",
            campo="anexo",
            valor_anterior=None,
            valor_novo=nome_original,
        )

        db.commit()
        db.refresh(anexo)

        return anexo_to_out(anexo)

    except HTTPException:
        db.rollback()
        raise
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="A estrutura de anexos de contratos ainda não existe no banco. Rode a query SQL da Parte 2A.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao enviar anexo: {exc}") from exc


@router.get("/api/contratos-admin/anexos/{anexo_id}/download")
def baixar_anexo_contrato(
    anexo_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)
    anexo = buscar_anexo_empresa(db, anexo_id, empresa_id)

    path = Path(anexo.arquivo_path or "")

    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado.")

    return FileResponse(
        path=str(path),
        media_type=anexo.arquivo_mime or "application/octet-stream",
        filename=anexo.arquivo_nome,
    )


@router.delete("/api/contratos-admin/anexos/{anexo_id}")
def excluir_anexo_contrato(
    anexo_id: int,
    db: Session = Depends(get_db),
    usuario: core_models.Usuario = Depends(get_current_user),
):
    empresa_id = int(usuario.empresa_id)

    try:
        anexo = buscar_anexo_empresa(db, anexo_id, empresa_id)

        contrato = buscar_contrato_empresa(db, int(anexo.contrato_id), empresa_id)

        nome_arquivo = anexo.arquivo_nome
        path_arquivo = anexo.arquivo_path

        db.delete(anexo)

        criar_historico(
            db=db,
            contrato=contrato,
            usuario=usuario,
            descricao=f"Anexo removido do contrato: {nome_arquivo}.",
            campo="anexo",
            valor_anterior=nome_arquivo,
            valor_novo=None,
        )

        db.commit()

        remover_arquivo_fisico(path_arquivo)

        return {
            "ok": True,
            "message": "Anexo removido com sucesso.",
            "anexo_id": anexo_id,
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao remover anexo: {exc}") from exc