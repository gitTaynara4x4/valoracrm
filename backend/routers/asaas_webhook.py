from __future__ import annotations

import json
import secrets
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import text

from backend.database import SessionLocal
from backend.services.asaas_cobranca import webhook_token

router = APIRouter(prefix="/api/integracoes/asaas", tags=["Integração Asaas"])


def _payment_date(payment: dict[str, Any]) -> date:
    for key in ("paymentDate", "clientPaymentDate", "confirmedDate"):
        raw = str(payment.get(key) or "").strip()
        if raw:
            try:
                return date.fromisoformat(raw[:10])
            except Exception:
                pass
    return datetime.now(timezone.utc).date()


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

        row = db.execute(
            text("""
                SELECT id, empresa_id, lancamento_id
                FROM financeiro_cobrancas_externas
                WHERE provider='asaas' AND provider_payment_id=:payment_id
                LIMIT 1
            """),
            {"payment_id": payment_id},
        ).mappings().first()

        if row:
            provider_status = str(payment.get("status") or event.removeprefix("PAYMENT_") or "").strip().upper()
            db.execute(
                text("""
                    UPDATE financeiro_cobrancas_externas
                    SET provider_status=:provider_status,
                        ultimo_evento=:evento,
                        provider_payload_json=:payload_json,
                        ultima_sincronizacao_em=NOW(),
                        atualizado_em=NOW()
                    WHERE id=:id
                """),
                {
                    "id": row["id"],
                    "provider_status": provider_status,
                    "evento": event,
                    "payload_json": json.dumps(payment, ensure_ascii=False, default=str),
                },
            )

            if event in {"PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"}:
                lanc = db.execute(
                    text("SELECT valor_total FROM financeiro_lancamentos WHERE id=:id AND empresa_id=:empresa_id"),
                    {"id": row["lancamento_id"], "empresa_id": row["empresa_id"]},
                ).mappings().first()
                if lanc:
                    total = Decimal(str(lanc.get("valor_total") or 0))
                    received = payment.get("value")
                    try:
                        received_value = Decimal(str(received)) if received is not None else total
                    except Exception:
                        received_value = total
                    received_value = min(max(received_value, Decimal("0")), total) if total > 0 else received_value
                    db.execute(
                        text("""
                            UPDATE financeiro_lancamentos
                            SET valor_pago=GREATEST(valor_pago, :valor_pago),
                                data_pagamento=COALESCE(data_pagamento, :data_pagamento),
                                status=CASE WHEN :valor_pago >= valor_total THEN 'pago' ELSE status END,
                                atualizado_em=NOW()
                            WHERE id=:id AND empresa_id=:empresa_id AND tipo='receber'
                        """),
                        {
                            "valor_pago": received_value,
                            "data_pagamento": _payment_date(payment),
                            "id": row["lancamento_id"],
                            "empresa_id": row["empresa_id"],
                        },
                    )

        db.commit()
        return {"ok": True}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
