from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import APIRouter, Cookie, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import (
    Cliente,
    Cotacao,
    Empresa,
    Fornecedor,
    Patrimonio,
    Produto,
    Proposta,
    Usuario,
)


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
)

# Rotas de compatibilidade para não quebrar dashboard antigo em cache.
compat_router = APIRouter(tags=["Dashboard compatibilidade"])


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _money_to_decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")

    if isinstance(value, Decimal):
        return value

    raw = str(value).strip()
    if not raw:
        return Decimal("0")

    raw = raw.replace("R$", "").replace(" ", "")

    # Formato brasileiro: 1.234,56
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")

    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _current_empresa_id(cookie_empresa_id: Optional[str], query_empresa_id: Optional[int]) -> int:
    # Prioriza cookie para não deixar um usuário enxergar outra empresa por querystring.
    cookie_id = _to_int(cookie_empresa_id, 0)
    if cookie_id > 0:
        return cookie_id

    query_id = _to_int(query_empresa_id, 1)
    return query_id if query_id > 0 else 1


def _safe_count(db: Session, model: Any, empresa_id: int) -> int:
    try:
        query = db.query(model).filter(model.empresa_id == empresa_id)
        if hasattr(model, "ativo"):
            query = query.filter(model.ativo.is_(True))
        return int(query.count() or 0)
    except Exception:
        return 0


def _count_propostas_mes(db: Session, empresa_id: int) -> int:
    try:
        now = datetime.now(timezone.utc)
        inicio_mes = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        return int(
            db.query(Proposta)
            .filter(Proposta.empresa_id == empresa_id)
            .filter(Proposta.criado_em >= inicio_mes)
            .count()
            or 0
        )
    except Exception:
        return _safe_count(db, Proposta, empresa_id)


def _propostas_aprovadas_info(db: Session, empresa_id: int) -> tuple[int, Decimal]:
    try:
        rows = (
            db.query(Proposta.status, Proposta.total)
            .filter(Proposta.empresa_id == empresa_id)
            .all()
        )
    except Exception:
        return 0, Decimal("0")

    aprovadas = 0
    total = Decimal("0")

    for status, valor in rows:
        status_norm = str(status or "").strip().lower()
        if status_norm in {"aprovada", "aprovado", "fechada", "fechado", "ganha", "ganho", "aceita", "aceito"}:
            aprovadas += 1
            total += _money_to_decimal(valor)

    return aprovadas, total


def _empresa_info(db: Session, empresa_id: int) -> dict[str, Any]:
    try:
        empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
        if empresa:
            return {
                "id": empresa.id,
                "nome": empresa.nome or "Valora CRM",
                "plano": (empresa.plano or "Essencial").capitalize(),
            }
    except Exception:
        pass

    return {
        "id": empresa_id,
        "nome": "Valora CRM",
        "plano": "Essencial",
    }


def _build_resumo(db: Session, empresa_id: int) -> dict[str, Any]:
    clientes_total = _safe_count(db, Cliente, empresa_id)
    fornecedores_total = _safe_count(db, Fornecedor, empresa_id)
    produtos_total = _safe_count(db, Produto, empresa_id)
    patrimonio_total = _safe_count(db, Patrimonio, empresa_id)
    cotacoes_total = _safe_count(db, Cotacao, empresa_id)
    propostas_total = _safe_count(db, Proposta, empresa_id)
    propostas_mes = _count_propostas_mes(db, empresa_id)
    usuarios_total = _safe_count(db, Usuario, empresa_id)

    aprovadas, faturamento_estimado = _propostas_aprovadas_info(db, empresa_id)
    taxa_aprovacao = round((aprovadas / propostas_total) * 100) if propostas_total else 0

    return {
        "ok": True,
        "status": "ok",
        "sistema_online": True,
        "modo_demo": False,
        "empresa": _empresa_info(db, empresa_id),
        "stats": {
            "clientes_total": clientes_total,
            "fornecedores_total": fornecedores_total,
            "produtos_total": produtos_total,
            "patrimonio_total": patrimonio_total,
            "cotacoes_total": cotacoes_total,
            "propostas_total": propostas_total,
            "propostas_mes": propostas_mes,
            "usuarios_total": usuarios_total,
            "taxa_aprovacao": taxa_aprovacao,
            "faturamento_estimado": float(faturamento_estimado),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/resumo")
def dashboard_resumo(
    empresa_id: Optional[int] = Query(default=None),
    empresa_id_cookie: Optional[str] = Cookie(default=None, alias="empresa_id"),
    db: Session = Depends(get_db),
):
    empresa_id_final = _current_empresa_id(empresa_id_cookie, empresa_id)
    return _build_resumo(db, empresa_id_final)


@router.get("")
@router.get("/")
def dashboard_consolidado(
    empresa_id: Optional[int] = Query(default=None),
    empresa_id_cookie: Optional[str] = Cookie(default=None, alias="empresa_id"),
    db: Session = Depends(get_db),
):
    """
    Compatibilidade com o dashboard antigo.
    Evita 404 em /api/dashboard caso algum JS antigo ainda esteja em cache no navegador.
    """
    resumo = _build_resumo(db, _current_empresa_id(empresa_id_cookie, empresa_id))
    stats = resumo["stats"]

    cards = {
        "mensagens_hoje": 0,
        "abertos": stats.get("propostas_mes", 0),
        "clientes_online": stats.get("clientes_total", 0),
        "total_atendimentos": stats.get("propostas_total", 0),
    }

    distrib = {
        "labels": ["Clientes", "Fornecedores", "Produtos", "Cotações", "Patrimônio"],
        "data": [
            stats.get("clientes_total", 0),
            stats.get("fornecedores_total", 0),
            stats.get("produtos_total", 0),
            stats.get("cotacoes_total", 0),
            stats.get("patrimonio_total", 0),
        ],
    }

    funil = {
        "labels": ["Clientes", "Propostas", "Aprovadas"],
        "data": [
            stats.get("clientes_total", 0),
            stats.get("propostas_total", 0),
            round((stats.get("propostas_total", 0) * stats.get("taxa_aprovacao", 0)) / 100),
        ],
    }

    return {
        **resumo,
        "cards": cards,
        "distrib": distrib,
        "distribuicao": distrib,
        "funil": funil,
        "ultimos": [],
        "atendimentos": [],
        "total_atendimentos": cards["total_atendimentos"],
    }


@router.get("/cards")
def dashboard_cards(
    empresa_id: Optional[int] = Query(default=None),
    empresa_id_cookie: Optional[str] = Cookie(default=None, alias="empresa_id"),
    db: Session = Depends(get_db),
):
    resumo = _build_resumo(db, _current_empresa_id(empresa_id_cookie, empresa_id))
    stats = resumo["stats"]
    return {
        "mensagens_hoje": 0,
        "abertos": stats.get("propostas_mes", 0),
        "clientes_online": stats.get("clientes_total", 0),
        "total_atendimentos": stats.get("propostas_total", 0),
    }


@router.get("/distribuicao")
def dashboard_distribuicao(
    empresa_id: Optional[int] = Query(default=None),
    empresa_id_cookie: Optional[str] = Cookie(default=None, alias="empresa_id"),
    db: Session = Depends(get_db),
):
    stats = _build_resumo(db, _current_empresa_id(empresa_id_cookie, empresa_id))["stats"]
    return {
        "labels": ["Clientes", "Fornecedores", "Produtos", "Cotações", "Patrimônio"],
        "data": [
            stats.get("clientes_total", 0),
            stats.get("fornecedores_total", 0),
            stats.get("produtos_total", 0),
            stats.get("cotacoes_total", 0),
            stats.get("patrimonio_total", 0),
        ],
    }


@router.get("/funil")
def dashboard_funil(
    empresa_id: Optional[int] = Query(default=None),
    empresa_id_cookie: Optional[str] = Cookie(default=None, alias="empresa_id"),
    db: Session = Depends(get_db),
):
    stats = _build_resumo(db, _current_empresa_id(empresa_id_cookie, empresa_id))["stats"]
    propostas_total = stats.get("propostas_total", 0)
    aprovadas_estimadas = round((propostas_total * stats.get("taxa_aprovacao", 0)) / 100)
    return {
        "labels": ["Clientes", "Propostas", "Aprovadas"],
        "data": [stats.get("clientes_total", 0), propostas_total, aprovadas_estimadas],
    }


@compat_router.get("/api/atendimentos/ultimos")
def atendimentos_ultimos_compat():
    return []


@compat_router.get("/api/whatsapp/status")
def whatsapp_status_compat():
    return {
        "online": False,
        "detalhes": [],
        "message": "WhatsApp não configurado neste módulo do Valora CRM.",
    }


@compat_router.get("/api/empresas/{empresa_id}/whatsapp")
def empresa_whatsapp_compat(empresa_id: int):
    return {
        "empresa_id": empresa_id,
        "instancias": [],
    }


@compat_router.get("/api/instancias/list")
def instancias_list_compat(empresa_id: Optional[int] = Query(default=None)):
    return {
        "empresa_id": empresa_id,
        "instancias": [],
    }
