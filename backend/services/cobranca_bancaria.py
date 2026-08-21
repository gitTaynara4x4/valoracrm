from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.services.asaas_cobranca import (
    AsaasError,
    buscar_pagamento_por_referencia,
    configured as asaas_configured,
    criar_boleto,
    environment_name as asaas_environment_name,
    obter_linha_digitavel,
    obter_ou_criar_cliente,
    obter_pagamento,
    obter_pix,
)

RECEIVED_STATUSES = {"RECEIVED", "RECEIVED_IN_CASH"}
REFUND_STATUSES = {"REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS"}


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _text(value: Any) -> Optional[str]:
    value = str(value or "").strip()
    return value or None


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _date_from_payment(payment: Dict[str, Any]) -> date:
    for key in ("paymentDate", "clientPaymentDate", "confirmedDate"):
        raw = str(payment.get(key) or "").strip()
        if raw:
            try:
                return date.fromisoformat(raw[:10])
            except Exception:
                pass
    return datetime.now(timezone.utc).date()


def _custom_fields(db: Session, empresa_id: int, cliente_id: int) -> Dict[str, str]:
    rows = db.execute(text("""
        SELECT cc.slug, ccv.valor
        FROM public.campos_clientes cc
        JOIN public.clientes_campos_valores ccv ON ccv.campo_id=cc.id AND ccv.cliente_id=:cliente_id
        WHERE cc.empresa_id=:empresa_id
          AND cc.slug IN ('cpf_cnpj','cnpj','cpf','razao_social','telefone_principal_whatssap',
                          'telefone_whatssap','e_mail_cobranca','logradouro','nº','complemento','bairro','cep')
    """), {"empresa_id": empresa_id, "cliente_id": cliente_id}).mappings().all()
    return {str(row["slug"]): str(row.get("valor") or "").strip() for row in rows if str(row.get("valor") or "").strip()}


def montar_cliente_asaas(db: Session, empresa_id: int, cliente_id: int) -> Dict[str, Any]:
    cliente = db.execute(text("""
        SELECT id, codigo, nome, cpf_cnpj, telefone, whatsapp, email, email_cobranca,
               endereco, numero, complemento, bairro, cep
        FROM public.clientes
        WHERE empresa_id=:empresa_id AND id=:cliente_id
        LIMIT 1
    """), {"empresa_id": empresa_id, "cliente_id": cliente_id}).mappings().first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente do título não foi encontrado.")

    custom = _custom_fields(db, empresa_id, cliente_id)
    documento = ""
    for value in (cliente.get("cpf_cnpj"), custom.get("cpf_cnpj"), custom.get("cnpj"), custom.get("cpf")):
        digits = _digits(value)
        if len(digits) in {11, 14}:
            documento = digits
            break
    if not documento:
        raise HTTPException(status_code=422, detail="CPF/CNPJ do cliente precisa estar preenchido para emitir boleto.")

    telefone = custom.get("telefone_principal_whatssap") or custom.get("telefone_whatssap") or cliente.get("whatsapp") or cliente.get("telefone")
    email = cliente.get("email_cobranca") or cliente.get("email") or custom.get("e_mail_cobranca")
    payload: Dict[str, Any] = {
        "name": custom.get("razao_social") or cliente.get("nome") or f"Cliente {cliente.get('codigo')}",
        "cpfCnpj": documento,
        "email": _text(email),
        "mobilePhone": _digits(telefone),
        "address": custom.get("logradouro") or cliente.get("endereco"),
        "addressNumber": custom.get("nº") or cliente.get("numero"),
        "complement": custom.get("complemento") or cliente.get("complemento"),
        "province": custom.get("bairro") or cliente.get("bairro"),
        "postalCode": _digits(custom.get("cep") or cliente.get("cep")),
        "notificationDisabled": True,
    }
    return {k: v for k, v in payload.items() if v not in {None, ""}}


def obter_titulo_boleto(db: Session, empresa_id: int, lancamento_id: int, *, cliente_id: Optional[int] = None, for_update: bool = False, allow_cancelled: bool = False) -> Dict[str, Any]:
    where_cliente = "AND l.cliente_id=:cliente_id" if cliente_id is not None else ""
    params: Dict[str, Any] = {"empresa_id": empresa_id, "id": lancamento_id}
    if cliente_id is not None:
        params["cliente_id"] = cliente_id
    lock_sql = " FOR UPDATE OF l" if for_update else ""
    row = db.execute(text(f"""
        SELECT l.*, fc.nome AS forma_cobranca_nome, fc.tipo AS forma_cobranca_tipo,
               cb.nome AS conta_banco_nome, cb.ativo AS conta_banco_ativa
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_formas_cobranca fc ON fc.id=l.forma_cobranca_id AND fc.empresa_id=l.empresa_id
        LEFT JOIN public.financeiro_contas_bancos cb ON cb.id=l.conta_banco_id AND cb.empresa_id=l.empresa_id
        WHERE l.empresa_id=:empresa_id AND l.id=:id AND l.tipo='receber' {where_cliente}{lock_sql}
    """), params).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Título de Contas a Receber não encontrado.")
    data = dict(row)
    if str(data.get("status") or "").casefold() == "cancelado" and not allow_cancelled:
        raise HTTPException(status_code=409, detail="Este título está cancelado.")
    saldo = max(Decimal("0.00"), _decimal(data.get("valor_total")) - _decimal(data.get("valor_pago")))
    data["saldo"] = saldo
    return data


def _cobranca_row(db: Session, empresa_id: int, lancamento_id: int) -> Optional[Dict[str, Any]]:
    row = db.execute(text("""
        SELECT * FROM public.financeiro_cobrancas_externas
        WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
        LIMIT 1
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).mappings().first()
    return dict(row) if row else None


def _nosso_numero(payment: Dict[str, Any], linha: Dict[str, Any]) -> Optional[str]:
    return _text(linha.get("nossoNumero") or linha.get("nosso_numero") or payment.get("nossoNumero") or payment.get("nosso_numero"))


def _salvar_cobranca(
    db: Session,
    *,
    empresa_id: int,
    lancamento_id: int,
    cliente_id: int,
    customer_id: str,
    payment: Dict[str, Any],
    linha: Dict[str, Any],
    pix: Dict[str, Any],
    ultimo_evento: Optional[str] = None,
) -> Dict[str, Any]:
    payment_id = str(payment.get("id") or "").strip()
    if not payment_id:
        raise HTTPException(status_code=502, detail="O provedor não retornou o identificador da cobrança.")
    nosso_numero = _nosso_numero(payment, linha)
    provider_status = str(payment.get("status") or "").upper().strip()
    db.execute(text("""
        INSERT INTO public.financeiro_cobrancas_externas
            (empresa_id, lancamento_id, cliente_id, provider, provider_customer_id, provider_payment_id,
             billing_type, provider_status, invoice_url, bank_slip_url, identification_field, barcode,
             pix_payload, pix_expiration, provider_payload_json, ultimo_evento,
             ultima_sincronizacao_em, criado_em, atualizado_em)
        VALUES
            (:empresa_id, :lancamento_id, :cliente_id, 'asaas', :customer_id, :payment_id,
             :billing_type, :provider_status, :invoice_url, :bank_slip_url, :identification_field, :barcode,
             :pix_payload, :pix_expiration, :payload, :ultimo_evento, NOW(), NOW(), NOW())
        ON CONFLICT (empresa_id, lancamento_id) DO UPDATE SET
             provider='asaas', provider_customer_id=EXCLUDED.provider_customer_id,
             provider_payment_id=EXCLUDED.provider_payment_id, billing_type=EXCLUDED.billing_type,
             provider_status=EXCLUDED.provider_status, invoice_url=EXCLUDED.invoice_url,
             bank_slip_url=EXCLUDED.bank_slip_url, identification_field=EXCLUDED.identification_field,
             barcode=EXCLUDED.barcode, pix_payload=EXCLUDED.pix_payload, pix_expiration=EXCLUDED.pix_expiration,
             provider_payload_json=EXCLUDED.provider_payload_json,
             ultimo_evento=COALESCE(EXCLUDED.ultimo_evento, financeiro_cobrancas_externas.ultimo_evento),
             ultima_sincronizacao_em=NOW(), atualizado_em=NOW()
    """), {
        "empresa_id": empresa_id,
        "lancamento_id": lancamento_id,
        "cliente_id": cliente_id,
        "customer_id": customer_id or None,
        "payment_id": payment_id,
        "billing_type": payment.get("billingType"),
        "provider_status": provider_status,
        "invoice_url": payment.get("invoiceUrl"),
        "bank_slip_url": payment.get("bankSlipUrl"),
        "identification_field": linha.get("identificationField"),
        "barcode": linha.get("barCode"),
        "pix_payload": pix.get("payload"),
        "pix_expiration": pix.get("expirationDate"),
        "payload": json.dumps(payment, ensure_ascii=False, default=str),
        "ultimo_evento": ultimo_evento,
    })
    if nosso_numero:
        db.execute(text("""
            UPDATE public.financeiro_lancamentos
            SET nosso_numero=:nosso_numero, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"nosso_numero": nosso_numero, "empresa_id": empresa_id, "id": lancamento_id})
    return _cobranca_row(db, empresa_id, lancamento_id) or {}


def _recalcular_lancamento(db: Session, empresa_id: int, lancamento_id: int, usuario_id: Optional[int]) -> Dict[str, Any]:
    lanc = db.execute(text("""
        SELECT id, tipo, status, valor_total, data_vencimento
        FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id AND id=:id
        FOR UPDATE
    """), {"empresa_id": empresa_id, "id": lancamento_id}).mappings().first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Título financeiro não encontrado durante a conciliação.")

    total = db.execute(text("""
        SELECT COALESCE(SUM(CASE WHEN tipo_movimentacao='baixa'
            THEN COALESCE(NULLIF(valor_principal,0), valor)
            ELSE -COALESCE(NULLIF(valor_principal,0), valor) END), 0)
        FROM public.financeiro_movimentacoes
        WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
          AND tipo_movimentacao IN ('baixa','estorno')
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar() or Decimal("0")
    total = max(Decimal("0.00"), _decimal(total))
    valor_total = _decimal(lanc.get("valor_total"))
    vencimento = lanc.get("data_vencimento")
    if str(lanc.get("status") or "").lower() == "cancelado":
        status_final = "cancelado"
    elif valor_total > 0 and total >= valor_total:
        status_final = "recebido"
    elif total > 0:
        status_final = "parcial"
    elif vencimento and vencimento < date.today():
        status_final = "vencido"
    else:
        status_final = "aberto"

    ultima_data = db.execute(text("""
        SELECT MAX(b.data_movimentacao)
        FROM public.financeiro_movimentacoes b
        WHERE b.empresa_id=:empresa_id AND b.lancamento_id=:lancamento_id AND b.tipo_movimentacao='baixa'
          AND NOT EXISTS (
              SELECT 1 FROM public.financeiro_movimentacoes e
              WHERE e.empresa_id=b.empresa_id AND e.movimentacao_origem_id=b.id AND e.tipo_movimentacao='estorno'
          )
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar()

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
        SET valor_pago=:valor_pago, data_pagamento=:data_pagamento, status=:status,
            atualizado_por_usuario_id=COALESCE(:usuario_id, atualizado_por_usuario_id), atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id
    """), {
        "valor_pago": total,
        "data_pagamento": ultima_data,
        "status": status_final,
        "usuario_id": usuario_id,
        "empresa_id": empresa_id,
        "id": lancamento_id,
    })
    return {"valor_pago": total, "saldo_aberto": max(Decimal("0.00"), valor_total-total), "status": status_final, "data_pagamento": ultima_data}


def reconciliar_pagamento_confirmado(
    db: Session,
    *,
    empresa_id: int,
    lancamento_id: int,
    payment: Dict[str, Any],
    evento: Optional[str],
    usuario_id: Optional[int],
    automatico: bool,
    conta_banco_id: Optional[int] = None,
) -> Dict[str, Any]:
    provider_status = str(payment.get("status") or "").upper().strip()
    if provider_status not in RECEIVED_STATUSES:
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status=CASE
                    WHEN provider_status = 'REFUNDED' THEN 'estornado_no_gateway'
                    WHEN provider_status IN ('REFUND_REQUESTED','REFUND_IN_PROGRESS') THEN 'estorno_pendente_gateway'
                    ELSE 'aguardando_retorno' END,
                atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
        """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id})
        return {"conciliado": False, "status": "aguardando_retorno"}

    titulo = obter_titulo_boleto(db, empresa_id, lancamento_id, for_update=True, allow_cancelled=True)
    if str(titulo.get("status") or "").casefold() == "cancelado":
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='divergencia_titulo_cancelado', data_recebimento_gateway=:data_recebimento,
                valor_recebido_gateway=:valor_recebido, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
        """), {
            "data_recebimento": _date_from_payment(payment), "valor_recebido": _decimal(payment.get("value")),
            "empresa_id": empresa_id, "lancamento_id": lancamento_id,
        })
        return {"conciliado": False, "status": "divergencia_titulo_cancelado"}
    if conta_banco_id is not None:
        conta = db.execute(text("""
            SELECT id FROM public.financeiro_contas_bancos
            WHERE empresa_id=:empresa_id AND id=:id AND ativo=TRUE
        """), {"empresa_id": empresa_id, "id": conta_banco_id}).scalar()
        if not conta:
            raise HTTPException(status_code=422, detail="Conta Corrente/Banco inválida ou inativa.")
        db.execute(text("""
            UPDATE public.financeiro_lancamentos SET conta_banco_id=:conta_id, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"conta_id": conta_banco_id, "empresa_id": empresa_id, "id": lancamento_id})
        titulo["conta_banco_id"] = conta_banco_id

    cobranca = _cobranca_row(db, empresa_id, lancamento_id) or {}
    payment_id = str(payment.get("id") or cobranca.get("provider_payment_id") or "").strip()
    if not payment_id:
        raise HTTPException(status_code=422, detail="Cobrança bancária sem identificador do pagamento.")

    if cobranca.get("conciliado_movimentacao_id"):
        movimento = db.execute(text("""
            SELECT m.id,
                   EXISTS (
                       SELECT 1 FROM public.financeiro_movimentacoes e
                       WHERE e.empresa_id=m.empresa_id
                         AND e.movimentacao_origem_id=m.id
                         AND e.tipo_movimentacao='estorno'
                   ) AS estornada
            FROM public.financeiro_movimentacoes m
            WHERE m.empresa_id=:empresa_id AND m.id=:id
              AND m.lancamento_id=:lancamento_id AND m.tipo_movimentacao='baixa'
        """), {
            "empresa_id": empresa_id,
            "id": cobranca["conciliado_movimentacao_id"],
            "lancamento_id": lancamento_id,
        }).mappings().first()
        if movimento and not bool(movimento.get("estornada")):
            return {
                "conciliado": True,
                "status": "conciliado",
                "movimentacao_id": int(movimento["id"]),
                "idempotente": True,
            }
        if movimento and bool(movimento.get("estornada")):
            db.execute(text("""
                UPDATE public.financeiro_cobrancas_externas
                SET conciliacao_status='divergencia_baixa_estornada', atualizado_em=NOW()
                WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
            """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id})
            return {
                "conciliado": False,
                "status": "divergencia_baixa_estornada",
                "movimentacao_id": int(movimento["id"]),
                "precisa_revisao": True,
            }

    saldo = max(Decimal("0.00"), _decimal(titulo.get("valor_total")) - _decimal(titulo.get("valor_pago")))
    payment_value = _decimal(payment.get("value"))
    if saldo <= 0:
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='conciliado', conciliado_em=COALESCE(conciliado_em,NOW()),
                conciliado_automaticamente=FALSE, data_recebimento_gateway=:data_recebimento,
                valor_recebido_gateway=:valor_recebido, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
        """), {
            "data_recebimento": _date_from_payment(payment), "valor_recebido": payment_value,
            "empresa_id": empresa_id, "lancamento_id": lancamento_id,
        })
        return {"conciliado": True, "status": "conciliado", "movimentacao_id": None, "titulo_ja_baixado": True}

    conta_id = titulo.get("conta_banco_id")
    if not conta_id:
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='aguardando_conta', data_recebimento_gateway=:data_recebimento,
                valor_recebido_gateway=:valor_recebido, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
        """), {
            "data_recebimento": _date_from_payment(payment), "valor_recebido": payment_value,
            "empresa_id": empresa_id, "lancamento_id": lancamento_id,
        })
        return {"conciliado": False, "status": "aguardando_conta", "precisa_conta": True}

    principal = min(saldo, payment_value if payment_value > 0 else saldo)
    if principal <= 0:
        principal = saldo
    modalidade = "total" if principal >= saldo else "parcial"
    chave = f"asaas:{payment_id}:received"[:100]
    existing = db.execute(text("""
        SELECT id FROM public.financeiro_movimentacoes
        WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
          AND tipo_movimentacao='baixa' AND chave_idempotencia=:chave
        LIMIT 1
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id, "chave": chave}).scalar()
    if existing:
        movimento_id = int(existing)
    else:
        mov = db.execute(text("""
            INSERT INTO public.financeiro_movimentacoes (
                empresa_id, lancamento_id, tipo_movimentacao, valor,
                valor_principal, valor_desconto, valor_acrescimo, valor_multa, valor_mora,
                dias_atraso, modalidade_baixa, data_movimentacao, forma_pagamento_id,
                conta_banco_id, conta_contabil_id, centro_custo_principal_id, centro_custo_secundario_id,
                chave_idempotencia, observacoes, usuario_id, criado_em
            ) VALUES (
                :empresa_id, :lancamento_id, 'baixa', :valor,
                :principal, 0, 0, 0, 0,
                :dias_atraso, :modalidade, :data_movimentacao, :forma_pagamento_id,
                :conta_banco_id, :conta_contabil_id, :centro_principal_id, :centro_secundario_id,
                :chave, :observacoes, :usuario_id, NOW()
            ) RETURNING id
        """), {
            "empresa_id": empresa_id,
            "lancamento_id": lancamento_id,
            "valor": principal,
            "principal": principal,
            "dias_atraso": max(0, (_date_from_payment(payment) - titulo["data_vencimento"]).days) if titulo.get("data_vencimento") else 0,
            "modalidade": modalidade,
            "data_movimentacao": _date_from_payment(payment),
            "forma_pagamento_id": titulo.get("forma_pagamento_id"),
            "conta_banco_id": conta_id,
            "conta_contabil_id": titulo.get("conta_contabil_id"),
            "centro_principal_id": titulo.get("centro_custo_principal_id"),
            "centro_secundario_id": titulo.get("centro_custo_secundario_id"),
            "chave": chave,
            "observacoes": f"Baixa {'automática' if automatico else 'conciliada'} via Asaas • {evento or provider_status} • cobrança {payment_id}",
            "usuario_id": usuario_id,
        }).scalar_one()
        movimento_id = int(mov)

    calculado = _recalcular_lancamento(db, empresa_id, lancamento_id, usuario_id)
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_externas
        SET conciliacao_status='conciliado', conciliado_em=NOW(),
            conciliado_movimentacao_id=:movimentacao_id,
            conciliado_automaticamente=:automatico,
            data_recebimento_gateway=:data_recebimento,
            valor_recebido_gateway=:valor_recebido,
            atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
    """), {
        "movimentacao_id": movimento_id,
        "automatico": bool(automatico),
        "data_recebimento": _date_from_payment(payment),
        "valor_recebido": payment_value,
        "empresa_id": empresa_id,
        "lancamento_id": lancamento_id,
    })
    db.execute(text("""
        INSERT INTO public.financeiro_auditoria
            (empresa_id, usuario_id, acao, entidade, entidade_id, dados_novos, motivo, criado_em)
        VALUES (:empresa_id, :usuario_id, :acao, 'lancamento', :lancamento_id,
                CAST(:dados AS JSONB), :motivo, NOW())
    """), {
        "empresa_id": empresa_id,
        "usuario_id": usuario_id,
        "acao": "baixa_automatica_gateway" if automatico else "conciliar_gateway",
        "lancamento_id": lancamento_id,
        "dados": json.dumps({
            "provider": "asaas", "provider_payment_id": payment_id,
            "movimentacao_id": movimento_id, "valor_principal": float(principal),
            "conta_banco_id": conta_id, "status": calculado["status"],
        }, ensure_ascii=False),
        "motivo": evento or provider_status,
    })
    return {"conciliado": True, "status": "conciliado", "movimentacao_id": movimento_id, "idempotente": bool(existing), **calculado}


def emitir_ou_atualizar_cobranca(
    db: Session,
    *,
    empresa_id: int,
    lancamento_id: int,
    criar: bool,
    cliente_id: Optional[int] = None,
    conta_banco_id: Optional[int] = None,
    usuario_id: Optional[int] = None,
    conciliar_se_recebido: bool = True,
) -> Dict[str, Any]:
    if not asaas_configured():
        raise HTTPException(status_code=503, detail="Emissão de boleto Asaas ainda não configurada no Valora.")
    titulo = obter_titulo_boleto(db, empresa_id, lancamento_id, cliente_id=cliente_id, for_update=True)
    cliente_id_real = int(titulo.get("cliente_id") or 0)
    if not cliente_id_real:
        raise HTTPException(status_code=422, detail="O título precisa estar vinculado a um cliente para emitir boleto.")

    if conta_banco_id is not None:
        conta = db.execute(text("""
            SELECT id FROM public.financeiro_contas_bancos
            WHERE empresa_id=:empresa_id AND id=:id AND ativo=TRUE
        """), {"empresa_id": empresa_id, "id": conta_banco_id}).scalar()
        if not conta:
            raise HTTPException(status_code=422, detail="Conta Corrente/Banco inválida ou inativa.")
        db.execute(text("""
            UPDATE public.financeiro_lancamentos SET conta_banco_id=:conta_id, atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND id=:id
        """), {"conta_id": conta_banco_id, "empresa_id": empresa_id, "id": lancamento_id})
        titulo["conta_banco_id"] = conta_banco_id

    existente = _cobranca_row(db, empresa_id, lancamento_id)
    customer_id = str((existente or {}).get("provider_customer_id") or "")
    try:
        if existente:
            payment_id = str(existente.get("provider_payment_id") or "").strip()
            payment = obter_pagamento(payment_id)
        else:
            if not criar:
                raise HTTPException(status_code=404, detail="Boleto ainda não emitido para este título.")
            if titulo["saldo"] <= 0:
                raise HTTPException(status_code=409, detail="Este título já está quitado.")
            if titulo.get("data_vencimento") and titulo["data_vencimento"] < date.today():
                raise HTTPException(status_code=409, detail="Título vencido: revise vencimento/encargos antes de emitir uma nova cobrança.")
            forma_tipo = str(titulo.get("forma_cobranca_tipo") or "").casefold()
            forma_nome = str(titulo.get("forma_cobranca_nome") or "").casefold()
            if forma_tipo != "boleto" and "boleto" not in forma_nome:
                raise HTTPException(status_code=422, detail="Configure a Forma de Cobrança do título como Boleto antes de emitir.")
            customer = obter_ou_criar_cliente(montar_cliente_asaas(db, empresa_id, cliente_id_real), cliente_id=cliente_id_real)
            customer_id = str(customer.get("id") or "").strip()
            if not customer_id:
                raise HTTPException(status_code=502, detail="O Asaas não retornou o cliente pagador.")
            external_reference = f"VALORA-LANCAMENTO-{int(lancamento_id)}"
            payment = buscar_pagamento_por_referencia(external_reference)
            if not payment:
                payment = criar_boleto(
                    asaas_customer_id=customer_id,
                    lancamento_id=lancamento_id,
                    valor=titulo["saldo"],
                    vencimento=titulo["data_vencimento"],
                    descricao=str(titulo.get("descricao") or f"Título {lancamento_id}"),
                )
            payment_id = str(payment.get("id") or "").strip()

        linha = obter_linha_digitavel(payment_id)
        try:
            pix = obter_pix(payment_id)
        except AsaasError:
            pix = {}
        cobranca = _salvar_cobranca(
            db,
            empresa_id=empresa_id,
            lancamento_id=lancamento_id,
            cliente_id=cliente_id_real,
            customer_id=customer_id,
            payment=payment,
            linha=linha,
            pix=pix,
        )
        conciliacao = None
        provider_status = str(payment.get("status") or "").upper().strip()
        if provider_status == "REFUNDED":
            conciliacao = _estornar_baixa_por_reembolso_gateway(
                db, cobranca=cobranca, payment=payment, evento="SINCRONIZACAO_MANUAL"
            )
        elif provider_status in {"REFUND_REQUESTED", "REFUND_IN_PROGRESS"}:
            db.execute(text("""
                UPDATE public.financeiro_cobrancas_externas
                SET conciliacao_status='estorno_pendente_gateway', atualizado_em=NOW()
                WHERE empresa_id=:empresa_id AND lancamento_id=:lancamento_id
            """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id})
            conciliacao = {
                "conciliado": bool(cobranca.get("conciliado_movimentacao_id")),
                "status": "estorno_pendente_gateway",
                "estorno_financeiro": False,
            }
        elif conciliar_se_recebido and provider_status in RECEIVED_STATUSES:
            conciliacao = reconciliar_pagamento_confirmado(
                db, empresa_id=empresa_id, lancamento_id=lancamento_id,
                payment=payment, evento="SINCRONIZACAO_MANUAL", usuario_id=usuario_id,
                automatico=False, conta_banco_id=conta_banco_id,
            )
        return {
            "provider": "asaas",
            "ambiente": asaas_environment_name(),
            "configurado": True,
            "cobranca": _cobranca_row(db, empresa_id, lancamento_id) or cobranca,
            "conciliacao": conciliacao,
        }
    except AsaasError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _estornar_baixa_por_reembolso_gateway(
    db: Session,
    *,
    cobranca: Dict[str, Any],
    payment: Dict[str, Any],
    evento: str,
) -> Dict[str, Any]:
    empresa_id = int(cobranca["empresa_id"])
    lancamento_id = int(cobranca["lancamento_id"])
    movimento_id = cobranca.get("conciliado_movimentacao_id")

    if not movimento_id:
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='estornado_no_gateway', atualizado_em=NOW()
            WHERE id=:id
        """), {"id": cobranca["id"]})
        return {
            "conciliado": False,
            "status": "estornado_no_gateway",
            "estorno_financeiro": False,
            "motivo": "Cobrança reembolsada sem baixa conciliada vinculada.",
        }

    baixa = db.execute(text("""
        SELECT m.*
        FROM public.financeiro_movimentacoes m
        WHERE m.empresa_id=:empresa_id AND m.id=:id
          AND m.lancamento_id=:lancamento_id AND m.tipo_movimentacao='baixa'
        FOR UPDATE
    """), {
        "empresa_id": empresa_id,
        "id": movimento_id,
        "lancamento_id": lancamento_id,
    }).mappings().first()
    if not baixa:
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='divergencia_movimentacao_ausente', atualizado_em=NOW()
            WHERE id=:id
        """), {"id": cobranca["id"]})
        return {
            "conciliado": False,
            "status": "divergencia_movimentacao_ausente",
            "estorno_financeiro": False,
            "precisa_revisao": True,
        }

    estorno_existente = db.execute(text("""
        SELECT id FROM public.financeiro_movimentacoes
        WHERE empresa_id=:empresa_id
          AND movimentacao_origem_id=:origem_id
          AND tipo_movimentacao='estorno'
        LIMIT 1
    """), {"empresa_id": empresa_id, "origem_id": movimento_id}).scalar()

    if estorno_existente:
        estorno_id = int(estorno_existente)
        calculado = _recalcular_lancamento(db, empresa_id, lancamento_id, None)
    else:
        estorno_id = int(db.execute(text("""
            INSERT INTO public.financeiro_movimentacoes (
                empresa_id, lancamento_id, tipo_movimentacao, valor,
                valor_principal, valor_desconto, valor_acrescimo, valor_multa, valor_mora,
                dias_atraso, modalidade_baixa, data_movimentacao, forma_pagamento_id,
                conta_banco_id, conta_contabil_id, centro_custo_principal_id, centro_custo_secundario_id,
                movimentacao_origem_id, observacoes, usuario_id, criado_em
            ) VALUES (
                :empresa_id, :lancamento_id, 'estorno', :valor,
                :valor_principal, :valor_desconto, :valor_acrescimo, :valor_multa, :valor_mora,
                :dias_atraso, :modalidade_baixa, :data_movimentacao, :forma_pagamento_id,
                :conta_banco_id, :conta_contabil_id, :centro_principal_id, :centro_secundario_id,
                :origem_id, :observacoes, NULL, NOW()
            ) RETURNING id
        """), {
            "empresa_id": empresa_id,
            "lancamento_id": lancamento_id,
            "valor": _decimal(baixa.get("valor")),
            "valor_principal": _decimal(baixa.get("valor_principal") or baixa.get("valor")),
            "valor_desconto": _decimal(baixa.get("valor_desconto")),
            "valor_acrescimo": _decimal(baixa.get("valor_acrescimo")),
            "valor_multa": _decimal(baixa.get("valor_multa")),
            "valor_mora": _decimal(baixa.get("valor_mora")),
            "dias_atraso": int(baixa.get("dias_atraso") or 0),
            "modalidade_baixa": baixa.get("modalidade_baixa"),
            "data_movimentacao": datetime.now(timezone.utc).date(),
            "forma_pagamento_id": baixa.get("forma_pagamento_id"),
            "conta_banco_id": baixa.get("conta_banco_id"),
            "conta_contabil_id": baixa.get("conta_contabil_id"),
            "centro_principal_id": baixa.get("centro_custo_principal_id"),
            "centro_secundario_id": baixa.get("centro_custo_secundario_id"),
            "origem_id": movimento_id,
            "observacoes": f"Estorno automático via Asaas • {evento or 'PAYMENT_REFUNDED'} • cobrança {payment.get('id') or cobranca.get('provider_payment_id')}",
        }).scalar_one())
        calculado = _recalcular_lancamento(db, empresa_id, lancamento_id, None)
        db.execute(text("""
            INSERT INTO public.financeiro_auditoria
                (empresa_id, usuario_id, acao, entidade, entidade_id, dados_novos, motivo, criado_em)
            VALUES (:empresa_id, NULL, 'estorno_automatico_gateway', 'lancamento', :lancamento_id,
                    CAST(:dados AS JSONB), :motivo, NOW())
        """), {
            "empresa_id": empresa_id,
            "lancamento_id": lancamento_id,
            "dados": json.dumps({
                "provider": "asaas",
                "provider_payment_id": payment.get("id") or cobranca.get("provider_payment_id"),
                "movimentacao_origem_id": int(movimento_id),
                "movimentacao_estorno_id": estorno_id,
                "status": calculado["status"],
            }, ensure_ascii=False),
            "motivo": evento or "PAYMENT_REFUNDED",
        })

    db.execute(text("""
        UPDATE public.financeiro_cobrancas_externas
        SET conciliacao_status='estornado_no_gateway', atualizado_em=NOW()
        WHERE id=:id
    """), {"id": cobranca["id"]})
    return {
        "conciliado": False,
        "status": "estornado_no_gateway",
        "estorno_financeiro": True,
        "movimentacao_origem_id": int(movimento_id),
        "movimentacao_estorno_id": estorno_id,
        "idempotente": bool(estorno_existente),
        **calculado,
    }


def processar_webhook_pagamento(
    db: Session,
    *,
    payment_id: str,
    event: str,
    payment: Dict[str, Any],
) -> Dict[str, Any]:
    row = db.execute(text("""
        SELECT * FROM public.financeiro_cobrancas_externas
        WHERE provider='asaas' AND provider_payment_id=:payment_id
        LIMIT 1
    """), {"payment_id": payment_id}).mappings().first()
    if not row:
        return {"encontrado": False, "conciliado": False}

    # Mantém a mesma ordem de locks da emissão/conciliação manual:
    # primeiro o título, depois a cobrança externa. Isso evita deadlock se o
    # webhook chegar exatamente enquanto o operador sincroniza o boleto.
    obter_titulo_boleto(
        db, int(row["empresa_id"]), int(row["lancamento_id"]),
        for_update=True, allow_cancelled=True,
    )

    provider_status = str(payment.get("status") or event.removeprefix("PAYMENT_") or "").strip().upper()
    db.execute(text("""
        UPDATE public.financeiro_cobrancas_externas
        SET provider_status=:provider_status, ultimo_evento=:evento,
            provider_payload_json=:payload_json, ultima_sincronizacao_em=NOW(), atualizado_em=NOW()
        WHERE id=:id
    """), {
        "id": row["id"],
        "provider_status": provider_status,
        "evento": event,
        "payload_json": json.dumps(payment, ensure_ascii=False, default=str),
    })
    payment = dict(payment)
    payment.setdefault("id", payment_id)
    payment.setdefault("status", provider_status)

    refund_event = event in {"PAYMENT_REFUNDED", "PAYMENT_REFUND_REQUESTED", "PAYMENT_REFUND_IN_PROGRESS"}
    if provider_status in REFUND_STATUSES or refund_event:
        refund_confirmado = provider_status == "REFUNDED" or event == "PAYMENT_REFUNDED"
        if refund_confirmado:
            result = _estornar_baixa_por_reembolso_gateway(
                db, cobranca=dict(row), payment=payment, evento=event
            )
            return {"encontrado": True, **result}
        db.execute(text("""
            UPDATE public.financeiro_cobrancas_externas
            SET conciliacao_status='estorno_pendente_gateway', atualizado_em=NOW()
            WHERE id=:id
        """), {"id": row["id"]})
        return {
            "encontrado": True,
            "conciliado": bool(row.get("conciliado_movimentacao_id")),
            "status": "estorno_pendente_gateway",
            "estorno_financeiro": False,
        }

    if provider_status in RECEIVED_STATUSES or event in {"PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"}:
        result = reconciliar_pagamento_confirmado(
            db,
            empresa_id=int(row["empresa_id"]),
            lancamento_id=int(row["lancamento_id"]),
            payment=payment,
            evento=event,
            usuario_id=None,
            automatico=True,
        )
        return {"encontrado": True, **result}

    return {"encontrado": True, "conciliado": False, "status": provider_status}


def status_cobranca(db: Session, empresa_id: int, lancamento_id: int) -> Dict[str, Any]:
    titulo = obter_titulo_boleto(db, empresa_id, lancamento_id, allow_cancelled=True)
    cobranca = _cobranca_row(db, empresa_id, lancamento_id)
    return {
        "provider": "asaas" if cobranca else None,
        "configurado": bool(asaas_configured()),
        "ambiente": asaas_environment_name() if asaas_configured() else None,
        "titulo": {
            "id": int(titulo["id"]),
            "cliente_id": titulo.get("cliente_id"),
            "descricao": titulo.get("descricao"),
            "documento": titulo.get("documento"),
            "nosso_numero": titulo.get("nosso_numero"),
            "data_vencimento": titulo.get("data_vencimento"),
            "valor_total": titulo.get("valor_total"),
            "valor_pago": titulo.get("valor_pago"),
            "saldo": titulo.get("saldo"),
            "conta_banco_id": titulo.get("conta_banco_id"),
            "conta_banco_nome": titulo.get("conta_banco_nome"),
            "forma_cobranca_nome": titulo.get("forma_cobranca_nome"),
            "forma_cobranca_tipo": titulo.get("forma_cobranca_tipo"),
        },
        "cobranca": cobranca,
    }
