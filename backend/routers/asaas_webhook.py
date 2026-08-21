from __future__ import annotations

import json
import secrets
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import text

from backend.database import SessionLocal
from backend.services.asaas_cobranca import webhook_token
from backend.services.cobranca_bancaria import processar_webhook_pagamento

router = APIRouter(prefix="/api/integracoes/asaas", tags=["Integração Asaas"])


@router.post("/webhook")
async def receber_webhook_asaas(
    request: Request,
    asaas_access_token: Optional[str] = Header(default=None, alias="asaas-access-token"),
):
    configured = webhook_token()
    if len(configured) < 32:
        raise HTTPException(status_code=503, detail="Webhook Asaas não configurado.")
    if not asaas_access_token or not secrets.compare_digest(str(asaas_access_token), configured):
        raise HTTPException(status_code=401, detail="Webhook não autorizado.")

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Payload inválido.")

    event_id = str(payload.get("id") or "").strip()
    event = str(payload.get("event") or "").strip().upper()
    payment = payload.get("payment") if isinstance(payload.get("payment"), dict) else {}
    payment_id = str(payment.get("id") or "").strip()
    if not event_id or not event or not payment_id:
        raise HTTPException(status_code=422, detail="Evento Asaas incompleto.")

    db = SessionLocal()
    try:
        duplicate = db.execute(
            text("SELECT 1 FROM financeiro_gateway_eventos WHERE provider='asaas' AND provider_event_id=:event_id"),
            {"event_id": event_id},
        ).scalar()
        if duplicate:
            return {"ok": True, "duplicado": True}

        db.execute(
            text("""
                INSERT INTO financeiro_gateway_eventos
                    (provider, provider_event_id, provider_payment_id, evento, payload_json, recebido_em)
                VALUES ('asaas', :event_id, :payment_id, :evento, :payload_json, NOW())
            """),
            {
                "event_id": event_id,
                "payment_id": payment_id,
                "evento": event,
                "payload_json": json.dumps(payload, ensure_ascii=False, default=str),
            },
        )

        resultado = processar_webhook_pagamento(
            db,
            payment_id=payment_id,
            event=event,
            payment=payment,
        )
        db.commit()
        return {"ok": True, "processamento": resultado}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
