from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal
from backend.financeiro_cobranca_automacao import (
    CobrancaDeliveryError,
    enviar_envio,
    executar_automacao_empresa,
    materializar_fila_cobranca,
    status_provedores,
)
from backend.security.permissions import get_request_user

router = APIRouter(prefix="/api/financeiro", tags=["Financeiro - Cobrança"])


# -----------------------------------------------------------------------------
# Dependências / helpers locais
# -----------------------------------------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.Usuario:
    return get_request_user(request, db)


def empresa_do(usuario: models.Usuario) -> int:
    return int(usuario.empresa_id)


def norm_str(value: Any) -> Optional[str]:
    value = str(value or "").strip()
    return value or None


def row_dict(row) -> dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


def _nome(value: Any, label: str = "Nome") -> str:
    value = str(value or "").strip()
    if not value:
        raise HTTPException(status_code=422, detail=f"{label} é obrigatório.")
    return value


def _validar_regua(db: Session, empresa_id: int, regua_id: int) -> dict[str, Any]:
    row = db.execute(text("""
        SELECT * FROM public.financeiro_reguas_cobranca
        WHERE empresa_id=:empresa_id AND id=:id
    """), {"empresa_id": empresa_id, "id": regua_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Régua de cobrança não encontrada.")
    return row_dict(row)


def _validar_etapa(db: Session, empresa_id: int, etapa_id: int) -> dict[str, Any]:
    row = db.execute(text("""
        SELECT e.*, r.nome AS regua_nome
        FROM public.financeiro_reguas_cobranca_etapas e
        JOIN public.financeiro_reguas_cobranca r
          ON r.id=e.regua_id AND r.empresa_id=e.empresa_id
        WHERE e.empresa_id=:empresa_id AND e.id=:id
    """), {"empresa_id": empresa_id, "id": etapa_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Etapa da régua não encontrada.")
    return row_dict(row)


def _canal_valido(canal: str) -> str:
    canal = str(canal or "whatsapp").strip().lower()
    if canal not in {"whatsapp", "email", "sms", "interno"}:
        raise HTTPException(status_code=422, detail="Canal deve ser WhatsApp, E-mail, SMS ou Interno.")
    return canal


def _acao_valida(acao: str) -> str:
    acao = str(acao or "lembrete").strip().lower()
    if acao not in {"lembrete", "alerta", "bloqueio", "protesto", "outro"}:
        raise HTTPException(status_code=422, detail="Ação da etapa de cobrança inválida.")
    return acao


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class ReguaCobrancaIn(BaseModel):
    nome: str
    descricao: Optional[str] = None
    padrao: bool = False
    ativo: bool = True


class EtapaCobrancaIn(BaseModel):
    regua_id: int
    nome: str
    deslocamento_dias: int
    canal: str = "whatsapp"
    acao: str = "lembrete"
    mensagem: Optional[str] = None
    ordem: int = 0
    ativo: bool = True


class StatusEnvioIn(BaseModel):
    status: str
    erro: Optional[str] = None


class EmissaoCobrancaLoteIn(BaseModel):
    data_inicio: date
    data_fim: date
    cliente_id: Optional[int] = None
    forma_cobranca_id: Optional[int] = None
    lancamento_ids: list[int]


def _validar_periodo_emissao(data_inicio: date, data_fim: date) -> None:
    if data_fim < data_inicio:
        raise HTTPException(status_code=422, detail="A data final deve ser igual ou posterior à data inicial.")
    if (data_fim - data_inicio).days > 3660:
        raise HTTPException(status_code=422, detail="O período de emissão não pode ultrapassar 10 anos.")


def _validar_filtros_emissao(
    db: Session, empresa_id: int, cliente_id: Optional[int], forma_cobranca_id: Optional[int]
) -> None:
    if cliente_id is not None:
        existe = db.execute(text(
            "SELECT 1 FROM public.clientes WHERE empresa_id=:empresa_id AND id=:id"
        ), {"empresa_id": empresa_id, "id": cliente_id}).first()
        if not existe:
            raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    if forma_cobranca_id is not None:
        existe = db.execute(text(
            "SELECT 1 FROM public.financeiro_formas_cobranca WHERE empresa_id=:empresa_id AND id=:id"
        ), {"empresa_id": empresa_id, "id": forma_cobranca_id}).first()
        if not existe:
            raise HTTPException(status_code=404, detail="Forma de cobrança não encontrada.")


# -----------------------------------------------------------------------------
# Réguas
# -----------------------------------------------------------------------------

@router.get("/reguas-cobranca")
def listar_reguas_cobranca(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    rows = db.execute(text("""
        SELECT r.*,
               COUNT(e.id) AS total_etapas,
               COUNT(e.id) FILTER (WHERE e.ativo=TRUE) AS etapas_ativas
        FROM public.financeiro_reguas_cobranca r
        LEFT JOIN public.financeiro_reguas_cobranca_etapas e
               ON e.regua_id=r.id AND e.empresa_id=r.empresa_id
        WHERE r.empresa_id=:empresa_id
        GROUP BY r.id
        ORDER BY r.ativo DESC, r.padrao DESC, r.nome, r.id
    """), {"empresa_id": empresa_do(usuario)}).fetchall()
    return [row_dict(r) for r in rows]


@router.post("/reguas-cobranca", status_code=status.HTTP_201_CREATED)
def criar_regua_cobranca(
    payload: ReguaCobrancaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    if payload.padrao:
        db.execute(text("""
            UPDATE public.financeiro_reguas_cobranca
            SET padrao=FALSE, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND padrao=TRUE
        """), {"empresa_id": empresa_id})
    row = db.execute(text("""
        INSERT INTO public.financeiro_reguas_cobranca
            (empresa_id, nome, descricao, padrao, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :descricao, :padrao, :ativo, NOW(), NOW())
        RETURNING *
    """), {
        "empresa_id": empresa_id,
        "nome": _nome(payload.nome),
        "descricao": norm_str(payload.descricao),
        "padrao": bool(payload.padrao),
        "ativo": bool(payload.ativo),
    }).first()
    db.commit()
    return row_dict(row)


@router.put("/reguas-cobranca/{regua_id}")
def atualizar_regua_cobranca(
    regua_id: int,
    payload: ReguaCobrancaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_regua(db, empresa_id, regua_id)
    if payload.padrao:
        db.execute(text("""
            UPDATE public.financeiro_reguas_cobranca
            SET padrao=FALSE, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND id<>:id AND padrao=TRUE
        """), {"empresa_id": empresa_id, "id": regua_id})
    row = db.execute(text("""
        UPDATE public.financeiro_reguas_cobranca
           SET nome=:nome, descricao=:descricao, padrao=:padrao, ativo=:ativo, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
         RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": regua_id,
        "nome": _nome(payload.nome),
        "descricao": norm_str(payload.descricao),
        "padrao": bool(payload.padrao),
        "ativo": bool(payload.ativo),
    }).first()
    db.commit()
    return row_dict(row)


@router.delete("/reguas-cobranca/{regua_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_regua_cobranca(
    regua_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_regua(db, empresa_id, regua_id)
    try:
        db.execute(text("""
            DELETE FROM public.financeiro_reguas_cobranca
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"empresa_id": empresa_id, "id": regua_id})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A régua possui histórico que impede a exclusão. Inative-a.") from exc
    return None


# -----------------------------------------------------------------------------
# Etapas da régua
# -----------------------------------------------------------------------------

@router.get("/reguas-cobranca/{regua_id}/etapas")
def listar_etapas_regua(
    regua_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_regua(db, empresa_id, regua_id)
    rows = db.execute(text("""
        SELECT * FROM public.financeiro_reguas_cobranca_etapas
        WHERE empresa_id=:empresa_id AND regua_id=:regua_id
        ORDER BY deslocamento_dias, ordem, id
    """), {"empresa_id": empresa_id, "regua_id": regua_id}).fetchall()
    return [row_dict(r) for r in rows]


@router.post("/reguas-cobranca/{regua_id}/etapas", status_code=status.HTTP_201_CREATED)
def criar_etapa_regua(
    regua_id: int,
    payload: EtapaCobrancaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_regua(db, empresa_id, regua_id)
    if int(payload.regua_id) != regua_id:
        raise HTTPException(status_code=422, detail="Régua informada não corresponde à URL.")
    if payload.deslocamento_dias < -365 or payload.deslocamento_dias > 3650:
        raise HTTPException(status_code=422, detail="Dias da etapa devem ficar entre 365 dias antes e 3650 dias depois do vencimento.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_reguas_cobranca_etapas
            (empresa_id, regua_id, nome, deslocamento_dias, canal, acao, mensagem, ordem, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :regua_id, :nome, :dias, :canal, :acao, :mensagem, :ordem, :ativo, NOW(), NOW())
        RETURNING *
    """), {
        "empresa_id": empresa_id,
        "regua_id": regua_id,
        "nome": _nome(payload.nome),
        "dias": int(payload.deslocamento_dias),
        "canal": _canal_valido(payload.canal),
        "acao": _acao_valida(payload.acao),
        "mensagem": norm_str(payload.mensagem),
        "ordem": int(payload.ordem or 0),
        "ativo": bool(payload.ativo),
    }).first()
    db.commit()
    return row_dict(row)


@router.put("/reguas-cobranca/etapas/{etapa_id}")
def atualizar_etapa_regua(
    etapa_id: int,
    payload: EtapaCobrancaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_etapa(db, empresa_id, etapa_id)
    _validar_regua(db, empresa_id, int(payload.regua_id))
    if payload.deslocamento_dias < -365 or payload.deslocamento_dias > 3650:
        raise HTTPException(status_code=422, detail="Dias da etapa devem ficar entre 365 dias antes e 3650 dias depois do vencimento.")
    row = db.execute(text("""
        UPDATE public.financeiro_reguas_cobranca_etapas
           SET regua_id=:regua_id, nome=:nome, deslocamento_dias=:dias,
               canal=:canal, acao=:acao, mensagem=:mensagem, ordem=:ordem,
               ativo=:ativo, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
         RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": etapa_id,
        "regua_id": int(payload.regua_id),
        "nome": _nome(payload.nome),
        "dias": int(payload.deslocamento_dias),
        "canal": _canal_valido(payload.canal),
        "acao": _acao_valida(payload.acao),
        "mensagem": norm_str(payload.mensagem),
        "ordem": int(payload.ordem or 0),
        "ativo": bool(payload.ativo),
    }).first()
    db.commit()
    return row_dict(row)


@router.delete("/reguas-cobranca/etapas/{etapa_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_etapa_regua(
    etapa_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_etapa(db, empresa_id, etapa_id)
    try:
        db.execute(text("""
            DELETE FROM public.financeiro_reguas_cobranca_etapas
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"empresa_id": empresa_id, "id": etapa_id})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A etapa possui histórico. Inative-a em vez de excluir.") from exc
    return None


# -----------------------------------------------------------------------------
# Emissão de títulos em lote
# -----------------------------------------------------------------------------

@router.get("/cobrancas/emissao-lote/titulos")
def listar_titulos_para_emissao_lote(
    data_inicio: date = Query(...),
    data_fim: date = Query(...),
    cliente_id: Optional[int] = Query(default=None),
    forma_cobranca_id: Optional[int] = Query(default=None),
    incluir_emitidos: bool = Query(default=False),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_periodo_emissao(data_inicio, data_fim)
    _validar_filtros_emissao(db, empresa_id, cliente_id, forma_cobranca_id)

    where = [
        "l.empresa_id=:empresa_id",
        "l.tipo='receber'",
        "l.status<>'cancelado'",
        "l.valor_total>l.valor_pago",
        "l.data_vencimento BETWEEN :data_inicio AND :data_fim",
    ]
    params: dict[str, Any] = {
        "empresa_id": empresa_id,
        "data_inicio": data_inicio,
        "data_fim": data_fim,
        "limit": limit,
    }
    if cliente_id is not None:
        where.append("l.cliente_id=:cliente_id")
        params["cliente_id"] = cliente_id
    if forma_cobranca_id is not None:
        where.append("l.forma_cobranca_id=:forma_cobranca_id")
        params["forma_cobranca_id"] = forma_cobranca_id
    if not incluir_emitidos:
        where.append("ei.id IS NULL")

    rows = db.execute(text(f"""
        SELECT
            l.id, l.cliente_id, l.forma_cobranca_id, l.descricao, l.documento,
            l.data_emissao, l.data_vencimento, l.valor_total, l.valor_pago,
            GREATEST(l.valor_total-l.valor_pago, 0) AS saldo_aberto,
            COALESCE(c.nome, 'Cliente não identificado') AS cliente_nome,
            COALESCE(fc.nome, 'Não informada') AS forma_cobranca_nome,
            (ei.id IS NOT NULL) AS ja_emitido,
            ee.id AS emissao_id, ee.data_emissao AS emissao_data
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.clientes c
               ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
        LEFT JOIN public.financeiro_formas_cobranca fc
               ON fc.id=l.forma_cobranca_id AND fc.empresa_id=l.empresa_id
        LEFT JOIN public.financeiro_cobrancas_emissao_itens ei
               ON ei.empresa_id=l.empresa_id AND ei.lancamento_id=l.id
        LEFT JOIN public.financeiro_cobrancas_emissoes ee
               ON ee.empresa_id=ei.empresa_id AND ee.id=ei.emissao_id
        WHERE {' AND '.join(where)}
        ORDER BY l.data_vencimento ASC, cliente_nome ASC, l.id ASC
        LIMIT :limit
    """), params).fetchall()

    items = [row_dict(r) for r in rows]
    return {
        "periodo": {"data_inicio": data_inicio.isoformat(), "data_fim": data_fim.isoformat()},
        "items": items,
        "resumo": {
            "quantidade": len(items),
            "valor_total": float(sum(Decimal(str(i.get("valor_total") or 0)) for i in items)),
            "saldo_total": float(sum(Decimal(str(i.get("saldo_aberto") or 0)) for i in items)),
        },
    }


@router.post("/cobrancas/emissao-lote", status_code=status.HTTP_201_CREATED)
def emitir_titulos_em_lote(
    payload: EmissaoCobrancaLoteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    _validar_periodo_emissao(payload.data_inicio, payload.data_fim)
    _validar_filtros_emissao(db, empresa_id, payload.cliente_id, payload.forma_cobranca_id)

    ids = list(dict.fromkeys(int(v) for v in (payload.lancamento_ids or []) if int(v) > 0))
    if not ids:
        raise HTTPException(status_code=422, detail="Selecione pelo menos um título para emitir.")
    if len(ids) > 1000:
        raise HTTPException(status_code=422, detail="Uma emissão em lote pode conter no máximo 1000 títulos.")

    id_params = {f"id_{idx}": lancamento_id for idx, lancamento_id in enumerate(ids)}
    placeholders = ", ".join(f":id_{idx}" for idx in range(len(ids)))
    params: dict[str, Any] = {
        "empresa_id": empresa_id,
        "data_inicio": payload.data_inicio,
        "data_fim": payload.data_fim,
        **id_params,
    }
    where = [
        "l.empresa_id=:empresa_id",
        "l.id IN (" + placeholders + ")",
        "l.tipo='receber'",
        "l.status<>'cancelado'",
        "l.valor_total>l.valor_pago",
        "l.data_vencimento BETWEEN :data_inicio AND :data_fim",
        "NOT EXISTS (SELECT 1 FROM public.financeiro_cobrancas_emissao_itens ei "
        "WHERE ei.empresa_id=l.empresa_id AND ei.lancamento_id=l.id)",
    ]
    if payload.cliente_id is not None:
        where.append("l.cliente_id=:cliente_id")
        params["cliente_id"] = payload.cliente_id
    if payload.forma_cobranca_id is not None:
        where.append("l.forma_cobranca_id=:forma_cobranca_id")
        params["forma_cobranca_id"] = payload.forma_cobranca_id

    rows = db.execute(text(f"""
        SELECT
            l.id, l.cliente_id, l.forma_cobranca_id, l.descricao, l.documento,
            l.data_vencimento, l.valor_total, l.valor_pago,
            GREATEST(l.valor_total-l.valor_pago, 0) AS saldo_aberto,
            COALESCE(c.nome, 'Cliente não identificado') AS cliente_nome,
            COALESCE(fc.nome, 'Não informada') AS forma_cobranca_nome
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.clientes c
               ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
        LEFT JOIN public.financeiro_formas_cobranca fc
               ON fc.id=l.forma_cobranca_id AND fc.empresa_id=l.empresa_id
        WHERE {' AND '.join(where)}
        ORDER BY l.data_vencimento ASC, l.id ASC
        FOR UPDATE OF l
    """), params).fetchall()
    titulos = [row_dict(r) for r in rows]

    encontrados = {int(i["id"]) for i in titulos}
    indisponiveis = [i for i in ids if i not in encontrados]
    if indisponiveis:
        raise HTTPException(
            status_code=409,
            detail=(
                "Um ou mais títulos já foram emitidos, foram quitados/cancelados ou deixaram de atender aos filtros. "
                f"Atualize a seleção antes de continuar. IDs: {', '.join(map(str, indisponiveis[:20]))}"
            ),
        )

    valor_total = sum(Decimal(str(i.get("valor_total") or 0)) for i in titulos)
    saldo_total = sum(Decimal(str(i.get("saldo_aberto") or 0)) for i in titulos)

    try:
        emissao = db.execute(text("""
            INSERT INTO public.financeiro_cobrancas_emissoes (
                empresa_id, data_emissao, periodo_inicio, periodo_fim,
                cliente_filtro_id, forma_cobranca_filtro_id, total_titulos,
                valor_total_titulos, saldo_total_emitido, criado_por_usuario_id, criado_em
            ) VALUES (
                :empresa_id, CURRENT_DATE, :periodo_inicio, :periodo_fim,
                :cliente_id, :forma_cobranca_id, :total_titulos,
                :valor_total, :saldo_total, :usuario_id, NOW()
            )
            RETURNING *
        """), {
            "empresa_id": empresa_id,
            "periodo_inicio": payload.data_inicio,
            "periodo_fim": payload.data_fim,
            "cliente_id": payload.cliente_id,
            "forma_cobranca_id": payload.forma_cobranca_id,
            "total_titulos": len(titulos),
            "valor_total": valor_total,
            "saldo_total": saldo_total,
            "usuario_id": int(usuario.id),
        }).first()
        emissao_dict = row_dict(emissao)

        db.execute(text("""
            INSERT INTO public.financeiro_cobrancas_emissao_itens (
                empresa_id, emissao_id, lancamento_id, cliente_id, forma_cobranca_id,
                data_vencimento, valor_titulo, saldo_emitido, cliente_nome,
                forma_cobranca_nome, documento, descricao, criado_em
            ) VALUES (
                :empresa_id, :emissao_id, :lancamento_id, :cliente_id, :forma_cobranca_id,
                :data_vencimento, :valor_titulo, :saldo_emitido, :cliente_nome,
                :forma_cobranca_nome, :documento, :descricao, NOW()
            )
        """), [{
            "empresa_id": empresa_id,
            "emissao_id": int(emissao_dict["id"]),
            "lancamento_id": int(item["id"]),
            "cliente_id": item.get("cliente_id"),
            "forma_cobranca_id": item.get("forma_cobranca_id"),
            "data_vencimento": item["data_vencimento"],
            "valor_titulo": item.get("valor_total") or 0,
            "saldo_emitido": item.get("saldo_aberto") or 0,
            "cliente_nome": item.get("cliente_nome"),
            "forma_cobranca_nome": item.get("forma_cobranca_nome"),
            "documento": item.get("documento"),
            "descricao": item.get("descricao"),
        } for item in titulos])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A emissão não foi concluída porque um dos títulos já foi emitido em outro processo. Atualize a lista e tente novamente.",
        ) from exc

    return {
        "ok": True,
        "emissao_id": int(emissao_dict["id"]),
        "data_emissao": emissao_dict.get("data_emissao"),
        "total_titulos": len(titulos),
        "valor_total_titulos": float(valor_total),
        "saldo_total_emitido": float(saldo_total),
    }


@router.get("/cobrancas/emissoes-lotes")
def listar_emissoes_lotes(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    rows = db.execute(text("""
        SELECT
            e.*, c.nome AS cliente_filtro_nome, fc.nome AS forma_cobranca_filtro_nome,
            u.nome AS usuario_nome
        FROM public.financeiro_cobrancas_emissoes e
        LEFT JOIN public.clientes c
               ON c.id=e.cliente_filtro_id AND c.empresa_id=e.empresa_id
        LEFT JOIN public.financeiro_formas_cobranca fc
               ON fc.id=e.forma_cobranca_filtro_id AND fc.empresa_id=e.empresa_id
        LEFT JOIN public.usuarios u
               ON u.id=e.criado_por_usuario_id AND u.empresa_id=e.empresa_id
        WHERE e.empresa_id=:empresa_id
        ORDER BY e.data_emissao DESC, e.id DESC
        LIMIT :limit
    """), {"empresa_id": empresa_id, "limit": limit}).fetchall()
    return [row_dict(r) for r in rows]


@router.get("/cobrancas/emissoes-lotes/{emissao_id}/itens")
def listar_itens_emissao_lote(
    emissao_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    emissao = db.execute(text("""
        SELECT * FROM public.financeiro_cobrancas_emissoes
        WHERE empresa_id=:empresa_id AND id=:id
    """), {"empresa_id": empresa_id, "id": emissao_id}).first()
    if not emissao:
        raise HTTPException(status_code=404, detail="Lote de emissão não encontrado.")
    rows = db.execute(text("""
        SELECT * FROM public.financeiro_cobrancas_emissao_itens
        WHERE empresa_id=:empresa_id AND emissao_id=:emissao_id
        ORDER BY data_vencimento ASC, cliente_nome ASC, lancamento_id ASC
    """), {"empresa_id": empresa_id, "emissao_id": emissao_id}).fetchall()
    return {"emissao": row_dict(emissao), "items": [row_dict(r) for r in rows]}


# -----------------------------------------------------------------------------
# Fila / agenda de cobranças
# -----------------------------------------------------------------------------

@router.post("/cobrancas/processar")
def processar_regua_cobranca(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    """Executa imediatamente a automação da empresa autenticada.

    Além de materializar etapas vencidas, tenta entregar os canais configurados.
    O dispatcher de background executa esta mesma lógica sem depender da tela.
    """
    empresa_id = empresa_do(usuario)
    return executar_automacao_empresa(db, empresa_id, usuario_id=int(usuario.id))


@router.get("/cobrancas/automacao/status")
def status_automacao_cobranca(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    provedores = status_provedores(db, empresa_id)
    row = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status='pendente') AS pendentes,
            COUNT(*) FILTER (WHERE status='erro') AS erros,
            COUNT(*) FILTER (WHERE status='enviado' AND automatico=TRUE) AS enviados_automaticamente,
            MAX(enviado_em) FILTER (WHERE status='enviado' AND automatico=TRUE) AS ultimo_envio_automatico,
            MAX(ultima_tentativa_em) AS ultima_tentativa
        FROM public.financeiro_cobrancas_envios
        WHERE empresa_id=:empresa_id
    """), {"empresa_id": empresa_id}).first()
    return {**provedores, "empresa_id": empresa_id, "fila": row_dict(row)}


@router.post("/cobrancas/envios/{envio_id}/enviar-agora")
def enviar_cobranca_agora(
    envio_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    # Trava por item para evitar clique duplo ou corrida com o dispatcher.
    key = f"valora_cobranca_envio_{empresa_id}_{envio_id}"
    locked = bool(db.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": key}).scalar())
    if not locked:
        raise HTTPException(status_code=409, detail="Este envio já está sendo processado. Atualize a fila em alguns segundos.")
    try:
        anterior = db.execute(text("""
            SELECT status FROM public.financeiro_cobrancas_envios
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"empresa_id": empresa_id, "id": envio_id}).first()
        if not anterior:
            raise HTTPException(status_code=404, detail="Item da fila de cobrança não encontrado.")
        if str(anterior._mapping["status"] or "").lower() in {"enviado", "ignorado"}:
            raise HTTPException(status_code=409, detail="Este item já foi concluído e não será reenviado automaticamente.")
        try:
            resultado = enviar_envio(db, empresa_id, envio_id, usuario_id=int(usuario.id), forcar=True)
        except CobrancaDeliveryError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return resultado
    finally:
        try:
            db.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": key})
            db.commit()
        except Exception:
            db.rollback()


@router.get("/cobrancas/resumo")
def resumo_cobrancas(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE ce.status='pendente') AS fila_pendente,
            COUNT(DISTINCT l.id) FILTER (
                WHERE l.tipo='receber' AND l.status<>'cancelado'
                  AND l.valor_total>l.valor_pago AND l.data_vencimento<CURRENT_DATE
            ) AS titulos_vencidos,
            COUNT(*) FILTER (WHERE ce.status='pendente' AND e.acao='bloqueio') AS a_bloquear,
            COUNT(*) FILTER (WHERE ce.status='pendente' AND e.acao='protesto') AS a_protestar
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_cobrancas_envios ce
               ON ce.empresa_id=l.empresa_id AND ce.lancamento_id=l.id
        LEFT JOIN public.financeiro_reguas_cobranca_etapas e
               ON e.empresa_id=ce.empresa_id AND e.id=ce.etapa_id
        WHERE l.empresa_id=:empresa_id
    """), {"empresa_id": empresa_id}).first()
    return row_dict(row)


@router.get("/cobrancas/fila")
def listar_fila_cobranca(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    acao: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    where = ["ce.empresa_id=:empresa_id"]
    params: dict[str, Any] = {"empresa_id": empresa_id, "limit": limit}
    if status_filtro:
        status_norm = str(status_filtro).strip().lower()
        if status_norm not in {"pendente", "enviado", "ignorado", "erro"}:
            raise HTTPException(status_code=422, detail="Status de fila inválido.")
        where.append("ce.status=:status")
        params["status"] = status_norm
        if status_norm in {"pendente", "erro"}:
            where.append("l.status <> 'cancelado' AND l.valor_total > l.valor_pago")
    if acao:
        acao_norm = _acao_valida(acao)
        where.append("e.acao=:acao")
        params["acao"] = acao_norm

    rows = db.execute(text(f"""
        SELECT
            ce.*,
            l.cliente_id,
            l.descricao AS lancamento_descricao,
            l.documento,
            l.data_vencimento,
            l.valor_total,
            l.valor_pago,
            GREATEST(l.valor_total-l.valor_pago, 0) AS saldo_aberto,
            GREATEST(CURRENT_DATE-l.data_vencimento, 0) AS dias_atraso,
            c.nome AS cliente_nome,
            r.nome AS regua_nome,
            e.nome AS etapa_nome,
            e.deslocamento_dias,
            e.acao,
            e.ordem
        FROM public.financeiro_cobrancas_envios ce
        JOIN public.financeiro_lancamentos l
          ON l.id=ce.lancamento_id AND l.empresa_id=ce.empresa_id
        LEFT JOIN public.clientes c
          ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
        JOIN public.financeiro_reguas_cobranca_etapas e
          ON e.id=ce.etapa_id AND e.empresa_id=ce.empresa_id
        JOIN public.financeiro_reguas_cobranca r
          ON r.id=e.regua_id AND r.empresa_id=e.empresa_id
        WHERE {' AND '.join(where)}
        ORDER BY
            CASE ce.status WHEN 'pendente' THEN 0 WHEN 'erro' THEN 1 WHEN 'enviado' THEN 2 ELSE 3 END,
            ce.data_prevista DESC, e.ordem DESC, ce.id DESC
        LIMIT :limit
    """), params).fetchall()
    return [row_dict(r) for r in rows]


@router.patch("/cobrancas/envios/{envio_id}")
def atualizar_status_envio(
    envio_id: int,
    payload: StatusEnvioIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    status_norm = str(payload.status or "").strip().lower()
    if status_norm not in {"pendente", "enviado", "ignorado", "erro"}:
        raise HTTPException(status_code=422, detail="Status de envio inválido.")
    anterior = db.execute(text("""
        SELECT * FROM public.financeiro_cobrancas_envios
        WHERE empresa_id=:empresa_id AND id=:id
    """), {"empresa_id": empresa_id, "id": envio_id}).first()
    if not anterior:
        raise HTTPException(status_code=404, detail="Item da fila de cobrança não encontrado.")

    if status_norm == "enviado":
        titulo = db.execute(text("""
            SELECT l.status, l.valor_total, l.valor_pago
            FROM public.financeiro_lancamentos l
            WHERE l.empresa_id=:empresa_id AND l.id=:lancamento_id
        """), {"empresa_id": empresa_id, "lancamento_id": anterior._mapping["lancamento_id"]}).first()
        if not titulo or titulo._mapping["status"] == "cancelado" or titulo._mapping["valor_total"] <= titulo._mapping["valor_pago"]:
            row = db.execute(text("""
                UPDATE public.financeiro_cobrancas_envios
                   SET status='ignorado', ignorado_em=COALESCE(ignorado_em, NOW()),
                       erro=NULL, automatico=FALSE,
                       atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
                 WHERE empresa_id=:empresa_id AND id=:id
                 RETURNING *
            """), {"empresa_id": empresa_id, "id": envio_id, "usuario_id": int(usuario.id)}).first()
            db.commit()
            resultado = row_dict(row)
            resultado["auto_ignorado"] = True
            resultado["motivo"] = "O título já foi quitado ou cancelado; a cobrança não foi marcada como enviada."
            return resultado

    row = db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios
           SET status=:status,
               enviado_em=CASE WHEN :status='enviado' THEN NOW() ELSE enviado_em END,
               ignorado_em=CASE WHEN :status='ignorado' THEN NOW() ELSE ignorado_em END,
               erro=:erro,
               automatico=CASE WHEN :status IN ('enviado','ignorado') THEN FALSE ELSE automatico END,
               atualizado_por_usuario_id=:usuario_id,
               atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
         RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": envio_id,
        "status": status_norm,
        "erro": norm_str(payload.erro),
        "usuario_id": int(usuario.id),
    }).first()
    db.commit()
    return row_dict(row)
