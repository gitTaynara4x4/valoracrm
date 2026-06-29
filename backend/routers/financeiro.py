from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
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

    # aceita R$ 1.234,56, 1.234,56 e 1234.56
    text_value = text_value.replace("R$", "").replace(" ", "")
    if "," in text_value and "." in text_value:
        text_value = text_value.replace(".", "").replace(",", ".")
    else:
        text_value = text_value.replace(",", ".")

    try:
        return Decimal(text_value)
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


def status_por_valor(tipo: str, status_base: str, valor_total: Decimal, valor_pago: Decimal, data_vencimento: date) -> str:
    if status_base == "cancelado":
        return "cancelado"
    if valor_total > 0 and valor_pago >= valor_total:
        return "recebido" if tipo == "receber" else "pago"
    if valor_pago > 0:
        return "parcial"
    if data_vencimento and data_vencimento < date.today() and status_base == "aberto":
        return "vencido"
    return status_base or "aberto"


def ensure_tables(db: Session):
    try:
        db.execute(text("SELECT 1 FROM public.financeiro_lancamentos LIMIT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Tabelas do financeiro não existem. Rode sql/financeiro_valora.sql no pgAdmin.",
        ) from exc


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
    ativo: bool = True


class LancamentoIn(BaseModel):
    tipo: str
    descricao: str
    valor_total: Any
    valor_pago: Optional[Any] = 0

    data_emissao: Optional[date] = None
    data_vencimento: date
    data_pagamento: Optional[date] = None

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
    valor_pago: Optional[Any] = None
    data_pagamento: Optional[date] = None
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: Optional[int] = None


# =========================================================
# Select base
# =========================================================

LANCAMENTO_SELECT = """
SELECT
    l.*,
    c.nome AS cliente_nome,
    f.nome AS fornecedor_nome,
    cat.nome AS categoria_nome,
    fp.nome AS forma_pagamento_nome,
    cb.nome AS conta_banco_nome
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
"""


# =========================================================
# Opções para selects
# =========================================================

@router.get("/opcoes")
def opcoes_financeiro(
    busca_cliente: Optional[str] = Query(default=None),
    busca_fornecedor: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_tables(db)
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
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_tables(db)
    params = {"empresa_id": empresa_id}

    resumo = db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status NOT IN ('cancelado') THEN valor_total ELSE 0 END), 0) AS total_receber,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status NOT IN ('cancelado') THEN valor_total ELSE 0 END), 0) AS total_pagar,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status = 'recebido' THEN valor_pago ELSE 0 END), 0) AS recebido,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status = 'pago' THEN valor_pago ELSE 0 END), 0) AS pago,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status NOT IN ('recebido', 'cancelado') AND data_vencimento < CURRENT_DATE THEN valor_total - valor_pago ELSE 0 END), 0) AS receber_vencido,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status NOT IN ('pago', 'cancelado') AND data_vencimento < CURRENT_DATE THEN valor_total - valor_pago ELSE 0 END), 0) AS pagar_vencido,
            COALESCE(COUNT(*), 0) AS total_lancamentos
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
    """), params).first()

    proximos = db.execute(text(LANCAMENTO_SELECT + """
        WHERE l.empresa_id = :empresa_id
          AND l.status NOT IN ('pago', 'recebido', 'cancelado')
        ORDER BY l.data_vencimento ASC, l.id DESC
        LIMIT 12
    """), params).fetchall()

    resumo_dict = row_to_dict(resumo) if resumo else {}
    total_receber = Decimal(str(resumo_dict.get("total_receber") or 0))
    total_pagar = Decimal(str(resumo_dict.get("total_pagar") or 0))
    recebido = Decimal(str(resumo_dict.get("recebido") or 0))
    pago = Decimal(str(resumo_dict.get("pago") or 0))
    resumo_dict["saldo_previsto"] = float(total_receber - total_pagar)
    resumo_dict["saldo_realizado"] = float(recebido - pago)

    return {
        "resumo": resumo_dict,
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
    where = ["l.empresa_id = :empresa_id"]
    params: Dict[str, Any] = {"empresa_id": empresa_id, "limit": limit, "offset": offset}

    if tipo:
        where.append("l.tipo = :tipo")
        params["tipo"] = validar_tipo_lancamento(tipo)

    if status_filtro:
        where.append("l.status = :status")
        params["status"] = status_filtro.strip().lower()

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
    empresa_id: int = Depends(get_empresa_id),
):
    return _listar_lancamentos_impl(tipo=tipo, status_filtro=status_filtro, data_inicio=data_inicio, data_fim=data_fim, busca=busca, limit=limit, offset=offset, db=db, empresa_id=empresa_id)


@router.get("/contas-receber")
def listar_contas_receber(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    return _listar_lancamentos_impl(tipo="receber", status_filtro=status_filtro, data_inicio=data_inicio, data_fim=data_fim, busca=busca, limit=limit, offset=offset, db=db, empresa_id=empresa_id)


@router.get("/contas-pagar")
def listar_contas_pagar(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    return _listar_lancamentos_impl(tipo="pagar", status_filtro=status_filtro, data_inicio=data_inicio, data_fim=data_fim, busca=busca, limit=limit, offset=offset, db=db, empresa_id=empresa_id)


@router.get("/lancamentos/{lancamento_id}")
def obter_lancamento(lancamento_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text(LANCAMENTO_SELECT + """
        WHERE l.empresa_id = :empresa_id AND l.id = :id LIMIT 1
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    return row_to_dict(row)


def _payload_to_params(payload: LancamentoIn, empresa_id: int, lancamento_id: Optional[int] = None) -> Dict[str, Any]:
    tipo = validar_tipo_lancamento(payload.tipo)
    valor_total = parse_money(payload.valor_total)
    valor_pago = parse_money(payload.valor_pago)
    data_venc = payload.data_vencimento
    status_base = validar_status(payload.status, tipo)
    status_final = status_por_valor(tipo, status_base, valor_total, valor_pago, data_venc)

    params = {
        "empresa_id": empresa_id,
        "tipo": tipo,
        "descricao": payload.descricao.strip(),
        "valor_total": valor_total,
        "valor_pago": valor_pago,
        "data_emissao": payload.data_emissao or date.today(),
        "data_vencimento": data_venc,
        "data_pagamento": payload.data_pagamento,
        "status": status_final,
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
    if lancamento_id is not None:
        params["id"] = lancamento_id
    return params


@router.post("/lancamentos", status_code=status.HTTP_201_CREATED)
def criar_lancamento(payload: LancamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    params = _payload_to_params(payload, empresa_id)
    row = db.execute(text("""
        INSERT INTO public.financeiro_lancamentos (
            empresa_id, tipo, descricao, valor_total, valor_pago,
            data_emissao, data_vencimento, data_pagamento, status,
            cliente_id, fornecedor_id, categoria_id, forma_pagamento_id, conta_banco_id,
            documento, observacoes, anexo_url,
            recorrente, parcelado, parcela_numero, parcela_total, grupo_recorrencia,
            criado_em, atualizado_em
        ) VALUES (
            :empresa_id, :tipo, :descricao, :valor_total, :valor_pago,
            :data_emissao, :data_vencimento, :data_pagamento, :status,
            :cliente_id, :fornecedor_id, :categoria_id, :forma_pagamento_id, :conta_banco_id,
            :documento, :observacoes, :anexo_url,
            :recorrente, :parcelado, :parcela_numero, :parcela_total, :grupo_recorrencia,
            NOW(), NOW()
        ) RETURNING id
    """), params).first()
    db.commit()
    return obter_lancamento(int(row[0]), db=db, empresa_id=empresa_id)


@router.post("/contas-receber", status_code=status.HTTP_201_CREATED)
def criar_conta_receber(payload: LancamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    payload.tipo = "receber"
    return criar_lancamento(payload, db=db, empresa_id=empresa_id)


@router.post("/contas-pagar", status_code=status.HTTP_201_CREATED)
def criar_conta_pagar(payload: LancamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    payload.tipo = "pagar"
    return criar_lancamento(payload, db=db, empresa_id=empresa_id)


@router.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(lancamento_id: int, payload: LancamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)
    params = _payload_to_params(payload, empresa_id, lancamento_id)
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET tipo = :tipo,
               descricao = :descricao,
               valor_total = :valor_total,
               valor_pago = :valor_pago,
               data_emissao = :data_emissao,
               data_vencimento = :data_vencimento,
               data_pagamento = :data_pagamento,
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
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), params)
    db.commit()
    return obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)


@router.patch("/lancamentos/{lancamento_id}/baixar")
def baixar_lancamento(lancamento_id: int, payload: BaixaIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    atual = obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)
    valor_total = parse_money(atual.get("valor_total"))
    valor_pago = parse_money(payload.valor_pago if payload.valor_pago is not None else valor_total)
    tipo = atual.get("tipo")
    status_final = "recebido" if tipo == "receber" else "pago"
    if valor_pago < valor_total:
        status_final = "parcial"

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET valor_pago = :valor_pago,
               data_pagamento = :data_pagamento,
               forma_pagamento_id = COALESCE(:forma_pagamento_id, forma_pagamento_id),
               conta_banco_id = COALESCE(:conta_banco_id, conta_banco_id),
               status = :status,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id,
        "id": lancamento_id,
        "valor_pago": valor_pago,
        "data_pagamento": payload.data_pagamento or date.today(),
        "forma_pagamento_id": payload.forma_pagamento_id,
        "conta_banco_id": payload.conta_banco_id,
        "status": status_final,
    })
    db.commit()
    return obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)


@router.patch("/lancamentos/{lancamento_id}/cancelar")
def cancelar_lancamento(lancamento_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET status = 'cancelado', atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {"empresa_id": empresa_id, "id": lancamento_id})
    db.commit()
    return {"ok": True}


@router.delete("/lancamentos/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_lancamento(lancamento_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    obter_lancamento(lancamento_id, db=db, empresa_id=empresa_id)
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
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_tables(db)
    params = {
        "empresa_id": empresa_id,
        "data_inicio": data_inicio or date.today().replace(day=1),
        "data_fim": data_fim or (date.today() + timedelta(days=60)),
    }
    rows = db.execute(text("""
        SELECT
            data_vencimento AS data,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status <> 'cancelado' THEN valor_total ELSE 0 END), 0) AS entradas_previstas,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status <> 'cancelado' THEN valor_total ELSE 0 END), 0) AS saidas_previstas,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status = 'recebido' THEN valor_pago ELSE 0 END), 0) AS entradas_realizadas,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status = 'pago' THEN valor_pago ELSE 0 END), 0) AS saidas_realizadas
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
          AND data_vencimento BETWEEN :data_inicio AND :data_fim
        GROUP BY data_vencimento
        ORDER BY data_vencimento ASC
    """), params).fetchall()

    saldo_previsto = Decimal("0")
    saldo_realizado = Decimal("0")
    items = []
    for row in rows:
        item = row_to_dict(row)
        saldo_previsto += Decimal(str(item.get("entradas_previstas") or 0)) - Decimal(str(item.get("saidas_previstas") or 0))
        saldo_realizado += Decimal(str(item.get("entradas_realizadas") or 0)) - Decimal(str(item.get("saidas_realizadas") or 0))
        item["saldo_previsto_acumulado"] = float(saldo_previsto)
        item["saldo_realizado_acumulado"] = float(saldo_realizado)
        items.append(item)

    return {"items": items}


@router.get("/relatorios/resumo")
def relatorio_resumo(
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    ensure_tables(db)
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
            COALESCE(SUM(l.valor_pago), 0) AS valor_pago
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_categorias cat ON cat.id = l.categoria_id AND cat.empresa_id = l.empresa_id
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
    rows = db.execute(text(f"SELECT * FROM public.{table_name} WHERE empresa_id = :empresa_id ORDER BY ativo DESC, nome ASC, id ASC"), {"empresa_id": empresa_id}).fetchall()
    return [row_to_dict(r) for r in rows]


def excluir_auxiliar(table_name: str, item_id: int, empresa_id: int, db: Session):
    ensure_tables(db)
    db.execute(text(f"DELETE FROM public.{table_name} WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id})
    db.commit()
    return None


@router.get("/categorias")
def listar_categorias(db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return listar_auxiliar("financeiro_categorias", empresa_id, db)


@router.post("/categorias", status_code=status.HTTP_201_CREATED)
def criar_categoria(payload: CategoriaIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        INSERT INTO public.financeiro_categorias (empresa_id, nome, tipo, cor, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :cor, :ativo, NOW(), NOW())
        RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": payload.tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    db.commit()
    return row_to_dict(row)


@router.put("/categorias/{item_id}")
def atualizar_categoria(item_id: int, payload: CategoriaIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        UPDATE public.financeiro_categorias
           SET nome = :nome, tipo = :tipo, cor = :cor, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
         RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": payload.tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    db.commit()
    return row_to_dict(row)


@router.delete("/categorias/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_categoria(item_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return excluir_auxiliar("financeiro_categorias", item_id, empresa_id, db)


@router.get("/formas-pagamento")
def listar_formas(db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return listar_auxiliar("financeiro_formas_pagamento", empresa_id, db)


@router.post("/formas-pagamento", status_code=status.HTTP_201_CREATED)
def criar_forma(payload: FormaPagamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        INSERT INTO public.financeiro_formas_pagamento (empresa_id, nome, tipo, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :ativo, NOW(), NOW())
        RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    db.commit()
    return row_to_dict(row)


@router.put("/formas-pagamento/{item_id}")
def atualizar_forma(item_id: int, payload: FormaPagamentoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        UPDATE public.financeiro_formas_pagamento
           SET nome = :nome, tipo = :tipo, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
         RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Forma de pagamento não encontrada.")
    db.commit()
    return row_to_dict(row)


@router.delete("/formas-pagamento/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_forma(item_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return excluir_auxiliar("financeiro_formas_pagamento", item_id, empresa_id, db)


@router.get("/contas-bancos")
def listar_contas_bancos(db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return listar_auxiliar("financeiro_contas_bancos", empresa_id, db)


@router.post("/contas-bancos", status_code=status.HTTP_201_CREATED)
def criar_conta_banco(payload: ContaBancoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        INSERT INTO public.financeiro_contas_bancos (empresa_id, nome, banco, agencia, conta, saldo_inicial, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :banco, :agencia, :conta, :saldo_inicial, :ativo, NOW(), NOW())
        RETURNING *
    """), {
        "empresa_id": empresa_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "ativo": payload.ativo,
    }).first()
    db.commit()
    return row_to_dict(row)


@router.put("/contas-bancos/{item_id}")
def atualizar_conta_banco(item_id: int, payload: ContaBancoIn, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    ensure_tables(db)
    row = db.execute(text("""
        UPDATE public.financeiro_contas_bancos
           SET nome = :nome, banco = :banco, agencia = :agencia, conta = :conta,
               saldo_inicial = :saldo_inicial, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
         RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": item_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "ativo": payload.ativo,
    }).first()
    if not row:
        raise HTTPException(status_code=404, detail="Conta/Banco não encontrada.")
    db.commit()
    return row_to_dict(row)


@router.delete("/contas-bancos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_conta_banco(item_id: int, db: Session = Depends(get_db), empresa_id: int = Depends(get_empresa_id)):
    return excluir_auxiliar("financeiro_contas_bancos", item_id, empresa_id, db)
