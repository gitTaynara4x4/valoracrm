from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal

router = APIRouter(prefix="/api/cotacoes", tags=["Cotações"])

Cotacao = models.Cotacao
CotacaoFornecedor = models.CotacaoFornecedor
CampoCotacao = models.CampoCotacao
CotacaoCampoValor = models.CotacaoCampoValor

STATUS_VALIDOS = {
    "rascunho",
    "em_cotacao",
    "respondida",
    "em_analise",
    "aprovada",
    "recusada",
    "convertida",
    "cancelada",
}


# =========================================================
# Banco / autenticação
# =========================================================
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

    usuario = db.query(models.Usuario).filter(models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return int(usuario.empresa_id)


def ensure_cotacoes_schema(db: Session) -> None:
    """Cria/atualiza as tabelas do módulo de Cotações sem depender de Alembic.

    O Valora atual já usa esse estilo mais direto em alguns módulos. Mantive aqui
    para o usuário conseguir aplicar o patch e abrir a tela sem rodar migração manual.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS cotacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(50) NOT NULL,
        item_nome VARCHAR(180) NOT NULL,
        descricao TEXT NULL,
        quantidade VARCHAR(40) NULL,
        unidade VARCHAR(30) NULL,
        categoria VARCHAR(120) NULL,
        status VARCHAR(40) NOT NULL DEFAULT 'rascunho',
        urgencia VARCHAR(30) NULL,
        observacoes TEXT NULL,
        fornecedor_vencedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL,
        fornecedor_vencedor_item_id BIGINT NULL,
        valor_aprovado VARCHAR(40) NULL,
        data_aprovacao TIMESTAMPTZ NULL,
        produto_id BIGINT NULL REFERENCES produtos(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS codigo VARCHAR(50) NOT NULL DEFAULT '';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS item_nome VARCHAR(180) NOT NULL DEFAULT '';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS descricao TEXT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS quantidade VARCHAR(40) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS unidade VARCHAR(30) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS categoria VARCHAR(120) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'rascunho';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS urgencia VARCHAR(30) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS observacoes TEXT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS fornecedor_vencedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS fornecedor_vencedor_item_id BIGINT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS valor_aprovado VARCHAR(40) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS data_aprovacao TIMESTAMPTZ NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS produto_id BIGINT NULL REFERENCES produtos(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacoes_empresa_codigo ON cotacoes(empresa_id, codigo);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_empresa ON cotacoes(empresa_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_item_nome ON cotacoes(item_nome);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_status ON cotacoes(status);

    CREATE TABLE IF NOT EXISTS cotacoes_fornecedores (
        id BIGSERIAL PRIMARY KEY,
        cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        fornecedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL,
        fornecedor_nome VARCHAR(180) NULL,
        valor_unitario VARCHAR(40) NULL,
        frete VARCHAR(40) NULL,
        valor_total VARCHAR(40) NULL,
        prazo_entrega VARCHAR(80) NULL,
        condicao_pagamento VARCHAR(160) NULL,
        observacoes TEXT NULL,
        vencedor BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS fornecedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS fornecedor_nome VARCHAR(180) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS valor_unitario VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS frete VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS valor_total VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS prazo_entrega VARCHAR(80) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS condicao_pagamento VARCHAR(160) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS observacoes TEXT NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS vencedor BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_cotacao ON cotacoes_fornecedores(cotacao_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_fornecedor ON cotacoes_fornecedores(fornecedor_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_vencedor ON cotacoes_fornecedores(vencedor);

    CREATE TABLE IF NOT EXISTS campos_cotacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(120) NOT NULL,
        slug VARCHAR(120) NOT NULL,
        tipo VARCHAR(30) NOT NULL,
        obrigatorio BOOLEAN NOT NULL DEFAULT FALSE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        opcoes_json TEXT NULL,
        ordem BIGINT NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_campos_cotacoes_empresa_slug ON campos_cotacoes(empresa_id, slug);
    CREATE INDEX IF NOT EXISTS ix_campos_cotacoes_empresa ON campos_cotacoes(empresa_id);

    CREATE TABLE IF NOT EXISTS cotacoes_campos_valores (
        id BIGSERIAL PRIMARY KEY,
        cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        campo_id BIGINT NOT NULL REFERENCES campos_cotacoes(id) ON DELETE CASCADE,
        valor TEXT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_cotacoes_campos_valores_cotacao ON cotacoes_campos_valores(cotacao_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_campos_valores_campo ON cotacoes_campos_valores(campo_id);
    """
    db.execute(text(ddl))
    db.commit()


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


# =========================================================
# Helpers
# =========================================================
def dump_model(obj: BaseModel, *, exclude_unset: bool = False) -> Dict[str, Any]:
    return obj.model_dump(exclude_unset=exclude_unset) if hasattr(obj, "model_dump") else obj.dict(exclude_unset=exclude_unset)


def norm_str(value: Any) -> Optional[str]:
    text_value = str(value or "").strip()
    return text_value or None


def normalizar_codigo_sistema(codigo: Any) -> str:
    return re.sub(r"\D+", "", str(codigo or "")).strip()


def normalizar_status(status_value: Any) -> str:
    value = str(status_value or "rascunho").strip().lower().replace("-", "_").replace(" ", "_")
    return value if value in STATUS_VALIDOS else "rascunho"


def parse_decimal(value: Any) -> Optional[Decimal]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, Decimal):
        return value

    text_value = str(value).strip().replace("R$", "").replace(" ", "")
    if not text_value:
        return None

    try:
        # 1.650,00 -> 1650.00 | 1650,00 -> 1650.00
        if "," in text_value:
            text_value = text_value.replace(".", "").replace(",", ".")
        return Decimal(text_value)
    except (InvalidOperation, ValueError):
        return None


def decimal_to_str(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return f"{value.quantize(Decimal('0.01'))}"


def calcular_total(quantidade: Any, valor_unitario: Any, frete: Any) -> Optional[str]:
    qtd = parse_decimal(quantidade) or Decimal("1")
    unitario = parse_decimal(valor_unitario)
    frete_dec = parse_decimal(frete) or Decimal("0")

    if unitario is None:
        return decimal_to_str(frete_dec) if frete_dec else None

    return decimal_to_str((qtd * unitario) + frete_dec)


def gerar_codigo_cotacao(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(Cotacao)
        .filter(Cotacao.empresa_id == empresa_id)
        .order_by(Cotacao.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"{proximo:04d}"


def gerar_codigo_produto(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(models.Produto)
        .filter(models.Produto.empresa_id == empresa_id)
        .order_by(models.Produto.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"{proximo:04d}"


def buscar_cotacao_empresa(db: Session, cotacao_id: int, empresa_id: int) -> Optional[Cotacao]:
    return (
        db.query(Cotacao)
        .filter(Cotacao.id == cotacao_id)
        .filter(Cotacao.empresa_id == empresa_id)
        .first()
    )


def buscar_fornecedor_item_empresa(
    db: Session,
    item_id: int,
    cotacao_id: int,
    empresa_id: int,
) -> Optional[CotacaoFornecedor]:
    return (
        db.query(CotacaoFornecedor)
        .join(Cotacao, Cotacao.id == CotacaoFornecedor.cotacao_id)
        .filter(CotacaoFornecedor.id == item_id)
        .filter(CotacaoFornecedor.cotacao_id == cotacao_id)
        .filter(Cotacao.empresa_id == empresa_id)
        .first()
    )


def fornecedor_nome_by_id(db: Session, fornecedor_id: Optional[int], empresa_id: int) -> Optional[str]:
    if not fornecedor_id:
        return None
    fornecedor = (
        db.query(models.Fornecedor)
        .filter(models.Fornecedor.id == fornecedor_id)
        .filter(models.Fornecedor.empresa_id == empresa_id)
        .first()
    )
    return getattr(fornecedor, "nome", None) if fornecedor else None


# =========================================================
# Schemas
# =========================================================
class CotacaoFornecedorBase(BaseModel):
    fornecedor_id: Optional[int] = None
    fornecedor_nome: Optional[str] = None
    valor_unitario: Optional[str] = None
    frete: Optional[str] = None
    valor_total: Optional[str] = None
    prazo_entrega: Optional[str] = None
    condicao_pagamento: Optional[str] = None
    observacoes: Optional[str] = None
    vencedor: Optional[bool] = False


class CotacaoFornecedorCreate(CotacaoFornecedorBase):
    pass


class CotacaoFornecedorUpdate(CotacaoFornecedorBase):
    pass


class CotacaoFornecedorOut(CotacaoFornecedorBase, ORMBaseModel):
    id: int
    cotacao_id: int


class CotacaoBase(BaseModel):
    codigo: Optional[str] = None
    item_nome: Optional[str] = None
    descricao: Optional[str] = None
    quantidade: Optional[str] = None
    unidade: Optional[str] = None
    categoria: Optional[str] = None
    status: Optional[str] = "rascunho"
    urgencia: Optional[str] = None
    observacoes: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None


class CotacaoCreate(CotacaoBase):
    item_nome: str


class CotacaoUpdate(CotacaoBase):
    pass


class CotacaoOut(CotacaoBase, ORMBaseModel):
    id: int
    empresa_id: int
    fornecedor_vencedor_id: Optional[int] = None
    fornecedor_vencedor_item_id: Optional[int] = None
    fornecedor_vencedor_nome: Optional[str] = None
    valor_aprovado: Optional[str] = None
    data_aprovacao: Optional[str] = None
    produto_id: Optional[int] = None
    fornecedores: List[CotacaoFornecedorOut] = Field(default_factory=list)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class CampoCotacaoBase(BaseModel):
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    ativo: bool = True
    opcoes_json: Optional[str] = None
    ordem: int = 0


class CampoCotacaoCreate(CampoCotacaoBase):
    pass


class CampoCotacaoUpdate(CampoCotacaoBase):
    pass


class CampoCotacaoOut(CampoCotacaoBase, ORMBaseModel):
    id: int
    empresa_id: int


# =========================================================
# Serialização
# =========================================================
def cotacao_fornecedor_to_out(item: CotacaoFornecedor) -> CotacaoFornecedorOut:
    return CotacaoFornecedorOut(
        id=int(item.id),
        cotacao_id=int(item.cotacao_id),
        fornecedor_id=int(item.fornecedor_id) if item.fornecedor_id else None,
        fornecedor_nome=item.fornecedor_nome,
        valor_unitario=item.valor_unitario,
        frete=item.frete,
        valor_total=item.valor_total,
        prazo_entrega=item.prazo_entrega,
        condicao_pagamento=item.condicao_pagamento,
        observacoes=item.observacoes,
        vencedor=bool(item.vencedor),
    )


def listar_fornecedores_cotacao(db: Session, cotacao_id: int) -> List[CotacaoFornecedor]:
    return (
        db.query(CotacaoFornecedor)
        .filter(CotacaoFornecedor.cotacao_id == cotacao_id)
        .order_by(CotacaoFornecedor.vencedor.desc(), CotacaoFornecedor.id.asc())
        .all()
    )


def buscar_custom_fields_cotacao(db: Session, empresa_id: int, cotacao_id: int) -> Dict[str, Any]:
    rows = (
        db.query(CotacaoCampoValor, CampoCotacao)
        .join(CampoCotacao, CampoCotacao.id == CotacaoCampoValor.campo_id)
        .filter(CotacaoCampoValor.cotacao_id == cotacao_id)
        .filter(CampoCotacao.empresa_id == empresa_id)
        .all()
    )
    return {str(campo.slug): valor.valor or "" for valor, campo in rows}


def salvar_custom_fields_cotacao(
    db: Session,
    empresa_id: int,
    cotacao_id: int,
    custom_fields: Optional[Dict[str, Any]],
) -> None:
    if custom_fields is None:
        return

    campos = db.query(CampoCotacao).filter(CampoCotacao.empresa_id == empresa_id).all()
    campos_map = {str(c.slug): c for c in campos}

    invalidos = sorted(set(custom_fields.keys()) - set(campos_map.keys()))
    if invalidos:
        raise HTTPException(status_code=400, detail=f"Campos personalizados inválidos: {', '.join(invalidos)}")

    existentes = (
        db.query(CotacaoCampoValor)
        .join(CampoCotacao, CampoCotacao.id == CotacaoCampoValor.campo_id)
        .filter(CotacaoCampoValor.cotacao_id == cotacao_id)
        .filter(CampoCotacao.empresa_id == empresa_id)
        .all()
    )
    por_campo = {int(v.campo_id): v for v in existentes}

    for slug, raw_value in custom_fields.items():
        campo = campos_map[slug]
        campo_id = int(campo.id)
        value = None if raw_value is None else str(raw_value).strip()

        atual = por_campo.get(campo_id)
        if not value:
            if atual:
                db.delete(atual)
            continue

        if atual:
            atual.valor = value
        else:
            db.add(CotacaoCampoValor(cotacao_id=cotacao_id, campo_id=campo_id, valor=value))


def cotacao_to_out(db: Session, cotacao: Cotacao, *, include_fornecedores: bool = True) -> CotacaoOut:
    fornecedores = listar_fornecedores_cotacao(db, int(cotacao.id)) if include_fornecedores else []
    vencedor = next((item for item in fornecedores if bool(item.vencedor)), None)
    if not vencedor and cotacao.fornecedor_vencedor_item_id:
        vencedor = next((item for item in fornecedores if int(item.id) == int(cotacao.fornecedor_vencedor_item_id)), None)

    vencedor_nome = None
    if vencedor:
        vencedor_nome = vencedor.fornecedor_nome
    elif cotacao.fornecedor_vencedor_id:
        vencedor_nome = fornecedor_nome_by_id(db, int(cotacao.fornecedor_vencedor_id), int(cotacao.empresa_id))

    return CotacaoOut(
        id=int(cotacao.id),
        empresa_id=int(cotacao.empresa_id),
        codigo=cotacao.codigo or "",
        item_nome=cotacao.item_nome or "",
        descricao=cotacao.descricao,
        quantidade=cotacao.quantidade,
        unidade=cotacao.unidade,
        categoria=cotacao.categoria,
        status=cotacao.status or "rascunho",
        urgencia=cotacao.urgencia,
        observacoes=cotacao.observacoes,
        fornecedor_vencedor_id=int(cotacao.fornecedor_vencedor_id) if cotacao.fornecedor_vencedor_id else None,
        fornecedor_vencedor_item_id=int(cotacao.fornecedor_vencedor_item_id) if cotacao.fornecedor_vencedor_item_id else None,
        fornecedor_vencedor_nome=vencedor_nome,
        valor_aprovado=cotacao.valor_aprovado,
        data_aprovacao=cotacao.data_aprovacao.isoformat() if cotacao.data_aprovacao else None,
        produto_id=int(cotacao.produto_id) if cotacao.produto_id else None,
        fornecedores=[cotacao_fornecedor_to_out(item) for item in fornecedores],
        custom_fields=buscar_custom_fields_cotacao(db, int(cotacao.empresa_id), int(cotacao.id)),
    )


def aplicar_cotacao_payload(cotacao: Cotacao, payload: CotacaoBase) -> None:
    if payload.item_nome is not None and payload.item_nome.strip():
        cotacao.item_nome = payload.item_nome.strip()
    if payload.descricao is not None:
        cotacao.descricao = norm_str(payload.descricao)
    if payload.quantidade is not None:
        cotacao.quantidade = norm_str(payload.quantidade)
    if payload.unidade is not None:
        cotacao.unidade = norm_str(payload.unidade)
    if payload.categoria is not None:
        cotacao.categoria = norm_str(payload.categoria)
    if payload.status is not None:
        cotacao.status = normalizar_status(payload.status)
    if payload.urgencia is not None:
        cotacao.urgencia = norm_str(payload.urgencia)
    if payload.observacoes is not None:
        cotacao.observacoes = norm_str(payload.observacoes)


def aplicar_fornecedor_payload(
    item: CotacaoFornecedor,
    payload: CotacaoFornecedorBase,
    *,
    quantidade: Any,
    empresa_id: int,
    db: Session,
) -> None:
    if payload.fornecedor_id is not None:
        item.fornecedor_id = int(payload.fornecedor_id) if payload.fornecedor_id else None
        nome = fornecedor_nome_by_id(db, item.fornecedor_id, empresa_id)
        if nome:
            item.fornecedor_nome = nome

    if payload.fornecedor_nome is not None:
        item.fornecedor_nome = norm_str(payload.fornecedor_nome)

    if payload.valor_unitario is not None:
        item.valor_unitario = norm_str(payload.valor_unitario)

    if payload.frete is not None:
        item.frete = norm_str(payload.frete)

    if payload.valor_total is not None and norm_str(payload.valor_total):
        item.valor_total = norm_str(payload.valor_total)
    else:
        item.valor_total = calcular_total(quantidade, item.valor_unitario, item.frete)

    if payload.prazo_entrega is not None:
        item.prazo_entrega = norm_str(payload.prazo_entrega)

    if payload.condicao_pagamento is not None:
        item.condicao_pagamento = norm_str(payload.condicao_pagamento)

    if payload.observacoes is not None:
        item.observacoes = norm_str(payload.observacoes)

    if payload.vencedor is not None:
        item.vencedor = bool(payload.vencedor)


# =========================================================
# Cotações
# =========================================================
@router.get("")
def listar_cotacoes(
    busca: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    categoria: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    query = db.query(Cotacao).filter(Cotacao.empresa_id == empresa_id)

    if norm_str(status_filter):
        query = query.filter(Cotacao.status == normalizar_status(status_filter))

    if norm_str(categoria):
        query = query.filter(Cotacao.categoria.ilike(f"%{str(categoria).strip()}%"))

    texto = norm_str(busca)
    if texto:
        q = f"%{texto}%"
        query = query.filter(
            Cotacao.codigo.ilike(q)
            | Cotacao.item_nome.ilike(q)
            | Cotacao.descricao.ilike(q)
            | Cotacao.categoria.ilike(q)
        )

    query = query.order_by(Cotacao.atualizado_em.desc(), Cotacao.id.desc())

    if paginated:
        total = query.count()
        rows = query.offset(offset).limit(limit).all()
        items = [cotacao_to_out(db, row, include_fornecedores=True) for row in rows]
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
        }

    rows = query.all()
    return [cotacao_to_out(db, row, include_fornecedores=True) for row in rows]


@router.post("", response_model=CotacaoOut, status_code=status.HTTP_201_CREATED)
def criar_cotacao(
    payload: CotacaoCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    codigo = normalizar_codigo_sistema(payload.codigo) or gerar_codigo_cotacao(db, empresa_id)
    cotacao = Cotacao(
        empresa_id=empresa_id,
        codigo=codigo,
        item_nome=payload.item_nome.strip(),
        status=normalizar_status(payload.status),
    )
    aplicar_cotacao_payload(cotacao, payload)

    try:
        db.add(cotacao)
        db.flush()
        salvar_custom_fields_cotacao(db, empresa_id, int(cotacao.id), payload.custom_fields)
        db.commit()
        db.refresh(cotacao)
        return cotacao_to_out(db, cotacao)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe cotação com este código para a empresa.")
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Não foi possível criar as tabelas de cotações.") from exc

# =========================================================
# Campos personalizados simples de cotações
# =========================================================
@router.get("/campos", response_model=List[CampoCotacaoOut])
def listar_campos_cotacao(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)
    return (
        db.query(CampoCotacao)
        .filter(CampoCotacao.empresa_id == empresa_id)
        .order_by(CampoCotacao.ordem.asc(), CampoCotacao.id.asc())
        .all()
    )


@router.post("/campos", response_model=CampoCotacaoOut, status_code=status.HTTP_201_CREATED)
def criar_campo_cotacao(
    payload: CampoCotacaoCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)
    campo = CampoCotacao(empresa_id=empresa_id, **dump_model(payload))
    try:
        db.add(campo)
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe campo de cotação com este identificador.")


@router.put("/campos/{campo_id}", response_model=CampoCotacaoOut)
def atualizar_campo_cotacao(
    campo_id: int,
    payload: CampoCotacaoUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)
    campo = db.query(CampoCotacao).filter(CampoCotacao.id == campo_id, CampoCotacao.empresa_id == empresa_id).first()
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")

    data = dump_model(payload)
    for key, value in data.items():
        setattr(campo, key, value)

    try:
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe campo de cotação com este identificador.")


@router.delete("/campos/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo_cotacao(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)
    campo = db.query(CampoCotacao).filter(CampoCotacao.id == campo_id, CampoCotacao.empresa_id == empresa_id).first()
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")
    db.delete(campo)
    db.commit()
    return None



@router.get("/{cotacao_id}", response_model=CotacaoOut)
def obter_cotacao(
    cotacao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")
    return cotacao_to_out(db, cotacao)


@router.put("/{cotacao_id}", response_model=CotacaoOut)
def atualizar_cotacao(
    cotacao_id: int,
    payload: CotacaoUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    codigo = normalizar_codigo_sistema(payload.codigo)
    if codigo:
        cotacao.codigo = codigo

    aplicar_cotacao_payload(cotacao, payload)

    try:
        salvar_custom_fields_cotacao(db, empresa_id, int(cotacao.id), payload.custom_fields)
        # Recalcula totais se a quantidade mudou.
        for item in listar_fornecedores_cotacao(db, int(cotacao.id)):
            item.valor_total = calcular_total(cotacao.quantidade, item.valor_unitario, item.frete)
        db.commit()
        db.refresh(cotacao)
        return cotacao_to_out(db, cotacao)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe cotação com este código para a empresa.")


@router.delete("/{cotacao_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_cotacao(
    cotacao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    db.delete(cotacao)
    db.commit()
    return None


# =========================================================
# Fornecedores cotados
# =========================================================
@router.post("/{cotacao_id}/fornecedores", response_model=CotacaoFornecedorOut, status_code=status.HTTP_201_CREATED)
def adicionar_fornecedor_cotado(
    cotacao_id: int,
    payload: CotacaoFornecedorCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    item = CotacaoFornecedor(cotacao_id=int(cotacao.id))
    aplicar_fornecedor_payload(item, payload, quantidade=cotacao.quantidade, empresa_id=empresa_id, db=db)

    if not item.fornecedor_nome and not item.fornecedor_id:
        raise HTTPException(status_code=400, detail="Informe o fornecedor cotado.")

    try:
        if item.vencedor:
            db.query(CotacaoFornecedor).filter(CotacaoFornecedor.cotacao_id == cotacao_id).update({"vencedor": False})
        db.add(item)
        db.flush()
        if item.vencedor:
            cotacao.fornecedor_vencedor_id = item.fornecedor_id
            cotacao.fornecedor_vencedor_item_id = int(item.id)
            cotacao.valor_aprovado = item.valor_total
        db.commit()
        db.refresh(item)
        return cotacao_fornecedor_to_out(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Fornecedor já vinculado a esta cotação.")


@router.put("/{cotacao_id}/fornecedores/{item_id}", response_model=CotacaoFornecedorOut)
def atualizar_fornecedor_cotado(
    cotacao_id: int,
    item_id: int,
    payload: CotacaoFornecedorUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    item = buscar_fornecedor_item_empresa(db, item_id, cotacao_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Fornecedor cotado não encontrado.")

    aplicar_fornecedor_payload(item, payload, quantidade=cotacao.quantidade, empresa_id=empresa_id, db=db)

    if item.vencedor:
        db.query(CotacaoFornecedor).filter(CotacaoFornecedor.cotacao_id == cotacao_id, CotacaoFornecedor.id != item_id).update({"vencedor": False})
        cotacao.fornecedor_vencedor_id = item.fornecedor_id
        cotacao.fornecedor_vencedor_item_id = int(item.id)
        cotacao.valor_aprovado = item.valor_total

    db.commit()
    db.refresh(item)
    return cotacao_fornecedor_to_out(item)


@router.delete("/{cotacao_id}/fornecedores/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_fornecedor_cotado(
    cotacao_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    item = buscar_fornecedor_item_empresa(db, item_id, cotacao_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Fornecedor cotado não encontrado.")

    era_vencedor = bool(item.vencedor) or int(cotacao.fornecedor_vencedor_item_id or 0) == int(item.id)
    db.delete(item)
    if era_vencedor:
        cotacao.fornecedor_vencedor_id = None
        cotacao.fornecedor_vencedor_item_id = None
        cotacao.valor_aprovado = None
    db.commit()
    return None


@router.post("/{cotacao_id}/fornecedores/{item_id}/vencedor", response_model=CotacaoOut)
def escolher_fornecedor_vencedor(
    cotacao_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    item = buscar_fornecedor_item_empresa(db, item_id, cotacao_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Fornecedor cotado não encontrado.")

    db.query(CotacaoFornecedor).filter(CotacaoFornecedor.cotacao_id == cotacao_id).update({"vencedor": False})
    item.vencedor = True
    cotacao.fornecedor_vencedor_id = item.fornecedor_id
    cotacao.fornecedor_vencedor_item_id = int(item.id)
    cotacao.valor_aprovado = item.valor_total
    cotacao.status = "em_analise" if cotacao.status in {"rascunho", "em_cotacao", "respondida"} else cotacao.status

    db.commit()
    db.refresh(cotacao)
    return cotacao_to_out(db, cotacao)


@router.post("/{cotacao_id}/aprovar", response_model=CotacaoOut)
def aprovar_cotacao(
    cotacao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    vencedor = None
    if cotacao.fornecedor_vencedor_item_id:
        vencedor = buscar_fornecedor_item_empresa(db, int(cotacao.fornecedor_vencedor_item_id), cotacao_id, empresa_id)
    if not vencedor:
        vencedor = (
            db.query(CotacaoFornecedor)
            .filter(CotacaoFornecedor.cotacao_id == cotacao_id)
            .filter(CotacaoFornecedor.vencedor == True)
            .first()
        )

    if not vencedor:
        raise HTTPException(status_code=400, detail="Escolha o fornecedor vencedor antes de aprovar.")

    cotacao.status = "aprovada"
    cotacao.fornecedor_vencedor_id = vencedor.fornecedor_id
    cotacao.fornecedor_vencedor_item_id = int(vencedor.id)
    cotacao.valor_aprovado = vencedor.valor_total
    cotacao.data_aprovacao = datetime.utcnow()

    db.commit()
    db.refresh(cotacao)
    return cotacao_to_out(db, cotacao)


@router.post("/{cotacao_id}/converter-produto")
def converter_cotacao_em_produto(
    cotacao_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_cotacoes_schema(db)

    cotacao = buscar_cotacao_empresa(db, cotacao_id, empresa_id)
    if not cotacao:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")

    if cotacao.produto_id:
        produto = (
            db.query(models.Produto)
            .filter(models.Produto.id == int(cotacao.produto_id))
            .filter(models.Produto.empresa_id == empresa_id)
            .first()
        )
        return {
            "message": "Cotação já convertida em produto.",
            "cotacao": cotacao_to_out(db, cotacao),
            "produto": {
                "id": int(produto.id),
                "codigo": produto.codigo,
                "nome": produto.nome,
            } if produto else None,
        }

    vencedor = None
    if cotacao.fornecedor_vencedor_item_id:
        vencedor = buscar_fornecedor_item_empresa(db, int(cotacao.fornecedor_vencedor_item_id), cotacao_id, empresa_id)
    if not vencedor:
        vencedor = (
            db.query(CotacaoFornecedor)
            .filter(CotacaoFornecedor.cotacao_id == cotacao_id)
            .filter(CotacaoFornecedor.vencedor == True)
            .first()
        )
    if not vencedor:
        raise HTTPException(status_code=400, detail="Escolha e aprove um fornecedor antes de converter em produto.")

    produto = models.Produto(
        empresa_id=empresa_id,
        codigo=gerar_codigo_produto(db, empresa_id),
        nome=cotacao.item_nome.strip(),
        descricao=norm_str(cotacao.descricao),
        categoria=norm_str(cotacao.categoria),
        unidade=norm_str(cotacao.unidade),
        custo=norm_str(vencedor.valor_unitario),
        preco_venda=None,
        estoque_atual=norm_str(cotacao.quantidade),
        ativo=True,
    )

    try:
        db.add(produto)
        db.flush()
        cotacao.produto_id = int(produto.id)
        cotacao.status = "convertida"
        cotacao.fornecedor_vencedor_id = vencedor.fornecedor_id
        cotacao.fornecedor_vencedor_item_id = int(vencedor.id)
        cotacao.valor_aprovado = vencedor.valor_total
        if not cotacao.data_aprovacao:
            cotacao.data_aprovacao = datetime.utcnow()
        db.commit()
        db.refresh(cotacao)
        db.refresh(produto)
        return {
            "message": "Cotação convertida em produto com sucesso.",
            "cotacao": cotacao_to_out(db, cotacao),
            "produto": {
                "id": int(produto.id),
                "codigo": produto.codigo,
                "nome": produto.nome,
            },
        }
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Não foi possível gerar o produto. Tente novamente.")

