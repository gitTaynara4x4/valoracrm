from __future__ import annotations

import json
import os
import re
import secrets
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.services.asaas_cobranca import AsaasError, configured as asaas_configured, environment_name as asaas_environment_name, obter_ou_criar_cliente as asaas_obter_ou_criar_cliente, criar_boleto as asaas_criar_boleto, buscar_pagamento_por_referencia as asaas_buscar_pagamento_por_referencia, obter_linha_digitavel as asaas_obter_linha_digitavel, obter_pix as asaas_obter_pix, obter_pagamento as asaas_obter_pagamento
from backend.services.cobranca_bancaria import emitir_ou_atualizar_cobranca

from backend.routers.proposta_cliente_publica import (
    PublicApprovalIn,
    PublicChangeRequestIn,
    PublicContractRegistrationIn,
    approve_public_proposal,
    complete_public_contract_registration,
    get_public_contract_registration,
    get_public_proposal,
    request_public_change,
)


router = APIRouter(prefix="/api/integracoes/seg", tags=["Integração SEG"])

# A integração SEG é deliberadamente limitada à empresa do Nilson.
# Não aceite empresa_id vindo de query, path, body ou header.
SEG_EMPRESA_ID = 2
SEG_API_KEY_ENV = "SEG_INTEGRATION_API_KEY"
SEG_API_KEY_HEADER = "X-SEG-API-Key"
MAX_TITULOS_RETORNADOS = 120

# Somente estes campos personalizados podem sair do Valora por esta integração.
# Dados internos, observações, CPF/RG, comissão, desconto e campos de teste ficam fora.
CUSTOM_FIELDS_APROVADOS = {
    "razao_social",
    "nome_fantasia",
    "tipo_cliente",
    "telefone_principal_whatssap",
    "telefone_whatssap",
    "telefone_contato_whatssap",
    "pessoa_contato",
    "pessoa_responsavel",
    "e_mail_cobranca",
    "logradouro",
    "nº",
    "complemento",
    "bairro",
    "cidade",
    "uf",
    "cep",
    "monit24hs",
    "conta_monit24hs",
    "tipo_de_contrato",
    "tipo_de_imovel",
    "segmento",
}

# Campos usados SOMENTE para autenticação do portal. Eles nunca são retornados
# como dados do cliente. A API compara os valores e devolve apenas se houve match.
AUTH_CUSTOM_FIELDS = {
    "cpf_cnpj",
    "cnpj",
    "cpf",
    "telefone_principal_whatssap",
    "telefone_whatssap",
    "telefone_contato_whatssap",
    "conta_monit24hs",
    "monit24hs",
}


def _texto(value: Any) -> Optional[str]:
    if value is None:
        return None
    value = str(value).strip()
    if not value or value.lower() in {"null", "undefined", "none"}:
        return None
    return value


def _primeiro(*values: Any) -> Optional[str]:
    for value in values:
        normalized = _texto(value)
        if normalized is not None:
            return normalized
    return None


def _decimal_str(value: Any) -> str:
    try:
        return f"{Decimal(str(value or 0)):.2f}"
    except Exception:
        return "0.00"


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return _decimal_str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _ensure_no_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Valora-Integration"] = "SEG"


def require_seg_api_key(
    x_seg_api_key: Optional[str] = Header(default=None, alias=SEG_API_KEY_HEADER),
) -> None:
    configured = str(os.getenv(SEG_API_KEY_ENV) or "").strip()

    # Falha fechada: uma chave ausente nunca deve transformar esta rota em pública.
    if len(configured) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Integração SEG não configurada no servidor.",
        )

    supplied = str(x_seg_api_key or "").strip()
    if not supplied or not secrets.compare_digest(supplied, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chave da integração SEG inválida.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


def _custom_fields_cliente(db: Session, cliente_id: int) -> Dict[str, Optional[str]]:
    rows = (
        db.query(models.CampoCliente.slug, models.ClienteCampoValor.valor)
        .join(models.ClienteCampoValor, models.ClienteCampoValor.campo_id == models.CampoCliente.id)
        .filter(models.CampoCliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(models.CampoCliente.slug.in_(sorted(CUSTOM_FIELDS_APROVADOS)))
        .all()
    )
    return {str(slug): _texto(valor) for slug, valor in rows}




def _somente_digitos(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _variantes_telefone(value: Any) -> set[str]:
    """Normaliza formatos de telefone históricos usados no Valora."""
    raw = str(value or "").strip()
    if not raw:
        return set()

    partes = [raw] + [parte for parte in re.split(r"[/;,|]+", raw) if parte.strip()]
    variantes: set[str] = set()

    for parte in partes:
        digits = _somente_digitos(parte)
        if not digits:
            continue

        candidatos = {digits}
        if digits.startswith("55") and len(digits) in {12, 13}:
            candidatos.add(digits[2:])
        if len(digits) > 11:
            candidatos.add(digits[-11:])
            candidatos.add(digits[-10:])

        for candidato in candidatos:
            if len(candidato) in {10, 11}:
                variantes.add(candidato)

    return variantes


def _telefone_confere(informado: Any, cadastrado: Any) -> bool:
    informado_variantes = _variantes_telefone(informado)
    if not informado_variantes:
        return False
    return bool(informado_variantes & _variantes_telefone(cadastrado))


def _auth_custom_fields_cliente(db: Session, cliente_id: int) -> Dict[str, Optional[str]]:
    rows = (
        db.query(models.CampoCliente.slug, models.ClienteCampoValor.valor)
        .join(models.ClienteCampoValor, models.ClienteCampoValor.campo_id == models.CampoCliente.id)
        .filter(models.CampoCliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(models.CampoCliente.slug.in_(sorted(AUTH_CUSTOM_FIELDS)))
        .all()
    )
    return {str(slug): _texto(valor) for slug, valor in rows}


def _buscar_cliente_por_conta_monitoramento(db: Session, conta: str) -> list[models.Cliente]:
    conta = str(conta or "").strip()
    if not conta:
        return []

    return (
        db.query(models.Cliente)
        .join(models.ClienteCampoValor, models.ClienteCampoValor.cliente_id == models.Cliente.id)
        .join(models.CampoCliente, models.CampoCliente.id == models.ClienteCampoValor.campo_id)
        .filter(models.Cliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.CampoCliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.CampoCliente.slug == "conta_monit24hs")
        .filter(func.trim(models.ClienteCampoValor.valor) == conta)
        .all()
    )


def _buscar_clientes_por_documento(db: Session, documento: str) -> list[models.Cliente]:
    digits = _somente_digitos(documento)
    if len(digits) not in {11, 14}:
        return []

    resultados: dict[int, models.Cliente] = {}

    # Campo nativo do cadastro.
    for cliente in (
        db.query(models.Cliente)
        .filter(models.Cliente.empresa_id == SEG_EMPRESA_ID)
        .filter(func.regexp_replace(func.coalesce(models.Cliente.cpf_cnpj, ""), "[^0-9]", "", "g") == digits)
        .all()
    ):
        resultados[int(cliente.id)] = cliente

    # Campos personalizados históricos usados na base do Nilson.
    for cliente in (
        db.query(models.Cliente)
        .join(models.ClienteCampoValor, models.ClienteCampoValor.cliente_id == models.Cliente.id)
        .join(models.CampoCliente, models.CampoCliente.id == models.ClienteCampoValor.campo_id)
        .filter(models.Cliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.CampoCliente.empresa_id == SEG_EMPRESA_ID)
        .filter(models.CampoCliente.slug.in_(["cpf_cnpj", "cnpj", "cpf"]))
        .filter(func.regexp_replace(func.coalesce(models.ClienteCampoValor.valor, ""), "[^0-9]", "", "g") == digits)
        .all()
    ):
        resultados[int(cliente.id)] = cliente

    return list(resultados.values())


def _cliente_monitorado_ou_none(db: Session, cliente: models.Cliente) -> models.Cliente | None:
    custom = _custom_fields_cliente(db, int(cliente.id))
    monitor_status = _texto(custom.get("monit24hs"))
    if not monitor_status or not _portal_elegivel(monitor_status):
        return None
    return cliente


def _buscar_cliente_por_identificador(db: Session, identificador: str) -> models.Cliente:
    raw = str(identificador or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="Identificador é obrigatório.")

    # 1) Código do cliente tem prioridade e é único por empresa.
    cliente_codigo = (
        db.query(models.Cliente)
        .filter(models.Cliente.empresa_id == SEG_EMPRESA_ID, models.Cliente.codigo == raw)
        .first()
    )
    if cliente_codigo and _cliente_monitorado_ou_none(db, cliente_codigo):
        return cliente_codigo

    # 2) Conta Monit24hs. Deve identificar somente um local.
    contas = [
        cliente
        for cliente in _buscar_cliente_por_conta_monitoramento(db, raw)
        if _cliente_monitorado_ou_none(db, cliente)
    ]
    contas_unicas = {int(cliente.id): cliente for cliente in contas}
    if len(contas_unicas) == 1:
        return next(iter(contas_unicas.values()))
    if len(contas_unicas) > 1:
        raise HTTPException(
            status_code=409,
            detail="Conta Monit24hs corresponde a mais de um local. Use o código do cliente.",
        )

    # 3) CPF/CNPJ pode estar repetido quando uma empresa possui várias unidades.
    documentos = [
        cliente
        for cliente in _buscar_clientes_por_documento(db, raw)
        if _cliente_monitorado_ou_none(db, cliente)
    ]
    documentos_unicos = {int(cliente.id): cliente for cliente in documentos}
    if len(documentos_unicos) == 1:
        return next(iter(documentos_unicos.values()))
    if len(documentos_unicos) > 1:
        raise HTTPException(
            status_code=409,
            detail="CPF/CNPJ possui mais de um local monitorado. Use o código do cliente ou a Conta Monit24hs.",
        )

    raise HTTPException(status_code=404, detail="Cadastro de monitoramento não encontrado.")


def _validacao_primeiro_acesso_confere(db: Session, cliente: models.Cliente, verificacao: str) -> bool:
    informado = _somente_digitos(verificacao)
    if len(informado) < 8:
        return False

    custom = _auth_custom_fields_cliente(db, int(cliente.id))

    documentos = [
        cliente.cpf_cnpj,
        custom.get("cpf_cnpj"),
        custom.get("cnpj"),
        custom.get("cpf"),
    ]
    telefones = [
        cliente.telefone,
        cliente.whatsapp,
        custom.get("telefone_principal_whatssap"),
        custom.get("telefone_whatssap"),
        custom.get("telefone_contato_whatssap"),
    ]

    if len(informado) in {11, 14}:
        if any(_somente_digitos(item) == informado for item in documentos if _somente_digitos(item)):
            return True

    return any(_telefone_confere(verificacao, item) for item in telefones if item)


def _resumo_autenticacao(db: Session, cliente: models.Cliente) -> Dict[str, Any]:
    custom = _custom_fields_cliente(db, int(cliente.id))
    status_monitor = _validar_escopo_monitoramento(custom)
    if not _portal_elegivel(status_monitor):
        raise HTTPException(status_code=403, detail="Cliente sem acesso liberado à Área do Cliente SEG.")

    return {
        "ok": True,
        "cliente_id": int(cliente.id),
        "codigo": str(cliente.codigo),
        "conta_monit24hs": _texto(custom.get("conta_monit24hs")),
        "monitoramento_status": status_monitor,
        "elegivel": True,
    }


def _buscar_cliente_por_id(db: Session, cliente_id: int) -> models.Cliente:
    cliente = (
        db.query(models.Cliente)
        .filter(
            models.Cliente.id == cliente_id,
            models.Cliente.empresa_id == SEG_EMPRESA_ID,
        )
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente SEG não encontrado.")
    return cliente


def _buscar_cliente_por_codigo(db: Session, codigo: str) -> models.Cliente:
    codigo = str(codigo or "").strip()
    if not codigo:
        raise HTTPException(status_code=422, detail="Código do cliente é obrigatório.")

    cliente = (
        db.query(models.Cliente)
        .filter(
            models.Cliente.codigo == codigo,
            models.Cliente.empresa_id == SEG_EMPRESA_ID,
        )
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente SEG não encontrado.")
    return cliente


def _validar_escopo_monitoramento(custom: Dict[str, Optional[str]]) -> str:
    monitor_status = _texto(custom.get("monit24hs"))
    if not monitor_status:
        # Impede que a chave da SEG seja usada para consultar os demais cadastros
        # comerciais da empresa 2 que não pertencem ao monitoramento.
        raise HTTPException(
            status_code=404,
            detail="Cliente não pertence ao escopo Monit24hs da SEG.",
        )
    return monitor_status


def _portal_elegivel(monitor_status: str) -> bool:
    normalized = monitor_status.casefold()
    return normalized in {"ativo", "bloqueio financeiro"}


def _table_exists(db: Session, qualified_name: str) -> bool:
    try:
        return bool(db.execute(text("SELECT to_regclass(:table_name)"), {"table_name": qualified_name}).scalar())
    except Exception:
        return False


def _financeiro_cliente(db: Session, cliente_id: int) -> Dict[str, Any]:
    if not _table_exists(db, "public.financeiro_lancamentos"):
        return {
            "disponivel": False,
            "total_titulos": 0,
            "resumo": None,
            "titulos": [],
            "truncado": False,
        }

    has_forma_cobranca = _table_exists(db, "public.financeiro_formas_cobranca")
    has_emissao_itens = _table_exists(db, "public.financeiro_cobrancas_emissao_itens")
    has_cobranca_externa = _table_exists(db, "public.financeiro_cobrancas_externas")

    forma_select = (
        "fc.id AS forma_cobranca_id, fc.nome AS forma_cobranca_nome, fc.tipo AS forma_cobranca_tipo,"
        if has_forma_cobranca
        else "NULL::BIGINT AS forma_cobranca_id, NULL::VARCHAR AS forma_cobranca_nome, NULL::VARCHAR AS forma_cobranca_tipo,"
    )
    forma_join = (
        "LEFT JOIN public.financeiro_formas_cobranca fc "
        "ON fc.id=l.forma_cobranca_id AND fc.empresa_id=l.empresa_id"
        if has_forma_cobranca
        else ""
    )
    emissao_select = (
        "EXISTS (SELECT 1 FROM public.financeiro_cobrancas_emissao_itens ei "
        "WHERE ei.empresa_id=l.empresa_id AND ei.lancamento_id=l.id) AS emitido_em_lote_valora"
        if has_emissao_itens
        else "FALSE AS emitido_em_lote_valora"
    )
    cobranca_select = (
        ", ce.provider AS cobranca_provider, ce.provider_payment_id, ce.provider_status, "
        "ce.invoice_url, ce.bank_slip_url, ce.identification_field, ce.barcode, "
        "ce.pix_payload, ce.pix_expiration"
        if has_cobranca_externa else
        ", NULL::VARCHAR AS cobranca_provider, NULL::VARCHAR AS provider_payment_id, "
        "NULL::VARCHAR AS provider_status, NULL::TEXT AS invoice_url, NULL::TEXT AS bank_slip_url, "
        "NULL::TEXT AS identification_field, NULL::TEXT AS barcode, NULL::TEXT AS pix_payload, NULL::TIMESTAMPTZ AS pix_expiration"
    )
    cobranca_join = (
        "LEFT JOIN public.financeiro_cobrancas_externas ce ON ce.empresa_id=l.empresa_id AND ce.lancamento_id=l.id"
        if has_cobranca_externa else ""
    )

    status_sql = """
        CASE
            WHEN l.status = 'cancelado' THEN 'cancelado'
            WHEN l.valor_total > 0 AND l.valor_pago >= l.valor_total THEN 'recebido'
            WHEN l.valor_pago > 0 THEN 'parcial'
            WHEN l.data_vencimento < CURRENT_DATE THEN 'vencido'
            ELSE 'aberto'
        END
    """

    total_titulos = int(
        db.execute(
            text("""
                SELECT COUNT(*)
                FROM public.financeiro_lancamentos l
                WHERE l.empresa_id=:empresa_id
                  AND l.cliente_id=:cliente_id
                  AND l.tipo='receber'
            """),
            {"empresa_id": SEG_EMPRESA_ID, "cliente_id": cliente_id},
        ).scalar()
        or 0
    )

    resumo_row = db.execute(
        text(f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ({status_sql}) IN ('aberto', 'parcial')) AS em_aberto,
                COUNT(*) FILTER (WHERE ({status_sql}) = 'vencido') AS vencidos,
                COUNT(*) FILTER (WHERE ({status_sql}) = 'recebido') AS recebidos,
                COUNT(*) FILTER (WHERE ({status_sql}) = 'cancelado') AS cancelados,
                COALESCE(SUM(GREATEST(l.valor_total-l.valor_pago, 0))
                    FILTER (WHERE ({status_sql}) IN ('aberto', 'parcial', 'vencido')), 0) AS saldo_em_aberto,
                MIN(l.data_vencimento)
                    FILTER (WHERE ({status_sql}) IN ('aberto', 'parcial', 'vencido')) AS proximo_vencimento
            FROM public.financeiro_lancamentos l
            WHERE l.empresa_id=:empresa_id
              AND l.cliente_id=:cliente_id
              AND l.tipo='receber'
        """),
        {"empresa_id": SEG_EMPRESA_ID, "cliente_id": cliente_id},
    ).mappings().first()

    rows = db.execute(
        text(f"""
            SELECT
                l.id,
                l.descricao,
                l.documento,
                l.competencia,
                l.moeda,
                l.valor_total,
                l.valor_pago,
                GREATEST(l.valor_total-l.valor_pago, 0) AS saldo_aberto,
                l.data_emissao,
                l.data_vencimento,
                l.data_pagamento,
                ({status_sql}) AS status,
                {forma_select}
                {emissao_select}
                {cobranca_select}
            FROM public.financeiro_lancamentos l
            {forma_join}
            {cobranca_join}
            WHERE l.empresa_id=:empresa_id
              AND l.cliente_id=:cliente_id
              AND l.tipo='receber'
            ORDER BY
                CASE WHEN ({status_sql}) IN ('aberto', 'parcial', 'vencido') THEN 0 ELSE 1 END,
                l.data_vencimento DESC,
                l.id DESC
            LIMIT :limit
        """),
        {
            "empresa_id": SEG_EMPRESA_ID,
            "cliente_id": cliente_id,
            "limit": MAX_TITULOS_RETORNADOS,
        },
    ).mappings().all()

    titulos = []
    for row in rows:
        row = dict(row)
        forma_tipo = _texto(row.get("forma_cobranca_tipo"))
        eh_boleto = (forma_tipo or "").casefold() == "boleto"

        titulos.append(
            {
                "id": int(row["id"]),
                "descricao": _texto(row.get("descricao")),
                "documento": _texto(row.get("documento")),
                "competencia": _json_value(row.get("competencia")),
                "moeda": _texto(row.get("moeda")) or "BRL",
                "valor_total": _decimal_str(row.get("valor_total")),
                "valor_pago": _decimal_str(row.get("valor_pago")),
                "saldo_aberto": _decimal_str(row.get("saldo_aberto")),
                "data_emissao": _json_value(row.get("data_emissao")),
                "data_vencimento": _json_value(row.get("data_vencimento")),
                "data_pagamento": _json_value(row.get("data_pagamento")),
                "status": _texto(row.get("status")),
                "forma_cobranca": {
                    "id": int(row["forma_cobranca_id"]) if row.get("forma_cobranca_id") is not None else None,
                    "nome": _texto(row.get("forma_cobranca_nome")),
                    "tipo": forma_tipo,
                },
                "boleto": {
                    "e_forma_boleto": eh_boleto,
                    "emitido_em_lote_valora": bool(row.get("emitido_em_lote_valora")),
                    "emissor_configurado": bool(asaas_configured()),
                    "ambiente": asaas_environment_name() if asaas_configured() else None,
                    "emitido": bool(row.get("provider_payment_id")),
                    "provider": _texto(row.get("cobranca_provider")),
                    "provider_payment_id": _texto(row.get("provider_payment_id")),
                    "provider_status": _texto(row.get("provider_status")),
                    "linha_digitavel": _texto(row.get("identification_field")),
                    "codigo_barras": _texto(row.get("barcode")),
                    "pdf_url": _texto(row.get("bank_slip_url")) or _texto(row.get("invoice_url")),
                    "fatura_url": _texto(row.get("invoice_url")),
                    "pix_copia_cola": _texto(row.get("pix_payload")),
                    "pix_expiracao": _json_value(row.get("pix_expiration")),
                    "pode_emitir": bool(
                        eh_boleto
                        and asaas_configured()
                        and str(row.get("status") or "").casefold() in {"aberto", "parcial"}
                        and row.get("data_vencimento") is not None
                        and row.get("data_vencimento") >= date.today()
                    ),
                },
            }
        )

    resumo = dict(resumo_row or {})
    return {
        "disponivel": True,
        "total_titulos": total_titulos,
        "resumo": {
            "total": int(resumo.get("total") or 0),
            "em_aberto": int(resumo.get("em_aberto") or 0),
            "vencidos": int(resumo.get("vencidos") or 0),
            "recebidos": int(resumo.get("recebidos") or 0),
            "cancelados": int(resumo.get("cancelados") or 0),
            "saldo_em_aberto": _decimal_str(resumo.get("saldo_em_aberto")),
            "proximo_vencimento": _json_value(resumo.get("proximo_vencimento")),
        },
        "titulos": titulos,
        "truncado": total_titulos > len(titulos),
        "cobranca_online": {
            "provider": "asaas" if asaas_configured() else None,
            "configurado": bool(asaas_configured()),
            "ambiente": asaas_environment_name() if asaas_configured() else None,
        },
    }


def _documento_cliente_para_cobranca(db: Session, cliente: models.Cliente) -> str:
    custom = _auth_custom_fields_cliente(db, int(cliente.id))
    for value in (cliente.cpf_cnpj, custom.get("cpf_cnpj"), custom.get("cnpj"), custom.get("cpf")):
        digits = _somente_digitos(value)
        if len(digits) in {11, 14}:
            return digits
    raise HTTPException(status_code=422, detail="CPF/CNPJ do cliente precisa estar preenchido no Valora para emitir boleto.")


def _asaas_customer_payload(db: Session, cliente: models.Cliente) -> Dict[str, Any]:
    custom = _custom_fields_cliente(db, int(cliente.id))
    documento = _documento_cliente_para_cobranca(db, cliente)
    telefone = _primeiro(custom.get("telefone_principal_whatssap"), custom.get("telefone_whatssap"), cliente.whatsapp, cliente.telefone)
    email = _primeiro(cliente.email_cobranca, cliente.email, custom.get("e_mail_cobranca"))
    payload: Dict[str, Any] = {
        "name": _primeiro(custom.get("razao_social"), cliente.nome) or f"Cliente {cliente.codigo}",
        "cpfCnpj": documento,
        "email": email,
        "mobilePhone": _somente_digitos(telefone),
        "address": _primeiro(custom.get("logradouro"), cliente.endereco),
        "addressNumber": _primeiro(custom.get("nº"), cliente.numero),
        "complement": _primeiro(custom.get("complemento"), cliente.complemento),
        "province": _primeiro(custom.get("bairro"), cliente.bairro),
        "postalCode": _somente_digitos(_primeiro(custom.get("cep"), cliente.cep)),
        "notificationDisabled": True,
    }
    return {key: value for key, value in payload.items() if value not in {None, ""}}


def _lancamento_boleto(db: Session, cliente_id: int, lancamento_id: int) -> Dict[str, Any]:
    has_forma = _table_exists(db, "public.financeiro_formas_cobranca")
    join = "LEFT JOIN public.financeiro_formas_cobranca fc ON fc.id=l.forma_cobranca_id AND fc.empresa_id=l.empresa_id" if has_forma else ""
    tipo = "fc.tipo AS forma_tipo" if has_forma else "NULL::VARCHAR AS forma_tipo"
    row = db.execute(text(f"""
        SELECT l.id, l.cliente_id, l.descricao, l.valor_total, l.valor_pago, l.data_vencimento, l.status, {tipo}
        FROM public.financeiro_lancamentos l
        {join}
        WHERE l.id=:id AND l.empresa_id=:empresa_id AND l.cliente_id=:cliente_id AND l.tipo='receber'
        LIMIT 1
    """), {"id": lancamento_id, "empresa_id": SEG_EMPRESA_ID, "cliente_id": cliente_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Título financeiro não encontrado para este cliente.")
    data = dict(row)
    if str(data.get("forma_tipo") or "").casefold() != "boleto":
        raise HTTPException(status_code=422, detail="Este título não está configurado com forma de cobrança Boleto no Valora.")
    saldo = Decimal(str(data.get("valor_total") or 0)) - Decimal(str(data.get("valor_pago") or 0))
    if saldo <= 0:
        raise HTTPException(status_code=409, detail="Este título já está quitado.")
    if str(data.get("status") or "").casefold() == "cancelado":
        raise HTTPException(status_code=409, detail="Este título está cancelado.")
    data["saldo"] = saldo
    return data


def _salvar_cobranca_asaas(db: Session, *, cliente_id: int, lancamento_id: int, customer_id: str, payment: Dict[str, Any], linha: Dict[str, Any], pix: Dict[str, Any]) -> None:
    payment_id = str(payment.get("id") or "").strip()
    if not payment_id:
        raise HTTPException(status_code=502, detail="O Asaas não retornou o identificador da cobrança.")
    db.execute(text("""
        INSERT INTO financeiro_cobrancas_externas
            (empresa_id, lancamento_id, cliente_id, provider, provider_customer_id, provider_payment_id,
             billing_type, provider_status, invoice_url, bank_slip_url, identification_field, barcode,
             pix_payload, pix_expiration, provider_payload_json, ultima_sincronizacao_em, criado_em, atualizado_em)
        VALUES
            (:empresa_id, :lancamento_id, :cliente_id, 'asaas', :customer_id, :payment_id,
             :billing_type, :provider_status, :invoice_url, :bank_slip_url, :identification_field, :barcode,
             :pix_payload, :pix_expiration, :payload, NOW(), NOW(), NOW())
        ON CONFLICT (empresa_id, lancamento_id) DO UPDATE SET
             provider='asaas', provider_customer_id=EXCLUDED.provider_customer_id,
             provider_payment_id=EXCLUDED.provider_payment_id, billing_type=EXCLUDED.billing_type,
             provider_status=EXCLUDED.provider_status, invoice_url=EXCLUDED.invoice_url,
             bank_slip_url=EXCLUDED.bank_slip_url, identification_field=EXCLUDED.identification_field,
             barcode=EXCLUDED.barcode, pix_payload=EXCLUDED.pix_payload, pix_expiration=EXCLUDED.pix_expiration,
             provider_payload_json=EXCLUDED.provider_payload_json, ultima_sincronizacao_em=NOW(), atualizado_em=NOW()
    """), {
        "empresa_id": SEG_EMPRESA_ID, "lancamento_id": lancamento_id, "cliente_id": cliente_id,
        "customer_id": customer_id, "payment_id": payment_id, "billing_type": payment.get("billingType") or "BOLETO",
        "provider_status": payment.get("status"), "invoice_url": payment.get("invoiceUrl"),
        "bank_slip_url": payment.get("bankSlipUrl"), "identification_field": linha.get("identificationField"),
        "barcode": linha.get("barCode"), "pix_payload": pix.get("payload"), "pix_expiration": pix.get("expirationDate"),
        "payload": json.dumps(payment, ensure_ascii=False, default=str),
    })


def _emitir_ou_atualizar_boleto(db: Session, cliente_id: int, lancamento_id: int, *, criar: bool) -> Dict[str, Any]:
    try:
        emitir_ou_atualizar_cobranca(
            db,
            empresa_id=SEG_EMPRESA_ID,
            lancamento_id=lancamento_id,
            criar=criar,
            cliente_id=cliente_id,
            usuario_id=None,
            conciliar_se_recebido=True,
        )
        db.commit()
        # Mantém exatamente o contrato da API consumida pela Área do Cliente SEG.
        return _financeiro_cliente(db, cliente_id)
    except HTTPException:
        db.rollback()
        raise
    except AsaasError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

def _montar_cliente(db: Session, cliente: models.Cliente) -> Dict[str, Any]:
    custom = _custom_fields_cliente(db, int(cliente.id))
    monitor_status = _validar_escopo_monitoramento(custom)

    razao_social = _primeiro(custom.get("razao_social"), cliente.nome)
    nome_fantasia = _primeiro(custom.get("nome_fantasia"), cliente.nome_fantasia)
    tipo_cliente = _primeiro(custom.get("tipo_cliente"), cliente.tipo_pessoa)

    telefone_principal = _primeiro(
        custom.get("telefone_principal_whatssap"),
        custom.get("telefone_whatssap"),
        cliente.whatsapp,
        cliente.telefone,
    )
    telefone_contato = _primeiro(custom.get("telefone_contato_whatssap"), cliente.whatsapp, cliente.telefone)
    email_principal = _primeiro(cliente.email, cliente.email_cobranca, custom.get("e_mail_cobranca"))

    endereco = {
        "logradouro": _primeiro(custom.get("logradouro"), cliente.endereco),
        "numero": _primeiro(custom.get("nº"), cliente.numero),
        "complemento": _primeiro(custom.get("complemento"), cliente.complemento),
        "bairro": _primeiro(custom.get("bairro"), cliente.bairro),
        "cidade": _primeiro(custom.get("cidade"), cliente.cidade),
        "uf": _primeiro(custom.get("uf"), cliente.estado),
        "cep": _primeiro(custom.get("cep"), cliente.cep),
    }

    return {
        "fonte": "valora",
        "consulta_em": datetime.now(timezone.utc).isoformat(),
        "cliente": {
            "id": int(cliente.id),
            "codigo": str(cliente.codigo),
            "nome_razao_social": razao_social,
            "nome_fantasia": nome_fantasia,
            "tipo_cliente": tipo_cliente,
        },
        "portal": {
            "elegivel": _portal_elegivel(monitor_status),
            "motivo": (
                "monitoramento_ativo"
                if monitor_status.casefold() == "ativo"
                else "bloqueio_financeiro"
                if monitor_status.casefold() == "bloqueio financeiro"
                else "monitoramento_inativo"
                if monitor_status.casefold() == "inativo"
                else "status_nao_liberado"
            ),
        },
        "monitoramento": {
            "status": monitor_status,
            "conta_monit24hs": _texto(custom.get("conta_monit24hs")),
            "tipo_contrato": _texto(custom.get("tipo_de_contrato")),
            "tipo_imovel": _texto(custom.get("tipo_de_imovel")),
            "segmento": _primeiro(custom.get("segmento"), cliente.segmento),
        },
        "contatos": {
            "telefone_principal_whatsapp": telefone_principal,
            "pessoa_contato": _primeiro(custom.get("pessoa_contato"), cliente.contato),
            "telefone_contato_whatsapp": telefone_contato,
            "pessoa_responsavel": _texto(custom.get("pessoa_responsavel")),
            "email": email_principal,
        },
        "endereco": endereco,
        "financeiro": _financeiro_cliente(db, int(cliente.id)),
    }




@router.post("/autenticacao/localizar")
def localizar_cliente_para_login_seg(
    response: Response,
    payload: dict = Body(default={}),
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    cliente = _buscar_cliente_por_identificador(db, str(payload.get("identificador") or ""))
    return _resumo_autenticacao(db, cliente)


@router.post("/autenticacao/validar-primeiro-acesso")
def validar_primeiro_acesso_seg(
    response: Response,
    payload: dict = Body(default={}),
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    identificador = str(payload.get("identificador") or "").strip()
    verificacao = str(payload.get("verificacao") or "").strip()

    cliente = _buscar_cliente_por_identificador(db, identificador)

    identificador_digitos = _somente_digitos(identificador)
    verificacao_digitos = _somente_digitos(verificacao)
    if len(identificador_digitos) in {11, 14} and identificador_digitos == verificacao_digitos:
        raise HTTPException(
            status_code=401,
            detail="Use o telefone cadastrado como confirmação quando entrar com CPF/CNPJ.",
        )

    if not _validacao_primeiro_acesso_confere(db, cliente, verificacao):
        # Não informa se o erro foi CPF/CNPJ ou telefone para evitar vazamento.
        raise HTTPException(status_code=401, detail="Não foi possível validar os dados informados.")

    return _resumo_autenticacao(db, cliente)


@router.get("/health")
def seg_integration_health(
    response: Response,
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    return {
        "ok": True,
        "fonte": "valora",
        "empresa_id": SEG_EMPRESA_ID,
        "consulta_em": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/clientes/{cliente_id}")
def obter_cliente_seg_por_id(
    cliente_id: int,
    response: Response,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    cliente = _buscar_cliente_por_id(db, cliente_id)
    return _montar_cliente(db, cliente)


@router.get("/clientes/codigo/{codigo}")
def obter_cliente_seg_por_codigo(
    codigo: str,
    response: Response,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    cliente = _buscar_cliente_por_codigo(db, codigo)
    return _montar_cliente(db, cliente)


@router.post("/clientes/{cliente_id}/financeiro/{lancamento_id}/boleto/emitir")
def emitir_boleto_seg(
    cliente_id: int,
    lancamento_id: int,
    response: Response,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    return {"ok": True, "financeiro": _emitir_ou_atualizar_boleto(db, cliente_id, lancamento_id, criar=True)}


@router.post("/clientes/{cliente_id}/financeiro/{lancamento_id}/boleto/atualizar")
def atualizar_boleto_seg(
    cliente_id: int,
    lancamento_id: int,
    response: Response,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    _ensure_no_cache(response)
    return {"ok": True, "financeiro": _emitir_ou_atualizar_boleto(db, cliente_id, lancamento_id, criar=False)}


# ---------------------------------------------------------------------------
# Proposta pública hospedada no domínio da SEG.
# O token continua sendo emitido/validado pelo Valora; o navegador do cliente
# nunca recebe a chave privada da integração.
# ---------------------------------------------------------------------------
@router.get("/propostas/{token}")
def seg_obter_proposta_publica(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    return get_public_proposal(token, request, db)


@router.post("/propostas/{token}/aprovar")
def seg_aprovar_proposta_publica(
    token: str,
    payload: PublicApprovalIn,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    return approve_public_proposal(token, payload, request, db)


@router.post("/propostas/{token}/solicitar-alteracao")
def seg_solicitar_alteracao_proposta(
    token: str,
    payload: PublicChangeRequestIn,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    return request_public_change(token, payload, request, db)


@router.get("/propostas/{token}/cadastro-contrato")
def seg_obter_cadastro_contrato_proposta(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    return get_public_contract_registration(token, request, db)


@router.post("/propostas/{token}/cadastro-contrato")
def seg_concluir_cadastro_contrato_proposta(
    token: str,
    payload: PublicContractRegistrationIn,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_seg_api_key),
):
    return complete_public_contract_registration(token, payload, request, db)
