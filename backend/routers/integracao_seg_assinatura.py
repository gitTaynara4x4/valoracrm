from __future__ import annotations

import hashlib
import json
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers.integracoes_seg import SEG_EMPRESA_ID, require_seg_api_key
from backend.services.contrato_cliente import contract_filename, render_contract_pdf

router = APIRouter(prefix="/api/integracoes/seg", tags=["Integração SEG - Assinatura"])


def _json_load(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return default


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _mask_document(value: Any) -> str:
    digits = _digits(value)
    if len(digits) == 11:
        return f"***.***.***-{digits[-2:]}"
    if len(digits) == 14:
        return f"**.***.***/****-{digits[-2:]}"
    return "***"


def _norm_name(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", raw).strip().casefold()


def _load_contract(db: Session, cliente_id: int, orcamento_id: int, lock: bool = False) -> Dict[str, Any]:
    suffix = " FOR UPDATE" if lock else ""
    row = db.execute(text("""
        SELECT id, empresa_id, cliente_id, codigo, titulo,
               proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
               proposta_cliente_contrato_gerado_em, proposta_cliente_contrato_snapshot_json,
               proposta_cliente_assinatura_status, proposta_cliente_assinatura_solicitada_em,
               proposta_cliente_assinatura_visualizado_em, proposta_cliente_assinatura_assinado_em,
               proposta_cliente_assinatura_cancelado_em, proposta_cliente_assinatura_id,
               proposta_cliente_assinante_nome, proposta_cliente_assinante_documento_mascarado,
               proposta_cliente_assinatura_documento_hash_sha256,
               proposta_cliente_assinatura_pdf_final_hash_sha256,
               proposta_cliente_assinatura_evidencias_json
        FROM orcamentos
        WHERE id=:orcamento_id AND cliente_id=:cliente_id AND empresa_id=:empresa_id
    """ + suffix), {
        "orcamento_id": int(orcamento_id),
        "cliente_id": int(cliente_id),
        "empresa_id": SEG_EMPRESA_ID,
    }).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contrato não encontrado para este cliente.")
    if str(row.get("proposta_cliente_contrato_status") or "") != "gerado":
        raise HTTPException(status_code=409, detail="O contrato ainda não foi gerado no Valora.")
    return dict(row)


def _expected_signer(snapshot: Dict[str, Any]) -> Dict[str, str]:
    client = snapshot.get("cliente") or {}
    person_type = str(client.get("tipo_pessoa") or "PF").upper()
    if person_type == "PJ":
        rep = client.get("representante") or {}
        name = str(rep.get("nome") or "").strip()
        document = _digits(rep.get("cpf"))
        label = "CPF do representante legal"
        if not name or len(document) != 11:
            return {"nome": name, "documento": document, "documento_mascarado": _mask_document(document), "rotulo_documento": label, "pode_assinar": False, "motivo": "Complete o representante legal e o CPF no cadastro para contrato."}
    else:
        name = str(client.get("nome") or "").strip()
        document = _digits(client.get("cpf_cnpj"))
        label = "CPF do contratante"
        if not name or len(document) != 11:
            return {"nome": name, "documento": document, "documento_mascarado": _mask_document(document), "rotulo_documento": label, "pode_assinar": False, "motivo": "O CPF do contratante precisa estar completo no cadastro para contrato."}
    return {"nome": name, "documento": document, "documento_mascarado": _mask_document(document), "rotulo_documento": label, "pode_assinar": True, "motivo": ""}


def _meta(row: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = _json_load(row.get("proposta_cliente_contrato_snapshot_json"), {})
    contract = snapshot.get("contrato") or {}
    signer = _expected_signer(snapshot)
    status = str(row.get("proposta_cliente_assinatura_status") or "nao_enviado")
    return {
        "orcamento_id": int(row.get("id") or 0),
        "orcamento_codigo": str(row.get("codigo") or ""),
        "titulo": str(contract.get("titulo") or row.get("titulo") or "Contrato"),
        "contrato_numero": str(contract.get("numero") or ""),
        "versao": int(row.get("proposta_cliente_contrato_versao") or contract.get("versao") or 0),
        "gerado_em": row.get("proposta_cliente_contrato_gerado_em").isoformat() if getattr(row.get("proposta_cliente_contrato_gerado_em"), "isoformat", None) else row.get("proposta_cliente_contrato_gerado_em"),
        "status": status,
        "solicitada_em": row.get("proposta_cliente_assinatura_solicitada_em").isoformat() if getattr(row.get("proposta_cliente_assinatura_solicitada_em"), "isoformat", None) else row.get("proposta_cliente_assinatura_solicitada_em"),
        "visualizado_em": row.get("proposta_cliente_assinatura_visualizado_em").isoformat() if getattr(row.get("proposta_cliente_assinatura_visualizado_em"), "isoformat", None) else row.get("proposta_cliente_assinatura_visualizado_em"),
        "assinado_em": row.get("proposta_cliente_assinatura_assinado_em").isoformat() if getattr(row.get("proposta_cliente_assinatura_assinado_em"), "isoformat", None) else row.get("proposta_cliente_assinatura_assinado_em"),
        "assinatura_id": row.get("proposta_cliente_assinatura_id"),
        "documento_hash_sha256": row.get("proposta_cliente_assinatura_documento_hash_sha256"),
        "pdf_final_hash_sha256": row.get("proposta_cliente_assinatura_pdf_final_hash_sha256"),
        "assinante": {
            "nome": signer.get("nome") or row.get("proposta_cliente_assinante_nome"),
            "documento_mascarado": signer.get("documento_mascarado") or row.get("proposta_cliente_assinante_documento_mascarado"),
            "rotulo_documento": signer.get("rotulo_documento"),
        },
        "pode_assinar": status in {"aguardando_assinatura", "visualizado"} and bool(signer.get("pode_assinar")),
        "motivo_bloqueio": signer.get("motivo") if not signer.get("pode_assinar") else None,
        "pdf_disponivel": status in {"aguardando_assinatura", "visualizado", "assinado"},
        "pdf_assinado_disponivel": status == "assinado",
    }


def _history(db: Session, budget_id: int, action: str, description: str, data: Dict[str, Any] | None = None) -> None:
    db.execute(text("""
        INSERT INTO orcamento_historico (orcamento_id, usuario_nome, acao, descricao, dados_json, criado_em)
        VALUES (:o, 'Área do Cliente SEG', :a, :d, :j, NOW())
    """), {"o": budget_id, "a": action, "d": description, "j": json.dumps(data or {}, ensure_ascii=False)})


@router.get("/clientes/{cliente_id}/contratos")
def listar_contratos_seg(cliente_id: int, response: Response, db: Session = Depends(get_db), _: None = Depends(require_seg_api_key)):
    response.headers["Cache-Control"] = "no-store"
    rows = db.execute(text("""
        SELECT id, empresa_id, cliente_id, codigo, titulo,
               proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
               proposta_cliente_contrato_gerado_em, proposta_cliente_contrato_snapshot_json,
               proposta_cliente_assinatura_status, proposta_cliente_assinatura_solicitada_em,
               proposta_cliente_assinatura_visualizado_em, proposta_cliente_assinatura_assinado_em,
               proposta_cliente_assinatura_cancelado_em, proposta_cliente_assinatura_id,
               proposta_cliente_assinante_nome, proposta_cliente_assinante_documento_mascarado,
               proposta_cliente_assinatura_documento_hash_sha256,
               proposta_cliente_assinatura_pdf_final_hash_sha256,
               proposta_cliente_assinatura_evidencias_json
        FROM orcamentos
        WHERE empresa_id=:empresa_id AND cliente_id=:cliente_id
          AND proposta_cliente_contrato_status='gerado'
          AND proposta_cliente_assinatura_status IN ('aguardando_assinatura','visualizado','assinado')
        ORDER BY COALESCE(proposta_cliente_assinatura_assinado_em, proposta_cliente_assinatura_solicitada_em, proposta_cliente_contrato_gerado_em) DESC, id DESC
        LIMIT 30
    """), {"empresa_id": SEG_EMPRESA_ID, "cliente_id": int(cliente_id)}).mappings().all()
    items = [_meta(dict(row)) for row in rows]
    return {"ok": True, "total": len(items), "pendentes": sum(1 for x in items if x["status"] in {"aguardando_assinatura", "visualizado"}), "contratos": items}


@router.get("/clientes/{cliente_id}/contratos/{orcamento_id}/pdf")
def pdf_contrato_seg(cliente_id: int, orcamento_id: int, assinado: bool = Query(default=False), db: Session = Depends(get_db), _: None = Depends(require_seg_api_key)):
    row = _load_contract(db, cliente_id, orcamento_id)
    status = str(row.get("proposta_cliente_assinatura_status") or "")
    if status not in {"aguardando_assinatura", "visualizado", "assinado"}:
        raise HTTPException(status_code=403, detail="Este contrato ainda não foi enviado para assinatura.")
    snapshot = _json_load(row.get("proposta_cliente_contrato_snapshot_json"), {})
    evidence = _json_load(row.get("proposta_cliente_assinatura_evidencias_json"), {})
    if assinado:
        if status != "assinado" or not evidence:
            raise HTTPException(status_code=409, detail="O contrato ainda não foi assinado.")
        pdf_bytes = render_contract_pdf(snapshot, assinatura=evidence)
        expected_final = str(row.get("proposta_cliente_assinatura_pdf_final_hash_sha256") or "")
        if expected_final and hashlib.sha256(pdf_bytes).hexdigest() != expected_final:
            raise HTTPException(status_code=409, detail="A versão assinada não passou na verificação de integridade.")
        filename = contract_filename(snapshot).replace('.pdf', '-assinado.pdf')
    else:
        pdf_bytes = render_contract_pdf(snapshot)
        expected_original = str(row.get("proposta_cliente_assinatura_documento_hash_sha256") or "")
        if expected_original and hashlib.sha256(pdf_bytes).hexdigest() != expected_original:
            raise HTTPException(status_code=409, detail="A versão do contrato não passou na verificação de integridade.")
        filename = contract_filename(snapshot)
    return FastAPIResponse(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff"})


@router.post("/clientes/{cliente_id}/contratos/{orcamento_id}/visualizado")
def contrato_visualizado_seg(cliente_id: int, orcamento_id: int, response: Response, db: Session = Depends(get_db), _: None = Depends(require_seg_api_key)):
    response.headers["Cache-Control"] = "no-store"
    row = _load_contract(db, cliente_id, orcamento_id, lock=True)
    status = str(row.get("proposta_cliente_assinatura_status") or "")
    if status == "aguardando_assinatura":
        db.execute(text("""UPDATE orcamentos SET proposta_cliente_assinatura_status='visualizado', proposta_cliente_assinatura_visualizado_em=COALESCE(proposta_cliente_assinatura_visualizado_em, NOW()) WHERE id=:id AND empresa_id=:empresa_id"""), {"id": orcamento_id, "empresa_id": SEG_EMPRESA_ID})
        _history(db, orcamento_id, "contrato_visualizado_para_assinatura", "Cliente visualizou o contrato na Área do Cliente SEG.")
        db.commit()
        row = _load_contract(db, cliente_id, orcamento_id)
    return _meta(row)


@router.post("/clientes/{cliente_id}/contratos/{orcamento_id}/assinar")
def assinar_contrato_seg(cliente_id: int, orcamento_id: int, response: Response, payload: dict = Body(default={}), db: Session = Depends(get_db), _: None = Depends(require_seg_api_key)):
    response.headers["Cache-Control"] = "no-store"
    row = _load_contract(db, cliente_id, orcamento_id, lock=True)
    status = str(row.get("proposta_cliente_assinatura_status") or "")
    if status == "assinado":
        return _meta(row)
    if status not in {"aguardando_assinatura", "visualizado"}:
        raise HTTPException(status_code=409, detail="Este contrato não está aguardando assinatura.")
    if payload.get("aceite") is not True:
        raise HTTPException(status_code=422, detail="Confirme que leu e concorda com o contrato.")

    snapshot = _json_load(row.get("proposta_cliente_contrato_snapshot_json"), {})
    signer = _expected_signer(snapshot)
    if not signer.get("pode_assinar"):
        raise HTTPException(status_code=409, detail=str(signer.get("motivo") or "Dados do assinante incompletos."))
    supplied_doc = _digits(payload.get("documento"))
    if not supplied_doc or supplied_doc != signer.get("documento"):
        raise HTTPException(status_code=401, detail="O CPF informado não confere com o representante/contratante do contrato.")

    version = int(payload.get("versao") or 0)
    if version != int(row.get("proposta_cliente_contrato_versao") or 0):
        raise HTTPException(status_code=409, detail="A versão do contrato mudou. Atualize a página antes de assinar.")

    unsigned_pdf = render_contract_pdf(snapshot)
    document_hash = hashlib.sha256(unsigned_pdf).hexdigest()
    stored_hash = str(row.get("proposta_cliente_assinatura_documento_hash_sha256") or "")
    if stored_hash and stored_hash != document_hash:
        raise HTTPException(status_code=409, detail="O documento disponível não corresponde à versão enviada para assinatura.")
    client_hash = str(payload.get("documento_hash_sha256") or "").strip().lower()
    if client_hash and client_hash != document_hash:
        raise HTTPException(status_code=409, detail="O documento exibido no navegador não corresponde à versão atual.")

    now = datetime.now(timezone.utc)
    signature_id = f"SIG-{now.strftime('%Y%m%d')}-{secrets.token_hex(8).upper()}"
    evidence = {
        "assinatura_id": signature_id,
        "assinante_nome": signer.get("nome"),
        "assinante_documento_mascarado": signer.get("documento_mascarado"),
        "assinado_em": now.isoformat(),
        "ip": str(payload.get("ip") or "")[:80],
        "user_agent": str(payload.get("user_agent") or "")[:500],
        "metodo": "Área do Cliente SEG Sistemas - conta autenticada por senha",
        "session_fingerprint": str(payload.get("session_fingerprint") or "")[:128],
        "documento_hash_sha256": document_hash,
        "consentimento": "Li e concordo com o contrato exibido e com a realização do aceite eletrônico.",
        "origem": "area_cliente_seg",
    }
    final_pdf = render_contract_pdf(snapshot, assinatura=evidence)
    final_hash = hashlib.sha256(final_pdf).hexdigest()
    evidence["pdf_final_hash_sha256"] = final_hash

    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_assinatura_status='assinado',
            proposta_cliente_assinatura_assinado_em=:assinado_em,
            proposta_cliente_assinatura_id=:assinatura_id,
            proposta_cliente_assinante_nome=:nome,
            proposta_cliente_assinante_documento_mascarado=:documento,
            proposta_cliente_assinatura_documento_hash_sha256=:documento_hash,
            proposta_cliente_assinatura_pdf_final_hash_sha256=:final_hash,
            proposta_cliente_assinatura_evidencias_json=:evidencias
        WHERE id=:id AND empresa_id=:empresa_id AND cliente_id=:cliente_id
    """), {
        "assinado_em": now,
        "assinatura_id": signature_id,
        "nome": signer.get("nome"),
        "documento": signer.get("documento_mascarado"),
        "documento_hash": document_hash,
        "final_hash": final_hash,
        "evidencias": json.dumps(evidence, ensure_ascii=False),
        "id": orcamento_id,
        "empresa_id": SEG_EMPRESA_ID,
        "cliente_id": cliente_id,
    })
    _history(db, orcamento_id, "contrato_assinado_eletronicamente", "Contrato assinado eletronicamente pelo cliente na Área do Cliente SEG.", {"assinatura_id": signature_id, "versao": version, "documento_hash_sha256": document_hash, "pdf_final_hash_sha256": final_hash})
    db.commit()
    return _meta(_load_contract(db, cliente_id, orcamento_id))
