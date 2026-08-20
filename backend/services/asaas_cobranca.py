from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError


@dataclass
class AsaasError(Exception):
    status_code: int
    detail: str
    upstream_status: Optional[int] = None

    def __str__(self) -> str:
        return self.detail


def _env(name: str) -> str:
    return str(os.getenv(name) or "").strip()


def configured() -> bool:
    return len(_env("ASAAS_API_KEY")) >= 20


def api_base() -> str:
    explicit = _env("ASAAS_API_BASE")
    if explicit:
        return explicit.rstrip("/")
    # Falha segura: sem configuração explícita de produção, usa Sandbox.
    return "https://api-sandbox.asaas.com/v3"


def environment_name() -> str:
    base = api_base().casefold()
    return "sandbox" if "sandbox" in base else "producao"


def webhook_token() -> str:
    return _env("ASAAS_WEBHOOK_TOKEN")


def _json_default(value: Any):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Tipo não serializável: {type(value)!r}")


def _decode(raw: bytes) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception as exc:
        raise AsaasError(502, "O Asaas respondeu em formato inválido.") from exc
    if not isinstance(data, dict):
        raise AsaasError(502, "O Asaas respondeu em formato inesperado.")
    return data


def _error_detail(data: Dict[str, Any]) -> str:
    errors = data.get("errors")
    if isinstance(errors, list):
        messages = []
        for item in errors:
            if isinstance(item, dict):
                msg = str(item.get("description") or item.get("message") or "").strip()
                if msg:
                    messages.append(msg)
        if messages:
            return " ".join(messages[:3])
    return str(data.get("message") or data.get("detail") or "").strip()


def request_json(method: str, path: str, payload: Optional[Dict[str, Any]] = None, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    key = _env("ASAAS_API_KEY")
    if len(key) < 20:
        raise AsaasError(503, "Emissão de boleto ainda não configurada no Valora.")

    url = api_base() + "/" + str(path or "").lstrip("/")
    if query:
        clean = {k: v for k, v in query.items() if v is not None and str(v).strip() != ""}
        if clean:
            url += "?" + urllib_parse.urlencode(clean)

    headers = {
        "Accept": "application/json",
        "access_token": key,
        "User-Agent": "ValoraCRM-SEG-Cobranca/1.0",
    }
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")

    req = urllib_request.Request(url=url, data=body, headers=headers, method=method.upper())
    timeout = max(3, min(int(_env("ASAAS_TIMEOUT_SECONDS") or "15"), 30))

    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            return _decode(response.read())
    except HTTPError as exc:
        raw = exc.read()
        try:
            data = _decode(raw)
            detail = _error_detail(data)
        except Exception:
            detail = ""
        if exc.code == 401:
            message = "A chave da API Asaas foi recusada."
        elif exc.code == 404:
            message = detail or "Cobrança não encontrada no Asaas."
        elif exc.code in {400, 422}:
            message = detail or "O Asaas recusou os dados da cobrança."
        else:
            message = detail or "O Asaas não conseguiu concluir a operação."
        raise AsaasError(exc.code if exc.code in {400, 401, 404, 422} else 502, message, exc.code) from exc
    except URLError as exc:
        reason = str(getattr(exc, "reason", "") or "").lower()
        raise AsaasError(504 if "timed out" in reason else 502, "Não foi possível conectar ao Asaas neste momento.") from exc
    except TimeoutError as exc:
        raise AsaasError(504, "O Asaas demorou além do limite para responder.") from exc


def buscar_cliente_por_documento(cpf_cnpj: str) -> list[Dict[str, Any]]:
    data = request_json("GET", "/customers", query={"cpfCnpj": cpf_cnpj, "limit": 100, "offset": 0})
    rows = data.get("data")
    return [item for item in rows if isinstance(item, dict)] if isinstance(rows, list) else []


def obter_ou_criar_cliente(payload: Dict[str, Any], *, cliente_id: int) -> Dict[str, Any]:
    cpf_cnpj = str(payload.get("cpfCnpj") or "").strip()
    if not cpf_cnpj:
        raise AsaasError(422, "CPF/CNPJ é obrigatório para emitir boleto.")

    expected_reference = f"VALORA-CLIENTE-{int(cliente_id)}"
    existing = buscar_cliente_por_documento(cpf_cnpj)
    if existing:
        exact = next((item for item in existing if str(item.get("externalReference") or "") == expected_reference), None)
        return exact or existing[0]

    body = dict(payload)
    body["externalReference"] = expected_reference
    body.setdefault("notificationDisabled", True)
    return request_json("POST", "/customers", payload=body)


def criar_boleto(*, asaas_customer_id: str, lancamento_id: int, valor: Decimal, vencimento: date, descricao: str) -> Dict[str, Any]:
    if valor <= 0:
        raise AsaasError(422, "O título não possui saldo para emissão.")
    return request_json(
        "POST",
        "/payments",
        payload={
            "customer": asaas_customer_id,
            "billingType": "BOLETO",
            "value": float(valor.quantize(Decimal("0.01"))),
            "dueDate": vencimento.isoformat(),
            "description": str(descricao or f"Título {lancamento_id}")[:500],
            "externalReference": f"VALORA-LANCAMENTO-{int(lancamento_id)}",
        },
    )



def buscar_pagamento_por_referencia(external_reference: str) -> Optional[Dict[str, Any]]:
    data = request_json("GET", "/payments", query={"externalReference": external_reference, "limit": 100, "offset": 0})
    rows = data.get("data")
    if not isinstance(rows, list):
        return None
    for item in rows:
        if isinstance(item, dict) and str(item.get("externalReference") or "") == external_reference:
            return item
    return None


def obter_pagamento(payment_id: str) -> Dict[str, Any]:
    return request_json("GET", f"/payments/{urllib_parse.quote(str(payment_id), safe='')}")


def obter_linha_digitavel(payment_id: str) -> Dict[str, Any]:
    return request_json("GET", f"/payments/{urllib_parse.quote(str(payment_id), safe='')}/identificationField")


def obter_pix(payment_id: str) -> Dict[str, Any]:
    return request_json("GET", f"/payments/{urllib_parse.quote(str(payment_id), safe='')}/pixQrCode")


def status_portal(status_asaas: Any) -> str:
    status = str(status_asaas or "").upper().strip()
    if status in {"RECEIVED", "RECEIVED_IN_CASH"}:
        return "recebido"
    if status in {"OVERDUE"}:
        return "vencido"
    if status in {"REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS"}:
        return "estornado"
    if status in {"DELETED"}:
        return "cancelado"
    return "aberto"
