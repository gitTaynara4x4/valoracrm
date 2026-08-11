from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal
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
# Fila / agenda de cobranças
# -----------------------------------------------------------------------------

@router.post("/cobrancas/processar")
def processar_regua_cobranca(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    """Materializa na fila as etapas vencidas das contas a receber ainda abertas.

    Não envia mensagens. Isso separa a regra financeira dos provedores de
    WhatsApp/SMS/E-mail e deixa a automação segura e multiempresa.
    """
    empresa_id = empresa_do(usuario)

    # Se o pagamento/cancelamento foi identificado depois que a etapa entrou na
    # fila, ela deixa de ser acionável antes de qualquer novo processamento.
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_envios ce
           SET status='ignorado',
               ignorado_em=COALESCE(ce.ignorado_em, NOW()),
               erro=NULL,
               atualizado_por_usuario_id=:usuario_id,
               atualizado_em=NOW()
          FROM public.financeiro_lancamentos l
         WHERE ce.empresa_id=:empresa_id
           AND ce.empresa_id=l.empresa_id
           AND ce.lancamento_id=l.id
           AND ce.status IN ('pendente', 'erro')
           AND (l.status='cancelado' OR l.valor_total <= l.valor_pago)
    """), {"empresa_id": empresa_id, "usuario_id": int(usuario.id)})

    before = int(db.execute(text("""
        SELECT COUNT(*) FROM public.financeiro_cobrancas_envios
        WHERE empresa_id=:empresa_id
    """), {"empresa_id": empresa_id}).scalar() or 0)

    db.execute(text("""
        WITH regua_padrao AS (
            SELECT id
            FROM public.financeiro_reguas_cobranca
            WHERE empresa_id=:empresa_id AND ativo=TRUE AND padrao=TRUE
            ORDER BY id
            LIMIT 1
        ), elegiveis AS (
            SELECT
                l.id AS lancamento_id,
                e.id AS etapa_id,
                e.canal,
                e.mensagem,
                (l.data_vencimento + e.deslocamento_dias) AS data_prevista,
                CASE
                    WHEN e.canal='email' THEN COALESCE(NULLIF(l.email_cobranca,''), NULLIF(c.email_cobranca,''), NULLIF(c.email,''))
                    WHEN e.canal IN ('whatsapp','sms') THEN COALESCE(NULLIF(l.whatsapp_cobranca,''), NULLIF(c.whatsapp,''), NULLIF(c.telefone,''))
                    ELSE NULL
                END AS contato_destino
            FROM public.financeiro_lancamentos l
            JOIN public.financeiro_reguas_cobranca r
              ON r.empresa_id=l.empresa_id
             AND r.id=COALESCE(l.regua_cobranca_id, (SELECT id FROM regua_padrao))
             AND r.ativo=TRUE
            JOIN public.financeiro_reguas_cobranca_etapas e
              ON e.empresa_id=r.empresa_id AND e.regua_id=r.id AND e.ativo=TRUE
            LEFT JOIN public.clientes c
              ON c.id=l.cliente_id AND c.empresa_id=l.empresa_id
            WHERE l.empresa_id=:empresa_id
              AND l.tipo='receber'
              AND l.status <> 'cancelado'
              AND l.valor_total > l.valor_pago
              AND CURRENT_DATE >= (l.data_vencimento + e.deslocamento_dias)
        )
        INSERT INTO public.financeiro_cobrancas_envios (
            empresa_id, lancamento_id, etapa_id, canal, contato_destino,
            mensagem, data_prevista, status, criado_por_usuario_id,
            atualizado_por_usuario_id, criado_em, atualizado_em
        )
        SELECT :empresa_id, x.lancamento_id, x.etapa_id, x.canal,
               x.contato_destino, x.mensagem, x.data_prevista, 'pendente',
               :usuario_id, :usuario_id, NOW(), NOW()
        FROM elegiveis x
        ON CONFLICT (empresa_id, lancamento_id, etapa_id) DO NOTHING
    """), {"empresa_id": empresa_id, "usuario_id": int(usuario.id)})
    db.commit()

    after = int(db.execute(text("""
        SELECT COUNT(*) FROM public.financeiro_cobrancas_envios
        WHERE empresa_id=:empresa_id
    """), {"empresa_id": empresa_id}).scalar() or 0)
    return {"ok": True, "novos": max(0, after - before)}


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
                       erro=NULL, atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
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
