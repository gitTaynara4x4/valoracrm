from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal

router = APIRouter(prefix="/api/financeiro", tags=["Financeiro"])


# =========================================================
# Dependências
# =========================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> models.Usuario:
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
    if getattr(usuario, "ativo", True) is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")
    return usuario


def empresa_do(usuario: models.Usuario) -> int:
    return int(usuario.empresa_id)


# =========================================================
# Helpers
# =========================================================

def norm_str(value: Any) -> Optional[str]:
    text_value = str(value or "").strip()
    return text_value or None


def parse_money(value: Any) -> Decimal:
    if value in (None, "", "null"):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value

    text_value = str(value).strip()
    if not text_value:
        return Decimal("0")

    text_value = text_value.replace("R$", "").replace(" ", "")
    if "," in text_value and "." in text_value:
        text_value = text_value.replace(".", "").replace(",", ".")
    else:
        text_value = text_value.replace(",", ".")

    try:
        return Decimal(text_value).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Valor inválido: {value}")


def to_json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row_to_dict(row: Any) -> Dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    return {k: to_json_value(v) for k, v in data.items()}


def json_safe(data: Optional[Dict[str, Any]]) -> Optional[str]:
    if data is None:
        return None
    return json.dumps({k: to_json_value(v) for k, v in data.items()}, ensure_ascii=False, default=str)


def validar_tipo_lancamento(tipo: str) -> str:
    tipo_norm = (tipo or "").strip().lower()
    if tipo_norm not in {"receber", "pagar"}:
        raise HTTPException(status_code=422, detail="tipo deve ser 'receber' ou 'pagar'.")
    return tipo_norm


def validar_status(status_value: Optional[str], tipo: str) -> str:
    status_norm = (status_value or "aberto").strip().lower()
    permitidos = {"aberto", "vencido", "parcial", "recebido", "pago", "cancelado"}
    if status_norm not in permitidos:
        raise HTTPException(status_code=422, detail="Status inválido.")
    if tipo == "receber" and status_norm == "pago":
        return "recebido"
    if tipo == "pagar" and status_norm == "recebido":
        return "pago"
    return status_norm


def status_por_valor(
    tipo: str,
    status_base: str,
    valor_total: Decimal,
    valor_pago: Decimal,
    data_vencimento: date,
) -> str:
    if status_base == "cancelado":
        return "cancelado"
    if valor_total > 0 and valor_pago >= valor_total:
        return "recebido" if tipo == "receber" else "pago"
    if valor_pago > 0:
        return "parcial"
    if data_vencimento and data_vencimento < date.today():
        return "vencido"
    return "aberto"


def ensure_tables(db: Session):
    obrigatorias = (
        "financeiro_lancamentos",
        "financeiro_categorias",
        "financeiro_formas_pagamento",
        "financeiro_contas_bancos",
        "financeiro_movimentacoes",
        "financeiro_auditoria",
    )
    placeholders = ", ".join(f"'{nome}'" for nome in obrigatorias)
    existentes = {
        r[0]
        for r in db.execute(text(f"""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ({placeholders})
        """)).fetchall()
    }
    faltantes = [nome for nome in obrigatorias if nome not in existentes]
    if faltantes:
        raise HTTPException(
            status_code=500,
            detail=(
                "Estrutura financeira incompleta. Execute "
                "sql/financeiro/001_base_financeiro_segura.sql. "
                f"Tabelas ausentes: {', '.join(faltantes)}."
            ),
        )


def sincronizar_status_lancamentos(db: Session, empresa_id: int) -> None:
    result = db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET status = CASE
               WHEN valor_total > 0 AND valor_pago >= valor_total
                   THEN CASE WHEN tipo = 'receber' THEN 'recebido' ELSE 'pago' END
               WHEN valor_pago > 0 THEN 'parcial'
               WHEN data_vencimento < CURRENT_DATE THEN 'vencido'
               ELSE 'aberto'
           END,
           atualizado_em = CASE
               WHEN status IS DISTINCT FROM CASE
                   WHEN valor_total > 0 AND valor_pago >= valor_total
                       THEN CASE WHEN tipo = 'receber' THEN 'recebido' ELSE 'pago' END
                   WHEN valor_pago > 0 THEN 'parcial'
                   WHEN data_vencimento < CURRENT_DATE THEN 'vencido'
                   ELSE 'aberto'
               END THEN NOW()
               ELSE atualizado_em
           END
         WHERE empresa_id = :empresa_id
           AND status <> 'cancelado'
    """), {"empresa_id": empresa_id})
    if result.rowcount:
        db.commit()


def registrar_auditoria(
    db: Session,
    *,
    empresa_id: int,
    usuario_id: Optional[int],
    acao: str,
    entidade: str,
    entidade_id: int,
    anteriores: Optional[Dict[str, Any]] = None,
    novos: Optional[Dict[str, Any]] = None,
    motivo: Optional[str] = None,
) -> None:
    db.execute(text("""
        INSERT INTO public.financeiro_auditoria (
            empresa_id, usuario_id, acao, entidade, entidade_id,
            dados_anteriores, dados_novos, motivo, criado_em
        ) VALUES (
            :empresa_id, :usuario_id, :acao, :entidade, :entidade_id,
            CAST(:anteriores AS JSONB), CAST(:novos AS JSONB), :motivo, NOW()
        )
    """), {
        "empresa_id": empresa_id,
        "usuario_id": usuario_id,
        "acao": acao,
        "entidade": entidade,
        "entidade_id": entidade_id,
        "anteriores": json_safe(anteriores),
        "novos": json_safe(novos),
        "motivo": norm_str(motivo),
    })


def validar_id_empresa(
    db: Session,
    *,
    table_name: str,
    item_id: Optional[int],
    empresa_id: int,
    label: str,
) -> None:
    if item_id is None:
        return
    permitidas = {
        "clientes",
        "fornecedores",
        "financeiro_categorias",
        "financeiro_formas_pagamento",
        "financeiro_contas_bancos",
    }
    if table_name not in permitidas:
        raise RuntimeError("Tabela não permitida na validação financeira.")
    existe = db.execute(
        text(f"SELECT 1 FROM public.{table_name} WHERE id = :id AND empresa_id = :empresa_id LIMIT 1"),
        {"id": item_id, "empresa_id": empresa_id},
    ).first()
    if not existe:
        raise HTTPException(status_code=422, detail=f"{label} não pertence à empresa atual ou não existe.")


def validar_referencias_lancamento(
    db: Session,
    *,
    empresa_id: int,
    tipo: str,
    cliente_id: Optional[int],
    fornecedor_id: Optional[int],
    categoria_id: Optional[int],
    forma_pagamento_id: Optional[int],
    conta_banco_id: Optional[int],
) -> None:
    if tipo == "receber" and fornecedor_id is not None:
        raise HTTPException(status_code=422, detail="Conta a receber não pode usar fornecedor.")
    if tipo == "pagar" and cliente_id is not None:
        raise HTTPException(status_code=422, detail="Conta a pagar não pode usar cliente.")

    validar_id_empresa(db, table_name="clientes", item_id=cliente_id, empresa_id=empresa_id, label="Cliente")
    validar_id_empresa(db, table_name="fornecedores", item_id=fornecedor_id, empresa_id=empresa_id, label="Fornecedor")
    validar_id_empresa(db, table_name="financeiro_categorias", item_id=categoria_id, empresa_id=empresa_id, label="Categoria")
    validar_id_empresa(db, table_name="financeiro_formas_pagamento", item_id=forma_pagamento_id, empresa_id=empresa_id, label="Forma de pagamento")
    validar_id_empresa(db, table_name="financeiro_contas_bancos", item_id=conta_banco_id, empresa_id=empresa_id, label="Conta/Banco")

    if categoria_id is not None:
        categoria = db.execute(text("""
            SELECT tipo FROM public.financeiro_categorias
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": categoria_id, "empresa_id": empresa_id}).scalar()
        esperado = "receita" if tipo == "receber" else "despesa"
        if categoria not in {"ambos", esperado}:
            raise HTTPException(status_code=422, detail=f"A categoria selecionada não aceita lançamentos de {esperado}.")


def validar_referencias_baixa(
    db: Session,
    *,
    empresa_id: int,
    forma_pagamento_id: Optional[int],
    conta_banco_id: Optional[int],
) -> None:
    validar_id_empresa(db, table_name="financeiro_formas_pagamento", item_id=forma_pagamento_id, empresa_id=empresa_id, label="Forma de pagamento")
    validar_id_empresa(db, table_name="financeiro_contas_bancos", item_id=conta_banco_id, empresa_id=empresa_id, label="Conta/Banco")


# =========================================================
# Schemas
# =========================================================

class CategoriaIn(BaseModel):
    nome: str
    tipo: str = "ambos"
    cor: Optional[str] = None
    ativo: bool = True


class FormaPagamentoIn(BaseModel):
    nome: str
    tipo: Optional[str] = None
    ativo: bool = True


class ContaBancoIn(BaseModel):
    nome: str
    banco: Optional[str] = None
    agencia: Optional[str] = None
    conta: Optional[str] = None
    saldo_inicial: Optional[Any] = 0
    data_saldo_inicial: Optional[date] = None
    ativo: bool = True


class LancamentoIn(BaseModel):
    tipo: str
    descricao: str
    moeda: str = "BRL"
    valor_total: Any
    valor_pago: Optional[Any] = 0  # compatibilidade; o backend não aceita edição direta

    data_emissao: Optional[date] = None
    data_vencimento: date
    data_pagamento: Optional[date] = None  # calculada pelas movimentações
    status: Optional[str] = "aberto"

    cliente_id: Optional[int] = None
    fornecedor_id: Optional[int] = None
    categoria_id: Optional[int] = None
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: Optional[int] = None

    documento: Optional[str] = None
    observacoes: Optional[str] = None
    anexo_url: Optional[str] = None

    recorrente: bool = False
    parcelado: bool = False
    parcela_numero: Optional[int] = None
    parcela_total: Optional[int] = None
    grupo_recorrencia: Optional[str] = None


class BaixaIn(BaseModel):
    valor_baixa: Optional[Any] = None
    valor_pago: Optional[Any] = None  # compatibilidade com front antigo
    data_pagamento: Optional[date] = None
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: Optional[int] = None
    observacoes: Optional[str] = None


class CancelamentoIn(BaseModel):
    motivo: str


class EstornoIn(BaseModel):
    motivo: str
    data_estorno: Optional[date] = None


# =========================================================
# Select base
# =========================================================

LANCAMENTO_SELECT = """
SELECT
    l.*,
    GREATEST(l.valor_total - l.valor_pago, 0) AS saldo_aberto,
    c.nome AS cliente_nome,
    f.nome AS fornecedor_nome,
    cat.nome AS categoria_nome,
    fp.nome AS forma_pagamento_nome,
    cb.nome AS conta_banco_nome,
    uc.nome AS criado_por_nome,
    ua.nome AS atualizado_por_nome,
    ucan.nome AS cancelado_por_nome
FROM public.financeiro_lancamentos l
LEFT JOIN public.clientes c
       ON c.id = l.cliente_id
      AND c.empresa_id = l.empresa_id
LEFT JOIN public.fornecedores f
       ON f.id = l.fornecedor_id
      AND f.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_categorias cat
       ON cat.id = l.categoria_id
      AND cat.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_formas_pagamento fp
       ON fp.id = l.forma_pagamento_id
      AND fp.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_contas_bancos cb
       ON cb.id = l.conta_banco_id
      AND cb.empresa_id = l.empresa_id
LEFT JOIN public.usuarios uc ON uc.id = l.criado_por_usuario_id
LEFT JOIN public.usuarios ua ON ua.id = l.atualizado_por_usuario_id
LEFT JOIN public.usuarios ucan ON ucan.id = l.cancelado_por_usuario_id
"""


def obter_lancamento_dict(db: Session, empresa_id: int, lancamento_id: int, *, for_update: bool = False) -> Dict[str, Any]:
    if for_update:
        row = db.execute(text("""
            SELECT * FROM public.financeiro_lancamentos
            WHERE empresa_id = :empresa_id AND id = :id
            FOR UPDATE
        """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    else:
        row = db.execute(text(LANCAMENTO_SELECT + """
            WHERE l.empresa_id = :empresa_id AND l.id = :id LIMIT 1
        """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    return row_to_dict(row)


def recalcular_lancamento(db: Session, empresa_id: int, lancamento_id: int, usuario_id: int) -> Dict[str, Any]:
    atual = obter_lancamento_dict(db, empresa_id, lancamento_id, for_update=True)
    total_movimentado = db.execute(text("""
        SELECT COALESCE(SUM(
            CASE WHEN tipo_movimentacao = 'baixa' THEN valor ELSE -valor END
        ), 0)
        FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id AND lancamento_id = :lancamento_id
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar() or Decimal("0")
    total_movimentado = max(Decimal("0"), Decimal(str(total_movimentado)))

    ultima_data = db.execute(text("""
        SELECT MAX(b.data_movimentacao)
        FROM public.financeiro_movimentacoes b
        WHERE b.empresa_id = :empresa_id
          AND b.lancamento_id = :lancamento_id
          AND b.tipo_movimentacao = 'baixa'
          AND NOT EXISTS (
              SELECT 1
              FROM public.financeiro_movimentacoes e
              WHERE e.empresa_id = b.empresa_id
                AND e.movimentacao_origem_id = b.id
                AND e.tipo_movimentacao = 'estorno'
          )
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar()

    valor_total = parse_money(atual["valor_total"])
    status_final = status_por_valor(
        str(atual["tipo"]),
        str(atual["status"]),
        valor_total,
        total_movimentado,
        date.fromisoformat(str(atual["data_vencimento"])[:10]),
    )
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET valor_pago = :valor_pago,
               data_pagamento = :data_pagamento,
               status = :status,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id,
        "id": lancamento_id,
        "valor_pago": total_movimentado,
        "data_pagamento": ultima_data,
        "status": status_final,
        "usuario_id": usuario_id,
    })
    return {
        "valor_pago": float(total_movimentado),
        "data_pagamento": ultima_data.isoformat() if ultima_data else None,
        "status": status_final,
        "saldo_aberto": float(max(Decimal("0"), valor_total - total_movimentado)),
    }


# =========================================================
# Opções para selects
# =========================================================

@router.get("/opcoes")
def opcoes_financeiro(
    busca_cliente: Optional[str] = Query(default=None),
    busca_fornecedor: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    params = {"empresa_id": empresa_id}

    categorias = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_categorias
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    formas = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_formas_pagamento
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    contas = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    cliente_where = "empresa_id = :empresa_id"
    cliente_params = dict(params)
    if busca_cliente and busca_cliente.strip():
        cliente_where += " AND (codigo ILIKE :busca_cliente OR nome ILIKE :busca_cliente OR email ILIKE :busca_cliente)"
        cliente_params["busca_cliente"] = f"%{busca_cliente.strip()}%"

    clientes = [row_to_dict(r) for r in db.execute(text(f"""
        SELECT id, codigo, nome, email, telefone, whatsapp
        FROM public.clientes
        WHERE {cliente_where}
        ORDER BY nome ASC, id ASC
        LIMIT 250
    """), cliente_params).fetchall()]

    fornecedor_where = "empresa_id = :empresa_id"
    fornecedor_params = dict(params)
    if busca_fornecedor and busca_fornecedor.strip():
        fornecedor_where += " AND (codigo ILIKE :busca_fornecedor OR nome ILIKE :busca_fornecedor OR email ILIKE :busca_fornecedor)"
        fornecedor_params["busca_fornecedor"] = f"%{busca_fornecedor.strip()}%"

    fornecedores = [row_to_dict(r) for r in db.execute(text(f"""
        SELECT id, codigo, nome, email, telefone, whatsapp
        FROM public.fornecedores
        WHERE {fornecedor_where}
        ORDER BY nome ASC, id ASC
        LIMIT 250
    """), fornecedor_params).fetchall()]

    return {
        "categorias": categorias,
        "formas_pagamento": formas,
        "contas_bancos": contas,
        "clientes": clientes,
        "fornecedores": fornecedores,
    }


# =========================================================
# Dashboard
# =========================================================

@router.get("/dashboard")
def dashboard_financeiro(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    sincronizar_status_lancamentos(db, empresa_id)
    params = {"empresa_id": empresa_id}

    resumo = row_to_dict(db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status <> 'cancelado'
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS total_receber,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status <> 'cancelado'
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS total_pagar,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status <> 'cancelado' AND data_vencimento < CURRENT_DATE
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS receber_vencido,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status <> 'cancelado' AND data_vencimento < CURRENT_DATE
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS pagar_vencido,
            COUNT(*) AS total_lancamentos
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
    """), params).first())

    mov = row_to_dict(db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN l.tipo = 'receber'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE 0 END), 0) AS recebido,
            COALESCE(SUM(CASE WHEN l.tipo = 'pagar'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE 0 END), 0) AS pago
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
    """), params).first())

    saldo_inicial = db.execute(text("""
        SELECT COALESCE(SUM(saldo_inicial), 0)
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
    """), params).scalar() or Decimal("0")

    resumo.update(mov)
    total_receber = Decimal(str(resumo.get("total_receber") or 0))
    total_pagar = Decimal(str(resumo.get("total_pagar") or 0))
    recebido = Decimal(str(resumo.get("recebido") or 0))
    pago = Decimal(str(resumo.get("pago") or 0))
    saldo_inicial_dec = Decimal(str(saldo_inicial))
    saldo_realizado = saldo_inicial_dec + recebido - pago
    resumo["saldo_inicial"] = float(saldo_inicial_dec)
    resumo["saldo_realizado"] = float(saldo_realizado)
    resumo["saldo_atual"] = float(saldo_realizado)
    resumo["saldo_previsto"] = float(saldo_realizado + total_receber - total_pagar)

    proximos = db.execute(text(LANCAMENTO_SELECT + """
        WHERE l.empresa_id = :empresa_id
          AND l.status NOT IN ('pago', 'recebido', 'cancelado')
        ORDER BY l.data_vencimento ASC, l.id DESC
        LIMIT 12
    """), params).fetchall()

    return {
        "resumo": resumo,
        "proximos_vencimentos": [row_to_dict(r) for r in proximos],
    }


# =========================================================
# Lançamentos
# =========================================================

def _listar_lancamentos_impl(
    *,
    tipo: Optional[str],
    status_filtro: Optional[str],
    data_inicio: Optional[date],
    data_fim: Optional[date],
    busca: Optional[str],
    limit: int,
    offset: int,
    db: Session,
    empresa_id: int,
):
    ensure_tables(db)
    sincronizar_status_lancamentos(db, empresa_id)
    where = ["l.empresa_id = :empresa_id"]
    params: Dict[str, Any] = {"empresa_id": empresa_id, "limit": limit, "offset": offset}

    if tipo:
        where.append("l.tipo = :tipo")
        params["tipo"] = validar_tipo_lancamento(tipo)

    if status_filtro:
        status_norm = status_filtro.strip().lower()
        if status_norm not in {"aberto", "vencido", "parcial", "recebido", "pago", "cancelado"}:
            raise HTTPException(status_code=422, detail="Status de filtro inválido.")
        where.append("l.status = :status")
        params["status"] = status_norm

    if data_inicio:
        where.append("l.data_vencimento >= :data_inicio")
        params["data_inicio"] = data_inicio
    if data_fim:
        where.append("l.data_vencimento <= :data_fim")
        params["data_fim"] = data_fim
    if busca and busca.strip():
        where.append("(l.descricao ILIKE :busca OR l.documento ILIKE :busca OR c.nome ILIKE :busca OR f.nome ILIKE :busca)")
        params["busca"] = f"%{busca.strip()}%"

    where_sql = " AND ".join(where)
    total = db.execute(text("""
        SELECT COUNT(*)
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
        LEFT JOIN public.fornecedores f ON f.id = l.fornecedor_id AND f.empresa_id = l.empresa_id
        WHERE """ + where_sql), params).scalar() or 0

    rows = db.execute(text(LANCAMENTO_SELECT + f"""
        WHERE {where_sql}
        ORDER BY l.data_vencimento ASC, l.id DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()
    items = [row_to_dict(r) for r in rows]
    return {"items": items, "total": int(total), "limit": limit, "offset": offset, "has_more": offset + len(items) < int(total)}


@router.get("/lancamentos")
def listar_lancamentos(
    tipo: Optional[str] = Query(default=None),
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo=tipo, status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, limit=limit, offset=offset,
        db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/contas-receber")
def listar_contas_receber(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo="receber", status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, limit=limit, offset=offset,
        db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/contas-pagar")
def listar_contas_pagar(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo="pagar", status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, limit=limit, offset=offset,
        db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/lancamentos/{lancamento_id}")
def obter_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    sincronizar_status_lancamentos(db, empresa_id)
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


def montar_params_lancamento(payload: LancamentoIn, empresa_id: int, db: Session) -> Dict[str, Any]:
    tipo = validar_tipo_lancamento(payload.tipo)
    descricao = (payload.descricao or "").strip()
    if not descricao:
        raise HTTPException(status_code=422, detail="Descrição é obrigatória.")
    valor_total = parse_money(payload.valor_total)
    if valor_total <= 0:
        raise HTTPException(status_code=422, detail="Valor total deve ser maior que zero.")
    moeda = (payload.moeda or "BRL").strip().upper()
    if moeda not in {"BRL", "USD", "EUR", "GBP"}:
        raise HTTPException(status_code=422, detail="Moeda inválida.")
    validar_referencias_lancamento(
        db,
        empresa_id=empresa_id,
        tipo=tipo,
        cliente_id=payload.cliente_id,
        fornecedor_id=payload.fornecedor_id,
        categoria_id=payload.categoria_id,
        forma_pagamento_id=payload.forma_pagamento_id,
        conta_banco_id=payload.conta_banco_id,
    )
    return {
        "empresa_id": empresa_id,
        "tipo": tipo,
        "descricao": descricao,
        "moeda": moeda,
        "valor_total": valor_total,
        "data_emissao": payload.data_emissao or date.today(),
        "data_vencimento": payload.data_vencimento,
        "cliente_id": payload.cliente_id,
        "fornecedor_id": payload.fornecedor_id,
        "categoria_id": payload.categoria_id,
        "forma_pagamento_id": payload.forma_pagamento_id,
        "conta_banco_id": payload.conta_banco_id,
        "documento": norm_str(payload.documento),
        "observacoes": norm_str(payload.observacoes),
        "anexo_url": norm_str(payload.anexo_url),
        "recorrente": payload.recorrente,
        "parcelado": payload.parcelado,
        "parcela_numero": payload.parcela_numero,
        "parcela_total": payload.parcela_total,
        "grupo_recorrencia": norm_str(payload.grupo_recorrencia),
    }


@router.post("/lancamentos", status_code=status.HTTP_201_CREATED)
def criar_lancamento(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    if parse_money(payload.valor_pago) != 0:
        raise HTTPException(status_code=422, detail="O valor pago/recebido deve ser registrado pela ação Baixar.")
    params = montar_params_lancamento(payload, empresa_id, db)
    params["usuario_id"] = int(usuario.id)
    params["status"] = status_por_valor(params["tipo"], "aberto", params["valor_total"], Decimal("0"), params["data_vencimento"])
    row = db.execute(text("""
        INSERT INTO public.financeiro_lancamentos (
            empresa_id, tipo, descricao, moeda, valor_total, valor_pago,
            data_emissao, data_vencimento, data_pagamento, status,
            cliente_id, fornecedor_id, categoria_id, forma_pagamento_id, conta_banco_id,
            documento, observacoes, anexo_url,
            recorrente, parcelado, parcela_numero, parcela_total, grupo_recorrencia,
            criado_por_usuario_id, atualizado_por_usuario_id, criado_em, atualizado_em
        ) VALUES (
            :empresa_id, :tipo, :descricao, :moeda, :valor_total, 0,
            :data_emissao, :data_vencimento, NULL, :status,
            :cliente_id, :fornecedor_id, :categoria_id, :forma_pagamento_id, :conta_banco_id,
            :documento, :observacoes, :anexo_url,
            :recorrente, :parcelado, :parcela_numero, :parcela_total, :grupo_recorrencia,
            :usuario_id, :usuario_id, NOW(), NOW()
        ) RETURNING id
    """), params).first()
    lancamento_id = int(row[0])
    novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar",
        entidade="lancamento", entidade_id=lancamento_id, novos=novo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.post("/contas-receber", status_code=status.HTTP_201_CREATED)
def criar_conta_receber(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    payload.tipo = "receber"
    return criar_lancamento(payload, db=db, usuario=usuario)


@router.post("/contas-pagar", status_code=status.HTTP_201_CREATED)
def criar_conta_pagar(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    payload.tipo = "pagar"
    return criar_lancamento(payload, db=db, usuario=usuario)


@router.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(
    lancamento_id: int,
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_dict(db, empresa_id, lancamento_id, for_update=True)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="Lançamento cancelado não pode ser editado.")
    params = montar_params_lancamento(payload, empresa_id, db)
    valor_pago_atual = parse_money(anterior["valor_pago"])
    if params["valor_total"] < valor_pago_atual:
        raise HTTPException(status_code=422, detail="Valor total não pode ser menor que o valor já baixado.")
    if str(anterior["tipo"]) != params["tipo"] and valor_pago_atual > 0:
        raise HTTPException(status_code=409, detail="Não é permitido trocar o tipo de um lançamento que possui movimentações.")

    params.update({
        "id": lancamento_id,
        "usuario_id": int(usuario.id),
        "status": status_por_valor(
            params["tipo"], str(anterior["status"]), params["valor_total"],
            valor_pago_atual, params["data_vencimento"],
        ),
    })
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET tipo = :tipo,
               descricao = :descricao,
               moeda = :moeda,
               valor_total = :valor_total,
               data_emissao = :data_emissao,
               data_vencimento = :data_vencimento,
               status = :status,
               cliente_id = :cliente_id,
               fornecedor_id = :fornecedor_id,
               categoria_id = :categoria_id,
               forma_pagamento_id = :forma_pagamento_id,
               conta_banco_id = :conta_banco_id,
               documento = :documento,
               observacoes = :observacoes,
               anexo_url = :anexo_url,
               recorrente = :recorrente,
               parcelado = :parcelado,
               parcela_numero = :parcela_numero,
               parcela_total = :parcela_total,
               grupo_recorrencia = :grupo_recorrencia,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), params)
    novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar",
        entidade="lancamento", entidade_id=lancamento_id,
        anteriores=anterior, novos=novo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.patch("/lancamentos/{lancamento_id}/baixar")
def baixar_lancamento(
    lancamento_id: int,
    payload: BaixaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_dict(db, empresa_id, lancamento_id, for_update=True)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="Não é possível baixar um lançamento cancelado.")

    valor_baixa = parse_money(payload.valor_baixa if payload.valor_baixa is not None else payload.valor_pago)
    if valor_baixa <= 0:
        raise HTTPException(status_code=422, detail="O valor desta baixa deve ser maior que zero.")
    saldo_aberto = parse_money(anterior["valor_total"]) - parse_money(anterior["valor_pago"])
    if saldo_aberto <= 0:
        raise HTTPException(status_code=409, detail="Este lançamento já está totalmente baixado.")
    if valor_baixa > saldo_aberto:
        raise HTTPException(status_code=422, detail=f"A baixa não pode superar o saldo aberto de R$ {saldo_aberto:.2f}.")

    forma_id = payload.forma_pagamento_id or anterior.get("forma_pagamento_id")
    conta_id = payload.conta_banco_id or anterior.get("conta_banco_id")
    validar_referencias_baixa(
        db, empresa_id=empresa_id,
        forma_pagamento_id=int(forma_id) if forma_id else None,
        conta_banco_id=int(conta_id) if conta_id else None,
    )

    mov = db.execute(text("""
        INSERT INTO public.financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            data_movimentacao, forma_pagamento_id, conta_banco_id,
            observacoes, usuario_id, criado_em
        ) VALUES (
            :empresa_id, :lancamento_id, 'baixa', :valor,
            :data_movimentacao, :forma_pagamento_id, :conta_banco_id,
            :observacoes, :usuario_id, NOW()
        ) RETURNING id
    """), {
        "empresa_id": empresa_id,
        "lancamento_id": lancamento_id,
        "valor": valor_baixa,
        "data_movimentacao": payload.data_pagamento or date.today(),
        "forma_pagamento_id": forma_id,
        "conta_banco_id": conta_id,
        "observacoes": norm_str(payload.observacoes),
        "usuario_id": int(usuario.id),
    }).first()
    movimento_id = int(mov[0])

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET forma_pagamento_id = COALESCE(:forma_pagamento_id, forma_pagamento_id),
               conta_banco_id = COALESCE(:conta_banco_id, conta_banco_id),
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id,
        "id": lancamento_id,
        "forma_pagamento_id": forma_id,
        "conta_banco_id": conta_id,
        "usuario_id": int(usuario.id),
    })
    calculado = recalcular_lancamento(db, empresa_id, lancamento_id, int(usuario.id))
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="baixar",
        entidade="lancamento", entidade_id=lancamento_id,
        anteriores=anterior,
        novos={"movimentacao_id": movimento_id, "valor_baixa": float(valor_baixa), **calculado},
        motivo=payload.observacoes,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.get("/lancamentos/{lancamento_id}/historico")
def historico_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    lancamento = obter_lancamento_dict(db, empresa_id, lancamento_id)
    movimentacoes = [row_to_dict(r) for r in db.execute(text("""
        SELECT
            m.*,
            u.nome AS usuario_nome,
            fp.nome AS forma_pagamento_nome,
            cb.nome AS conta_banco_nome,
            EXISTS (
                SELECT 1 FROM public.financeiro_movimentacoes e
                WHERE e.empresa_id = m.empresa_id
                  AND e.movimentacao_origem_id = m.id
                  AND e.tipo_movimentacao = 'estorno'
            ) AS estornada
        FROM public.financeiro_movimentacoes m
        LEFT JOIN public.usuarios u ON u.id = m.usuario_id
        LEFT JOIN public.financeiro_formas_pagamento fp
               ON fp.id = m.forma_pagamento_id AND fp.empresa_id = m.empresa_id
        LEFT JOIN public.financeiro_contas_bancos cb
               ON cb.id = m.conta_banco_id AND cb.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id AND m.lancamento_id = :lancamento_id
        ORDER BY m.criado_em DESC, m.id DESC
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).fetchall()]
    auditoria = [row_to_dict(r) for r in db.execute(text("""
        SELECT a.*, u.nome AS usuario_nome
        FROM public.financeiro_auditoria a
        LEFT JOIN public.usuarios u ON u.id = a.usuario_id
        WHERE a.empresa_id = :empresa_id
          AND a.entidade = 'lancamento'
          AND a.entidade_id = :lancamento_id
        ORDER BY a.criado_em DESC, a.id DESC
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).fetchall()]
    return {"lancamento": lancamento, "movimentacoes": movimentacoes, "auditoria": auditoria}


@router.patch("/movimentacoes/{movimentacao_id}/estornar")
def estornar_movimentacao(
    movimentacao_id: int,
    payload: EstornoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="O motivo do estorno é obrigatório.")

    origem_row = db.execute(text("""
        SELECT m.*, l.tipo, l.valor_total, l.valor_pago, l.status, l.data_vencimento
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id AND m.id = :id
        FOR UPDATE
    """), {"empresa_id": empresa_id, "id": movimentacao_id}).first()
    if not origem_row:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada.")
    origem = row_to_dict(origem_row)
    if origem["tipo_movimentacao"] != "baixa":
        raise HTTPException(status_code=409, detail="Somente uma baixa pode ser estornada.")
    ja_estornada = db.execute(text("""
        SELECT 1 FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id
          AND movimentacao_origem_id = :origem_id
          AND tipo_movimentacao = 'estorno'
        LIMIT 1
    """), {"empresa_id": empresa_id, "origem_id": movimentacao_id}).first()
    if ja_estornada:
        raise HTTPException(status_code=409, detail="Esta movimentação já foi estornada.")

    estorno = db.execute(text("""
        INSERT INTO public.financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            data_movimentacao, forma_pagamento_id, conta_banco_id,
            movimentacao_origem_id, observacoes, usuario_id, criado_em
        ) VALUES (
            :empresa_id, :lancamento_id, 'estorno', :valor,
            :data_movimentacao, :forma_pagamento_id, :conta_banco_id,
            :origem_id, :observacoes, :usuario_id, NOW()
        ) RETURNING id
    """), {
        "empresa_id": empresa_id,
        "lancamento_id": origem["lancamento_id"],
        "valor": parse_money(origem["valor"]),
        "data_movimentacao": payload.data_estorno or date.today(),
        "forma_pagamento_id": origem.get("forma_pagamento_id"),
        "conta_banco_id": origem.get("conta_banco_id"),
        "origem_id": movimentacao_id,
        "observacoes": motivo,
        "usuario_id": int(usuario.id),
    }).first()
    calculado = recalcular_lancamento(db, empresa_id, int(origem["lancamento_id"]), int(usuario.id))
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="estornar",
        entidade="lancamento", entidade_id=int(origem["lancamento_id"]),
        anteriores=origem,
        novos={"movimentacao_estorno_id": int(estorno[0]), "movimentacao_origem_id": movimentacao_id, **calculado},
        motivo=motivo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, int(origem["lancamento_id"]))


@router.patch("/lancamentos/{lancamento_id}/cancelar")
def cancelar_lancamento(
    lancamento_id: int,
    payload: CancelamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="O motivo do cancelamento é obrigatório.")
    anterior = obter_lancamento_dict(db, empresa_id, lancamento_id, for_update=True)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="O lançamento já está cancelado.")
    if parse_money(anterior["valor_pago"]) > 0:
        raise HTTPException(status_code=409, detail="Estorne todas as baixas antes de cancelar o lançamento.")

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET status = 'cancelado',
               cancelado_por_usuario_id = :usuario_id,
               cancelado_em = NOW(),
               motivo_cancelamento = :motivo,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id, "id": lancamento_id,
        "usuario_id": int(usuario.id), "motivo": motivo,
    })
    novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="cancelar",
        entidade="lancamento", entidade_id=lancamento_id,
        anteriores=anterior, novos=novo, motivo=motivo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.delete("/lancamentos/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_dict(db, empresa_id, lancamento_id, for_update=True)
    possui_movimentacoes = db.execute(text("""
        SELECT 1 FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id AND lancamento_id = :id LIMIT 1
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if possui_movimentacoes:
        raise HTTPException(status_code=409, detail="Lançamento com movimentações não pode ser excluído. Use estorno e cancelamento.")
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="excluir",
        entidade="lancamento", entidade_id=lancamento_id, anteriores=anterior,
    )
    db.execute(text("DELETE FROM public.financeiro_lancamentos WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": lancamento_id})
    db.commit()
    return None


# =========================================================
# Fluxo de caixa e relatório
# =========================================================

@router.get("/fluxo-caixa")
def fluxo_caixa(
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    sincronizar_status_lancamentos(db, empresa_id)
    inicio = data_inicio or date.today().replace(day=1)
    fim = data_fim or (date.today() + timedelta(days=60))
    if fim < inicio:
        raise HTTPException(status_code=422, detail="A data final deve ser igual ou posterior à data inicial.")
    params = {"empresa_id": empresa_id, "data_inicio": inicio, "data_fim": fim}

    saldo_inicial_anterior = Decimal(str(db.execute(text("""
        SELECT COALESCE(SUM(saldo_inicial), 0)
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
          AND data_saldo_inicial < :data_inicio
    """), params).scalar() or 0))

    movimento_anterior = Decimal(str(db.execute(text("""
        SELECT COALESCE(SUM(
            CASE
                WHEN l.tipo = 'receber' THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE -1 * CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
            END
        ), 0)
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
          AND m.data_movimentacao < :data_inicio
    """), params).scalar() or 0))
    saldo_base = saldo_inicial_anterior + movimento_anterior

    previstos = db.execute(text("""
        SELECT
            data_vencimento AS data,
            COALESCE(SUM(CASE WHEN tipo = 'receber' THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS entradas_previstas,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS saidas_previstas
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
          AND status <> 'cancelado'
          AND GREATEST(valor_total - valor_pago, 0) > 0
          AND data_vencimento BETWEEN :data_inicio AND :data_fim
        GROUP BY data_vencimento
    """), params).fetchall()

    realizados = db.execute(text("""
        SELECT
            m.data_movimentacao AS data,
            COALESCE(SUM(CASE WHEN l.tipo = 'receber'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END ELSE 0 END), 0) AS entradas_realizadas,
            COALESCE(SUM(CASE WHEN l.tipo = 'pagar'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END ELSE 0 END), 0) AS saidas_realizadas
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
          AND m.data_movimentacao BETWEEN :data_inicio AND :data_fim
        GROUP BY m.data_movimentacao
    """), params).fetchall()

    saldos_no_periodo = db.execute(text("""
        SELECT
            data_saldo_inicial AS data,
            COALESCE(SUM(CASE WHEN saldo_inicial >= 0 THEN saldo_inicial ELSE 0 END), 0) AS entradas_realizadas,
            COALESCE(SUM(CASE WHEN saldo_inicial < 0 THEN ABS(saldo_inicial) ELSE 0 END), 0) AS saidas_realizadas
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
          AND data_saldo_inicial BETWEEN :data_inicio AND :data_fim
        GROUP BY data_saldo_inicial
    """), params).fetchall()

    por_data: Dict[date, Dict[str, Decimal]] = {}
    def bucket(d: date) -> Dict[str, Decimal]:
        return por_data.setdefault(d, {
            "entradas_previstas": Decimal("0"), "saidas_previstas": Decimal("0"),
            "entradas_realizadas": Decimal("0"), "saidas_realizadas": Decimal("0"),
        })

    for row in previstos:
        r = row_to_dict(row)
        d = date.fromisoformat(str(r["data"])[:10])
        bucket(d)["entradas_previstas"] += Decimal(str(r["entradas_previstas"] or 0))
        bucket(d)["saidas_previstas"] += Decimal(str(r["saidas_previstas"] or 0))
    for colecao in (realizados, saldos_no_periodo):
        for row in colecao:
            r = row_to_dict(row)
            d = date.fromisoformat(str(r["data"])[:10])
            bucket(d)["entradas_realizadas"] += Decimal(str(r["entradas_realizadas"] or 0))
            bucket(d)["saidas_realizadas"] += Decimal(str(r["saidas_realizadas"] or 0))

    saldo_previsto = saldo_base
    saldo_realizado = saldo_base
    items = []
    for d in sorted(por_data):
        valores = por_data[d]
        saldo_previsto += valores["entradas_previstas"] - valores["saidas_previstas"]
        saldo_realizado += valores["entradas_realizadas"] - valores["saidas_realizadas"]
        items.append({
            "data": d.isoformat(),
            **{k: float(v) for k, v in valores.items()},
            "saldo_previsto_acumulado": float(saldo_previsto),
            "saldo_realizado_acumulado": float(saldo_realizado),
        })
    return {"items": items, "saldo_inicial_periodo": float(saldo_base)}


@router.get("/relatorios/resumo")
def relatorio_resumo(
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    sincronizar_status_lancamentos(db, empresa_id)
    params = {
        "empresa_id": empresa_id,
        "data_inicio": data_inicio or date.today().replace(day=1),
        "data_fim": data_fim or (date.today() + timedelta(days=60)),
    }
    por_categoria = [row_to_dict(r) for r in db.execute(text("""
        SELECT
            l.tipo,
            COALESCE(cat.nome, 'Sem categoria') AS categoria,
            COUNT(*) AS quantidade,
            COALESCE(SUM(l.valor_total), 0) AS valor_total,
            COALESCE(SUM(l.valor_pago), 0) AS valor_pago,
            COALESCE(SUM(GREATEST(l.valor_total - l.valor_pago, 0)), 0) AS saldo_aberto
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_categorias cat
               ON cat.id = l.categoria_id AND cat.empresa_id = l.empresa_id
        WHERE l.empresa_id = :empresa_id
          AND l.data_vencimento BETWEEN :data_inicio AND :data_fim
          AND l.status <> 'cancelado'
        GROUP BY l.tipo, COALESCE(cat.nome, 'Sem categoria')
        ORDER BY l.tipo, valor_total DESC
    """), params).fetchall()]
    return {"por_categoria": por_categoria}


# =========================================================
# Cadastros auxiliares
# =========================================================

def listar_auxiliar(table_name: str, empresa_id: int, db: Session):
    ensure_tables(db)
    permitidas = {"financeiro_categorias", "financeiro_formas_pagamento"}
    if table_name not in permitidas:
        raise RuntimeError("Tabela auxiliar não permitida.")
    rows = db.execute(text(f"SELECT * FROM public.{table_name} WHERE empresa_id = :empresa_id ORDER BY ativo DESC, nome ASC, id ASC"), {"empresa_id": empresa_id}).fetchall()
    return [row_to_dict(r) for r in rows]


def excluir_auxiliar(table_name: str, item_id: int, empresa_id: int, db: Session, usuario_id: int):
    ensure_tables(db)
    permitidas = {"financeiro_categorias", "financeiro_formas_pagamento", "financeiro_contas_bancos"}
    if table_name not in permitidas:
        raise RuntimeError("Tabela auxiliar não permitida.")
    anterior_row = db.execute(text(f"SELECT * FROM public.{table_name} WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    anterior = row_to_dict(anterior_row)
    try:
        db.execute(text(f"DELETE FROM public.{table_name} WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id})
        registrar_auditoria(
            db, empresa_id=empresa_id, usuario_id=usuario_id, acao="excluir",
            entidade=table_name, entidade_id=item_id, anteriores=anterior,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Este cadastro já está sendo usado e não pode ser excluído.") from exc
    return None


@router.get("/categorias")
def listar_categorias(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_categorias", empresa_do(usuario), db)


@router.post("/categorias", status_code=status.HTTP_201_CREATED)
def criar_categoria(payload: CategoriaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    tipo = (payload.tipo or "ambos").strip().lower()
    if tipo not in {"receita", "despesa", "ambos"}:
        raise HTTPException(status_code=422, detail="Tipo de categoria inválido.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_categorias (empresa_id, nome, tipo, cor, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :cor, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_categorias", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    return novo


@router.put("/categorias/{item_id}")
def atualizar_categoria(item_id: int, payload: CategoriaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_categorias WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    tipo = (payload.tipo or "ambos").strip().lower()
    if tipo not in {"receita", "despesa", "ambos"}:
        raise HTTPException(status_code=422, detail="Tipo de categoria inválido.")
    row = db.execute(text("""
        UPDATE public.financeiro_categorias
           SET nome = :nome, tipo = :tipo, cor = :cor, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_categorias", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/categorias/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_categoria(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_categorias", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/formas-pagamento")
def listar_formas(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_formas_pagamento", empresa_do(usuario), db)


@router.post("/formas-pagamento", status_code=status.HTTP_201_CREATED)
def criar_forma(payload: FormaPagamentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_formas_pagamento (empresa_id, nome, tipo, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_formas_pagamento", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    return novo


@router.put("/formas-pagamento/{item_id}")
def atualizar_forma(item_id: int, payload: FormaPagamentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_formas_pagamento WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Forma de pagamento não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_formas_pagamento
           SET nome = :nome, tipo = :tipo, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_formas_pagamento", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/formas-pagamento/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_forma(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_formas_pagamento", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/contas-bancos")
def listar_contas_bancos(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    rows = db.execute(text("""
        SELECT
            cb.*,
            cb.saldo_inicial + COALESCE((
                SELECT SUM(
                    CASE
                        WHEN l.tipo = 'receber' THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                        ELSE -1 * CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                    END
                )
                FROM public.financeiro_movimentacoes m
                JOIN public.financeiro_lancamentos l
                  ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
                WHERE m.empresa_id = cb.empresa_id
                  AND m.conta_banco_id = cb.id
                  AND m.data_movimentacao >= cb.data_saldo_inicial
            ), 0) AS saldo_atual
        FROM public.financeiro_contas_bancos cb
        WHERE cb.empresa_id = :empresa_id
        ORDER BY cb.ativo DESC, cb.nome ASC, cb.id ASC
    """), {"empresa_id": empresa_id}).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/contas-bancos", status_code=status.HTTP_201_CREATED)
def criar_conta_banco(payload: ContaBancoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_contas_bancos (
            empresa_id, nome, banco, agencia, conta, saldo_inicial,
            data_saldo_inicial, ativo, criado_em, atualizado_em
        ) VALUES (
            :empresa_id, :nome, :banco, :agencia, :conta, :saldo_inicial,
            :data_saldo_inicial, :ativo, NOW(), NOW()
        ) RETURNING *
    """), {
        "empresa_id": empresa_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "data_saldo_inicial": payload.data_saldo_inicial or date.today(),
        "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_contas_bancos", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    novo["saldo_atual"] = novo["saldo_inicial"]
    return novo


@router.put("/contas-bancos/{item_id}")
def atualizar_conta_banco(item_id: int, payload: ContaBancoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    ensure_tables(db)
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_contas_bancos WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Conta/Banco não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_contas_bancos
           SET nome = :nome, banco = :banco, agencia = :agencia, conta = :conta,
               saldo_inicial = :saldo_inicial, data_saldo_inicial = :data_saldo_inicial,
               ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": item_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "data_saldo_inicial": payload.data_saldo_inicial or date.today(),
        "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_contas_bancos", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/contas-bancos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_conta_banco(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_contas_bancos", item_id, empresa_do(usuario), db, int(usuario.id))
