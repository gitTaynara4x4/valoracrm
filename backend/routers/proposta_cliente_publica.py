from __future__ import annotations

import json
import os
import secrets
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.audit import record_section_changes
from backend.services.proposta_cliente import build_public_url, decode_public_token

router = APIRouter(tags=["Proposta para Cliente - Pública"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = PROJECT_ROOT / "frontend"


class PublicApprovalIn(BaseModel):
    aceite: bool = False


class PublicChangeRequestIn(BaseModel):
    mensagem: str = Field(min_length=5, max_length=1200)


class PublicContractRepresentativeIn(BaseModel):
    nome: Optional[str] = Field(default=None, max_length=180)
    cpf: Optional[str] = Field(default=None, max_length=30)
    rg: Optional[str] = Field(default=None, max_length=30)
    cargo: Optional[str] = Field(default=None, max_length=120)
    nacionalidade: Optional[str] = Field(default=None, max_length=80)
    profissao: Optional[str] = Field(default=None, max_length=120)
    estado_civil: Optional[str] = Field(default=None, max_length=80)
    data_nascimento: Optional[str] = Field(default=None, max_length=10)
    telefone: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=255)


class PublicContractRegistrationIn(BaseModel):
    tipo_pessoa: str = Field(min_length=2, max_length=2)
    nome: str = Field(min_length=2, max_length=180)
    nome_fantasia: Optional[str] = Field(default=None, max_length=180)
    cpf_cnpj: str = Field(min_length=11, max_length=30)
    rg_ie: Optional[str] = Field(default=None, max_length=30)
    inscricao_municipal: Optional[str] = Field(default=None, max_length=30)
    nacionalidade: Optional[str] = Field(default=None, max_length=80)
    profissao: Optional[str] = Field(default=None, max_length=120)
    estado_civil: Optional[str] = Field(default=None, max_length=80)
    data_nascimento: Optional[str] = Field(default=None, max_length=10)
    telefone: str = Field(min_length=8, max_length=40)
    email: str = Field(min_length=5, max_length=255)
    cep: str = Field(min_length=8, max_length=20)
    endereco: str = Field(min_length=2, max_length=200)
    numero: str = Field(min_length=1, max_length=20)
    complemento: Optional[str] = Field(default=None, max_length=120)
    bairro: str = Field(min_length=2, max_length=120)
    cidade: str = Field(min_length=2, max_length=120)
    estado: str = Field(min_length=2, max_length=2)
    ponto_referencia: Optional[str] = Field(default=None, max_length=180)
    representante: Optional[PublicContractRepresentativeIn] = None
    confirmacao: bool = False


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _json_load(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def _client_ip(request: Request) -> Optional[str]:
    # Quando a ação chega pelo backend da SEG, preserva o IP real do cliente.
    # O header só é confiado se a requisição também trouxer a chave privada
    # correta da integração SEG -> Valora.
    seg_ip = str(request.headers.get("x-seg-client-ip") or "").strip()
    supplied_key = str(request.headers.get("x-seg-api-key") or "").strip()
    configured_key = str(os.getenv("SEG_INTEGRATION_API_KEY") or "").strip()
    if (
        seg_ip
        and len(configured_key) >= 32
        and supplied_key
        and secrets.compare_digest(supplied_key, configured_key)
    ):
        return seg_ip.split(",", 1)[0].strip()[:64] or None

    forwarded = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",", 1)[0].strip()[:64] or None
    if request.client and request.client.host:
        return str(request.client.host)[:64]
    return None


def _public_headers() -> Dict[str, str]:
    return {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
    }


def _load_public_budget(db: Session, token: str, *, lock: bool = False):
    decoded = decode_public_token(token)
    if not decoded:
        raise HTTPException(status_code=410, detail="Este link é inválido ou expirou.")

    suffix = " FOR UPDATE" if lock else ""
    row = db.execute(
        text(
            """
            SELECT id, empresa_id, cliente_id, codigo, titulo, status, atualizado_em,
                   proposta_cliente_link_versao, proposta_cliente_link_ativo,
                   proposta_cliente_link_expira_em, proposta_cliente_public_status,
                   proposta_cliente_snapshot_json, proposta_cliente_snapshot_orcamento_atualizado_em,
                   proposta_cliente_primeira_visualizacao_em, proposta_cliente_ultima_visualizacao_em,
                   proposta_cliente_visualizacoes, proposta_cliente_aprovado_em,
                   proposta_cliente_alteracao_solicitada_em, proposta_cliente_alteracao_mensagem,
                   proposta_cliente_cadastro_status, proposta_cliente_cadastro_iniciado_em,
                   proposta_cliente_cadastro_concluido_em, proposta_cliente_cadastro_tipo_pessoa
            FROM orcamentos
            WHERE id=:id AND empresa_id=:empresa_id
            """ + suffix
        ),
        {"id": decoded["budget_id"], "empresa_id": decoded["company_id"]},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Proposta não encontrada.")
    if int(row.get("proposta_cliente_link_versao") or 0) != decoded["version"]:
        raise HTTPException(status_code=410, detail="Este link foi substituído por uma versão mais recente.")
    if not bool(row.get("proposta_cliente_link_ativo")):
        raise HTTPException(status_code=410, detail="Este link não está mais ativo.")

    expires = _aware_utc(row.get("proposta_cliente_link_expira_em"))
    if expires and expires <= _now_utc():
        raise HTTPException(status_code=410, detail="Este link expirou. Solicite um novo link à equipe.")

    snapshot = _json_load(row.get("proposta_cliente_snapshot_json"), {})
    if not snapshot:
        raise HTTPException(status_code=409, detail="A proposta ainda não possui uma versão pública válida.")

    source_updated = _aware_utc(row.get("proposta_cliente_snapshot_orcamento_atualizado_em"))
    current_updated = _aware_utc(row.get("atualizado_em"))
    outdated = bool(source_updated and current_updated and current_updated > source_updated)

    return row, snapshot, outdated


def _insert_public_history(
    db: Session,
    *,
    budget_id: int,
    action: str,
    description: str,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
    data: Optional[dict] = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO orcamento_historico (
                orcamento_id, usuario_id, usuario_nome, acao,
                status_anterior, status_novo, descricao, dados_json
            ) VALUES (:orcamento_id, NULL, 'Cliente', :acao, :status_anterior, :status_novo, :descricao, :dados_json)
            """
        ),
        {
            "orcamento_id": budget_id,
            "acao": action,
            "status_anterior": old_status,
            "status_novo": new_status,
            "descricao": description,
            "dados_json": json.dumps(data or {}, ensure_ascii=False, default=str),
        },
    )


def _clean(value: Any) -> Optional[str]:
    value = " ".join(str(value or "").split()).strip()
    return value or None


def _digits(value: Any) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def _valid_cpf(value: Any) -> bool:
    digits = _digits(value)
    if len(digits) != 11 or len(set(digits)) == 1:
        return False
    for size in (9, 10):
        total = sum(int(digits[i]) * (size + 1 - i) for i in range(size))
        check = (total * 10) % 11
        if check == 10:
            check = 0
        if check != int(digits[size]):
            return False
    return True


def _valid_cnpj(value: Any) -> bool:
    digits = _digits(value)
    if len(digits) != 14 or len(set(digits)) == 1:
        return False
    weights = ((5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2), (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2))
    for index, weight in ((12, weights[0]), (13, weights[1])):
        total = sum(int(digits[i]) * weight[i] for i in range(index))
        remainder = total % 11
        check = 0 if remainder < 2 else 11 - remainder
        if check != int(digits[index]):
            return False
    return True


def _valid_email(value: Any) -> bool:
    email = str(value or "").strip()
    if len(email) > 255 or " " in email or email.count("@") != 1:
        return False
    local, domain = email.rsplit("@", 1)
    return bool(local and "." in domain and not domain.startswith(".") and not domain.endswith("."))


def _parse_iso_date(value: Any, field_label: str) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_label} inválida.") from exc
    if parsed > date.today():
        raise HTTPException(status_code=422, detail=f"{field_label} não pode estar no futuro.")
    return parsed.isoformat()


def _get_client_custom_fields(db: Session, *, company_id: int, client_id: int) -> Dict[str, str]:
    rows = db.execute(
        text(
            """
            SELECT cc.slug, ccv.valor
            FROM clientes_campos_valores ccv
            JOIN campos_clientes cc ON cc.id=ccv.campo_id
            WHERE ccv.cliente_id=:cliente_id AND cc.empresa_id=:empresa_id
            """
        ),
        {"cliente_id": client_id, "empresa_id": company_id},
    ).mappings().all()
    return {str(row["slug"]): str(row.get("valor") or "") for row in rows}


def _first_value(*values: Any) -> Optional[str]:
    for value in values:
        cleaned = _clean(value)
        if cleaned:
            return cleaned
    return None


_CONTRACT_CUSTOM_FIELDS: Dict[str, tuple[str, str]] = {
    "razao_social": ("Razão Social", "texto"),
    "nome": ("Nome", "texto"),
    "nome_fantasia": ("Nome Fantasia", "texto"),
    "cpf_cnpj": ("CPF / CNPJ", "texto"),
    "rg_inscricao_estadual": ("RG / Inscrição estadual", "texto"),
    "nacionalidade": ("Nacionalidade", "texto"),
    "profissao": ("Profissão", "texto"),
    "estado_civil": ("Estado Civil", "select"),
    "data_nascimento": ("Data Nascimento", "data"),
    "telefone_principal_whatssap": ("Telefone Principal (Whatsapp)", "telefone"),
    "logradouro": ("Logradouro", "texto"),
    "nº": ("Nº", "numero"),
    "complemento": ("Complemento", "texto"),
    "bairro": ("Bairro", "texto"),
    "cidade": ("Cidade", "texto"),
    "uf": ("UF", "texto"),
    "cep": ("CEP", "texto"),
    "ponto_referencia": ("Ponto de Referência", "texto"),
    "responsavel_contratante": ("Responsável Contratante", "texto"),
    "cpf_contratante": ("CPF (Contratante)", "texto"),
    "rg_contratante": ("RG (Contratante)", "texto"),
    "funcao_cargo": ("Função/Cargo", "texto"),
    "nacionalidade_contratante": ("Nacionalidade (Contratante)", "texto"),
    "profissao_contratante": ("Profissão (Contratante)", "texto"),
    "estado_civil_contratante": ("Estado Civil (Contratante)", "texto"),
    "data_nascimento_contratante": ("Data Nascimento (Contratante)", "data"),
    "telefone_contato_whatssap": ("Telefone Contato (Whatsapp)", "telefone"),
    "email_contratante": ("E-mail (Contratante)", "email"),
}


def _upsert_custom_value(db: Session, *, company_id: int, client_id: int, slug: str, value: Any) -> None:
    cleaned = _clean(value)
    if not cleaned:
        return
    label, field_type = _CONTRACT_CUSTOM_FIELDS[slug]
    db.execute(
        text(
            """
            INSERT INTO campos_clientes (empresa_id, nome, slug, tipo, obrigatorio, ativo, ordem)
            VALUES (:empresa_id, :nome, :slug, :tipo, FALSE, TRUE, 900)
            ON CONFLICT (empresa_id, slug) DO NOTHING
            """
        ),
        {"empresa_id": company_id, "nome": label, "slug": slug, "tipo": field_type},
    )
    field_id = db.execute(
        text("SELECT id FROM campos_clientes WHERE empresa_id=:empresa_id AND slug=:slug"),
        {"empresa_id": company_id, "slug": slug},
    ).scalar()
    if not field_id:
        raise HTTPException(status_code=500, detail="Não foi possível preparar os campos do cadastro para contrato.")
    db.execute(
        text(
            """
            INSERT INTO clientes_campos_valores (cliente_id, campo_id, valor)
            VALUES (:cliente_id, :campo_id, :valor)
            ON CONFLICT (cliente_id, campo_id)
            DO UPDATE SET valor=EXCLUDED.valor, atualizado_em=NOW()
            """
        ),
        {"cliente_id": client_id, "campo_id": int(field_id), "valor": cleaned},
    )


def _load_contract_registration(db: Session, row: Any) -> Dict[str, Any]:
    company_id = int(row["empresa_id"])
    client_id = int(row.get("cliente_id") or 0)
    if client_id <= 0:
        raise HTTPException(status_code=409, detail="Esta proposta não possui um cliente vinculado.")

    client = db.execute(
        text(
            """
            SELECT id, codigo, tipo_pessoa, nome, nome_fantasia, cpf_cnpj, rg_ie, inscricao_municipal,
                   data_nascimento, telefone, whatsapp, email, cep, endereco, numero, complemento,
                   bairro, cidade, estado
            FROM clientes
            WHERE id=:cliente_id AND empresa_id=:empresa_id
            """
        ),
        {"cliente_id": client_id, "empresa_id": company_id},
    ).mappings().first()
    if not client:
        raise HTTPException(status_code=404, detail="O cadastro do cliente vinculado à proposta não foi encontrado.")

    custom = _get_client_custom_fields(db, company_id=company_id, client_id=client_id)
    tipo = str(client.get("tipo_pessoa") or row.get("proposta_cliente_cadastro_tipo_pessoa") or "PF").upper()
    if tipo not in {"PF", "PJ"}:
        tipo = "PF"

    data_nascimento = client.get("data_nascimento")
    if data_nascimento:
        data_nascimento = data_nascimento.isoformat() if hasattr(data_nascimento, "isoformat") else str(data_nascimento)

    return {
        "cliente_id": client_id,
        "codigo": client.get("codigo"),
        "tipo_pessoa": tipo,
        "nome": client.get("nome"),
        "nome_fantasia": client.get("nome_fantasia"),
        "cpf_cnpj": client.get("cpf_cnpj"),
        "rg_ie": client.get("rg_ie"),
        "inscricao_municipal": client.get("inscricao_municipal"),
        "nacionalidade": custom.get("nacionalidade"),
        "profissao": custom.get("profissao"),
        "estado_civil": custom.get("estado_civil"),
        "data_nascimento": data_nascimento or custom.get("data_nascimento"),
        "telefone": _first_value(client.get("whatsapp"), client.get("telefone"), custom.get("telefone_principal_whatssap"), custom.get("telefone_whatssap")),
        "email": client.get("email"),
        "cep": _first_value(client.get("cep"), custom.get("cep")),
        "endereco": _first_value(client.get("endereco"), custom.get("logradouro")),
        "numero": _first_value(client.get("numero"), custom.get("nº")),
        "complemento": _first_value(client.get("complemento"), custom.get("complemento")),
        "bairro": _first_value(client.get("bairro"), custom.get("bairro")),
        "cidade": _first_value(client.get("cidade"), custom.get("cidade")),
        "estado": _first_value(client.get("estado"), custom.get("uf")),
        "ponto_referencia": custom.get("ponto_referencia"),
        "representante": {
            "nome": custom.get("responsavel_contratante"),
            "cpf": custom.get("cpf_contratante"),
            "rg": custom.get("rg_contratante"),
            "cargo": custom.get("funcao_cargo"),
            "nacionalidade": custom.get("nacionalidade_contratante"),
            "profissao": custom.get("profissao_contratante"),
            "estado_civil": custom.get("estado_civil_contratante"),
            "data_nascimento": custom.get("data_nascimento_contratante"),
            "telefone": custom.get("telefone_contato_whatssap"),
            "email": custom.get("email_contratante"),
        },
    }


def _validate_contract_payload(payload: PublicContractRegistrationIn, *, company_id: int, client_id: int, db: Session) -> Dict[str, Any]:
    tipo = str(payload.tipo_pessoa or "").upper().strip()
    if tipo not in {"PF", "PJ"}:
        raise HTTPException(status_code=422, detail="Selecione Pessoa Física ou Pessoa Jurídica.")
    if not payload.confirmacao:
        raise HTTPException(status_code=422, detail="Confirme que os dados informados estão corretos.")

    document = _digits(payload.cpf_cnpj)
    if tipo == "PF" and not _valid_cpf(document):
        raise HTTPException(status_code=422, detail="Informe um CPF válido.")
    if tipo == "PJ" and not _valid_cnpj(document):
        raise HTTPException(status_code=422, detail="Informe um CNPJ válido.")
    if not _valid_email(payload.email):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    if len(_digits(payload.telefone)) < 10:
        raise HTTPException(status_code=422, detail="Informe um telefone com DDD.")
    if len(_digits(payload.cep)) != 8:
        raise HTTPException(status_code=422, detail="Informe um CEP válido com 8 dígitos.")
    state = str(payload.estado or "").strip().upper()
    if len(state) != 2 or not state.isalpha():
        raise HTTPException(status_code=422, detail="Informe a UF com duas letras.")

    birth_date = _parse_iso_date(payload.data_nascimento, "Data de nascimento")
    representative = payload.representante
    rep_data: Dict[str, Optional[str]] = {}
    if tipo == "PJ":
        if not representative:
            raise HTTPException(status_code=422, detail="Informe o representante legal da empresa.")
        rep_name = _clean(representative.nome)
        rep_cpf = _digits(representative.cpf)
        rep_role = _clean(representative.cargo)
        if not rep_name:
            raise HTTPException(status_code=422, detail="Informe o nome do representante legal.")
        if not _valid_cpf(rep_cpf):
            raise HTTPException(status_code=422, detail="Informe um CPF válido para o representante legal.")
        if not rep_role:
            raise HTTPException(status_code=422, detail="Informe a função/cargo do representante legal.")
        if representative.email and not _valid_email(representative.email):
            raise HTTPException(status_code=422, detail="Informe um e-mail válido para o representante legal.")
        if representative.telefone and len(_digits(representative.telefone)) < 10:
            raise HTTPException(status_code=422, detail="Informe um telefone válido para o representante legal.")
        rep_data = {
            "nome": rep_name,
            "cpf": rep_cpf,
            "rg": _clean(representative.rg),
            "cargo": rep_role,
            "nacionalidade": _clean(representative.nacionalidade),
            "profissao": _clean(representative.profissao),
            "estado_civil": _clean(representative.estado_civil),
            "data_nascimento": _parse_iso_date(representative.data_nascimento, "Data de nascimento do representante"),
            "telefone": _clean(representative.telefone),
            "email": str(representative.email or "").strip().lower() or None,
        }

    duplicate = db.execute(
        text(
            """
            SELECT id, codigo
            FROM clientes
            WHERE empresa_id=:empresa_id AND id<>:cliente_id
              AND regexp_replace(COALESCE(cpf_cnpj, ''), '\\D', '', 'g')=:documento
            LIMIT 1
            """
        ),
        {"empresa_id": company_id, "cliente_id": client_id, "documento": document},
    ).mappings().first()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Este CPF/CNPJ já está vinculado a outro cliente do Valora (código {duplicate.get('codigo')}).")

    return {
        "tipo_pessoa": tipo,
        "nome": _clean(payload.nome),
        "nome_fantasia": _clean(payload.nome_fantasia),
        "cpf_cnpj": document,
        "rg_ie": _clean(payload.rg_ie),
        "inscricao_municipal": _clean(payload.inscricao_municipal),
        "nacionalidade": _clean(payload.nacionalidade),
        "profissao": _clean(payload.profissao),
        "estado_civil": _clean(payload.estado_civil),
        "data_nascimento": birth_date,
        "telefone": _clean(payload.telefone),
        "email": str(payload.email or "").strip().lower(),
        "cep": _digits(payload.cep),
        "endereco": _clean(payload.endereco),
        "numero": _clean(payload.numero),
        "complemento": _clean(payload.complemento),
        "bairro": _clean(payload.bairro),
        "cidade": _clean(payload.cidade),
        "estado": state,
        "ponto_referencia": _clean(payload.ponto_referencia),
        "representante": rep_data,
    }


@router.get("/proposta-cliente/{token}", include_in_schema=False)
def proposal_page(token: str):
    # Compatibilidade com links antigos: quem abrir o endereço antigo do
    # Valora é encaminhado para a experiência pública da SEG.
    return RedirectResponse(
        url=build_public_url(token),
        status_code=307,
        headers=_public_headers(),
    )


@router.get("/api/proposta-cliente-publica/{token}")
def get_public_proposal(token: str, request: Request, db: Session = Depends(get_db)):
    row, snapshot, outdated = _load_public_budget(db, token)

    now = _now_utc()
    first_view = row.get("proposta_cliente_primeira_visualizacao_em") is None
    db.execute(
        text(
            """
            UPDATE orcamentos SET
                proposta_cliente_primeira_visualizacao_em=COALESCE(proposta_cliente_primeira_visualizacao_em, :now),
                proposta_cliente_ultima_visualizacao_em=:now,
                proposta_cliente_visualizacoes=COALESCE(proposta_cliente_visualizacoes, 0) + 1,
                proposta_cliente_public_status=CASE
                    WHEN proposta_cliente_public_status='aguardando' THEN 'visualizado'
                    ELSE proposta_cliente_public_status
                END
            WHERE id=:id AND empresa_id=:empresa_id
            """
        ),
        {"now": now, "id": int(row["id"]), "empresa_id": int(row["empresa_id"])},
    )
    if first_view:
        _insert_public_history(
            db,
            budget_id=int(row["id"]),
            action="proposta_cliente_visualizada",
            description="O cliente abriu o link público da proposta pela primeira vez.",
            data={"ip": _client_ip(request)},
        )
    db.commit()

    public_status = str(row.get("proposta_cliente_public_status") or "aguardando")
    if public_status == "aguardando":
        public_status = "visualizado"

    response = {
        "ok": True,
        "status": public_status,
        "desatualizada": outdated,
        "pode_aprovar": not outdated and public_status in {"aguardando", "visualizado"},
        "pode_solicitar_alteracao": not outdated and public_status in {"aguardando", "visualizado"},
        "aprovado_em": row.get("proposta_cliente_aprovado_em").isoformat() if row.get("proposta_cliente_aprovado_em") else None,
        "alteracao_solicitada_em": row.get("proposta_cliente_alteracao_solicitada_em").isoformat() if row.get("proposta_cliente_alteracao_solicitada_em") else None,
        "alteracao_mensagem": row.get("proposta_cliente_alteracao_mensagem") if public_status == "alteracao_solicitada" else None,
        "cadastro_contrato": {
            "status": str(row.get("proposta_cliente_cadastro_status") or "nao_iniciado"),
            "iniciado_em": row.get("proposta_cliente_cadastro_iniciado_em").isoformat() if row.get("proposta_cliente_cadastro_iniciado_em") else None,
            "concluido_em": row.get("proposta_cliente_cadastro_concluido_em").isoformat() if row.get("proposta_cliente_cadastro_concluido_em") else None,
            "tipo_pessoa": row.get("proposta_cliente_cadastro_tipo_pessoa"),
        },
        "proposta": snapshot,
    }
    return JSONResponse(response, headers=_public_headers())


@router.post("/api/proposta-cliente-publica/{token}/aprovar")
def approve_public_proposal(
    token: str,
    payload: PublicApprovalIn,
    request: Request,
    db: Session = Depends(get_db),
):
    if not payload.aceite:
        raise HTTPException(status_code=422, detail="Confirme que leu e está de acordo com a proposta.")

    row, snapshot, outdated = _load_public_budget(db, token, lock=True)
    public_status = str(row.get("proposta_cliente_public_status") or "aguardando")

    if outdated:
        raise HTTPException(status_code=409, detail="A equipe atualizou esta proposta. Solicite um novo link antes de aprovar.")
    if public_status == "aprovado":
        return JSONResponse({"ok": True, "status": "aprovado", "mensagem": "Esta proposta já foi aprovada."}, headers=_public_headers())
    if public_status == "alteracao_solicitada":
        raise HTTPException(status_code=409, detail="Há uma solicitação de alteração registrada. Aguarde uma nova versão da proposta.")
    if public_status not in {"aguardando", "visualizado"}:
        raise HTTPException(status_code=409, detail="Esta proposta não está disponível para aprovação.")

    old_status = str(row.get("status") or "rascunho")
    now = _now_utc()
    ip = _client_ip(request)
    db.execute(
        text(
            """
            UPDATE orcamentos SET
                proposta_cliente_public_status='aprovado',
                proposta_cliente_aprovado_em=:now,
                proposta_cliente_aprovado_ip=:ip,
                status='aprovado',
                data_aprovacao=COALESCE(data_aprovacao, :now),
                proposta_cliente_cadastro_status=CASE
                    WHEN proposta_cliente_cadastro_status='concluido' THEN proposta_cliente_cadastro_status
                    ELSE 'pendente'
                END
            WHERE id=:id AND empresa_id=:empresa_id
            """
        ),
        {"now": now, "ip": ip, "id": int(row["id"]), "empresa_id": int(row["empresa_id"])},
    )
    _insert_public_history(
        db,
        budget_id=int(row["id"]),
        action="proposta_cliente_aprovada",
        description="Proposta aprovada pelo cliente através do link público.",
        old_status=old_status,
        new_status="aprovado",
        data={
            "ip": ip,
            "versao_link": int(row.get("proposta_cliente_link_versao") or 0),
            "total": snapshot.get("orcamento", {}).get("total"),
        },
    )
    db.commit()

    return JSONResponse(
        {"ok": True, "status": "aprovado", "aprovado_em": now.isoformat(), "mensagem": "Proposta aprovada com sucesso.", "proxima_etapa": "cadastro_contrato"},
        headers=_public_headers(),
    )


@router.get("/api/proposta-cliente-publica/{token}/cadastro-contrato")
def get_public_contract_registration(token: str, request: Request, db: Session = Depends(get_db)):
    row, _, _ = _load_public_budget(db, token, lock=True)
    public_status = str(row.get("proposta_cliente_public_status") or "aguardando")
    if public_status != "aprovado":
        raise HTTPException(status_code=409, detail="A proposta precisa ser aprovada antes do cadastro para contrato.")

    current_status = str(row.get("proposta_cliente_cadastro_status") or "nao_iniciado")
    now = _now_utc()
    if current_status in {"nao_iniciado", "pendente"}:
        db.execute(
            text(
                """
                UPDATE orcamentos SET
                    proposta_cliente_cadastro_status='em_preenchimento',
                    proposta_cliente_cadastro_iniciado_em=COALESCE(proposta_cliente_cadastro_iniciado_em, :now)
                WHERE id=:id AND empresa_id=:empresa_id
                """
            ),
            {"now": now, "id": int(row["id"]), "empresa_id": int(row["empresa_id"])},
        )
        _insert_public_history(
            db,
            budget_id=int(row["id"]),
            action="cadastro_contrato_iniciado",
            description="O cliente iniciou o preenchimento dos dados para o contrato.",
            data={"ip": _client_ip(request)},
        )
        db.commit()
        current_status = "em_preenchimento"

    registration = _load_contract_registration(db, row)
    return JSONResponse(
        {
            "ok": True,
            "status": current_status,
            "concluido_em": row.get("proposta_cliente_cadastro_concluido_em").isoformat() if row.get("proposta_cliente_cadastro_concluido_em") else None,
            "dados": registration,
        },
        headers=_public_headers(),
    )


@router.post("/api/proposta-cliente-publica/{token}/cadastro-contrato")
def complete_public_contract_registration(
    token: str,
    payload: PublicContractRegistrationIn,
    request: Request,
    db: Session = Depends(get_db),
):
    row, _, _ = _load_public_budget(db, token, lock=True)
    if str(row.get("proposta_cliente_public_status") or "") != "aprovado":
        raise HTTPException(status_code=409, detail="A proposta precisa estar aprovada para concluir o cadastro do contrato.")
    if str(row.get("proposta_cliente_cadastro_status") or "") == "concluido":
        return JSONResponse(
            {
                "ok": True,
                "status": "concluido",
                "concluido_em": row.get("proposta_cliente_cadastro_concluido_em").isoformat() if row.get("proposta_cliente_cadastro_concluido_em") else None,
                "mensagem": "O cadastro para contrato já foi concluído.",
            },
            headers=_public_headers(),
        )

    company_id = int(row["empresa_id"])
    client_id = int(row.get("cliente_id") or 0)
    if client_id <= 0:
        raise HTTPException(status_code=409, detail="Esta proposta não possui um cliente vinculado.")

    before_registration = _load_contract_registration(db, row)
    data = _validate_contract_payload(payload, company_id=company_id, client_id=client_id, db=db)
    now = _now_utc()
    ip = _client_ip(request)

    result = db.execute(
        text(
            """
            UPDATE clientes SET
                tipo_pessoa=:tipo_pessoa,
                nome=:nome,
                nome_fantasia=COALESCE(:nome_fantasia, nome_fantasia),
                cpf_cnpj=:cpf_cnpj,
                rg_ie=COALESCE(:rg_ie, rg_ie),
                inscricao_municipal=COALESCE(:inscricao_municipal, inscricao_municipal),
                data_nascimento=COALESCE(CAST(:data_nascimento AS DATE), data_nascimento),
                telefone=:telefone,
                whatsapp=:telefone,
                email=:email,
                cep=:cep,
                endereco=:endereco,
                numero=:numero,
                complemento=COALESCE(:complemento, complemento),
                bairro=:bairro,
                cidade=:cidade,
                estado=:estado,
                atualizado_em=NOW()
            WHERE id=:cliente_id AND empresa_id=:empresa_id
            RETURNING id
            """
        ),
        {
            "tipo_pessoa": data["tipo_pessoa"],
            "nome": data["nome"],
            "nome_fantasia": data["nome_fantasia"],
            "cpf_cnpj": data["cpf_cnpj"],
            "rg_ie": data["rg_ie"],
            "inscricao_municipal": data["inscricao_municipal"],
            "data_nascimento": data["data_nascimento"],
            "telefone": data["telefone"],
            "email": data["email"],
            "cep": data["cep"],
            "endereco": data["endereco"],
            "numero": data["numero"],
            "complemento": data["complemento"],
            "bairro": data["bairro"],
            "cidade": data["cidade"],
            "estado": data["estado"],
            "cliente_id": client_id,
            "empresa_id": company_id,
        },
    ).scalar()
    if not result:
        raise HTTPException(status_code=404, detail="Cliente vinculado à proposta não encontrado.")

    custom_values = {
        "razao_social": data["nome"] if data["tipo_pessoa"] == "PJ" else None,
        "nome": data["nome"] if data["tipo_pessoa"] == "PF" else None,
        "nome_fantasia": data["nome_fantasia"],
        "cpf_cnpj": data["cpf_cnpj"],
        "rg_inscricao_estadual": data["rg_ie"],
        "nacionalidade": data["nacionalidade"] if data["tipo_pessoa"] == "PF" else None,
        "profissao": data["profissao"] if data["tipo_pessoa"] == "PF" else None,
        "estado_civil": data["estado_civil"] if data["tipo_pessoa"] == "PF" else None,
        "data_nascimento": data["data_nascimento"] if data["tipo_pessoa"] == "PF" else None,
        "telefone_principal_whatssap": data["telefone"],
        "logradouro": data["endereco"],
        "nº": data["numero"],
        "complemento": data["complemento"],
        "bairro": data["bairro"],
        "cidade": data["cidade"],
        "uf": data["estado"],
        "cep": data["cep"],
        "ponto_referencia": data["ponto_referencia"],
    }
    representative = data.get("representante") or {}
    if data["tipo_pessoa"] == "PJ":
        custom_values.update({
            "responsavel_contratante": representative.get("nome"),
            "cpf_contratante": representative.get("cpf"),
            "rg_contratante": representative.get("rg"),
            "funcao_cargo": representative.get("cargo"),
            "nacionalidade_contratante": representative.get("nacionalidade"),
            "profissao_contratante": representative.get("profissao"),
            "estado_civil_contratante": representative.get("estado_civil"),
            "data_nascimento_contratante": representative.get("data_nascimento"),
            "telefone_contato_whatssap": representative.get("telefone"),
            "email_contratante": representative.get("email"),
        })

    for slug, value in custom_values.items():
        if slug in _CONTRACT_CUSTOM_FIELDS:
            _upsert_custom_value(db, company_id=company_id, client_id=client_id, slug=slug, value=value)

    after_registration = _load_contract_registration(db, row)
    record_section_changes(
        db,
        empresa_id=company_id,
        modulo="clientes",
        entidade_tipo="cliente",
        entidade_id=client_id,
        before_sections={
            "dados_principais": {key: before_registration.get(key) for key in ("tipo_pessoa", "nome", "nome_fantasia", "cpf_cnpj", "rg_ie", "inscricao_municipal", "nacionalidade", "profissao", "estado_civil", "data_nascimento")},
            "contatos": {key: before_registration.get(key) for key in ("telefone", "email")},
            "endereco": {key: before_registration.get(key) for key in ("cep", "endereco", "numero", "complemento", "bairro", "cidade", "estado", "ponto_referencia")},
            "representante_legal": before_registration.get("representante") or {},
        },
        after_sections={
            "dados_principais": {key: after_registration.get(key) for key in ("tipo_pessoa", "nome", "nome_fantasia", "cpf_cnpj", "rg_ie", "inscricao_municipal", "nacionalidade", "profissao", "estado_civil", "data_nascimento")},
            "contatos": {key: after_registration.get(key) for key in ("telefone", "email")},
            "endereco": {key: after_registration.get(key) for key in ("cep", "endereco", "numero", "complemento", "bairro", "cidade", "estado", "ponto_referencia")},
            "representante_legal": after_registration.get("representante") or {},
        },
        user=SimpleNamespace(id=None, nome="Cliente"),
        labels={
            "dados_principais": "Dados principais",
            "contatos": "Contatos",
            "endereco": "Endereço",
            "representante_legal": "Representante legal",
        },
        origem="proposta_cliente_publica",
    )

    db.execute(
        text(
            """
            UPDATE orcamentos SET
                proposta_cliente_cadastro_status='concluido',
                proposta_cliente_cadastro_iniciado_em=COALESCE(proposta_cliente_cadastro_iniciado_em, :now),
                proposta_cliente_cadastro_concluido_em=:now,
                proposta_cliente_cadastro_ip=:ip,
                proposta_cliente_cadastro_tipo_pessoa=:tipo_pessoa
            WHERE id=:id AND empresa_id=:empresa_id
            """
        ),
        {"now": now, "ip": ip, "tipo_pessoa": data["tipo_pessoa"], "id": int(row["id"]), "empresa_id": company_id},
    )
    _insert_public_history(
        db,
        budget_id=int(row["id"]),
        action="cadastro_contrato_concluido",
        description="Cliente concluiu os dados necessários para elaboração do contrato.",
        data={
            "ip": ip,
            "cliente_id": client_id,
            "tipo_pessoa": data["tipo_pessoa"],
            "campos_atualizados": sorted([key for key, value in custom_values.items() if _clean(value)]),
        },
    )
    db.commit()

    return JSONResponse(
        {
            "ok": True,
            "status": "concluido",
            "concluido_em": now.isoformat(),
            "mensagem": "Cadastro concluído. Os dados já foram atualizados no Valora.",
        },
        headers=_public_headers(),
    )


@router.post("/api/proposta-cliente-publica/{token}/solicitar-alteracao")
def request_public_change(
    token: str,
    payload: PublicChangeRequestIn,
    request: Request,
    db: Session = Depends(get_db),
):
    row, _, outdated = _load_public_budget(db, token, lock=True)
    public_status = str(row.get("proposta_cliente_public_status") or "aguardando")
    message = " ".join(str(payload.mensagem or "").split()).strip()

    if outdated:
        raise HTTPException(status_code=409, detail="A equipe já atualizou esta proposta. Solicite o novo link.")
    if public_status == "aprovado":
        raise HTTPException(status_code=409, detail="Esta proposta já foi aprovada.")
    if public_status == "alteracao_solicitada":
        raise HTTPException(status_code=409, detail="Já existe uma solicitação de alteração registrada para esta proposta.")
    if public_status not in {"aguardando", "visualizado"}:
        raise HTTPException(status_code=409, detail="Esta proposta não está disponível para solicitar alteração.")

    old_status = str(row.get("status") or "rascunho")
    new_status = "em_negociacao" if old_status not in {"recusado", "cancelado", "expirado"} else old_status
    now = _now_utc()
    ip = _client_ip(request)

    db.execute(
        text(
            """
            UPDATE orcamentos SET
                proposta_cliente_public_status='alteracao_solicitada',
                proposta_cliente_alteracao_solicitada_em=:now,
                proposta_cliente_alteracao_mensagem=:mensagem,
                proposta_cliente_alteracao_ip=:ip,
                status=:status
            WHERE id=:id AND empresa_id=:empresa_id
            """
        ),
        {
            "now": now,
            "mensagem": message,
            "ip": ip,
            "status": new_status,
            "id": int(row["id"]),
            "empresa_id": int(row["empresa_id"]),
        },
    )
    _insert_public_history(
        db,
        budget_id=int(row["id"]),
        action="proposta_cliente_alteracao_solicitada",
        description="O cliente solicitou uma alteração na proposta.",
        old_status=old_status,
        new_status=new_status,
        data={"ip": ip, "mensagem": message, "versao_link": int(row.get("proposta_cliente_link_versao") or 0)},
    )
    db.commit()

    return JSONResponse(
        {"ok": True, "status": "alteracao_solicitada", "mensagem": "Solicitação enviada para a equipe."},
        headers=_public_headers(),
    )
