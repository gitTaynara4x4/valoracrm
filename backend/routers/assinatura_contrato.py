from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend import models
from backend.security.permissions import get_db, require_permission
from backend.services.contrato_cliente import contract_filename, render_contract_pdf

router = APIRouter(prefix="/api/orcamentos", tags=["Orçamentos - Assinatura"])


def _load_json(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        return json.loads(str(value or "")) if value else {}
    except Exception:
        return {}


def _load(db: Session, budget_id: int, company_id: int, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = db.execute(text("""
        SELECT id, empresa_id, cliente_id, codigo,
               proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
               proposta_cliente_contrato_gerado_em, proposta_cliente_contrato_snapshot_json,
               proposta_cliente_assinatura_status, proposta_cliente_assinatura_solicitada_em,
               proposta_cliente_assinatura_enviado_por_id, proposta_cliente_assinatura_visualizado_em,
               proposta_cliente_assinatura_assinado_em, proposta_cliente_assinatura_cancelado_em,
               proposta_cliente_assinatura_id, proposta_cliente_assinante_nome,
               proposta_cliente_assinante_documento_mascarado,
               proposta_cliente_assinatura_documento_hash_sha256,
               proposta_cliente_assinatura_pdf_final_hash_sha256,
               proposta_cliente_assinatura_evidencias_json
        FROM orcamentos WHERE id=:id AND empresa_id=:empresa_id
    """ + suffix), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    return dict(row)


def _iso(value):
    return value.isoformat() if getattr(value, "isoformat", None) else value


def _details(row: Dict[str, Any]):
    snapshot = _load_json(row.get("proposta_cliente_contrato_snapshot_json"))
    contract = snapshot.get("contrato") or {}
    status = str(row.get("proposta_cliente_assinatura_status") or "nao_enviado")
    return {
        "status": status,
        "contrato_numero": contract.get("numero"),
        "versao": int(row.get("proposta_cliente_contrato_versao") or 0),
        "solicitada_em": _iso(row.get("proposta_cliente_assinatura_solicitada_em")),
        "visualizado_em": _iso(row.get("proposta_cliente_assinatura_visualizado_em")),
        "assinado_em": _iso(row.get("proposta_cliente_assinatura_assinado_em")),
        "cancelado_em": _iso(row.get("proposta_cliente_assinatura_cancelado_em")),
        "assinatura_id": row.get("proposta_cliente_assinatura_id"),
        "assinante_nome": row.get("proposta_cliente_assinante_nome"),
        "assinante_documento_mascarado": row.get("proposta_cliente_assinante_documento_mascarado"),
        "documento_hash_sha256": row.get("proposta_cliente_assinatura_documento_hash_sha256"),
        "pdf_final_hash_sha256": row.get("proposta_cliente_assinatura_pdf_final_hash_sha256"),
        "pode_enviar": str(row.get("proposta_cliente_contrato_status") or "") == "gerado" and status in {"nao_enviado", "cancelado"},
        "pode_cancelar": status in {"aguardando_assinatura", "visualizado"},
        "pdf_assinado_disponivel": status == "assinado",
    }


def _history(db: Session, budget_id: int, user: models.Usuario, action: str, description: str, data: Dict[str, Any] | None = None):
    db.execute(text("""
        INSERT INTO orcamento_historico (orcamento_id, usuario_id, usuario_nome, acao, descricao, dados_json, criado_em)
        VALUES (:o, :u, :n, :a, :d, :j, NOW())
    """), {"o": budget_id, "u": int(user.id), "n": user.nome, "a": action, "d": description, "j": json.dumps(data or {}, ensure_ascii=False)})


@router.get("/{budget_id}/contrato/assinatura")
def assinatura_status(budget_id: int, current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")), db: Session = Depends(get_db)):
    return _details(_load(db, budget_id, int(current_user.empresa_id)))


@router.post("/{budget_id}/contrato/assinatura/enviar")
def enviar_assinatura(budget_id: int, payload: dict = Body(default={}), current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")), db: Session = Depends(get_db)):
    company_id = int(current_user.empresa_id)
    row = _load(db, budget_id, company_id, lock=True)
    if str(row.get("proposta_cliente_contrato_status") or "") != "gerado":
        raise HTTPException(status_code=409, detail="Gere o contrato antes de enviar para assinatura.")
    status = str(row.get("proposta_cliente_assinatura_status") or "nao_enviado")
    if status == "assinado":
        raise HTTPException(status_code=409, detail="Este contrato já foi assinado.")
    if status in {"aguardando_assinatura", "visualizado"}:
        return _details(row)
    snapshot = _load_json(row.get("proposta_cliente_contrato_snapshot_json"))
    if not snapshot:
        raise HTTPException(status_code=409, detail="A versão do contrato não foi encontrada.")
    cliente = snapshot.get("cliente") or {}
    if str(cliente.get("tipo_pessoa") or "PF").upper() == "PJ":
        representante = cliente.get("representante") or {}
        cpf_assinante = "".join(ch for ch in str(representante.get("cpf") or "") if ch.isdigit())
        if not str(representante.get("nome") or "").strip() or len(cpf_assinante) != 11:
            raise HTTPException(status_code=409, detail="Complete o nome e o CPF do representante legal antes de enviar para assinatura.")
    else:
        cpf_assinante = "".join(ch for ch in str(cliente.get("cpf_cnpj") or "") if ch.isdigit())
        if not str(cliente.get("nome") or "").strip() or len(cpf_assinante) != 11:
            raise HTTPException(status_code=409, detail="Complete o nome e o CPF do contratante antes de enviar para assinatura.")
    document_hash = hashlib.sha256(render_contract_pdf(snapshot)).hexdigest()
    now = datetime.now(timezone.utc)
    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_assinatura_status='aguardando_assinatura',
            proposta_cliente_assinatura_solicitada_em=:agora,
            proposta_cliente_assinatura_enviado_por_id=:usuario_id,
            proposta_cliente_assinatura_visualizado_em=NULL,
            proposta_cliente_assinatura_assinado_em=NULL,
            proposta_cliente_assinatura_cancelado_em=NULL,
            proposta_cliente_assinatura_id=NULL,
            proposta_cliente_assinante_nome=NULL,
            proposta_cliente_assinante_documento_mascarado=NULL,
            proposta_cliente_assinatura_documento_hash_sha256=:hash,
            proposta_cliente_assinatura_pdf_final_hash_sha256=NULL,
            proposta_cliente_assinatura_evidencias_json=NULL
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"agora": now, "usuario_id": int(current_user.id), "hash": document_hash, "id": budget_id, "empresa_id": company_id})
    _history(db, budget_id, current_user, "contrato_enviado_assinatura_seg", "Contrato disponibilizado para assinatura na Área do Cliente SEG.", {"versao": row.get("proposta_cliente_contrato_versao"), "documento_hash_sha256": document_hash})
    db.commit()
    return _details(_load(db, budget_id, company_id))


@router.post("/{budget_id}/contrato/assinatura/cancelar")
def cancelar_assinatura(budget_id: int, current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")), db: Session = Depends(get_db)):
    company_id = int(current_user.empresa_id)
    row = _load(db, budget_id, company_id, lock=True)
    status = str(row.get("proposta_cliente_assinatura_status") or "nao_enviado")
    if status == "assinado":
        raise HTTPException(status_code=409, detail="Uma assinatura concluída não pode ser cancelada por esta ação.")
    if status not in {"aguardando_assinatura", "visualizado"}:
        return _details(row)
    db.execute(text("""UPDATE orcamentos SET proposta_cliente_assinatura_status='cancelado', proposta_cliente_assinatura_cancelado_em=NOW() WHERE id=:id AND empresa_id=:empresa_id"""), {"id": budget_id, "empresa_id": company_id})
    _history(db, budget_id, current_user, "assinatura_seg_cancelada", "Solicitação de assinatura na Área do Cliente SEG cancelada.")
    db.commit()
    return _details(_load(db, budget_id, company_id))


@router.get("/{budget_id}/contrato/pdf-assinado")
def pdf_assinado(budget_id: int, download: bool = Query(default=False), current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")), db: Session = Depends(get_db)):
    row = _load(db, budget_id, int(current_user.empresa_id))
    if str(row.get("proposta_cliente_assinatura_status") or "") != "assinado":
        raise HTTPException(status_code=409, detail="O contrato ainda não foi assinado.")
    snapshot = _load_json(row.get("proposta_cliente_contrato_snapshot_json"))
    evidence = _load_json(row.get("proposta_cliente_assinatura_evidencias_json"))
    if not snapshot or not evidence:
        raise HTTPException(status_code=409, detail="As evidências da assinatura não foram encontradas.")
    pdf_bytes = render_contract_pdf(snapshot, assinatura=evidence)
    expected_hash = str(row.get("proposta_cliente_assinatura_pdf_final_hash_sha256") or "")
    if expected_hash and hashlib.sha256(pdf_bytes).hexdigest() != expected_hash:
        raise HTTPException(status_code=409, detail="A versão assinada não passou na verificação de integridade.")
    filename = contract_filename(snapshot).replace('.pdf', '-assinado.pdf')
    disposition = "attachment" if download else "inline"
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'{disposition}; filename="{filename}"', "Cache-Control": "private, no-store, max-age=0"})
