from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from backend import models
from backend.services.proposta_cliente import build_public_url, create_public_token, link_days
from backend.services.contrato_cliente import (
    build_contract_snapshot,
    contract_details,
    contract_filename,
    load_contract_source,
    render_contract_pdf,
)
from backend.security.permissions import (
    get_current_user,
    get_db,
    is_admin,
    is_owner,
    require_permission,
    user_has_permission,
)

router = APIRouter(prefix="/api/orcamentos", tags=["Orçamentos"])

STATUS_VALIDOS = {
    "rascunho",
    "enviado",
    "em_negociacao",
    "aprovado",
    "recusado",
    "cancelado",
    "expirado",
}

TIPOS_DESCONTO = {"valor", "percentual"}
STATUS_PRECOS_BLOQUEADOS = {"aprovado", "recusado", "cancelado", "expirado"}

PROPOSTA_CLIENTE_NATUREZAS = {"venda", "locacao", "comodato", "prestacao_servicos"}
PROPOSTA_CLIENTE_SERVICOS = {"alarme", "cerca_eletrica", "cftv", "controle_acesso", "manutencao"}
PROPOSTA_CLIENTE_PLANOS = {"monitoramento_alarme", "cerca_eletrica", "acompanhamento", "assistencia_tecnica"}
PROPOSTA_CLIENTE_TIPOS_CONTRATO = {"mensal", "trimestral"}
PROPOSTA_CLIENTE_FORMAS_PAGAMENTO = {"dinheiro", "pix", "cheque", "cartao", "boleto", "outro"}
PROPOSTA_CLIENTE_NATUREZA_LABELS = {
    "venda": "Venda",
    "locacao": "Locação",
    "comodato": "Comodato",
    "prestacao_servicos": "Prestação de serviços",
}
PROPOSTA_CLIENTE_SERVICO_LABELS = {
    "alarme": "Alarme",
    "cerca_eletrica": "Cerca elétrica",
    "cftv": "CFTV",
    "controle_acesso": "Controle de acesso",
    "manutencao": "Manutenção",
}
PROPOSTA_CLIENTE_PLANO_LABELS = {
    "monitoramento_alarme": "Monitoramento de alarme",
    "cerca_eletrica": "Cerca elétrica",
    "acompanhamento": "Acompanhamento",
    "assistencia_tecnica": "Assistência técnica",
}
PROPOSTA_CLIENTE_TIPO_CONTRATO_LABELS = {"mensal": "Mensal", "trimestral": "Trimestral"}
PROPOSTA_CLIENTE_FORMA_PAGAMENTO_LABELS = {
    "dinheiro": "Dinheiro",
    "pix": "PIX",
    "cheque": "Cheque",
    "cartao": "Cartão",
    "boleto": "Boleto",
    "outro": "Outro",
}
_SCHEMA_READY = False
_PREPARED_COMPANIES: set[int] = set()

PRODUCT_COST_ALIASES = (
    "custo",
    "valor_custo",
    "valor_de_custo",
    "custo_efetivo",
    "preco_custo",
    "preco_de_custo",
    "valor_compra",
    "valor_de_compra",
    "preco_compra",
    "preco_de_compra",
    "custo_compra",
    "custo_de_compra",
)
PRODUCT_COST_ALIAS_SET = set(PRODUCT_COST_ALIASES)


def norm_str(value: Any) -> Optional[str]:
    value = str(value or "").strip()
    return value or None


def normalize_product_cost_slug(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower().strip()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    return re.sub(r"_+", "_", raw).strip("_")


def product_cost_field_priority(slug: Any, name: Any = None) -> Optional[int]:
    identifiers = [normalize_product_cost_slug(slug), normalize_product_cost_slug(name)]
    for offset, identifier in enumerate(identifiers):
        if not identifier:
            continue
        if identifier in PRODUCT_COST_ALIAS_SET:
            return PRODUCT_COST_ALIASES.index(identifier) + offset * 20

        without_suffix = re.sub(r"_\d+$", "", identifier)
        if without_suffix in PRODUCT_COST_ALIAS_SET:
            return PRODUCT_COST_ALIASES.index(without_suffix) + 40 + offset * 20

        tokens = set(identifier.split("_"))
        if "custo" in tokens:
            return 100 + offset
        if "compra" in tokens and ({"valor", "preco"} & tokens):
            return 110 + offset
    return None


def apply_product_cost_fallbacks(
    db: Session,
    company_id: int,
    rows: List[Any],
    *,
    product_id_key: str = "id",
) -> List[dict]:
    """Aplica o custo efetivo cadastrado na Formação de Preços.

    O campo personalizado de compra/custo é autoritativo inclusive quando
    produtos.custo contém zero antigo. Esse zero era o motivo de itens com
    Valor Compra preenchido aparecerem como R$ 0,00 na análise financeira.
    """
    output = [dict(row) for row in rows]
    product_ids = sorted({
        int(row.get(product_id_key) or 0)
        for row in output
        if int(row.get(product_id_key) or 0) > 0
    })
    if not product_ids:
        return output

    custom_rows = (
        db.query(
            models.ProdutoCampoValor.produto_id,
            models.CampoProduto.id,
            models.CampoProduto.slug,
            models.CampoProduto.nome,
            models.ProdutoCampoValor.valor,
        )
        .join(models.CampoProduto, models.CampoProduto.id == models.ProdutoCampoValor.campo_id)
        .filter(models.CampoProduto.empresa_id == company_id)
        .filter(models.ProdutoCampoValor.produto_id.in_(product_ids))
        .all()
    )

    best: Dict[int, tuple[int, int, str]] = {}
    for product_id, field_id, slug, name, raw_value in custom_rows:
        priority = product_cost_field_priority(slug, name)
        value = norm_str(raw_value)
        if priority is None or value is None:
            continue
        candidate = (priority, int(field_id), value)
        current = best.get(int(product_id))
        if current is None or candidate[:2] < current[:2]:
            best[int(product_id)] = candidate

    for row in output:
        selected = best.get(int(row.get(product_id_key) or 0))
        if selected:
            row["custo"] = selected[2]
    return output


def natural_sort_key(value: Any) -> tuple:
    """Ordena textos como o seletor do navegador: sem diferenciar acentos/caixa e com números naturais."""
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    ).casefold().strip()

    key = []
    for part in re.split(r"(\d+)", normalized):
        if not part:
            continue
        if part.isdigit():
            # 800 deve vir antes de 1800; o comprimento desempata zeros à esquerda.
            key.append((1, int(part), len(part), part))
        else:
            # Mantém pontuação relevante: "(" antes de letras e "P/" antes de "PAR".
            key.append((0, part))
    return tuple(key)


def money(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value in (None, "", "null"):
        return default
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    raw = re.sub(r"[^0-9,.-]", "", str(value).strip())
    if not raw:
        return default
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        return default


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q4(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def dec_out(value: Any) -> str:
    return f"{q2(money(value)):.2f}"


def dec4_out(value: Any) -> str:
    text_value = f"{q4(money(value)):.4f}"
    return text_value.rstrip("0").rstrip(".") or "0"


def parse_date(value: Any, default: Optional[date] = None) -> Optional[date]:
    if value in (None, "", "null"):
        return default
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return default


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def json_dump(value: Any) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False, default=str)


def json_load(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        parsed = json.loads(value)
        return parsed
    except Exception:
        return default


def status_norm(value: Any) -> str:
    aliases = {
        "enviada": "enviado",
        "aprovada": "aprovado",
        "rejeitada": "recusado",
        "rejeitado": "recusado",
        "negociacao": "em_negociacao",
    }
    current = aliases.get(str(value or "").strip().lower(), str(value or "").strip().lower())
    return current if current in STATUS_VALIDOS else "rascunho"


NILSON_PROPOSAL_EMAIL = "nlsgv2010@gmail.com"
NILSON_PROPOSAL_MODELS = {
    "monitoramento_24h",
    "monitoramento_24h_comodato",
    "teleassistencia_idosos",
}


def can_use_nilson_proposal_models(user: models.Usuario) -> bool:
    return str(getattr(user, "email", "") or "").strip().lower() == NILSON_PROPOSAL_EMAIL


def validate_nilson_proposal_model_access(user: models.Usuario, model_key: Any) -> None:
    """Valida no backend a exclusividade dos modelos comerciais do Nilson."""
    key = norm_str(model_key) or "padrao"
    if key in NILSON_PROPOSAL_MODELS and not can_use_nilson_proposal_models(user):
        raise HTTPException(
            status_code=403,
            detail="Este modelo de proposta comercial é exclusivo do usuário autorizado.",
        )


def can_manage_settings(user: models.Usuario) -> bool:
    return is_owner(user) or is_admin(user)


def can_view_costs(user: models.Usuario, db: Optional[Session] = None) -> bool:
    """Autoriza custos para gestores e usuários com edição de Orçamentos.

    A permissão de edição é usada porque o modelo atual de permissões possui
    apenas ver/criar/editar/excluir. Isso evita obrigar um responsável
    comercial a ser administrador apenas para visualizar a análise financeira.
    """
    if is_owner(user) or is_admin(user):
        return True
    return bool(db is not None and user_has_permission(db, user, "orcamentos", "editar"))


def assert_settings_access(user: models.Usuario) -> None:
    if not can_manage_settings(user):
        raise HTTPException(status_code=403, detail="Apenas owner ou administrador pode alterar as configurações de orçamentos.")


def ensure_schema(db: Session) -> None:
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


def ensure_default_config(db: Session, empresa_id: int, *, commit: bool = True) -> None:
    db.execute(text("""
        INSERT INTO orcamento_configuracoes (
            empresa_id, condicoes_padrao, formas_pagamento_json, titulo_capa, subtitulo_capa
        ) VALUES (
            :empresa_id,
            '1. Este orçamento contempla somente os produtos e serviços descritos.\n2. Materiais ou serviços adicionais serão orçados separadamente.\n3. Garantias seguem as condições informadas neste documento.',
            :formas,
            'Proposta comercial',
            'Soluções preparadas para a necessidade do cliente'
        ) ON CONFLICT (empresa_id) DO NOTHING
    """), {
        "empresa_id": empresa_id,
        "formas": json_dump([
            {"tipo": "avista", "nome": "À vista", "ativo": True},
            {"tipo": "entrada_parcelas", "nome": "Entrada + parcelas", "ativo": True},
            {"tipo": "cartao", "nome": "Cartão de crédito", "ativo": True},
            {"tipo": "pix", "nome": "PIX", "ativo": True},
            {"tipo": "boleto", "nome": "Boleto", "ativo": True},
        ]),
    })

    # Cria um perfil emitente padrão usando o cadastro atual da empresa.
    # O perfil é independente do cadastro principal: editar um modelo de
    # documento nunca mais altera razão social, CNPJ ou endereço da empresa.
    db.execute(text("""
        INSERT INTO orcamento_emitentes (
            empresa_id, nome, razao_social, nome_fantasia, cnpj, email, site, telefone,
            cep, endereco, numero, complemento, cidade, estado, logo_url, rodape, padrao, ativo
        )
        SELECT
            e.id,
            COALESCE(NULLIF(cfg.cabecalho_nome_fantasia, ''), NULLIF(cfg.cabecalho_razao_social, ''), NULLIF(e.nome, ''), 'Empresa principal'),
            COALESCE(NULLIF(cfg.cabecalho_razao_social, ''), NULLIF(e.nome, ''), 'Empresa principal'),
            COALESCE(NULLIF(cfg.cabecalho_nome_fantasia, ''), e.nome),
            COALESCE(NULLIF(cfg.cabecalho_cnpj, ''), e.cnpj),
            COALESCE(NULLIF(cfg.cabecalho_email, ''), e.email),
            NULLIF(cfg.cabecalho_site, ''),
            COALESCE(NULLIF(cfg.cabecalho_telefone, ''), e.telefone),
            CASE WHEN NULLIF(cfg.cabecalho_endereco, '') IS NOT NULL THEN NULL ELSE e.cep END,
            COALESCE(NULLIF(cfg.cabecalho_endereco, ''), e.rua),
            CASE WHEN NULLIF(cfg.cabecalho_endereco, '') IS NOT NULL THEN NULL ELSE e.numero END,
            CASE WHEN NULLIF(cfg.cabecalho_endereco, '') IS NOT NULL THEN NULL ELSE e.complemento END,
            CASE WHEN NULLIF(cfg.cabecalho_endereco, '') IS NOT NULL THEN NULL ELSE e.cidade END,
            CASE WHEN NULLIF(cfg.cabecalho_endereco, '') IS NOT NULL THEN NULL ELSE e.estado END,
            e.logo_url,
            COALESCE(NULLIF(cfg.cabecalho_rodape, ''), NULLIF(cfg.rodape_padrao, '')),
            TRUE,
            TRUE
        FROM empresas e
        JOIN orcamento_configuracoes cfg ON cfg.empresa_id=e.id
        WHERE e.id=:empresa_id
          AND NOT EXISTS (
              SELECT 1 FROM orcamento_emitentes oe WHERE oe.empresa_id=e.id
          )
    """), {"empresa_id": empresa_id})

    # Garante somente um perfil padrão por empresa.
    default_id = db.execute(text("""
        SELECT id FROM orcamento_emitentes
        WHERE empresa_id=:empresa_id AND ativo=TRUE
        ORDER BY padrao DESC, id ASC LIMIT 1
    """), {"empresa_id": empresa_id}).scalar()
    if default_id:
        db.execute(text("""
            UPDATE orcamento_emitentes
            SET padrao=(id=:default_id), atualizado_em=CASE WHEN id=:default_id THEN atualizado_em ELSE atualizado_em END
            WHERE empresa_id=:empresa_id
        """), {"empresa_id": empresa_id, "default_id": int(default_id)})

    if commit:
        db.commit()


def maybe_import_legacy(db: Session, empresa_id: int, *, commit: bool = True) -> None:
    """Importa uma única vez os registros do módulo antigo de Propostas.

    A conversão é feita em Python para aceitar valores antigos armazenados como
    texto, inclusive formatos como ``R$ 1.234,56``. Propostas continuam
    existindo no módulo legado; o orçamento recebe uma cópia independente.
    """
    exists = db.execute(text("SELECT to_regclass('public.propostas') IS NOT NULL")).scalar()
    if not exists:
        return

    proposals = db.execute(text("""
        SELECT id, empresa_id, cliente_id, codigo, titulo, status, observacoes,
               validade_dias, subtotal, desconto, total, criado_em, atualizado_em
        FROM propostas
        WHERE empresa_id=:empresa_id
        ORDER BY id
    """), {"empresa_id": empresa_id}).mappings().all()

    items_table_exists = db.execute(text("SELECT to_regclass('public.propostas_itens') IS NOT NULL")).scalar()

    for proposal in proposals:
        legacy_id = int(proposal["id"])
        already_imported = db.execute(text("""
            SELECT id FROM orcamentos
            WHERE empresa_id=:empresa_id AND legacy_proposta_id=:legacy_id
        """), {"empresa_id": empresa_id, "legacy_id": legacy_id}).scalar()
        if already_imported:
            continue

        base_code = norm_str(proposal.get("codigo")) or f"LEG-{legacy_id:07d}"
        code = base_code[:50]
        code_in_use = db.execute(text("""
            SELECT 1 FROM orcamentos WHERE empresa_id=:empresa_id AND codigo=:codigo
        """), {"empresa_id": empresa_id, "codigo": code}).scalar()
        if code_in_use:
            suffix = f"-LEG-{legacy_id}"
            code = f"{base_code[:max(1, 50 - len(suffix))]}{suffix}"

        created_at = proposal.get("criado_em") or datetime.now(timezone.utc)
        updated_at = proposal.get("atualizado_em") or created_at
        emission_date = parse_date(created_at, date.today()) or date.today()
        validity_digits = re.sub(r"\D", "", str(proposal.get("validade_dias") or ""))
        validity_days = int(validity_digits) if validity_digits else 0
        validity_date = emission_date + timedelta(days=validity_days) if validity_days > 0 else None

        subtotal_value = q2(money(proposal.get("subtotal")))
        discount_value = q2(money(proposal.get("desconto")))
        total_value = q2(money(proposal.get("total"), max(subtotal_value - discount_value, Decimal("0"))))

        budget_id = db.execute(text("""
            INSERT INTO orcamentos (
                empresa_id, cliente_id, codigo, titulo, nome_documento, status,
                data_emissao, data_validade, desconto_tipo, desconto_valor, desconto_total,
                subtotal, total, observacoes, legacy_proposta_id, criado_em, atualizado_em
            ) VALUES (
                :empresa_id, :cliente_id, :codigo, :titulo, 'Orçamento', :status,
                :data_emissao, :data_validade, 'valor', :desconto_valor, :desconto_total,
                :subtotal, :total, :observacoes, :legacy_id, :criado_em, :atualizado_em
            )
            RETURNING id
        """), {
            "empresa_id": empresa_id,
            "cliente_id": proposal.get("cliente_id"),
            "codigo": code,
            "titulo": norm_str(proposal.get("titulo")) or "Orçamento importado",
            "status": status_norm(proposal.get("status")),
            "data_emissao": emission_date,
            "data_validade": validity_date,
            "desconto_valor": discount_value,
            "desconto_total": discount_value,
            "subtotal": subtotal_value,
            "total": total_value,
            "observacoes": norm_str(proposal.get("observacoes")),
            "legacy_id": legacy_id,
            "criado_em": created_at,
            "atualizado_em": updated_at,
        }).scalar_one()

        if items_table_exists:
            legacy_items = db.execute(text("""
                SELECT pi.id, pi.produto_id, pi.origem, pi.codigo, pi.descricao, pi.unidade,
                       pi.quantidade, pi.valor_unitario, pi.valor_total, pi.observacao, pi.ordem
                FROM propostas_itens pi
                WHERE pi.proposta_id=:proposal_id
                ORDER BY pi.ordem, pi.id
            """), {"proposal_id": legacy_id}).mappings().all()

            for index, item in enumerate(legacy_items):
                product_id = item.get("produto_id")
                if product_id and not product_for_company(db, int(product_id), empresa_id):
                    product_id = None
                quantity = max(money(item.get("quantidade"), Decimal("1")), Decimal("0.0001"))
                unit_value = max(money(item.get("valor_unitario")), Decimal("0"))
                item_total = money(item.get("valor_total"), quantity * unit_value)
                db.execute(text("""
                    INSERT INTO orcamento_itens (
                        orcamento_id, produto_id, origem, codigo, descricao, unidade,
                        quantidade, valor_unitario, valor_total, observacao, ordem
                    ) VALUES (
                        :orcamento_id, :produto_id, :origem, :codigo, :descricao, :unidade,
                        :quantidade, :valor_unitario, :valor_total, :observacao, :ordem
                    )
                """), {
                    "orcamento_id": int(budget_id),
                    "produto_id": product_id,
                    "origem": norm_str(item.get("origem")) or ("produto" if product_id else "manual"),
                    "codigo": norm_str(item.get("codigo")),
                    "descricao": norm_str(item.get("descricao")) or "Item importado",
                    "unidade": norm_str(item.get("unidade")) or "UN",
                    "quantidade": q2(quantity),
                    "valor_unitario": q2(unit_value),
                    "valor_total": q2(max(item_total, Decimal("0"))),
                    "observacao": norm_str(item.get("observacao")),
                    "ordem": int(item.get("ordem") if item.get("ordem") is not None else index),
                })

        db.execute(text("""
            INSERT INTO orcamento_historico (orcamento_id, usuario_nome, acao, descricao, criado_em)
            VALUES (:orcamento_id, 'Sistema', 'importado', 'Importado do módulo antigo de Propostas.', :criado_em)
        """), {"orcamento_id": int(budget_id), "criado_em": created_at})

    if commit:
        db.commit()


def prepare_write(db: Session, empresa_id: int) -> None:
    """Inicializa dados padrão somente dentro de operações de escrita."""
    if empresa_id in _PREPARED_COMPANIES:
        return
    ensure_default_config(db, empresa_id)
    _PREPARED_COMPANIES.add(empresa_id)


def code_prefix(db: Session, empresa_id: int) -> str:
    config = db.execute(text("SELECT prefixo FROM orcamento_configuracoes WHERE empresa_id=:e"), {"e": empresa_id}).mappings().first()
    return re.sub(r"[^A-Za-z0-9_-]", "", (config or {}).get("prefixo") or "ORC").upper()[:20] or "ORC"


def preview_next_code(db: Session, empresa_id: int) -> str:
    prefix = code_prefix(db, empresa_id)
    max_existing = int(db.execute(text(r"""
        SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '\D', '', 'g'), '')::bigint), 0)
        FROM orcamentos WHERE empresa_id=:e
    """), {"e": empresa_id}).scalar() or 0)
    current_sequence = int(db.execute(text("""
        SELECT ultimo_codigo FROM cadastro_sequencias
        WHERE empresa_id=:e AND modulo='orcamentos'
    """), {"e": empresa_id}).scalar() or 0)
    return f"{prefix}-{max(max_existing, current_sequence) + 1:05d}"


def consume_next_code(db: Session, empresa_id: int) -> str:
    prefix = code_prefix(db, empresa_id)
    max_existing = int(db.execute(text(r"""
        SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '\D', '', 'g'), '')::bigint), 0)
        FROM orcamentos WHERE empresa_id=:e
    """), {"e": empresa_id}).scalar() or 0)
    prepare_write(db, empresa_id)
    db.execute(text("""
        INSERT INTO cadastro_sequencias (empresa_id, modulo, ultimo_codigo)
        VALUES (:e, 'orcamentos', :m)
        ON CONFLICT (empresa_id, modulo)
        DO UPDATE SET ultimo_codigo=GREATEST(cadastro_sequencias.ultimo_codigo, EXCLUDED.ultimo_codigo), atualizado_em=NOW()
    """), {"e": empresa_id, "m": max_existing})
    number = db.execute(text("""
        UPDATE cadastro_sequencias
        SET ultimo_codigo=ultimo_codigo+1, atualizado_em=NOW()
        WHERE empresa_id=:e AND modulo='orcamentos'
        RETURNING ultimo_codigo
    """), {"e": empresa_id}).scalar_one()
    return f"{prefix}-{int(number):05d}"


def add_history(
    db: Session,
    budget_id: int,
    user: models.Usuario,
    action: str,
    description: Optional[str] = None,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
    data: Optional[dict] = None,
) -> None:
    db.execute(text("""
        INSERT INTO orcamento_historico (
            orcamento_id, usuario_id, usuario_nome, acao,
            status_anterior, status_novo, descricao, dados_json
        ) VALUES (:o, :u, :n, :a, :sa, :sn, :d, :j)
    """), {
        "o": budget_id,
        "u": int(user.id),
        "n": user.nome,
        "a": action,
        "sa": old_status,
        "sn": new_status,
        "d": description,
        "j": json_dump(data or {}),
    })


class PaymentOption(BaseModel):
    tipo: str = "personalizado"
    nome: str
    descricao: Optional[str] = None
    desconto_percentual: Decimal = Decimal("0")
    entrada_percentual: Decimal = Decimal("0")
    entrada_valor: Decimal = Decimal("0")
    parcelas: int = Field(default=1, ge=1, le=120)
    juros_percentual: Decimal = Decimal("0")
    valor_parcela: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    selecionada: bool = False


class BudgetItemIn(BaseModel):
    id: Optional[int] = None
    produto_id: Optional[int] = None
    origem: str = "manual"
    codigo: Optional[str] = None
    descricao: str
    referencia: Optional[str] = None
    unidade: Optional[str] = "UN"
    quantidade: Decimal = Decimal("1")
    valor_unitario: Decimal = Decimal("0")
    desconto: Decimal = Decimal("0")
    custo_unitario: Optional[Decimal] = None
    custo_informado: Optional[bool] = None
    observacao: Optional[str] = None
    ordem: int = 0


class BudgetBase(BaseModel):
    cliente_id: Optional[int] = None
    emitente_id: Optional[int] = None
    consultor_id: Optional[int] = None
    categoria_id: Optional[int] = None
    modelo_id: Optional[int] = None
    titulo: str
    nome_documento: Optional[str] = None
    status: str = "rascunho"
    data_solicitacao: Optional[date] = None
    data_emissao: Optional[date] = None
    data_validade: Optional[date] = None
    responsavel_cliente: Optional[str] = None
    contato_cliente: Optional[str] = None
    endereco_cep: Optional[str] = None
    endereco_logradouro: Optional[str] = None
    endereco_numero: Optional[str] = None
    endereco_complemento: Optional[str] = None
    endereco_bairro: Optional[str] = None
    endereco_cidade: Optional[str] = None
    endereco_estado: Optional[str] = None
    desconto_tipo: str = "valor"
    desconto_valor: Decimal = Decimal("0")
    frete: Decimal = Decimal("0")
    acrescimo: Decimal = Decimal("0")
    prazo_execucao: Optional[str] = None
    condicoes: Optional[str] = None
    observacoes: Optional[str] = None
    proposta_modelo: str = "padrao"
    proposta_comercial: Dict[str, Any] = Field(default_factory=dict)
    pagamentos: List[PaymentOption] = Field(default_factory=list)
    usar_capa: bool = False
    titulo_capa: Optional[str] = None
    subtitulo_capa: Optional[str] = None
    escala_documento: Optional[int] = Field(default=None, ge=70, le=125)
    itens: List[BudgetItemIn] = Field(default_factory=list)


class BudgetCreate(BudgetBase):
    pass


class BudgetUpdate(BudgetBase):
    titulo: Optional[str] = None
    itens: Optional[List[BudgetItemIn]] = None
    pagamentos: Optional[List[PaymentOption]] = None


class CalculationIn(BudgetBase):
    titulo: str = "Prévia"


class StatusIn(BaseModel):
    status: str
    observacao: Optional[str] = None


class EnviarFinanceiroIn(BaseModel):
    observacao: Optional[str] = None
    tipo_venda: str = "avulsa"


class PropostaClientePreparacaoIn(BaseModel):
    natureza: str
    servicos: List[str] = Field(default_factory=list)
    planos: List[str] = Field(default_factory=list)
    tipo_contrato: Optional[str] = None
    valor_implantacao: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    valor_mensal: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    dia_vencimento: Optional[int] = Field(default=None, ge=1, le=31)
    forma_pagamento: str
    condicao_pagamento: str


class PropostaClienteLinkIn(BaseModel):
    regenerar: bool = False


class ContratoClienteGerarIn(BaseModel):
    regenerar: bool = False


class CategoryIn(BaseModel):
    nome: str
    descricao: Optional[str] = None
    ativo: bool = True
    ordem: int = 0


class TemplateIn(BaseModel):
    nome: str
    categoria_id: Optional[int] = None
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    validade_dias: Optional[int] = Field(default=None, ge=0, le=3650)
    prazo_execucao: Optional[str] = None
    condicoes: Optional[str] = None
    observacoes: Optional[str] = None
    pagamentos: List[PaymentOption] = Field(default_factory=list)
    ativo: bool = True
    itens: List[BudgetItemIn] = Field(default_factory=list)


class KitItemIn(BaseModel):
    produto_id: int = Field(gt=0)
    quantidade: Decimal = Field(default=Decimal("1"), gt=Decimal("0"), le=Decimal("1000000"))
    ordem: int = 0


class KitIn(BaseModel):
    nome: str
    descricao: Optional[str] = None
    ativo: bool = True
    itens: List[KitItemIn] = Field(default_factory=list)


class EmitenteIn(BaseModel):
    nome: str
    razao_social: str
    nome_fantasia: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    email: Optional[str] = None
    site: Optional[str] = None
    telefone: Optional[str] = None
    cep: Optional[str] = None
    endereco: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    logo_url: Optional[str] = None
    rodape: Optional[str] = None
    padrao: bool = False
    ativo: bool = True


class SettingsIn(BaseModel):
    nome_documento: str = "Orçamento"
    prefixo: str = "ORC"
    modelo_documento: str = "padrao"
    dav_titulo: str = "DAV - Documento Auxiliar de Venda"
    cabecalho_razao_social: Optional[str] = None
    cabecalho_nome_fantasia: Optional[str] = None
    cabecalho_cnpj: Optional[str] = None
    cabecalho_email: Optional[str] = None
    cabecalho_site: Optional[str] = None
    cabecalho_telefone: Optional[str] = None
    cabecalho_endereco: Optional[str] = None
    cabecalho_rodape: Optional[str] = None
    validade_padrao_dias: int = Field(default=7, ge=0, le=3650)
    prazo_execucao_padrao: Optional[str] = None
    condicoes_padrao: Optional[str] = None
    observacoes_padrao: Optional[str] = None
    rodape_padrao: Optional[str] = None
    cor_primaria: str = "#65ACDE"
    titulo_capa: Optional[str] = None
    subtitulo_capa: Optional[str] = None
    usar_capa: bool = False
    escala_documento_padrao: int = Field(default=100, ge=70, le=125)
    mostrar_codigo: bool = True
    mostrar_desconto: bool = True
    mostrar_imagens: bool = False
    controlar_custos: bool = True
    margem_minima: Decimal = Field(default=Decimal("0"), ge=Decimal("0"), le=Decimal("100"))
    exigir_aprovacao_margem: bool = False
    formas_pagamento: List[dict] = Field(default_factory=list)


def client_snapshot(db: Session, client_id: Optional[int], company_id: int) -> dict:
    if not client_id:
        return {
            "cliente_nome_documento": None,
            "cliente_nome_fantasia_documento": None,
            "cliente_cpf_cnpj": None,
            "cliente_rg_ie": None,
            "cliente_telefone": None,
            "cliente_whatsapp_documento": None,
            "cliente_fax": None,
            "cliente_email_nfe": None,
            "cliente_contato_nome": None,
            "cliente_cep": None,
            "cliente_endereco": None,
            "cliente_numero": None,
            "cliente_complemento": None,
            "cliente_bairro": None,
            "cliente_cidade": None,
            "cliente_estado": None,
        }
    row = db.execute(text("""
        SELECT nome, nome_fantasia, cpf_cnpj, rg_ie, telefone, whatsapp, fax,
               email_nfe, contato, cep, endereco, numero, complemento, bairro, cidade, estado
        FROM clientes WHERE id=:id AND empresa_id=:empresa_id
    """), {"id": client_id, "empresa_id": company_id}).mappings().first()
    if not row:
        return client_snapshot(db, None, company_id)
    return {
        "cliente_nome_documento": norm_str(row.get("nome")),
        "cliente_nome_fantasia_documento": norm_str(row.get("nome_fantasia")),
        "cliente_cpf_cnpj": norm_str(row.get("cpf_cnpj")),
        "cliente_rg_ie": norm_str(row.get("rg_ie")),
        "cliente_telefone": norm_str(row.get("telefone")),
        "cliente_whatsapp_documento": norm_str(row.get("whatsapp")),
        "cliente_fax": norm_str(row.get("fax")),
        "cliente_email_nfe": norm_str(row.get("email_nfe")),
        "cliente_contato_nome": norm_str(row.get("contato")),
        "cliente_cep": norm_str(row.get("cep")),
        "cliente_endereco": norm_str(row.get("endereco")),
        "cliente_numero": norm_str(row.get("numero")),
        "cliente_complemento": norm_str(row.get("complemento")),
        "cliente_bairro": norm_str(row.get("bairro")),
        "cliente_cidade": norm_str(row.get("cidade")),
        "cliente_estado": norm_str(row.get("estado")),
    }


def emitter_row(db: Session, emitter_id: Optional[int], company_id: int):
    if emitter_id:
        row = db.execute(text("""
            SELECT * FROM orcamento_emitentes
            WHERE id=:id AND empresa_id=:empresa_id AND ativo=TRUE
        """), {"id": int(emitter_id), "empresa_id": company_id}).mappings().first()
        if not row:
            raise HTTPException(status_code=422, detail="A empresa emitente selecionada não está disponível.")
        return dict(row)

    row = db.execute(text("""
        SELECT * FROM orcamento_emitentes
        WHERE empresa_id=:empresa_id AND ativo=TRUE
        ORDER BY padrao DESC, nome ASC, id ASC LIMIT 1
    """), {"empresa_id": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=422, detail="Cadastre ao menos uma empresa emitente nas configurações do orçamento.")
    return dict(row)


def emitter_snapshot(db: Session, emitter_id: Optional[int], company_id: int) -> dict:
    row = emitter_row(db, emitter_id, company_id)
    address = ", ".join(filter(None, [
        norm_str(row.get("endereco")),
        norm_str(row.get("numero")),
        norm_str(row.get("complemento")),
        norm_str(row.get("bairro")),
        norm_str(row.get("cidade")),
        norm_str(row.get("estado")),
        norm_str(row.get("cep")),
    ]))
    return {
        "emitente_id": int(row["id"]),
        "emitente_nome_documento": norm_str(row.get("nome")),
        "emitente_razao_social_documento": norm_str(row.get("razao_social")) or norm_str(row.get("nome")),
        "emitente_nome_fantasia_documento": norm_str(row.get("nome_fantasia")),
        "emitente_cnpj_documento": norm_str(row.get("cnpj")),
        "emitente_ie_documento": norm_str(row.get("inscricao_estadual")),
        "emitente_email_documento": norm_str(row.get("email")),
        "emitente_site_documento": norm_str(row.get("site")),
        "emitente_telefone_documento": norm_str(row.get("telefone")),
        "emitente_endereco_documento": address or None,
        "emitente_logo_documento": norm_str(row.get("logo_url")),
        "emitente_rodape_documento": norm_str(row.get("rodape")),
    }


def stored_emitter_snapshot(row: dict) -> dict:
    """Reutiliza os dados emitentes já gravados no documento.

    Orçamentos antigos não devem mudar quando um perfil emitente for editado ou
    desativado. A fotografia só é renovada quando o usuário escolhe outro perfil.
    """
    keys = (
        "emitente_id", "emitente_nome_documento", "emitente_razao_social_documento",
        "emitente_nome_fantasia_documento", "emitente_cnpj_documento",
        "emitente_ie_documento", "emitente_email_documento", "emitente_site_documento",
        "emitente_telefone_documento", "emitente_endereco_documento",
        "emitente_logo_documento", "emitente_rodape_documento",
    )
    return {key: row.get(key) for key in keys}


def serialize_emitter(row: dict) -> dict:
    out = dict(row)
    for key in ("criado_em", "atualizado_em"):
        out[key] = iso(out.get(key))
    return out


def product_for_company(db: Session, product_id: int, company_id: int):
    row = db.execute(text("""
        SELECT id, codigo, nome, descricao, unidade, preco_venda, custo
        FROM produtos WHERE id=:id AND empresa_id=:e
    """), {"id": product_id, "e": company_id}).mappings().first()
    if not row:
        return None
    return apply_product_cost_fallbacks(db, company_id, [row])[0]


def product_by_code_for_company(db: Session, code: str, company_id: int):
    normalized_code = norm_str(code)
    if not normalized_code:
        return None
    row = db.execute(text("""
        SELECT id, codigo, nome, descricao, unidade, preco_venda, custo
        FROM produtos
        WHERE empresa_id=:e
          AND ativo=TRUE
          AND LOWER(TRIM(codigo))=LOWER(:codigo)
        ORDER BY id
        LIMIT 1
    """), {"e": company_id, "codigo": normalized_code}).mappings().first()
    if not row:
        return None
    return apply_product_cost_fallbacks(db, company_id, [row])[0]


def calculate_items(
    db: Session,
    company_id: int,
    user: models.Usuario,
    items: List[BudgetItemIn],
    existing_costs: Optional[Dict[int, tuple[Decimal, bool]]] = None,
    refresh_product_prices: bool = False,
) -> tuple[List[dict], dict]:
    normalized: List[dict] = []
    subtotal = Decimal("0")
    cost_total = Decimal("0")
    missing_costs = 0
    allow_cost = can_view_costs(user, db)
    existing_costs = existing_costs or {}

    for index, item in enumerate(items or []):
        description = norm_str(item.descricao)
        reference = norm_str(item.referencia)
        if not description:
            continue

        qty = max(money(item.quantidade, Decimal("1")), Decimal("0.0001"))
        unit_value = max(money(item.valor_unitario), Decimal("0"))
        discount = max(money(item.desconto), Decimal("0"))
        product = product_for_company(db, int(item.produto_id), company_id) if item.produto_id else None
        product_replaced_by_code = False
        requested_code = norm_str(item.codigo)
        if product and requested_code and requested_code.casefold() != (norm_str(product.get("codigo")) or "").casefold():
            replacement_product = product_by_code_for_company(db, requested_code, company_id)
            if not replacement_product:
                raise HTTPException(
                    status_code=422,
                    detail=f"Produto com código {requested_code} não foi encontrado ou está inativo.",
                )
            product = replacement_product
            product_replaced_by_code = True
            description = norm_str(product.get("nome")) or description
            reference = norm_str(product.get("descricao"))
        previous_entry = existing_costs.get(int(item.id)) if item.id else None
        if isinstance(previous_entry, tuple):
            previous_cost, previous_cost_known = previous_entry
        elif previous_entry is not None:
            previous_cost, previous_cost_known = previous_entry, True
        else:
            previous_cost, previous_cost_known = None, False
        submitted_cost = None if item.custo_unitario is None else max(money(item.custo_unitario), Decimal("0"))

        if product:
            code = (norm_str(product.get("codigo")) if product_replaced_by_code else norm_str(item.codigo)) or product["codigo"]
            unit = (norm_str(product.get("unidade")) if product_replaced_by_code else norm_str(item.unidade)) or product["unidade"] or "UN"
            product_sale_raw = product.get("preco_venda")
            product_has_sale = product_sale_raw is not None and str(product_sale_raw).strip() != ""
            if product_replaced_by_code:
                unit_value = max(money(product_sale_raw), Decimal("0")) if product_has_sale else Decimal("0")
            elif refresh_product_prices and product_has_sale:
                unit_value = max(money(product_sale_raw), Decimal("0"))

            product_cost_raw = product.get("custo")
            product_cost = max(money(product_cost_raw), Decimal("0"))
            product_has_cost = product_cost_raw is not None and str(product_cost_raw).strip() != ""

            # Ao trocar o item digitando outro código, o novo cadastro de Produto
            # é a fonte autoritativa para preço, custo, nome e unidade.
            if product_replaced_by_code:
                cost_unit = product_cost
                cost_known = product_has_cost
            # Na atualização explícita de preços, o cadastro do produto é a fonte
            # principal. Campo vazio no cadastro preserva o valor antigo para não
            # apagar preços já negociados por acidente.
            elif refresh_product_prices and product_has_cost:
                cost_unit = product_cost
                cost_known = True
            # O custo cadastrado no banco é a fonte padrão. Um zero enviado pelo
            # navegador não apaga o custo do produto. Usuários autorizados podem
            # substituir o custo quando enviam um valor explícito.
            elif allow_cost and submitted_cost is not None and (submitted_cost > 0 or not product_has_cost):
                cost_unit = submitted_cost
                cost_known = True
            elif (
                previous_cost is not None
                and previous_cost_known
                and not (
                    max(previous_cost, Decimal("0")) == 0
                    and product_has_cost
                    and product_cost > 0
                )
            ):
                cost_unit = max(previous_cost, Decimal("0"))
                cost_known = True
            else:
                # Corrige snapshots antigos gravados com custo zero enquanto o
                # produto já possuía Valor Compra na Formação de Preços.
                cost_unit = product_cost
                cost_known = product_has_cost
        else:
            code = norm_str(item.codigo)
            unit = norm_str(item.unidade) or "UN"
            if allow_cost and submitted_cost is not None:
                cost_unit = submitted_cost
                cost_known = bool(item.custo_informado) or submitted_cost > 0
            elif previous_cost is not None and previous_cost_known:
                cost_unit = max(previous_cost, Decimal("0"))
                cost_known = True
            else:
                cost_unit = Decimal("0")
                cost_known = False

        if not cost_known:
            missing_costs += 1

        gross = qty * unit_value
        total = max(gross - discount, Decimal("0"))
        cost = qty * max(cost_unit, Decimal("0"))
        profit = total - cost
        margin = (profit / total * Decimal("100")) if total > 0 else Decimal("0")
        subtotal += total
        cost_total += cost

        normalized.append({
            "id": int(item.id) if item.id else None,
            "produto_id": int(product["id"]) if product else None,
            "origem": "produto" if product else (norm_str(item.origem) or "manual"),
            "codigo": code,
            "descricao": description,
            "referencia": reference,
            "unidade": unit,
            "quantidade": q4(qty),
            "valor_unitario": q4(unit_value),
            "desconto": q4(discount),
            "valor_total": q2(total),
            "custo_unitario": q4(cost_unit),
            "custo_informado": bool(cost_known),
            "custo_total": q2(cost),
            "lucro_total": q2(profit),
            "margem_percentual": q2(margin),
            "observacao": norm_str(item.observacao),
            "ordem": int(item.ordem if item.ordem is not None else index),
        })

    return normalized, {
        "subtotal": subtotal,
        "custo_total": cost_total,
        "itens_sem_custo": missing_costs,
    }


def calculate_totals(payload: BudgetBase, subtotal: Decimal, cost_total: Decimal) -> dict:
    discount_type = payload.desconto_tipo if payload.desconto_tipo in TIPOS_DESCONTO else "valor"
    discount_value = max(money(payload.desconto_valor), Decimal("0"))
    discount_total = subtotal * discount_value / Decimal("100") if discount_type == "percentual" else discount_value
    discount_total = min(max(discount_total, Decimal("0")), subtotal)
    total = max(subtotal - discount_total + max(money(payload.frete), Decimal("0")) + max(money(payload.acrescimo), Decimal("0")), Decimal("0"))
    profit = total - cost_total
    margin = (profit / total * Decimal("100")) if total > 0 else Decimal("0")
    return {
        "desconto_tipo": discount_type,
        "desconto_valor": q2(discount_value),
        "desconto_total": q2(discount_total),
        "frete": q2(max(money(payload.frete), Decimal("0"))),
        "acrescimo": q2(max(money(payload.acrescimo), Decimal("0"))),
        "subtotal": q2(subtotal),
        "total": q2(total),
        "custo_total": q2(cost_total),
        "lucro_total": q2(profit),
        "margem_percentual": q2(margin),
    }


def recalculate_payment_options(payments: List[PaymentOption], total: Decimal) -> List[dict]:
    """Recalcula parcelas quando o total do orçamento muda."""
    normalized: List[dict] = []
    budget_total = max(money(total), Decimal("0"))
    for payment in payments or []:
        discount_percent = max(money(payment.desconto_percentual), Decimal("0"))
        entry_percent = max(money(payment.entrada_percentual), Decimal("0"))
        interest_percent = max(money(payment.juros_percentual), Decimal("0"))
        installments = max(int(payment.parcelas or 1), 1)
        discounted = budget_total * (Decimal("1") - discount_percent / Decimal("100"))
        with_interest = max(discounted, Decimal("0")) * (Decimal("1") + interest_percent / Decimal("100"))
        payment_total = max(with_interest, Decimal("0"))
        entry_value = payment_total * entry_percent / Decimal("100")
        installment_value = max((payment_total - entry_value) / Decimal(installments), Decimal("0"))
        item = payment.model_dump(mode="json") if hasattr(payment, "model_dump") else payment.dict()
        item.update({
            "desconto_percentual": dec_out(discount_percent),
            "entrada_percentual": dec_out(entry_percent),
            "entrada_valor": dec_out(entry_value),
            "parcelas": installments,
            "juros_percentual": dec_out(interest_percent),
            "valor_parcela": dec_out(installment_value),
            "total": dec_out(payment_total),
        })
        normalized.append(item)
    return normalized


def default_config_row(company_id: int) -> dict:
    formas = [
        {"tipo": "avista", "nome": "À vista", "ativo": True},
        {"tipo": "entrada_parcelas", "nome": "Entrada + parcelas", "ativo": True},
        {"tipo": "cartao", "nome": "Cartão de crédito", "ativo": True},
        {"tipo": "pix", "nome": "PIX", "ativo": True},
        {"tipo": "boleto", "nome": "Boleto", "ativo": True},
    ]
    values = SettingsIn().model_dump() if hasattr(SettingsIn(), "model_dump") else SettingsIn().dict()
    values["empresa_id"] = company_id
    values["formas_pagamento_json"] = json_dump(formas)
    values["condicoes_padrao"] = (
        "1. Este orçamento contempla somente os produtos e serviços descritos.\n"
        "2. Materiais ou serviços adicionais serão orçados separadamente.\n"
        "3. Garantias seguem as condições informadas neste documento."
    )
    values["titulo_capa"] = "Proposta comercial"
    values["subtitulo_capa"] = "Soluções preparadas para a necessidade do cliente"
    values.pop("formas_pagamento", None)
    return values


def get_config_row(db: Session, company_id: int) -> dict:
    row = db.execute(text("SELECT * FROM orcamento_configuracoes WHERE empresa_id=:e"), {"e": company_id}).mappings().first()
    return dict(row) if row else default_config_row(company_id)


def validate_company_fk(db: Session, table: str, row_id: Optional[int], company_id: int, label: str) -> None:
    if not row_id:
        return
    if table not in {"clientes", "usuarios", "orcamento_categorias", "orcamento_modelos"}:
        raise ValueError("Tabela inválida")
    found = db.execute(text(f"SELECT id FROM {table} WHERE id=:id AND empresa_id=:e"), {"id": row_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=422, detail=f"{label} não pertence a esta empresa.")


def _apply_live_product_costs_to_budget_rows(
    db: Session,
    company_id: int,
    rows: List[Any],
) -> List[dict]:
    output = [dict(row) for row in rows]
    product_ids = sorted({
        int(row.get("produto_id") or 0)
        for row in output
        if int(row.get("produto_id") or 0) > 0
    })
    if not product_ids:
        return output

    product_rows = (
        db.query(models.Produto.id, models.Produto.custo)
        .filter(models.Produto.empresa_id == company_id)
        .filter(models.Produto.id.in_(product_ids))
        .all()
    )
    effective_rows = apply_product_cost_fallbacks(
        db,
        company_id,
        [
            {"produto_id": int(row[0]), "custo": row[1]}
            for row in product_rows
        ],
        product_id_key="produto_id",
    )
    effective_costs = {
        int(row["produto_id"]): row.get("custo")
        for row in effective_rows
    }

    for item in output:
        product_id = int(item.get("produto_id") or 0)
        if not product_id:
            continue
        raw_product_cost = effective_costs.get(product_id)
        if raw_product_cost is None or str(raw_product_cost).strip() == "":
            continue

        product_cost = max(money(raw_product_cost), Decimal("0"))
        stored_cost = max(money(item.get("custo_unitario")), Decimal("0"))
        stored_known = bool(item.get("custo_informado"))

        # Orçamentos antigos podem ter sido salvos com zero por causa do campo
        # nativo desatualizado. Quando o produto possui custo real, ele corrige
        # a análise sem exigir que o usuário remova e inclua o item novamente.
        if stored_known and not (stored_cost == 0 and product_cost > 0):
            continue

        qty = max(money(item.get("quantidade"), Decimal("1")), Decimal("0"))
        sale_total = max(money(item.get("valor_total")), Decimal("0"))
        cost_total = qty * product_cost
        profit = sale_total - cost_total
        margin = (profit / sale_total * Decimal("100")) if sale_total > 0 else Decimal("0")

        item["custo_unitario"] = q4(product_cost)
        item["custo_informado"] = True
        item["custo_total"] = q2(cost_total)
        item["lucro_total"] = q2(profit)
        item["margem_percentual"] = q2(margin)

    return output


def serialize_items(
    db: Session,
    budget_id: int,
    show_costs: bool,
    company_id: Optional[int] = None,
) -> List[dict]:
    rows = db.execute(text("""
        SELECT * FROM orcamento_itens WHERE orcamento_id=:o ORDER BY ordem, id
    """), {"o": budget_id}).mappings().all()
    prepared_rows = (
        _apply_live_product_costs_to_budget_rows(db, int(company_id), rows)
        if show_costs and company_id
        else [dict(row) for row in rows]
    )

    output = []
    for item in prepared_rows:
        for key in ("quantidade", "valor_unitario", "desconto", "valor_total"):
            item[key] = dec_out(item.get(key))
        if show_costs:
            for key in ("custo_unitario", "custo_total", "lucro_total", "margem_percentual"):
                item[key] = dec_out(item.get(key))
        else:
            item.pop("custo_unitario", None)
            item.pop("custo_total", None)
            item.pop("lucro_total", None)
            item.pop("margem_percentual", None)
        item["criado_em"] = iso(item.get("criado_em"))
        item["atualizado_em"] = iso(item.get("atualizado_em"))
        output.append(item)
    return output


def serialize_budget(
    db: Session,
    row: dict,
    user: models.Usuario,
    complete: bool = True,
    show_costs_override: Optional[bool] = None,
) -> dict:
    out = dict(row)
    show_costs = can_view_costs(user, db) if show_costs_override is None else bool(show_costs_override)
    for key in ("desconto_valor", "desconto_total", "frete", "acrescimo", "subtotal", "total"):
        out[key] = dec_out(out.get(key))
    if show_costs:
        for key in ("custo_total", "lucro_total", "margem_percentual"):
            out[key] = dec_out(out.get(key))
    else:
        out.pop("custo_total", None)
        out.pop("lucro_total", None)
        out.pop("margem_percentual", None)
        out.pop("itens_sem_custo", None)
    for key in ("data_solicitacao", "data_emissao", "data_validade", "data_aprovacao", "aprovado_em", "criado_em", "atualizado_em"):
        out[key] = iso(out.get(key))
    out["pagamentos"] = json_load(out.pop("pagamentos_json", None), [])
    out["proposta_modelo"] = norm_str(out.get("proposta_modelo")) or "padrao"
    out["proposta_comercial"] = json_load(out.pop("proposta_comercial_json", None), {})
    out["preparacao_cliente"] = {
        "preparada": bool(out.pop("proposta_cliente_preparada", False)),
        "natureza": out.pop("proposta_cliente_natureza", None),
        "servicos": json_load(out.pop("proposta_cliente_servicos_json", None), []),
        "planos": json_load(out.pop("proposta_cliente_planos_json", None), []),
        "tipo_contrato": out.pop("proposta_cliente_tipo_contrato", None),
        "valor_implantacao": dec_out(out.pop("proposta_cliente_valor_implantacao", 0)),
        "valor_mensal": dec_out(out.pop("proposta_cliente_valor_mensal", 0)),
        "dia_vencimento": out.pop("proposta_cliente_dia_vencimento", None),
        "forma_pagamento": out.pop("proposta_cliente_forma_pagamento", None),
        "condicao_pagamento": out.pop("proposta_cliente_condicao_pagamento", None),
        "preparada_em": iso(out.pop("proposta_cliente_preparada_em", None)),
        "preparada_por_id": out.pop("proposta_cliente_preparada_por_id", None),
    }
    out["publicacao_cliente"] = {
        "versao_link": int(out.pop("proposta_cliente_link_versao", 0) or 0),
        "link_ativo": bool(out.pop("proposta_cliente_link_ativo", False)),
        "gerado_em": iso(out.pop("proposta_cliente_link_gerado_em", None)),
        "expira_em": iso(out.pop("proposta_cliente_link_expira_em", None)),
        "status": out.pop("proposta_cliente_public_status", "nao_gerado") or "nao_gerado",
        "primeira_visualizacao_em": iso(out.pop("proposta_cliente_primeira_visualizacao_em", None)),
        "ultima_visualizacao_em": iso(out.pop("proposta_cliente_ultima_visualizacao_em", None)),
        "visualizacoes": int(out.pop("proposta_cliente_visualizacoes", 0) or 0),
        "aprovado_em": iso(out.pop("proposta_cliente_aprovado_em", None)),
        "alteracao_solicitada_em": iso(out.pop("proposta_cliente_alteracao_solicitada_em", None)),
        "alteracao_mensagem": out.pop("proposta_cliente_alteracao_mensagem", None),
        "cadastro_contrato": {
            "status": out.pop("proposta_cliente_cadastro_status", "nao_iniciado") or "nao_iniciado",
            "iniciado_em": iso(out.pop("proposta_cliente_cadastro_iniciado_em", None)),
            "concluido_em": iso(out.pop("proposta_cliente_cadastro_concluido_em", None)),
            "tipo_pessoa": out.pop("proposta_cliente_cadastro_tipo_pessoa", None),
        },
        "contrato": {
            "status": out.pop("proposta_cliente_contrato_status", "nao_gerado") or "nao_gerado",
            "versao": int(out.pop("proposta_cliente_contrato_versao", 0) or 0),
            "gerado_em": iso(out.pop("proposta_cliente_contrato_gerado_em", None)),
            "assinatura": {
                "status": out.pop("proposta_cliente_assinatura_status", "nao_enviado") or "nao_enviado",
                "solicitada_em": iso(out.pop("proposta_cliente_assinatura_solicitada_em", None)),
                "visualizado_em": iso(out.pop("proposta_cliente_assinatura_visualizado_em", None)),
                "assinado_em": iso(out.pop("proposta_cliente_assinatura_assinado_em", None)),
                "assinatura_id": out.pop("proposta_cliente_assinatura_id", None),
            },
        },
    }
    out.pop("proposta_cliente_link_gerado_por_id", None)
    out.pop("proposta_cliente_link_desativado_em", None)
    out.pop("proposta_cliente_link_desativado_por_id", None)
    out.pop("proposta_cliente_snapshot_json", None)
    out.pop("proposta_cliente_snapshot_orcamento_atualizado_em", None)
    out.pop("proposta_cliente_aprovado_ip", None)
    out.pop("proposta_cliente_alteracao_ip", None)
    out.pop("proposta_cliente_cadastro_ip", None)
    out.pop("proposta_cliente_contrato_gerado_por_id", None)
    out.pop("proposta_cliente_contrato_snapshot_json", None)
    out.pop("proposta_cliente_contrato_cliente_atualizado_em", None)
    out.pop("proposta_cliente_assinatura_enviado_por_id", None)
    out.pop("proposta_cliente_assinatura_cancelado_em", None)
    out.pop("proposta_cliente_assinante_nome", None)
    out.pop("proposta_cliente_assinante_documento_mascarado", None)
    out.pop("proposta_cliente_assinatura_documento_hash_sha256", None)
    out.pop("proposta_cliente_assinatura_pdf_final_hash_sha256", None)
    out.pop("proposta_cliente_assinatura_evidencias_json", None)
    out["pode_ver_custos"] = show_costs
    if complete:
        items = serialize_items(
            db,
            int(out["id"]),
            show_costs,
            company_id=int(out.get("empresa_id") or getattr(user, "empresa_id", 0) or 0),
        )
        out["itens"] = items

        if show_costs:
            live_cost_total = sum((money(item.get("custo_total")) for item in items), Decimal("0"))
            total = max(money(out.get("total")), Decimal("0"))
            live_profit = total - live_cost_total
            live_margin = (live_profit / total * Decimal("100")) if total > 0 else Decimal("0")
            missing = sum(1 for item in items if item.get("custo_informado") is False)
            out["custo_total"] = dec_out(q2(live_cost_total))
            out["lucro_total"] = dec_out(q2(live_profit))
            out["margem_percentual"] = dec_out(q2(live_margin))
            out["itens_sem_custo"] = missing
            out["analise_confiavel"] = missing == 0

        history = db.execute(text("""
            SELECT id, usuario_id, usuario_nome, acao, status_anterior, status_novo, descricao, dados_json, criado_em
            FROM orcamento_historico WHERE orcamento_id=:o ORDER BY criado_em DESC, id DESC
        """), {"o": out["id"]}).mappings().all()
        out["historico"] = [{
            **dict(h),
            "dados": json_load(h.get("dados_json"), {}),
            "criado_em": iso(h["criado_em"]),
        } for h in history]
    return out


def base_select() -> str:
    return """
        SELECT o.*,
               c.codigo AS cliente_codigo,
               COALESCE(c.nome_fantasia, c.nome) AS cliente_nome,
               COALESCE(o.cliente_nome_documento, c.nome) AS cliente_razao_social,
               COALESCE(o.cliente_nome_fantasia_documento, c.nome_fantasia) AS cliente_nome_fantasia,
               COALESCE(o.cliente_cpf_cnpj, c.cpf_cnpj) AS cliente_documento,
               COALESCE(o.cliente_rg_ie, c.rg_ie) AS cliente_rg_ie_documento,
               COALESCE(o.cliente_telefone, c.telefone) AS cliente_telefone_documento,
               COALESCE(o.cliente_whatsapp_documento, c.whatsapp, c.telefone) AS cliente_whatsapp,
               COALESCE(o.cliente_fax, c.fax) AS cliente_fax_documento,
               COALESCE(o.cliente_email_nfe, c.email_nfe, c.email) AS cliente_email_nfe_documento,
               COALESCE(o.cliente_contato_nome, c.contato) AS cliente_contato_documento,
               c.email AS cliente_email,
               u.nome AS consultor_nome,
               u.telefone AS consultor_telefone,
               cat.nome AS categoria_nome,
               m.nome AS modelo_nome
        FROM orcamentos o
        LEFT JOIN clientes c ON c.id=o.cliente_id AND c.empresa_id=o.empresa_id
        LEFT JOIN usuarios u ON u.id=o.consultor_id AND u.empresa_id=o.empresa_id
        LEFT JOIN orcamento_categorias cat ON cat.id=o.categoria_id AND cat.empresa_id=o.empresa_id
        LEFT JOIN orcamento_modelos m ON m.id=o.modelo_id AND m.empresa_id=o.empresa_id
    """


@router.get("/meta")
def meta(
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    config = get_config_row(db, company_id)
    config_out = dict(config)
    config_out["margem_minima"] = dec_out(config.get("margem_minima"))
    config_out["formas_pagamento"] = json_load(config_out.pop("formas_pagamento_json", None), [])
    emitters = db.execute(text("""
        SELECT * FROM orcamento_emitentes
        WHERE empresa_id=:empresa_id AND ativo=TRUE
        ORDER BY padrao DESC, nome ASC, id ASC
    """), {"empresa_id": company_id}).mappings().all()
    return {
        "pode_ver_custos": can_view_costs(current_user, db),
        "pode_configurar": can_manage_settings(current_user),
        "usuario": {"id": int(current_user.id), "nome": current_user.nome, "papel": current_user.papel, "email": current_user.email},
        "modelos_proposta_monitoramento_habilitados": can_use_nilson_proposal_models(current_user),
        "configuracao": config_out,
        "emitentes": [serialize_emitter(dict(row)) for row in emitters],
    }


@router.get("/proximo-codigo")
def get_next_code(
    current_user: models.Usuario = Depends(require_permission("orcamentos", "criar")),
    db: Session = Depends(get_db),
):
    return {"codigo": preview_next_code(db, int(current_user.empresa_id))}


@router.get("")
def list_budgets(
    busca: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    where = ["o.empresa_id=:e"]
    params: Dict[str, Any] = {"e": company_id}
    if norm_str(busca):
        where.append("(o.codigo ILIKE :q OR o.titulo ILIKE :q OR c.nome ILIKE :q OR c.nome_fantasia ILIKE :q)")
        params["q"] = f"%{str(busca).strip()}%"
    if norm_str(status_filter):
        where.append("o.status=:s")
        params["s"] = status_norm(status_filter)

    where_sql = " WHERE " + " AND ".join(where)
    show_costs = can_view_costs(current_user, db)

    if paginated:
        count_sql = """
            SELECT COUNT(*)
            FROM orcamentos o
            LEFT JOIN clientes c ON c.id=o.cliente_id AND c.empresa_id=o.empresa_id
        """ + where_sql
        total = int(db.execute(text(count_sql), params).scalar() or 0)

        page_params = {**params, "limit": limit, "offset": offset}
        rows = db.execute(
            text(
                base_select()
                + where_sql
                + " ORDER BY o.data_emissao DESC, o.id DESC LIMIT :limit OFFSET :offset"
            ),
            page_params,
        ).mappings().all()

        summary = db.execute(text("""
            SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE status='rascunho')::INTEGER AS rascunhos,
                COUNT(*) FILTER (WHERE status IN ('enviado', 'em_negociacao'))::INTEGER AS negociacao,
                COALESCE(SUM(CASE WHEN status='aprovado' THEN total ELSE 0 END), 0) AS aprovado_total
            FROM orcamentos
            WHERE empresa_id=:empresa_id
        """), {"empresa_id": company_id}).mappings().one()

        items = [
            serialize_budget(
                db,
                dict(row),
                current_user,
                complete=False,
                show_costs_override=show_costs,
            )
            for row in rows
        ]
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
            "summary": {
                "total": int(summary.get("total") or 0),
                "rascunhos": int(summary.get("rascunhos") or 0),
                "negociacao": int(summary.get("negociacao") or 0),
                "aprovado_total": dec_out(summary.get("aprovado_total")),
            },
        }

    rows = db.execute(
        text(base_select() + where_sql + " ORDER BY o.data_emissao DESC, o.id DESC"),
        params,
    ).mappings().all()
    return [
        serialize_budget(
            db,
            dict(row),
            current_user,
            complete=False,
            show_costs_override=show_costs,
        )
        for row in rows
    ]


@router.get("/configuracao")
def get_settings(
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    row = get_config_row(db, int(current_user.empresa_id))
    row["margem_minima"] = dec_out(row.get("margem_minima"))
    row["formas_pagamento"] = json_load(row.pop("formas_pagamento_json", None), [])
    for key in ("criado_em", "atualizado_em"):
        row[key] = iso(row.get(key))
    return row


@router.put("/configuracao")
def update_settings(
    payload: SettingsIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    prefix = re.sub(r"[^A-Za-z0-9_-]", "", payload.prefixo.upper())[:20] or "ORC"
    document_model = payload.modelo_documento if payload.modelo_documento in {"padrao", "dav"} else "padrao"
    settings_data = payload.model_dump(exclude={"formas_pagamento", "prefixo", "modelo_documento"}) if hasattr(payload, "model_dump") else payload.dict(exclude={"formas_pagamento", "prefixo", "modelo_documento"})
    db.execute(text("""
        UPDATE orcamento_configuracoes SET
            nome_documento=:nome_documento, prefixo=:prefixo,
            modelo_documento=:modelo_documento, dav_titulo=:dav_titulo,
            cabecalho_razao_social=:cabecalho_razao_social,
            cabecalho_nome_fantasia=:cabecalho_nome_fantasia,
            cabecalho_cnpj=:cabecalho_cnpj,
            cabecalho_email=:cabecalho_email,
            cabecalho_site=:cabecalho_site,
            cabecalho_telefone=:cabecalho_telefone,
            cabecalho_endereco=:cabecalho_endereco,
            cabecalho_rodape=:cabecalho_rodape,
            validade_padrao_dias=:validade_padrao_dias,
            prazo_execucao_padrao=:prazo_execucao_padrao,
            condicoes_padrao=:condicoes_padrao,
            observacoes_padrao=:observacoes_padrao,
            rodape_padrao=:rodape_padrao,
            cor_primaria=:cor_primaria,
            titulo_capa=:titulo_capa,
            subtitulo_capa=:subtitulo_capa,
            usar_capa=:usar_capa,
            escala_documento_padrao=:escala_documento_padrao,
            mostrar_codigo=:mostrar_codigo,
            mostrar_desconto=:mostrar_desconto,
            mostrar_imagens=:mostrar_imagens,
            controlar_custos=:controlar_custos,
            margem_minima=:margem_minima,
            exigir_aprovacao_margem=:exigir_aprovacao_margem,
            formas_pagamento_json=:formas,
            atualizado_em=NOW()
        WHERE empresa_id=:empresa_id
    """), {
        **settings_data,
        "prefixo": prefix,
        "modelo_documento": document_model,
        "margem_minima": q2(money(payload.margem_minima)),
        "formas": json_dump(payload.formas_pagamento),
        "empresa_id": company_id,
    })
    db.commit()
    return get_settings(current_user=current_user, db=db)


@router.get("/emitentes")
def list_emitters(
    incluir_inativos: bool = False,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    where = "empresa_id=:empresa_id"
    if not incluir_inativos:
        where += " AND ativo=TRUE"
    rows = db.execute(text(f"""
        SELECT * FROM orcamento_emitentes WHERE {where}
        ORDER BY padrao DESC, nome ASC, id ASC
    """), {"empresa_id": company_id}).mappings().all()
    return [serialize_emitter(dict(row)) for row in rows]


@router.post("/emitentes", status_code=status.HTTP_201_CREATED)
def create_emitter(
    payload: EmitenteIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    name = norm_str(payload.nome)
    legal_name = norm_str(payload.razao_social)
    if not name or not legal_name:
        raise HTTPException(status_code=422, detail="Informe o nome e a razão social da empresa emitente.")
    if payload.padrao and not payload.ativo:
        raise HTTPException(status_code=422, detail="A empresa emitente padrão precisa estar ativa.")
    active_count = db.execute(text("SELECT COUNT(*) FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE"), {"e": company_id}).scalar() or 0
    if not payload.ativo and active_count == 0:
        raise HTTPException(status_code=422, detail="Mantenha ao menos uma empresa emitente ativa.")
    try:
        if payload.padrao:
            db.execute(text("UPDATE orcamento_emitentes SET padrao=FALSE WHERE empresa_id=:empresa_id"), {"empresa_id": company_id})
        emitter_id = db.execute(text("""
            INSERT INTO orcamento_emitentes (
                empresa_id, nome, razao_social, nome_fantasia, cnpj, inscricao_estadual,
                email, site, telefone, cep, endereco, numero, complemento, bairro, cidade, estado,
                logo_url, rodape, padrao, ativo
            ) VALUES (
                :empresa_id, :nome, :razao_social, :nome_fantasia, :cnpj, :inscricao_estadual,
                :email, :site, :telefone, :cep, :endereco, :numero, :complemento, :bairro, :cidade, :estado,
                :logo_url, :rodape, :padrao, :ativo
            ) RETURNING id
        """), {
            **(payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()),
            "empresa_id": company_id,
            "nome": name,
            "razao_social": legal_name,
        }).scalar_one()
        if not db.execute(text("SELECT 1 FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE AND padrao=TRUE"), {"e": company_id}).scalar():
            default_id = db.execute(text("""
                SELECT id FROM orcamento_emitentes
                WHERE empresa_id=:e AND ativo=TRUE
                ORDER BY id ASC LIMIT 1
            """), {"e": company_id}).scalar()
            if default_id:
                db.execute(text("UPDATE orcamento_emitentes SET padrao=(id=:id) WHERE empresa_id=:e"), {"id": int(default_id), "e": company_id})
        db.commit()
        row = db.execute(text("SELECT * FROM orcamento_emitentes WHERE id=:id AND empresa_id=:e"), {"id": emitter_id, "e": company_id}).mappings().one()
        return serialize_emitter(dict(row))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma empresa emitente com esse nome.")


@router.put("/emitentes/{emitter_id}")
def update_emitter(
    emitter_id: int,
    payload: EmitenteIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    existing = db.execute(text("SELECT id, padrao, ativo FROM orcamento_emitentes WHERE id=:id AND empresa_id=:e"), {"id": emitter_id, "e": company_id}).mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail="Empresa emitente não encontrada.")
    name = norm_str(payload.nome)
    legal_name = norm_str(payload.razao_social)
    if not name or not legal_name:
        raise HTTPException(status_code=422, detail="Informe o nome e a razão social da empresa emitente.")
    if payload.padrao and not payload.ativo:
        raise HTTPException(status_code=422, detail="A empresa emitente padrão precisa estar ativa.")
    if bool(existing.get("ativo", True)) and not payload.ativo:
        active_count = db.execute(text("SELECT COUNT(*) FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE"), {"e": company_id}).scalar() or 0
        if active_count <= 1:
            raise HTTPException(status_code=422, detail="Mantenha ao menos uma empresa emitente ativa.")
    try:
        if payload.padrao:
            db.execute(text("UPDATE orcamento_emitentes SET padrao=FALSE WHERE empresa_id=:empresa_id"), {"empresa_id": company_id})
        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        if not payload.ativo:
            data["padrao"] = False
        db.execute(text("""
            UPDATE orcamento_emitentes SET
                nome=:nome, razao_social=:razao_social, nome_fantasia=:nome_fantasia, cnpj=:cnpj,
                inscricao_estadual=:inscricao_estadual, email=:email, site=:site, telefone=:telefone,
                cep=:cep, endereco=:endereco, numero=:numero, complemento=:complemento, bairro=:bairro,
                cidade=:cidade, estado=:estado, logo_url=:logo_url, rodape=:rodape,
                padrao=:padrao, ativo=:ativo, atualizado_em=NOW()
            WHERE id=:id AND empresa_id=:empresa_id
        """), {**data, "nome": name, "razao_social": legal_name, "id": emitter_id, "empresa_id": company_id})
        default_id = db.execute(text("""
            SELECT id FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE
            ORDER BY padrao DESC, id ASC LIMIT 1
        """), {"e": company_id}).scalar()
        if default_id:
            db.execute(text("UPDATE orcamento_emitentes SET padrao=(id=:id) WHERE empresa_id=:e"), {"id": int(default_id), "e": company_id})
        db.commit()
        row = db.execute(text("SELECT * FROM orcamento_emitentes WHERE id=:id AND empresa_id=:e"), {"id": emitter_id, "e": company_id}).mappings().one()
        return serialize_emitter(dict(row))
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma empresa emitente com esse nome.")


@router.delete("/emitentes/{emitter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_emitter(
    emitter_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    row = db.execute(text("SELECT id, padrao, ativo FROM orcamento_emitentes WHERE id=:id AND empresa_id=:e"), {"id": emitter_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Empresa emitente não encontrada.")
    if row.get("ativo") is False:
        return None
    active_count = db.execute(text("SELECT COUNT(*) FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE"), {"e": company_id}).scalar() or 0
    if active_count <= 1:
        raise HTTPException(status_code=422, detail="Mantenha ao menos uma empresa emitente ativa.")
    db.execute(text("UPDATE orcamento_emitentes SET ativo=FALSE, padrao=FALSE, atualizado_em=NOW() WHERE id=:id AND empresa_id=:e"), {"id": emitter_id, "e": company_id})
    default_id = db.execute(text("SELECT id FROM orcamento_emitentes WHERE empresa_id=:e AND ativo=TRUE ORDER BY id LIMIT 1"), {"e": company_id}).scalar()
    if default_id:
        db.execute(text("UPDATE orcamento_emitentes SET padrao=(id=:id) WHERE empresa_id=:e"), {"id": int(default_id), "e": company_id})
    db.commit()
    return None


@router.get("/produtos")
def search_budget_products(
    busca: Optional[str] = Query(default=None),
    codigo_exato: Optional[str] = Query(default=None, max_length=120),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    where = ["empresa_id=:empresa_id", "ativo=TRUE"]
    params: Dict[str, Any] = {"empresa_id": company_id}
    exact_code = norm_str(codigo_exato)
    if exact_code:
        where.append("LOWER(TRIM(codigo))=LOWER(:codigo_exato)")
        params["codigo_exato"] = exact_code
    elif norm_str(busca):
        where.append("(codigo ILIKE :q OR nome ILIKE :q OR descricao ILIKE :q OR categoria ILIKE :q)")
        params["q"] = f"%{str(busca).strip()}%"
    clause = " AND ".join(where)

    # A collation padrão do PostgreSQL pode ignorar pontuação e ordenar números
    # como texto. Buscamos o conjunto filtrado, aplicamos a mesma ordem natural
    # usada pela interface e somente depois recortamos a página solicitada.
    all_rows = db.execute(text(f"""
        SELECT id, codigo, nome, descricao, categoria, unidade, preco_venda, custo, estoque_atual
        FROM produtos
        WHERE {clause}
        ORDER BY id ASC
    """), params).mappings().all()
    ordered_rows = sorted(
        all_rows,
        key=lambda row: (natural_sort_key(row.get("nome")), int(row.get("id") or 0)),
    )
    total = len(ordered_rows)
    rows = apply_product_cost_fallbacks(
        db,
        company_id,
        ordered_rows[offset:offset + limit],
    )

    show_cost = can_view_costs(current_user, db)
    items = []
    for row in rows:
        item = dict(row)
        if not show_cost:
            item.pop("custo", None)
        items.append(item)
    return {
        "items": items,
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }


@router.post("/calcular")
def calculate_budget_preview(
    payload: CalculationIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    items, partial = calculate_items(db, company_id, current_user, payload.itens)
    totals = calculate_totals(payload, partial["subtotal"], partial["custo_total"])
    result = {key: dec_out(value) if isinstance(value, Decimal) else value for key, value in totals.items()}
    result["itens_sem_custo"] = int(partial.get("itens_sem_custo") or 0)
    result["analise_confiavel"] = result["itens_sem_custo"] == 0
    result["itens"] = [{
        **item,
        "quantidade": dec4_out(item.get("quantidade")),
        "valor_unitario": dec4_out(item.get("valor_unitario")),
        "desconto": dec4_out(item.get("desconto")),
        "valor_total": dec_out(item.get("valor_total")),
        "custo_unitario": dec4_out(item.get("custo_unitario")),
        "custo_total": dec_out(item.get("custo_total")),
        "lucro_total": dec_out(item.get("lucro_total")),
        "margem_percentual": dec_out(item.get("margem_percentual")),
    } for item in items]
    if not can_view_costs(current_user, db):
        for key in ("custo_total", "lucro_total", "margem_percentual", "itens_sem_custo", "analise_confiavel"):
            result.pop(key, None)
        for item in result["itens"]:
            for key in ("custo_unitario", "custo_total", "lucro_total", "margem_percentual", "custo_informado"):
                item.pop(key, None)
    return result


@router.get("/categorias")
def list_categories(
    incluir_inativas: bool = False,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    sql = "SELECT * FROM orcamento_categorias WHERE empresa_id=:e"
    if not incluir_inativas:
        sql += " AND ativo=TRUE"
    sql += " ORDER BY ordem, nome"
    rows = db.execute(text(sql), {"e": company_id}).mappings().all()
    return [{**dict(row), "criado_em": iso(row["criado_em"]), "atualizado_em": iso(row["atualizado_em"])} for row in rows]


@router.post("/categorias", status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome da categoria.")
    try:
        row = db.execute(text("""
            INSERT INTO orcamento_categorias (empresa_id, nome, descricao, ativo, ordem)
            VALUES (:e, :n, :d, :a, :o) RETURNING *
        """), {"e": company_id, "n": name, "d": norm_str(payload.descricao), "a": payload.ativo, "o": payload.ordem}).mappings().one()
        db.commit()
        return dict(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma categoria com esse nome.")


@router.put("/categorias/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome da categoria.")
    try:
        row = db.execute(text("""
            UPDATE orcamento_categorias SET nome=:n, descricao=:d, ativo=:a, ordem=:o, atualizado_em=NOW()
            WHERE id=:id AND empresa_id=:e RETURNING *
        """), {"n": name, "d": norm_str(payload.descricao), "a": payload.ativo, "o": payload.ordem, "id": category_id, "e": company_id}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="Categoria não encontrada.")
        db.commit()
        return dict(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma categoria com esse nome.")


@router.delete("/categorias/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    found = db.execute(text("DELETE FROM orcamento_categorias WHERE id=:id AND empresa_id=:e RETURNING id"), {"id": category_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    db.commit()
    return None


def template_to_out(db: Session, row: dict, show_costs: bool, with_items: bool = True) -> dict:
    out = dict(row)
    out["pagamentos"] = json_load(out.pop("pagamentos_json", None), [])
    out["criado_em"] = iso(out.get("criado_em"))
    out["atualizado_em"] = iso(out.get("atualizado_em"))
    if with_items:
        items = db.execute(text("SELECT * FROM orcamento_modelo_itens WHERE modelo_id=:m ORDER BY ordem, id"), {"m": out["id"]}).mappings().all()
        product_ids = sorted({
            int(item.get("produto_id") or 0)
            for item in items
            if int(item.get("produto_id") or 0) > 0
        })
        live_products: Dict[int, dict] = {}
        if product_ids:
            product_rows = db.execute(text("""
                SELECT id, codigo, nome, descricao, unidade, preco_venda, custo
                FROM produtos
                WHERE empresa_id=:empresa_id AND id IN :product_ids
            """).bindparams(bindparam("product_ids", expanding=True)), {
                "empresa_id": int(out.get("empresa_id") or 0),
                "product_ids": product_ids,
            }).mappings().all()
            product_rows = apply_product_cost_fallbacks(
                db,
                int(out.get("empresa_id") or 0),
                product_rows,
            )
            live_products = {int(product["id"]): product for product in product_rows}

        result = []
        for item in items:
            obj = dict(item)
            product = live_products.get(int(obj.get("produto_id") or 0))
            if product:
                # Modelos guardam a composição e a quantidade, mas preços de
                # produtos devem sempre refletir a Formação de Preços (Tab-01).
                # Itens manuais continuam usando os valores gravados no modelo.
                obj["codigo"] = product.get("codigo") or obj.get("codigo")
                obj["descricao"] = product.get("nome") or obj.get("descricao")
                obj["referencia"] = product.get("descricao") or obj.get("referencia")
                obj["unidade"] = product.get("unidade") or obj.get("unidade") or "UN"
                if product.get("preco_venda") is not None and str(product.get("preco_venda")).strip() != "":
                    obj["valor_unitario"] = product.get("preco_venda")
                if product.get("custo") is not None and str(product.get("custo")).strip() != "":
                    obj["custo_unitario"] = product.get("custo")
            for key in ("quantidade", "valor_unitario"):
                obj[key] = dec_out(obj.get(key))
            if show_costs:
                obj["custo_unitario"] = dec_out(obj.get("custo_unitario"))
            else:
                obj.pop("custo_unitario", None)
            result.append(obj)
        out["itens"] = result
    return out


@router.get("/modelos")
def list_templates(
    incluir_inativos: bool = False,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    sql = """
        SELECT m.*, c.nome AS categoria_nome
        FROM orcamento_modelos m LEFT JOIN orcamento_categorias c ON c.id=m.categoria_id
        WHERE m.empresa_id=:e
    """
    if not incluir_inativos:
        sql += " AND m.ativo=TRUE"
    sql += " ORDER BY m.nome"
    rows = db.execute(text(sql), {"e": company_id}).mappings().all()
    return [template_to_out(db, dict(r), can_view_costs(current_user, db), with_items=False) for r in rows]


@router.get("/modelos/{template_id}")
def get_template(
    template_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = db.execute(text("""
        SELECT m.*, c.nome AS categoria_nome
        FROM orcamento_modelos m LEFT JOIN orcamento_categorias c ON c.id=m.categoria_id
        WHERE m.id=:id AND m.empresa_id=:e
    """), {"id": template_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return template_to_out(db, dict(row), can_view_costs(current_user, db), with_items=True)


def save_template_items(db: Session, template_id: int, company_id: int, user: models.Usuario, items: List[BudgetItemIn]) -> None:
    db.execute(text("DELETE FROM orcamento_modelo_itens WHERE modelo_id=:m"), {"m": template_id})
    normalized, _ = calculate_items(db, company_id, user, items)
    for item in normalized:
        db.execute(text("""
            INSERT INTO orcamento_modelo_itens (
                modelo_id, produto_id, codigo, descricao, referencia, unidade,
                quantidade, valor_unitario, custo_unitario, observacao, ordem
            ) VALUES (:modelo_id, :produto_id, :codigo, :descricao, :referencia, :unidade,
                      :quantidade, :valor_unitario, :custo_unitario, :observacao, :ordem)
        """), {"modelo_id": template_id, **{k: item[k] for k in ("produto_id", "codigo", "descricao", "referencia", "unidade", "quantidade", "valor_unitario", "custo_unitario", "observacao", "ordem")}})


@router.post("/modelos", status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    validate_company_fk(db, "orcamento_categorias", payload.categoria_id, company_id, "Categoria")
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome do modelo.")
    try:
        row = db.execute(text("""
            INSERT INTO orcamento_modelos (
                empresa_id, categoria_id, nome, titulo, descricao, validade_dias,
                prazo_execucao, condicoes, observacoes, pagamentos_json, ativo
            ) VALUES (:e, :c, :n, :t, :d, :v, :p, :co, :o, :pg, :a) RETURNING *
        """), {
            "e": company_id, "c": payload.categoria_id, "n": name, "t": norm_str(payload.titulo),
            "d": norm_str(payload.descricao), "v": payload.validade_dias, "p": norm_str(payload.prazo_execucao),
            "co": norm_str(payload.condicoes), "o": norm_str(payload.observacoes), "pg": json_dump([p.model_dump() if hasattr(p, "model_dump") else p.dict() for p in payload.pagamentos]), "a": payload.ativo,
        }).mappings().one()
        save_template_items(db, int(row["id"]), company_id, current_user, payload.itens)
        db.commit()
        return get_template(int(row["id"]), current_user=current_user, db=db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um modelo com esse nome.")


@router.put("/modelos/{template_id}")
def update_template(
    template_id: int,
    payload: TemplateIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    validate_company_fk(db, "orcamento_categorias", payload.categoria_id, company_id, "Categoria")
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome do modelo.")
    try:
        row = db.execute(text("""
        UPDATE orcamento_modelos SET categoria_id=:c, nome=:n, titulo=:t, descricao=:d,
            validade_dias=:v, prazo_execucao=:p, condicoes=:co, observacoes=:o,
            pagamentos_json=:pg, ativo=:a, atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:e RETURNING id
        """), {
            "c": payload.categoria_id, "n": name, "t": norm_str(payload.titulo), "d": norm_str(payload.descricao),
            "v": payload.validade_dias, "p": norm_str(payload.prazo_execucao), "co": norm_str(payload.condicoes),
            "o": norm_str(payload.observacoes), "pg": json_dump([p.model_dump() if hasattr(p, "model_dump") else p.dict() for p in payload.pagamentos]),
            "a": payload.ativo, "id": template_id, "e": company_id,
        }).scalar()
        if not row:
            raise HTTPException(status_code=404, detail="Modelo não encontrado.")
        save_template_items(db, template_id, company_id, current_user, payload.itens)
        db.commit()
        return get_template(template_id, current_user=current_user, db=db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um modelo com esse nome.")


@router.delete("/modelos/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    found = db.execute(text("DELETE FROM orcamento_modelos WHERE id=:id AND empresa_id=:e RETURNING id"), {"id": template_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    db.commit()
    return None


def kit_to_out(db: Session, row: dict, show_costs: bool, with_items: bool = True) -> dict:
    out = dict(row)
    out["criado_em"] = iso(out.get("criado_em"))
    out["atualizado_em"] = iso(out.get("atualizado_em"))
    out["itens_quantidade"] = int(out.get("itens_quantidade") or 0)
    out["valor_estimado"] = dec_out(out.get("valor_estimado"))

    if with_items:
        rows = db.execute(text("""
            SELECT ki.id, ki.produto_id, ki.quantidade, ki.ordem,
                   p.codigo, p.nome, p.descricao AS produto_descricao,
                   p.unidade, p.preco_venda, p.custo
            FROM orcamento_kit_itens ki
            JOIN produtos p ON p.id=ki.produto_id
            WHERE ki.kit_id=:kit_id
            ORDER BY ki.ordem, ki.id
        """), {"kit_id": out["id"]}).mappings().all()
        rows = apply_product_cost_fallbacks(
            db,
            int(out.get("empresa_id") or 0),
            rows,
            product_id_key="produto_id",
        )
        items = []
        for item in rows:
            obj = {
                "id": item["id"],
                "produto_id": item["produto_id"],
                "origem": "produto",
                "codigo": item.get("codigo"),
                "descricao": item.get("nome") or "Produto",
                "referencia": item.get("produto_descricao"),
                "unidade": item.get("unidade") or "UN",
                "quantidade": dec4_out(item.get("quantidade")),
                "valor_unitario": dec_out(item.get("preco_venda")),
                "desconto": "0.00",
                "ordem": int(item.get("ordem") or 0),
            }
            if show_costs:
                obj["custo_unitario"] = dec_out(item.get("custo"))
            items.append(obj)
        out["itens"] = items
        out["itens_quantidade"] = len(items)
        out["valor_estimado"] = dec_out(sum(
            (money(item.get("quantidade")) * money(item.get("preco_venda")) for item in rows),
            Decimal("0"),
        ))
    return out


def get_kit_row(db: Session, kit_id: int, company_id: int):
    # preco_venda é VARCHAR no cadastro de produtos. O valor estimado é
    # recalculado em Python por kit_to_out(), usando money(), para aceitar
    # formatos como "150,00", "1.234,56" e "R$ 150,00" sem cast inválido.
    return db.execute(text("""
        SELECT k.*,
               COUNT(ki.id)::INTEGER AS itens_quantidade,
               0::NUMERIC AS valor_estimado
        FROM orcamento_kits k
        LEFT JOIN orcamento_kit_itens ki ON ki.kit_id=k.id
        WHERE k.id=:id AND k.empresa_id=:empresa_id
        GROUP BY k.id
    """), {"id": kit_id, "empresa_id": company_id}).mappings().first()


def save_kit_items(db: Session, kit_id: int, company_id: int, items: List[KitItemIn]) -> None:
    db.execute(text("DELETE FROM orcamento_kit_itens WHERE kit_id=:kit_id"), {"kit_id": kit_id})

    merged: Dict[int, dict] = {}
    for index, item in enumerate(items or []):
        product_id = int(item.produto_id)
        product = product_for_company(db, product_id, company_id)
        if not product:
            raise HTTPException(status_code=422, detail=f"Produto #{product_id} não pertence a esta empresa ou não existe.")
        quantity = q4(max(money(item.quantidade, Decimal("1")), Decimal("0.0001")))
        if product_id in merged:
            merged[product_id]["quantidade"] = q4(merged[product_id]["quantidade"] + quantity)
        else:
            merged[product_id] = {
                "produto_id": product_id,
                "quantidade": quantity,
                "ordem": int(item.ordem if item.ordem is not None else index),
            }

    for values in sorted(merged.values(), key=lambda current: current["ordem"]):
        db.execute(text("""
            INSERT INTO orcamento_kit_itens (kit_id, produto_id, quantidade, ordem)
            VALUES (:kit_id, :produto_id, :quantidade, :ordem)
        """), {"kit_id": kit_id, **values})


@router.get("/kits")
def list_kits(
    incluir_inativos: bool = False,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    sql = """
        SELECT k.*,
               COUNT(ki.id)::INTEGER AS itens_quantidade,
               0::NUMERIC AS valor_estimado
        FROM orcamento_kits k
        LEFT JOIN orcamento_kit_itens ki ON ki.kit_id=k.id
        WHERE k.empresa_id=:empresa_id
    """
    if not incluir_inativos:
        sql += " AND k.ativo=TRUE"
    sql += " GROUP BY k.id ORDER BY k.nome"
    rows = db.execute(text(sql), {"empresa_id": company_id}).mappings().all()

    # O preço de venda é armazenado como texto no módulo de Produtos.
    # Calculamos em Python com money() para suportar vírgula, ponto e "R$"
    # sem tentar multiplicar NUMERIC por VARCHAR no PostgreSQL.
    totals_sql = """
        SELECT ki.kit_id, ki.quantidade, p.preco_venda
        FROM orcamento_kit_itens ki
        JOIN orcamento_kits k ON k.id=ki.kit_id
        JOIN produtos p ON p.id=ki.produto_id
        WHERE k.empresa_id=:empresa_id
    """
    if not incluir_inativos:
        totals_sql += " AND k.ativo=TRUE"

    totals: Dict[int, Decimal] = {}
    price_rows = db.execute(text(totals_sql), {"empresa_id": company_id}).mappings().all()
    for item in price_rows:
        current_kit_id = int(item["kit_id"])
        item_total = money(item.get("quantidade")) * money(item.get("preco_venda"))
        totals[current_kit_id] = totals.get(current_kit_id, Decimal("0")) + item_total

    result = []
    show_costs = can_view_costs(current_user, db)
    for row in rows:
        obj = dict(row)
        obj["valor_estimado"] = totals.get(int(obj["id"]), Decimal("0"))
        result.append(kit_to_out(db, obj, show_costs, with_items=False))
    return result


@router.get("/kits/{kit_id}")
def get_kit(
    kit_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = get_kit_row(db, kit_id, company_id)
    if not row:
        raise HTTPException(status_code=404, detail="Kit de produtos não encontrado.")
    return kit_to_out(db, dict(row), can_view_costs(current_user, db), with_items=True)


@router.post("/kits", status_code=status.HTTP_201_CREATED)
def create_kit(
    payload: KitIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome do kit.")
    if not payload.itens:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um produto ao kit.")
    try:
        kit_id = db.execute(text("""
            INSERT INTO orcamento_kits (empresa_id, nome, descricao, ativo)
            VALUES (:empresa_id, :nome, :descricao, :ativo)
            RETURNING id
        """), {
            "empresa_id": company_id,
            "nome": name,
            "descricao": norm_str(payload.descricao),
            "ativo": payload.ativo,
        }).scalar_one()
        save_kit_items(db, int(kit_id), company_id, payload.itens)
        db.commit()
        return get_kit(int(kit_id), current_user=current_user, db=db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um kit com esse nome.")


@router.put("/kits/{kit_id}")
def update_kit(
    kit_id: int,
    payload: KitIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    name = norm_str(payload.nome)
    if not name:
        raise HTTPException(status_code=422, detail="Informe o nome do kit.")
    if not payload.itens:
        raise HTTPException(status_code=422, detail="Adicione pelo menos um produto ao kit.")
    try:
        found = db.execute(text("""
            UPDATE orcamento_kits
            SET nome=:nome, descricao=:descricao, ativo=:ativo, atualizado_em=NOW()
            WHERE id=:id AND empresa_id=:empresa_id
            RETURNING id
        """), {
            "nome": name,
            "descricao": norm_str(payload.descricao),
            "ativo": payload.ativo,
            "id": kit_id,
            "empresa_id": company_id,
        }).scalar()
        if not found:
            raise HTTPException(status_code=404, detail="Kit de produtos não encontrado.")
        save_kit_items(db, kit_id, company_id, payload.itens)
        db.commit()
        return get_kit(kit_id, current_user=current_user, db=db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um kit com esse nome.")


@router.post("/kits/{kit_id}/duplicar", status_code=status.HTTP_201_CREATED)
def duplicate_kit(
    kit_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    source = get_kit_row(db, kit_id, company_id)
    if not source:
        raise HTTPException(status_code=404, detail="Kit de produtos não encontrado.")

    base_name = f"{source['nome']} (cópia)"
    new_name = base_name
    suffix = 2
    while db.execute(text("SELECT 1 FROM orcamento_kits WHERE empresa_id=:empresa_id AND LOWER(nome)=LOWER(:nome)"), {
        "empresa_id": company_id,
        "nome": new_name,
    }).scalar():
        new_name = f"{base_name} {suffix}"
        suffix += 1

    new_id = db.execute(text("""
        INSERT INTO orcamento_kits (empresa_id, nome, descricao, ativo)
        VALUES (:empresa_id, :nome, :descricao, :ativo)
        RETURNING id
    """), {
        "empresa_id": company_id,
        "nome": new_name,
        "descricao": source.get("descricao"),
        "ativo": source.get("ativo", True),
    }).scalar_one()
    db.execute(text("""
        INSERT INTO orcamento_kit_itens (kit_id, produto_id, quantidade, ordem)
        SELECT :new_id, produto_id, quantidade, ordem
        FROM orcamento_kit_itens
        WHERE kit_id=:source_id
    """), {"new_id": new_id, "source_id": kit_id})
    db.commit()
    return get_kit(int(new_id), current_user=current_user, db=db)


@router.delete("/kits/{kit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_kit(
    kit_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    found = db.execute(text("""
        DELETE FROM orcamento_kits
        WHERE id=:id AND empresa_id=:empresa_id
        RETURNING id
    """), {"id": kit_id, "empresa_id": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Kit de produtos não encontrado.")
    db.commit()
    return None


def budget_row(db: Session, budget_id: int, company_id: int):
    return db.execute(text(base_select() + " WHERE o.id=:id AND o.empresa_id=:e"), {"id": budget_id, "e": company_id}).mappings().first()


@router.get("/{budget_id}")
def get_budget(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = budget_row(db, budget_id, company_id)
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    return serialize_budget(db, dict(row), current_user, complete=True)


def save_budget_items(db: Session, budget_id: int, items: List[dict]) -> None:
    db.execute(text("DELETE FROM orcamento_itens WHERE orcamento_id=:o"), {"o": budget_id})
    for item in items:
        db.execute(text("""
            INSERT INTO orcamento_itens (
                orcamento_id, produto_id, origem, codigo, descricao, referencia, unidade,
                quantidade, valor_unitario, desconto, valor_total, custo_unitario, custo_informado,
                custo_total, lucro_total, margem_percentual, observacao, ordem
            ) VALUES (
                :orcamento_id, :produto_id, :origem, :codigo, :descricao, :referencia, :unidade,
                :quantidade, :valor_unitario, :desconto, :valor_total, :custo_unitario, :custo_informado,
                :custo_total, :lucro_total, :margem_percentual, :observacao, :ordem
            )
        """), {"orcamento_id": budget_id, **item})


def payload_params(
    payload: BudgetBase,
    config: dict,
    totals: dict,
    snapshot: Optional[dict] = None,
    emitter: Optional[dict] = None,
    itens_sem_custo: int = 0,
) -> dict:
    snapshot = snapshot or {}
    emitter = emitter or {}
    emission = parse_date(payload.data_emissao, date.today())
    validity = parse_date(payload.data_validade)
    if not validity and int(config.get("validade_padrao_dias") or 0) > 0:
        validity = emission + timedelta(days=int(config["validade_padrao_dias"]))
    return {
        "cliente_id": payload.cliente_id,
        "consultor_id": payload.consultor_id,
        "categoria_id": payload.categoria_id,
        "modelo_id": payload.modelo_id,
        "titulo": norm_str(payload.titulo) or "Orçamento comercial",
        "nome_documento": norm_str(payload.nome_documento) or config.get("nome_documento") or "Orçamento",
        "status": status_norm(payload.status),
        "data_solicitacao": parse_date(payload.data_solicitacao),
        "data_emissao": emission,
        "data_validade": validity,
        "responsavel_cliente": norm_str(payload.responsavel_cliente),
        "contato_cliente": norm_str(payload.contato_cliente),
        "endereco_cep": norm_str(payload.endereco_cep) or snapshot.get("cliente_cep"),
        "endereco_logradouro": norm_str(payload.endereco_logradouro) or snapshot.get("cliente_endereco"),
        "endereco_numero": norm_str(payload.endereco_numero) or snapshot.get("cliente_numero"),
        "endereco_complemento": norm_str(payload.endereco_complemento) or snapshot.get("cliente_complemento"),
        "endereco_bairro": norm_str(payload.endereco_bairro) or snapshot.get("cliente_bairro"),
        "endereco_cidade": norm_str(payload.endereco_cidade) or snapshot.get("cliente_cidade"),
        "endereco_estado": norm_str(payload.endereco_estado) or snapshot.get("cliente_estado"),
        "cliente_nome_documento": snapshot.get("cliente_nome_documento"),
        "cliente_nome_fantasia_documento": snapshot.get("cliente_nome_fantasia_documento"),
        "cliente_cpf_cnpj": snapshot.get("cliente_cpf_cnpj"),
        "cliente_rg_ie": snapshot.get("cliente_rg_ie"),
        "cliente_telefone": snapshot.get("cliente_telefone"),
        "cliente_whatsapp_documento": snapshot.get("cliente_whatsapp_documento"),
        "cliente_fax": snapshot.get("cliente_fax"),
        "cliente_email_nfe": snapshot.get("cliente_email_nfe"),
        "cliente_contato_nome": snapshot.get("cliente_contato_nome"),
        **emitter,
        "itens_sem_custo": int(itens_sem_custo or 0),
        **totals,
        "prazo_execucao": norm_str(payload.prazo_execucao) or norm_str(config.get("prazo_execucao_padrao")),
        "condicoes": norm_str(payload.condicoes) or norm_str(config.get("condicoes_padrao")),
        "observacoes": norm_str(payload.observacoes) or norm_str(config.get("observacoes_padrao")),
        "proposta_modelo": norm_str(payload.proposta_modelo) or "padrao",
        "proposta_comercial_json": json_dump(payload.proposta_comercial or {}),
        "pagamentos_json": json_dump([p.model_dump(mode="json") if hasattr(p, "model_dump") else p.dict() for p in payload.pagamentos]),
        "usar_capa": bool(payload.usar_capa),
        "titulo_capa": norm_str(payload.titulo_capa) or norm_str(config.get("titulo_capa")),
        "subtitulo_capa": norm_str(payload.subtitulo_capa) or norm_str(config.get("subtitulo_capa")),
        "escala_documento": int(payload.escala_documento or config.get("escala_documento_padrao") or 100),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_budget(
    payload: BudgetCreate,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "criar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    validate_nilson_proposal_model_access(current_user, payload.proposta_modelo)
    for table, row_id, label in (
        ("clientes", payload.cliente_id, "Cliente"),
        ("usuarios", payload.consultor_id, "Consultor"),
        ("orcamento_categorias", payload.categoria_id, "Categoria"),
        ("orcamento_modelos", payload.modelo_id, "Modelo"),
    ):
        validate_company_fk(db, table, row_id, company_id, label)

    config = get_config_row(db, company_id)
    items, partial = calculate_items(db, company_id, current_user, payload.itens)
    totals = calculate_totals(payload, partial["subtotal"], partial["custo_total"])
    approval_needed = (
        bool(config.get("controlar_custos"))
        and bool(config.get("exigir_aprovacao_margem"))
        and totals["margem_percentual"] < money(config.get("margem_minima"))
    )
    snapshot = client_snapshot(db, payload.cliente_id, company_id)
    emitter = emitter_snapshot(db, payload.emitente_id, company_id)
    params = payload_params(
        payload, config, totals, snapshot, emitter,
        itens_sem_custo=int(partial.get("itens_sem_custo") or 0),
    )
    requested_approved = params["status"] == "aprovado"
    if requested_approved and bool(config.get("controlar_custos")) and params["itens_sem_custo"] > 0:
        raise HTTPException(
            status_code=422,
            detail=f"Informe o custo de todos os itens antes de aprovar. Há {params['itens_sem_custo']} item(ns) sem custo.",
        )
    manager_approval = bool(approval_needed and requested_approved and can_manage_settings(current_user))
    if approval_needed and requested_approved and not manager_approval:
        raise HTTPException(
            status_code=403,
            detail="Este orçamento precisa de aprovação gerencial por estar abaixo da margem mínima.",
        )
    approved_now = bool(requested_approved and (not approval_needed or manager_approval))
    code = consume_next_code(db, company_id)

    try:
        row = db.execute(text("""
            INSERT INTO orcamentos (
                empresa_id, cliente_id, usuario_criador_id, consultor_id, categoria_id, modelo_id,
                codigo, titulo, nome_documento, status, data_solicitacao, data_emissao, data_validade, data_aprovacao,
                responsavel_cliente, contato_cliente, endereco_cep, endereco_logradouro, endereco_numero,
                endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado,
                cliente_nome_documento, cliente_nome_fantasia_documento, cliente_cpf_cnpj, cliente_rg_ie,
                cliente_telefone, cliente_whatsapp_documento, cliente_fax, cliente_email_nfe, cliente_contato_nome,
                emitente_id, emitente_nome_documento, emitente_razao_social_documento, emitente_nome_fantasia_documento,
                emitente_cnpj_documento, emitente_ie_documento, emitente_email_documento, emitente_site_documento,
                emitente_telefone_documento, emitente_endereco_documento, emitente_logo_documento, emitente_rodape_documento,
                desconto_tipo, desconto_valor, desconto_total, frete, acrescimo, subtotal, total,
                custo_total, lucro_total, margem_percentual, itens_sem_custo, prazo_execucao, condicoes, observacoes,
                proposta_modelo, proposta_comercial_json,
                pagamentos_json, usar_capa, titulo_capa, subtitulo_capa, escala_documento, aprovacao_necessaria, aprovacao_status,
                aprovado_por_id, aprovado_em
            ) VALUES (
                :empresa_id, :cliente_id, :usuario_criador_id, :consultor_id, :categoria_id, :modelo_id,
                :codigo, :titulo, :nome_documento, :status, :data_solicitacao, :data_emissao, :data_validade, :data_aprovacao,
                :responsavel_cliente, :contato_cliente, :endereco_cep, :endereco_logradouro, :endereco_numero,
                :endereco_complemento, :endereco_bairro, :endereco_cidade, :endereco_estado,
                :cliente_nome_documento, :cliente_nome_fantasia_documento, :cliente_cpf_cnpj, :cliente_rg_ie,
                :cliente_telefone, :cliente_whatsapp_documento, :cliente_fax, :cliente_email_nfe, :cliente_contato_nome,
                :emitente_id, :emitente_nome_documento, :emitente_razao_social_documento, :emitente_nome_fantasia_documento,
                :emitente_cnpj_documento, :emitente_ie_documento, :emitente_email_documento, :emitente_site_documento,
                :emitente_telefone_documento, :emitente_endereco_documento, :emitente_logo_documento, :emitente_rodape_documento,
                :desconto_tipo, :desconto_valor, :desconto_total, :frete, :acrescimo, :subtotal, :total,
                :custo_total, :lucro_total, :margem_percentual, :itens_sem_custo, :prazo_execucao, :condicoes, :observacoes,
                :proposta_modelo, :proposta_comercial_json,
                :pagamentos_json, :usar_capa, :titulo_capa, :subtitulo_capa, :escala_documento, :aprovacao_necessaria, :aprovacao_status,
                :aprovado_por_id, :aprovado_em
            ) RETURNING id
        """), {
            **params, "empresa_id": company_id, "usuario_criador_id": int(current_user.id), "codigo": code,
            "data_aprovacao": datetime.now(timezone.utc) if approved_now else None,
            "aprovacao_necessaria": approval_needed,
            "aprovacao_status": "aprovado" if manager_approval else ("pendente" if approval_needed else None),
            "aprovado_por_id": int(current_user.id) if approved_now else None,
            "aprovado_em": datetime.now(timezone.utc) if approved_now else None,
        }).scalar_one()
        save_budget_items(db, int(row), items)
        add_history(db, int(row), current_user, "criado", "Orçamento criado.", new_status=params["status"])
        db.commit()
        return get_budget(int(row), current_user=current_user, db=db)
    except Exception:
        db.rollback()
        raise


def _history_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return dec4_out(value)
    if isinstance(value, (date, datetime)):
        return iso(value)
    return value


def budget_change_details(old: dict, new_params: dict, old_items: List[dict], new_items: List[dict]) -> List[dict]:
    field_map = {
        "cliente_id": ("Dados gerais", "Cliente"),
        "emitente_id": ("Dados gerais", "Empresa emitente"),
        "consultor_id": ("Dados gerais", "Consultor"),
        "categoria_id": ("Dados gerais", "Categoria"),
        "modelo_id": ("Dados gerais", "Modelo"),
        "titulo": ("Dados gerais", "Título"),
        "nome_documento": ("Condições", "Nome do documento"),
        "proposta_modelo": ("Proposta comercial", "Modelo de proposta"),
        "proposta_comercial_json": ("Proposta comercial", "Configuração da proposta"),
        "status": ("Dados gerais", "Status"),
        "data_solicitacao": ("Dados gerais", "Data da solicitação"),
        "data_emissao": ("Dados gerais", "Data de emissão"),
        "data_validade": ("Dados gerais", "Validade"),
        "responsavel_cliente": ("Local e contato", "Responsável no cliente"),
        "contato_cliente": ("Local e contato", "Contato"),
        "endereco_cep": ("Local e contato", "CEP"),
        "endereco_logradouro": ("Local e contato", "Endereço"),
        "endereco_numero": ("Local e contato", "Número"),
        "endereco_complemento": ("Local e contato", "Complemento"),
        "endereco_bairro": ("Local e contato", "Bairro"),
        "endereco_cidade": ("Local e contato", "Cidade"),
        "endereco_estado": ("Local e contato", "UF"),
        "desconto_tipo": ("Pagamento", "Tipo de desconto"),
        "desconto_valor": ("Pagamento", "Desconto"),
        "frete": ("Pagamento", "Frete"),
        "acrescimo": ("Pagamento", "Acréscimo"),
        "prazo_execucao": ("Condições", "Prazo de execução"),
        "condicoes": ("Condições", "Condições gerais"),
        "observacoes": ("Condições", "Observações"),
        "usar_capa": ("Documento", "Usar capa"),
        "titulo_capa": ("Documento", "Título da capa"),
        "subtitulo_capa": ("Documento", "Subtítulo da capa"),
        "escala_documento": ("Documento", "Tamanho da impressão (%)"),
    }
    changes: List[dict] = []
    for field, (section, label) in field_map.items():
        before = _history_value(old.get(field))
        after = _history_value(new_params.get(field))
        if before != after:
            changes.append({"secao": section, "campo": field, "nome": label, "anterior": before, "novo": after})

    def item_key(item: dict, index: int) -> str:
        return str(item.get("id") or item.get("produto_id") or f"manual-{index}")

    old_map = {item_key(item, index): item for index, item in enumerate(old_items)}
    new_map = {item_key(item, index): item for index, item in enumerate(new_items)}
    for key in sorted(set(old_map) | set(new_map)):
        before = old_map.get(key)
        after = new_map.get(key)
        if before is None:
            changes.append({"secao": "Itens", "campo": "item", "nome": after.get("descricao") or "Item", "anterior": None, "novo": "Adicionado"})
            continue
        if after is None:
            changes.append({"secao": "Itens", "campo": "item", "nome": before.get("descricao") or "Item", "anterior": "Existente", "novo": "Removido"})
            continue
        for field, label in (("descricao", "Descrição"), ("quantidade", "Quantidade"), ("valor_unitario", "Valor unitário"), ("desconto", "Desconto"), ("custo_unitario", "Custo unitário"), ("observacao", "Observação")):
            old_value = _history_value(before.get(field))
            new_value = _history_value(after.get(field))
            if old_value != new_value:
                changes.append({
                    "secao": "Itens",
                    "campo": field,
                    "nome": f"{after.get('descricao') or before.get('descricao') or 'Item'} — {label}",
                    "anterior": old_value,
                    "novo": new_value,
                })
    return changes


@router.put("/{budget_id}")
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    atualizar_precos: bool = Query(default=False),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    old = budget_row(db, budget_id, company_id)
    if not old:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    data = dict(old)
    financeiro_status = financeiro_status_norm(data.get("financeiro_status"))
    if financeiro_status == "autenticado":
        raise HTTPException(status_code=409, detail="Esta venda já foi autenticada pelo Financeiro. Faça ajustes por cancelamento ou renegociação financeira.")
    if financeiro_status == "pendente":
        raise HTTPException(status_code=409, detail="Esta venda está em conferência no Financeiro. Cancele o envio ou aguarde a devolução antes de editar.")
    if atualizar_precos and status_norm(data.get("status")) in STATUS_PRECOS_BLOQUEADOS:
        raise HTTPException(
            status_code=409,
            detail="Este orçamento já está encerrado. Duplique-o para atualizar os preços em uma nova versão.",
        )

    incoming = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    current_items = serialize_items(db, budget_id, show_costs=True, company_id=company_id)
    base_fields = list(getattr(BudgetBase, "model_fields", {}).keys()) or list(getattr(BudgetBase, "__fields__", {}).keys())
    merged = {**{k: data.get(k) for k in base_fields}, **incoming}
    merged["itens"] = incoming.get("itens", current_items)
    merged["pagamentos"] = incoming.get("pagamentos", json_load(data.get("pagamentos_json"), []))
    merged["proposta_comercial"] = incoming.get("proposta_comercial", json_load(data.get("proposta_comercial_json"), {}))
    merged["proposta_modelo"] = incoming.get("proposta_modelo", data.get("proposta_modelo") or "padrao")
    effective = BudgetCreate(**merged)
    validate_nilson_proposal_model_access(current_user, effective.proposta_modelo)
    if atualizar_precos and not any(item.produto_id for item in effective.itens):
        raise HTTPException(
            status_code=422,
            detail="Este orçamento não possui produtos vinculados ao cadastro para atualizar.",
        )

    for table, row_id, label in (
        ("clientes", effective.cliente_id, "Cliente"),
        ("usuarios", effective.consultor_id, "Consultor"),
        ("orcamento_categorias", effective.categoria_id, "Categoria"),
        ("orcamento_modelos", effective.modelo_id, "Modelo"),
    ):
        validate_company_fk(db, table, row_id, company_id, label)

    config = get_config_row(db, company_id)
    existing_costs = {
        int(item["id"]): (money(item.get("custo_unitario")), bool(item.get("custo_informado")))
        for item in current_items if item.get("id")
    }
    comparison_items = None
    if atualizar_precos:
        comparison_items, _ = calculate_items(
            db, company_id, current_user, effective.itens, existing_costs=existing_costs
        )
    items, partial = calculate_items(
        db,
        company_id,
        current_user,
        effective.itens,
        existing_costs=existing_costs,
        refresh_product_prices=atualizar_precos,
    )
    totals = calculate_totals(effective, partial["subtotal"], partial["custo_total"])
    approval_needed = (
        bool(config.get("controlar_custos"))
        and bool(config.get("exigir_aprovacao_margem"))
        and totals["margem_percentual"] < money(config.get("margem_minima"))
    )
    snapshot = client_snapshot(db, effective.cliente_id, company_id)
    same_emitter = int(effective.emitente_id or 0) == int(data.get("emitente_id") or 0)
    has_stored_emitter = bool(data.get("emitente_razao_social_documento") or data.get("emitente_nome_documento"))
    emitter = stored_emitter_snapshot(data) if same_emitter and has_stored_emitter else emitter_snapshot(db, effective.emitente_id, company_id)
    params = payload_params(
        effective, config, totals, snapshot, emitter,
        itens_sem_custo=int(partial.get("itens_sem_custo") or 0),
    )
    if atualizar_precos:
        params["pagamentos_json"] = json_dump(recalculate_payment_options(effective.pagamentos, totals["total"]))
    requested_approved = params["status"] == "aprovado"
    if requested_approved and bool(config.get("controlar_custos")) and params["itens_sem_custo"] > 0:
        raise HTTPException(
            status_code=422,
            detail=f"Informe o custo de todos os itens antes de aprovar. Há {params['itens_sem_custo']} item(ns) sem custo.",
        )
    previous_margin_approved = (
        data.get("aprovacao_status") == "aprovado"
        and q2(money(data.get("margem_percentual"))) == q2(totals["margem_percentual"])
    )
    manager_approval = bool(approval_needed and requested_approved and can_manage_settings(current_user))
    if approval_needed and requested_approved and not (manager_approval or previous_margin_approved):
        raise HTTPException(
            status_code=403,
            detail="Este orçamento precisa de aprovação gerencial por estar abaixo da margem mínima.",
        )

    db.execute(text("""
        UPDATE orcamentos SET
            cliente_id=:cliente_id, consultor_id=:consultor_id, categoria_id=:categoria_id, modelo_id=:modelo_id,
            titulo=:titulo, nome_documento=:nome_documento, status=:status,
            data_solicitacao=:data_solicitacao, data_emissao=:data_emissao, data_validade=:data_validade,
            data_aprovacao=CASE WHEN :status='aprovado' THEN COALESCE(data_aprovacao, NOW()) ELSE data_aprovacao END,
            responsavel_cliente=:responsavel_cliente, contato_cliente=:contato_cliente,
            endereco_cep=:endereco_cep, endereco_logradouro=:endereco_logradouro, endereco_numero=:endereco_numero,
            endereco_complemento=:endereco_complemento, endereco_bairro=:endereco_bairro,
            endereco_cidade=:endereco_cidade, endereco_estado=:endereco_estado,
            cliente_nome_documento=:cliente_nome_documento,
            cliente_nome_fantasia_documento=:cliente_nome_fantasia_documento,
            cliente_cpf_cnpj=:cliente_cpf_cnpj, cliente_rg_ie=:cliente_rg_ie,
            cliente_telefone=:cliente_telefone, cliente_whatsapp_documento=:cliente_whatsapp_documento,
            cliente_fax=:cliente_fax, cliente_email_nfe=:cliente_email_nfe,
            cliente_contato_nome=:cliente_contato_nome,
            emitente_id=:emitente_id, emitente_nome_documento=:emitente_nome_documento,
            emitente_razao_social_documento=:emitente_razao_social_documento,
            emitente_nome_fantasia_documento=:emitente_nome_fantasia_documento,
            emitente_cnpj_documento=:emitente_cnpj_documento, emitente_ie_documento=:emitente_ie_documento,
            emitente_email_documento=:emitente_email_documento, emitente_site_documento=:emitente_site_documento,
            emitente_telefone_documento=:emitente_telefone_documento, emitente_endereco_documento=:emitente_endereco_documento,
            emitente_logo_documento=:emitente_logo_documento, emitente_rodape_documento=:emitente_rodape_documento,
            desconto_tipo=:desconto_tipo, desconto_valor=:desconto_valor, desconto_total=:desconto_total,
            frete=:frete, acrescimo=:acrescimo, subtotal=:subtotal, total=:total,
            custo_total=:custo_total, lucro_total=:lucro_total, margem_percentual=:margem_percentual,
            itens_sem_custo=:itens_sem_custo,
            prazo_execucao=:prazo_execucao, condicoes=:condicoes, observacoes=:observacoes,
            proposta_modelo=:proposta_modelo, proposta_comercial_json=:proposta_comercial_json,
            pagamentos_json=:pagamentos_json, usar_capa=:usar_capa, titulo_capa=:titulo_capa,
            subtitulo_capa=:subtitulo_capa, escala_documento=:escala_documento, aprovacao_necessaria=:aprovacao_necessaria,
            aprovacao_status=CASE
                WHEN NOT :aprovacao_necessaria THEN NULL
                WHEN :manager_approval THEN 'aprovado'
                WHEN aprovacao_status='aprovado' AND margem_percentual IS NOT DISTINCT FROM :margem_percentual THEN 'aprovado'
                ELSE 'pendente'
            END,
            aprovado_por_id=CASE
                WHEN :status='aprovado' AND NOT :aprovacao_necessaria THEN :current_user_id
                WHEN :manager_approval THEN :current_user_id
                WHEN :aprovacao_necessaria AND aprovacao_status='aprovado' AND margem_percentual IS NOT DISTINCT FROM :margem_percentual THEN aprovado_por_id
                ELSE NULL
            END,
            aprovado_em=CASE
                WHEN :status='aprovado' AND NOT :aprovacao_necessaria THEN NOW()
                WHEN :manager_approval THEN NOW()
                WHEN :aprovacao_necessaria AND aprovacao_status='aprovado' AND margem_percentual IS NOT DISTINCT FROM :margem_percentual THEN aprovado_em
                ELSE NULL
            END,
            versao=versao+1, atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:empresa_id
    """), {
        **params,
        "aprovacao_necessaria": approval_needed,
        "manager_approval": manager_approval,
        "current_user_id": int(current_user.id),
        "id": budget_id,
        "empresa_id": company_id,
    })
    changes = budget_change_details(data, params, current_items, items)
    price_summary = None
    if atualizar_precos:
        sale_changes = 0
        cost_changes = 0
        changed_products = 0
        linked_items = 0
        for before, after in zip(comparison_items or [], items):
            if not before.get("produto_id"):
                continue
            linked_items += 1
            sale_changed = q4(money(before.get("valor_unitario"))) != q4(money(after.get("valor_unitario")))
            cost_changed = (
                q4(money(before.get("custo_unitario"))) != q4(money(after.get("custo_unitario")))
                or bool(before.get("custo_informado")) != bool(after.get("custo_informado"))
            )
            sale_changes += int(sale_changed)
            cost_changes += int(cost_changed)
            changed_products += int(sale_changed or cost_changed)
        price_summary = {
            "itens_vinculados": linked_items,
            "itens_atualizados": changed_products,
            "precos_venda_alterados": sale_changes,
            "custos_alterados": cost_changes,
        }

    save_budget_items(db, budget_id, items)
    if atualizar_precos:
        description = (
            f"Preços atualizados pela tabela de produtos: {price_summary['itens_atualizados']} item(ns), "
            f"{price_summary['precos_venda_alterados']} preço(s) de venda e {price_summary['custos_alterados']} custo(s)."
        )
        action = "precos_atualizados"
    else:
        description = f"Orçamento atualizado: {len(changes)} alteração(ões)." if changes else "Orçamento salvo sem mudanças de conteúdo."
        action = "editado"
    history_data = {"alteracoes": changes}
    if price_summary is not None:
        history_data["atualizacao_precos"] = price_summary
    add_history(
        db, budget_id, current_user, action, description,
        old_status=data.get("status"), new_status=params["status"],
        data=history_data,
    )
    db.commit()
    result = get_budget(budget_id, current_user=current_user, db=db)
    if price_summary is not None:
        result["atualizacao_precos"] = price_summary
    return result


def financeiro_status_norm(value: Any) -> str:
    current = str(value or "nao_enviado").strip().lower()
    permitidos = {"nao_enviado", "pendente", "devolvido", "autenticado", "cancelado"}
    return current if current in permitidos else "nao_enviado"


def snapshot_venda_financeiro(db: Session, budget_id: int, company_id: int) -> dict:
    row = db.execute(text(base_select() + " WHERE o.id=:id AND o.empresa_id=:e LIMIT 1"), {"id": budget_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    data = dict(row)
    itens = serialize_items(db, budget_id, show_costs=False)
    pagamentos = json_load(data.get("pagamentos_json"), [])
    return {
        "orcamento_id": int(data["id"]),
        "cliente_id": int(data["cliente_id"]) if data.get("cliente_id") else None,
        "consultor_id": int(data["consultor_id"]) if data.get("consultor_id") else None,
        "orcamento_codigo": str(data.get("codigo") or "").strip(),
        "orcamento_titulo": str(data.get("titulo") or "Venda").strip(),
        "cliente_nome": str(data.get("cliente_nome") or data.get("cliente_razao_social") or "").strip(),
        "cliente_documento": norm_str(data.get("cliente_documento")),
        "consultor_nome": norm_str(data.get("consultor_nome")),
        "data_venda": parse_date(data.get("data_aprovacao")) or parse_date(data.get("data_emissao")) or date.today(),
        "valor_total": q2(money(data.get("total"))),
        "pagamentos_json": json_dump(pagamentos),
        "itens_json": json_dump(itens),
        "condicoes": norm_str(data.get("condicoes")),
        "observacoes_comerciais": norm_str(data.get("observacoes")),
        "status_orcamento": status_norm(data.get("status")),
        "financeiro_status": financeiro_status_norm(data.get("financeiro_status")),
    }



def _proposal_aware_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _proposal_snapshot(db: Session, budget_id: int, company_id: int) -> tuple[dict, datetime]:
    row = db.execute(
        text(base_select() + " WHERE o.id=:id AND o.empresa_id=:empresa_id LIMIT 1"),
        {"id": budget_id, "empresa_id": company_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    data = dict(row)
    if not bool(data.get("proposta_cliente_preparada")):
        raise HTTPException(status_code=422, detail="Prepare os dados comerciais antes de gerar o link para o cliente.")
    if not data.get("cliente_id"):
        raise HTTPException(status_code=422, detail="O orçamento precisa estar vinculado a um cliente.")
    if status_norm(data.get("status")) in {"aprovado", "recusado", "cancelado", "expirado"}:
        raise HTTPException(status_code=409, detail="Este orçamento não está disponível para gerar uma nova proposta pública.")
    if bool(data.get("aprovacao_necessaria")) and str(data.get("aprovacao_status") or "").lower() != "aprovado":
        raise HTTPException(status_code=409, detail="A margem deste orçamento precisa ser aprovada internamente antes do envio ao cliente.")

    items = serialize_items(db, budget_id, show_costs=False, company_id=company_id)
    public_items = []
    for item in items:
        public_items.append({
            "codigo": norm_str(item.get("codigo")),
            "descricao": norm_str(item.get("descricao")) or "Item",
            "unidade": norm_str(item.get("unidade")) or "UN",
            "quantidade": dec4_out(item.get("quantidade")),
            "valor_unitario": dec_out(item.get("valor_unitario")),
            "desconto": dec_out(item.get("desconto")),
            "valor_total": dec_out(item.get("valor_total")),
        })

    natureza = norm_str(data.get("proposta_cliente_natureza"))
    services = json_load(data.get("proposta_cliente_servicos_json"), [])
    plans = json_load(data.get("proposta_cliente_planos_json"), [])
    contract_type = norm_str(data.get("proposta_cliente_tipo_contrato"))
    payment_method = norm_str(data.get("proposta_cliente_forma_pagamento"))
    source_updated = _proposal_aware_utc(data.get("atualizado_em")) or datetime.now(timezone.utc)

    snapshot = {
        "versao": int(data.get("versao") or 1),
        "gerada_em": datetime.now(timezone.utc).isoformat(),
        "orcamento": {
            "id": int(data["id"]),
            "codigo": norm_str(data.get("codigo")),
            "titulo": norm_str(data.get("titulo")) or "Proposta comercial",
            "nome_documento": norm_str(data.get("nome_documento")) or "Proposta",
            "data_emissao": iso(data.get("data_emissao")),
            "data_validade": iso(data.get("data_validade")),
            "prazo_execucao": norm_str(data.get("prazo_execucao")),
            "subtotal": dec_out(data.get("subtotal")),
            "desconto_total": dec_out(data.get("desconto_total")),
            "frete": dec_out(data.get("frete")),
            "acrescimo": dec_out(data.get("acrescimo")),
            "total": dec_out(data.get("total")),
        },
        "cliente": {
            "nome": norm_str(data.get("cliente_razao_social")) or norm_str(data.get("cliente_nome")) or "Cliente",
            "nome_fantasia": norm_str(data.get("cliente_nome_fantasia")),
        },
        "emitente": {
            "nome": norm_str(data.get("emitente_nome_fantasia_documento")) or norm_str(data.get("emitente_nome_documento")) or norm_str(data.get("emitente_razao_social_documento")) or "SEG Sistemas",
            "razao_social": norm_str(data.get("emitente_razao_social_documento")),
            "cnpj": norm_str(data.get("emitente_cnpj_documento")),
            "telefone": norm_str(data.get("emitente_telefone_documento")),
            "email": norm_str(data.get("emitente_email_documento")),
            "site": norm_str(data.get("emitente_site_documento")),
            "endereco": norm_str(data.get("emitente_endereco_documento")),
        },
        "itens": public_items,
        "modelo_servico": {
            "tipo": norm_str(data.get("proposta_modelo")) or "padrao",
            "dados": json_load(data.get("proposta_comercial_json"), {}),
        },
        "comercial": {
            "natureza": {"codigo": natureza, "label": PROPOSTA_CLIENTE_NATUREZA_LABELS.get(natureza or "", natureza)},
            "servicos": [{"codigo": item, "label": PROPOSTA_CLIENTE_SERVICO_LABELS.get(item, item)} for item in services],
            "planos": [{"codigo": item, "label": PROPOSTA_CLIENTE_PLANO_LABELS.get(item, item)} for item in plans],
            "tipo_contrato": {"codigo": contract_type, "label": PROPOSTA_CLIENTE_TIPO_CONTRATO_LABELS.get(contract_type or "", contract_type)} if contract_type else None,
            "valor_implantacao": dec_out(data.get("proposta_cliente_valor_implantacao")),
            "valor_mensal": dec_out(data.get("proposta_cliente_valor_mensal")),
            "dia_vencimento": data.get("proposta_cliente_dia_vencimento"),
            "forma_pagamento": {"codigo": payment_method, "label": PROPOSTA_CLIENTE_FORMA_PAGAMENTO_LABELS.get(payment_method or "", payment_method)},
            "condicao_pagamento": norm_str(data.get("proposta_cliente_condicao_pagamento")),
        },
    }
    return snapshot, source_updated


def _proposal_link_details(row: dict, request: Request) -> dict:
    active = bool(row.get("proposta_cliente_link_ativo"))
    version = int(row.get("proposta_cliente_link_versao") or 0)
    expires = _proposal_aware_utc(row.get("proposta_cliente_link_expira_em"))
    source_updated = _proposal_aware_utc(row.get("proposta_cliente_snapshot_orcamento_atualizado_em"))
    current_updated = _proposal_aware_utc(row.get("atualizado_em"))
    outdated = bool(source_updated and current_updated and current_updated > source_updated)
    expired = bool(expires and expires <= datetime.now(timezone.utc))
    url = None
    if active and version > 0 and expires and not expired:
        token = create_public_token(
            budget_id=int(row["id"]),
            company_id=int(row["empresa_id"]),
            version=version,
            expires_at=expires,
        )
        url = build_public_url(token, str(request.base_url))
    return {
        "tem_link": bool(active and version > 0 and not expired),
        "url": url,
        "versao": version,
        "status": str(row.get("proposta_cliente_public_status") or "nao_gerado"),
        "ativo": active,
        "expirado": expired,
        "desatualizado": outdated,
        "gerado_em": iso(row.get("proposta_cliente_link_gerado_em")),
        "expira_em": iso(row.get("proposta_cliente_link_expira_em")),
        "primeira_visualizacao_em": iso(row.get("proposta_cliente_primeira_visualizacao_em")),
        "ultima_visualizacao_em": iso(row.get("proposta_cliente_ultima_visualizacao_em")),
        "visualizacoes": int(row.get("proposta_cliente_visualizacoes") or 0),
        "aprovado_em": iso(row.get("proposta_cliente_aprovado_em")),
        "alteracao_solicitada_em": iso(row.get("proposta_cliente_alteracao_solicitada_em")),
        "alteracao_mensagem": row.get("proposta_cliente_alteracao_mensagem"),
        "cadastro_contrato": {
            "status": str(row.get("proposta_cliente_cadastro_status") or "nao_iniciado"),
            "iniciado_em": iso(row.get("proposta_cliente_cadastro_iniciado_em")),
            "concluido_em": iso(row.get("proposta_cliente_cadastro_concluido_em")),
            "tipo_pessoa": row.get("proposta_cliente_cadastro_tipo_pessoa"),
        },
        "contrato": {
            "status": str(row.get("proposta_cliente_contrato_status") or "nao_gerado"),
            "versao": int(row.get("proposta_cliente_contrato_versao") or 0),
            "gerado_em": iso(row.get("proposta_cliente_contrato_gerado_em")),
        },
    }


def _get_proposal_link_row(db: Session, budget_id: int, company_id: int, *, lock: bool = False):
    """Carrega apenas o estado necessário para publicação da proposta.

    A consulta de link não deve depender das colunas da etapa de assinatura.
    Isso mantém o modal de preparação desacoplado das etapas posteriores e,
    quando o banco estiver desatualizado, devolve uma mensagem útil em vez de
    um HTTP 500 genérico.
    """
    suffix = " FOR UPDATE" if lock else ""
    try:
        return db.execute(text("""
            SELECT id, empresa_id, cliente_id, codigo, titulo, status, atualizado_em,
                   proposta_cliente_preparada, aprovacao_necessaria, aprovacao_status,
                   proposta_cliente_link_versao, proposta_cliente_link_ativo,
                   proposta_cliente_link_gerado_em, proposta_cliente_link_expira_em,
                   proposta_cliente_public_status, proposta_cliente_snapshot_orcamento_atualizado_em,
                   proposta_cliente_primeira_visualizacao_em, proposta_cliente_ultima_visualizacao_em,
                   proposta_cliente_visualizacoes, proposta_cliente_aprovado_em,
                   proposta_cliente_alteracao_solicitada_em, proposta_cliente_alteracao_mensagem,
                   proposta_cliente_cadastro_status, proposta_cliente_cadastro_iniciado_em,
                   proposta_cliente_cadastro_concluido_em, proposta_cliente_cadastro_tipo_pessoa,
                   proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
                   proposta_cliente_contrato_gerado_em
            FROM orcamentos WHERE id=:id AND empresa_id=:empresa_id
        """ + suffix), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    except ProgrammingError as exc:
        # PostgreSQL 42703 = undefined_column. Como esse fluxo foi adicionado
        # por migrations, uma base que recebeu os arquivos mas não todas as
        # migrations deve orientar o operador em vez de retornar 500.
        original = getattr(exc, "orig", None)
        sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
        message = str(original or exc).lower()
        db.rollback()
        if sqlstate == "42703" or "proposta_cliente_" in message:
            raise HTTPException(
                status_code=503,
                detail=(
                    "O banco do Valora está com a estrutura da proposta desatualizada. "
                    "Execute '.\\.venv\\Scripts\\python.exe -m alembic upgrade head' "
                    "e reinicie o Valora."
                ),
            ) from exc
        raise


@router.get("/{budget_id}/contrato")
def obter_contrato_cliente(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    source = load_contract_source(db, budget_id=budget_id, company_id=company_id)
    row = source["orcamento"]
    details = contract_details(row, client_updated_at=(source.get("cliente") or {}).get("atualizado_em"))
    details["pode_gerar"] = True
    details["pdf_inline_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf"
    details["pdf_download_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf?download=true"
    return details


@router.post("/{budget_id}/contrato/gerar")
def gerar_contrato_cliente(
    budget_id: int,
    payload: ContratoClienteGerarIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    source = load_contract_source(db, budget_id=budget_id, company_id=company_id)
    row = source["orcamento"]
    existing = contract_details(row, client_updated_at=(source.get("cliente") or {}).get("atualizado_em"))
    if existing.get("gerado") and not payload.regenerar:
        existing["pode_gerar"] = True
        existing["pdf_inline_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf"
        existing["pdf_download_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf?download=true"
        return existing

    assinatura_status = str(row.get("proposta_cliente_assinatura_status") or "nao_enviado")
    if assinatura_status in {"aguardando_assinatura", "visualizado"}:
        raise HTTPException(status_code=409, detail="Cancele a solicitação de assinatura antes de gerar uma nova versão do contrato.")
    if assinatura_status == "assinado":
        raise HTTPException(status_code=409, detail="Este contrato já foi assinado. Uma nova versão exige um novo fluxo comercial/proposta.")

    version = int(row.get("proposta_cliente_contrato_versao") or 0) + 1
    snapshot = build_contract_snapshot(
        db,
        budget_id=budget_id,
        company_id=company_id,
        version=version,
        generated_by_id=int(current_user.id),
        generated_by_name=str(current_user.nome or "Usuário"),
    )
    now = datetime.now(timezone.utc)
    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_contrato_status='gerado',
            proposta_cliente_contrato_versao=:versao,
            proposta_cliente_contrato_gerado_em=:gerado_em,
            proposta_cliente_contrato_gerado_por_id=:usuario_id,
            proposta_cliente_contrato_snapshot_json=:snapshot,
            proposta_cliente_contrato_cliente_atualizado_em=:cliente_atualizado_em,
            proposta_cliente_assinatura_status='nao_enviado',
            proposta_cliente_assinatura_solicitada_em=NULL,
            proposta_cliente_assinatura_enviado_por_id=NULL,
            proposta_cliente_assinatura_visualizado_em=NULL,
            proposta_cliente_assinatura_assinado_em=NULL,
            proposta_cliente_assinatura_cancelado_em=NULL,
            proposta_cliente_assinatura_id=NULL,
            proposta_cliente_assinante_nome=NULL,
            proposta_cliente_assinante_documento_mascarado=NULL,
            proposta_cliente_assinatura_documento_hash_sha256=NULL,
            proposta_cliente_assinatura_pdf_final_hash_sha256=NULL,
            proposta_cliente_assinatura_evidencias_json=NULL
        WHERE id=:id AND empresa_id=:empresa_id
    """), {
        "versao": version,
        "gerado_em": now,
        "usuario_id": int(current_user.id),
        "snapshot": json_dump(snapshot),
        "cliente_atualizado_em": _proposal_aware_utc((source.get("cliente") or {}).get("atualizado_em")),
        "id": budget_id,
        "empresa_id": company_id,
    })
    add_history(
        db,
        budget_id,
        current_user,
        "contrato_gerado" if version == 1 else "contrato_regenerado",
        "Contrato gerado a partir da proposta aprovada e do cadastro concluído do cliente."
        if version == 1 else
        "Nova versão do contrato gerada a partir da proposta aprovada e dos dados atuais do cliente.",
        data={
            "contrato_numero": (snapshot.get("contrato") or {}).get("numero"),
            "versao": version,
            "proposta_aprovada_em": (snapshot.get("aprovacao") or {}).get("aprovado_em"),
        },
    )
    db.commit()

    fresh = db.execute(text("""
        SELECT proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
               proposta_cliente_contrato_gerado_em, proposta_cliente_contrato_snapshot_json,
               proposta_cliente_contrato_cliente_atualizado_em
        FROM orcamentos WHERE id=:id AND empresa_id=:empresa_id
    """), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    details = contract_details(dict(fresh or {}), client_updated_at=(source.get("cliente") or {}).get("atualizado_em"))
    details["pode_gerar"] = True
    details["pdf_inline_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf"
    details["pdf_download_url"] = f"/api/orcamentos/{budget_id}/contrato/pdf?download=true"
    return details


@router.get("/{budget_id}/contrato/pdf")
def pdf_contrato_cliente(
    budget_id: int,
    download: bool = Query(default=False),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = db.execute(text("""
        SELECT proposta_cliente_contrato_status, proposta_cliente_contrato_snapshot_json
        FROM orcamentos WHERE id=:id AND empresa_id=:empresa_id
    """), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if str(row.get("proposta_cliente_contrato_status") or "") != "gerado":
        raise HTTPException(status_code=409, detail="Gere o contrato antes de abrir o PDF.")
    snapshot = json_load(row.get("proposta_cliente_contrato_snapshot_json"), {})
    if not snapshot:
        raise HTTPException(status_code=409, detail="A versão do contrato não foi encontrada.")
    pdf_bytes = render_contract_pdf(snapshot)
    filename = contract_filename(snapshot)
    disposition = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "private, no-store, max-age=0",
        },
    )


@router.put("/{budget_id}/preparacao-cliente")
def salvar_preparacao_proposta_cliente(
    budget_id: int,
    payload: PropostaClientePreparacaoIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = db.execute(text("""
        SELECT id, cliente_id, codigo, status, proposta_cliente_public_status
        FROM orcamentos
        WHERE id=:id AND empresa_id=:empresa_id
        FOR UPDATE
    """), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if str(row.get("proposta_cliente_public_status") or "").lower() == "aprovado":
        raise HTTPException(status_code=409, detail="Esta proposta já foi aprovada pelo cliente e não pode ser alterada nesta etapa.")
    if not row.get("cliente_id"):
        raise HTTPException(status_code=422, detail="Selecione um cliente antes de preparar a proposta para envio.")
    if status_norm(row.get("status")) in {"recusado", "cancelado", "expirado"}:
        raise HTTPException(status_code=409, detail="Este orçamento está encerrado e não pode ser preparado para envio ao cliente.")

    natureza = (norm_str(payload.natureza) or "").lower()
    forma_pagamento = (norm_str(payload.forma_pagamento) or "").lower()
    tipo_contrato = (norm_str(payload.tipo_contrato) or "").lower() or None
    servicos = list(dict.fromkeys(str(item or "").strip().lower() for item in payload.servicos if str(item or "").strip()))
    planos = list(dict.fromkeys(str(item or "").strip().lower() for item in payload.planos if str(item or "").strip()))
    condicao_pagamento = norm_str(payload.condicao_pagamento)

    if natureza not in PROPOSTA_CLIENTE_NATUREZAS:
        raise HTTPException(status_code=422, detail="Selecione a natureza da proposta.")
    invalid_services = [item for item in servicos if item not in PROPOSTA_CLIENTE_SERVICOS]
    if invalid_services:
        raise HTTPException(status_code=422, detail="Existe um serviço inválido na preparação da proposta.")
    invalid_plans = [item for item in planos if item not in PROPOSTA_CLIENTE_PLANOS]
    if invalid_plans:
        raise HTTPException(status_code=422, detail="Existe um plano de serviço inválido na preparação da proposta.")
    if tipo_contrato and tipo_contrato not in PROPOSTA_CLIENTE_TIPOS_CONTRATO:
        raise HTTPException(status_code=422, detail="Tipo de contrato inválido.")
    if forma_pagamento not in PROPOSTA_CLIENTE_FORMAS_PAGAMENTO:
        raise HTTPException(status_code=422, detail="Selecione a forma de pagamento.")
    if not condicao_pagamento:
        raise HTTPException(status_code=422, detail="Informe a condição de pagamento.")

    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_natureza=:natureza,
            proposta_cliente_servicos_json=:servicos_json,
            proposta_cliente_planos_json=:planos_json,
            proposta_cliente_tipo_contrato=:tipo_contrato,
            proposta_cliente_valor_implantacao=:valor_implantacao,
            proposta_cliente_valor_mensal=:valor_mensal,
            proposta_cliente_dia_vencimento=:dia_vencimento,
            proposta_cliente_forma_pagamento=:forma_pagamento,
            proposta_cliente_condicao_pagamento=:condicao_pagamento,
            proposta_cliente_preparada=TRUE,
            proposta_cliente_preparada_em=NOW(),
            proposta_cliente_preparada_por_id=:usuario_id,
            proposta_cliente_link_ativo=FALSE,
            proposta_cliente_public_status='preparada',
            proposta_cliente_cadastro_status='nao_iniciado',
            proposta_cliente_cadastro_iniciado_em=NULL,
            proposta_cliente_cadastro_concluido_em=NULL,
            proposta_cliente_cadastro_ip=NULL,
            proposta_cliente_cadastro_tipo_pessoa=NULL,
            proposta_cliente_link_desativado_em=CASE WHEN proposta_cliente_link_ativo THEN NOW() ELSE proposta_cliente_link_desativado_em END,
            proposta_cliente_link_desativado_por_id=CASE WHEN proposta_cliente_link_ativo THEN :usuario_id ELSE proposta_cliente_link_desativado_por_id END,
            atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:empresa_id
    """), {
        "id": budget_id,
        "empresa_id": company_id,
        "natureza": natureza,
        "servicos_json": json_dump(servicos),
        "planos_json": json_dump(planos),
        "tipo_contrato": tipo_contrato,
        "valor_implantacao": q2(money(payload.valor_implantacao)),
        "valor_mensal": q2(money(payload.valor_mensal)),
        "dia_vencimento": payload.dia_vencimento,
        "forma_pagamento": forma_pagamento,
        "condicao_pagamento": condicao_pagamento,
        "usuario_id": int(current_user.id),
    })
    add_history(
        db,
        budget_id,
        current_user,
        "proposta_cliente_preparada",
        "Dados para envio e aprovação do cliente preparados.",
        data={
            "natureza": natureza,
            "servicos": servicos,
            "planos": planos,
            "tipo_contrato": tipo_contrato,
            "valor_implantacao": dec_out(payload.valor_implantacao),
            "valor_mensal": dec_out(payload.valor_mensal),
            "dia_vencimento": payload.dia_vencimento,
            "forma_pagamento": forma_pagamento,
            "condicao_pagamento": condicao_pagamento,
        },
    )
    db.commit()
    return get_budget(budget_id, current_user=current_user, db=db)


@router.get("/{budget_id}/proposta-cliente/link")
def consultar_link_proposta_cliente(
    budget_id: int,
    request: Request,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = _get_proposal_link_row(db, budget_id, company_id)
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    return _proposal_link_details(dict(row), request)


@router.post("/{budget_id}/proposta-cliente/link")
def gerar_link_proposta_cliente(
    budget_id: int,
    payload: PropostaClienteLinkIn,
    request: Request,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = _get_proposal_link_row(db, budget_id, company_id, lock=True)
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if not bool(row.get("proposta_cliente_preparada")):
        raise HTTPException(status_code=422, detail="Salve a preparação da proposta antes de gerar o link.")
    if str(row.get("proposta_cliente_public_status") or "").lower() == "aprovado":
        raise HTTPException(status_code=409, detail="Esta proposta já foi aprovada pelo cliente.")

    existing = _proposal_link_details(dict(row), request)
    if existing["tem_link"] and not existing["desatualizado"] and not payload.regenerar:
        return existing

    snapshot, source_updated = _proposal_snapshot(db, budget_id, company_id)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=link_days())
    version = int(row.get("proposta_cliente_link_versao") or 0) + 1

    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_link_versao=:version,
            proposta_cliente_link_ativo=TRUE,
            proposta_cliente_link_gerado_em=:now,
            proposta_cliente_link_gerado_por_id=:usuario_id,
            proposta_cliente_link_expira_em=:expires,
            proposta_cliente_link_desativado_em=NULL,
            proposta_cliente_link_desativado_por_id=NULL,
            proposta_cliente_public_status='aguardando',
            proposta_cliente_snapshot_json=:snapshot,
            proposta_cliente_snapshot_orcamento_atualizado_em=:source_updated,
            proposta_cliente_primeira_visualizacao_em=NULL,
            proposta_cliente_ultima_visualizacao_em=NULL,
            proposta_cliente_visualizacoes=0,
            proposta_cliente_aprovado_em=NULL,
            proposta_cliente_aprovado_ip=NULL,
            proposta_cliente_alteracao_solicitada_em=NULL,
            proposta_cliente_alteracao_mensagem=NULL,
            proposta_cliente_alteracao_ip=NULL,
            proposta_cliente_cadastro_status='nao_iniciado',
            proposta_cliente_cadastro_iniciado_em=NULL,
            proposta_cliente_cadastro_concluido_em=NULL,
            proposta_cliente_cadastro_ip=NULL,
            proposta_cliente_cadastro_tipo_pessoa=NULL,
            proposta_cliente_contrato_status='nao_gerado',
            proposta_cliente_contrato_versao=0,
            proposta_cliente_contrato_gerado_em=NULL,
            proposta_cliente_contrato_gerado_por_id=NULL,
            proposta_cliente_contrato_snapshot_json=NULL,
            proposta_cliente_contrato_cliente_atualizado_em=NULL
        WHERE id=:id AND empresa_id=:empresa_id
    """), {
        "version": version,
        "now": now,
        "usuario_id": int(current_user.id),
        "expires": expires,
        "snapshot": json_dump(snapshot),
        "source_updated": source_updated,
        "id": budget_id,
        "empresa_id": company_id,
    })
    add_history(
        db,
        budget_id,
        current_user,
        "proposta_cliente_link_gerado" if version == 1 else "proposta_cliente_link_regenerado",
        "Link público da proposta gerado para o cliente." if version == 1 else "Nova versão do link público da proposta gerada; links anteriores foram invalidados.",
        data={"versao_link": version, "expira_em": expires.isoformat()},
    )
    db.commit()

    fresh = _get_proposal_link_row(db, budget_id, company_id)
    return _proposal_link_details(dict(fresh), request)


@router.post("/{budget_id}/proposta-cliente/link/desativar")
def desativar_link_proposta_cliente(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    row = _get_proposal_link_row(db, budget_id, company_id, lock=True)
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if str(row.get("proposta_cliente_public_status") or "").lower() == "aprovado":
        raise HTTPException(status_code=409, detail="A proposta já foi aprovada. O registro de aprovação deve ser preservado.")
    if not bool(row.get("proposta_cliente_link_ativo")):
        return {"ok": True, "status": "desativado"}

    db.execute(text("""
        UPDATE orcamentos SET
            proposta_cliente_link_ativo=FALSE,
            proposta_cliente_public_status='desativado',
            proposta_cliente_link_desativado_em=NOW(),
            proposta_cliente_link_desativado_por_id=:usuario_id
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"usuario_id": int(current_user.id), "id": budget_id, "empresa_id": company_id})
    add_history(db, budget_id, current_user, "proposta_cliente_link_desativado", "Link público da proposta desativado.")
    db.commit()
    return {"ok": True, "status": "desativado"}


@router.post("/{budget_id}/enviar-financeiro", status_code=status.HTTP_201_CREATED)
def enviar_orcamento_financeiro(
    budget_id: int,
    payload: EnviarFinanceiroIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    tipo_venda = str(payload.tipo_venda or "avulsa").strip().lower()
    if tipo_venda not in {"avulsa", "contrato"}:
        raise HTTPException(status_code=422, detail="Tipo de venda inválido.")
    if tipo_venda == "contrato":
        raise HTTPException(status_code=422, detail="Contratos recorrentes serão enviados na Fase 7. Nesta etapa, envie somente vendas avulsas.")

    db.execute(text("SELECT id FROM orcamentos WHERE id=:id AND empresa_id=:e FOR UPDATE"), {"id": budget_id, "e": company_id}).first()
    venda = snapshot_venda_financeiro(db, budget_id, company_id)
    if venda["status_orcamento"] != "aprovado":
        raise HTTPException(status_code=409, detail="Apenas um orçamento aprovado pode ser fechado e enviado ao Financeiro.")
    if not venda["cliente_id"]:
        raise HTTPException(status_code=422, detail="O orçamento precisa ter um cliente vinculado.")
    if venda["valor_total"] <= 0:
        raise HTTPException(status_code=422, detail="O total da venda deve ser maior que zero.")

    existente = db.execute(text("""
        SELECT * FROM public.financeiro_vendas_pendentes
        WHERE empresa_id=:empresa_id AND orcamento_id=:orcamento_id
        FOR UPDATE
    """), {"empresa_id": company_id, "orcamento_id": budget_id}).mappings().first()
    if existente and existente["status"] == "pendente":
        raise HTTPException(status_code=409, detail="Esta venda já está aguardando autenticação no Financeiro.")
    if existente and existente["status"] == "autenticado":
        raise HTTPException(status_code=409, detail="Esta venda já foi autenticada e possui títulos financeiros.")

    params = {
        **venda,
        "empresa_id": company_id,
        "tipo_venda": tipo_venda,
        "observacoes_envio": norm_str(payload.observacao),
        "usuario_id": int(current_user.id),
    }
    if existente:
        pendencia_id = int(existente["id"])
        db.execute(text("""
            UPDATE public.financeiro_vendas_pendentes SET
                cliente_id=:cliente_id, consultor_id=:consultor_id, status='pendente', tipo_venda=:tipo_venda,
                orcamento_codigo=:orcamento_codigo, orcamento_titulo=:orcamento_titulo,
                cliente_nome=:cliente_nome, cliente_documento=:cliente_documento, consultor_nome=:consultor_nome,
                data_venda=:data_venda, valor_total=:valor_total,
                pagamentos_json=CAST(:pagamentos_json AS JSONB), itens_json=CAST(:itens_json AS JSONB),
                condicoes=:condicoes, observacoes_comerciais=:observacoes_comerciais,
                observacoes_envio=:observacoes_envio, enviado_por_usuario_id=:usuario_id, enviado_em=NOW(),
                devolvido_por_usuario_id=NULL, devolvido_em=NULL, motivo_devolucao=NULL,
                cancelado_por_usuario_id=NULL, cancelado_em=NULL, motivo_cancelamento=NULL,
                autenticado_por_usuario_id=NULL, autenticado_em=NULL,
                grupo_parcelamento=NULL, lancamentos_gerados='[]'::jsonb,
                atualizado_em=NOW()
            WHERE id=:pendencia_id AND empresa_id=:empresa_id
        """), {**params, "pendencia_id": pendencia_id})
    else:
        pendencia_id = int(db.execute(text("""
            INSERT INTO public.financeiro_vendas_pendentes (
                empresa_id, orcamento_id, cliente_id, consultor_id, status, tipo_venda,
                orcamento_codigo, orcamento_titulo, cliente_nome, cliente_documento, consultor_nome,
                data_venda, valor_total, pagamentos_json, itens_json, condicoes,
                observacoes_comerciais, observacoes_envio, enviado_por_usuario_id, enviado_em,
                criado_em, atualizado_em
            ) VALUES (
                :empresa_id, :orcamento_id, :cliente_id, :consultor_id, 'pendente', :tipo_venda,
                :orcamento_codigo, :orcamento_titulo, :cliente_nome, :cliente_documento, :consultor_nome,
                :data_venda, :valor_total, CAST(:pagamentos_json AS JSONB), CAST(:itens_json AS JSONB), :condicoes,
                :observacoes_comerciais, :observacoes_envio, :usuario_id, NOW(), NOW(), NOW()
            ) RETURNING id
        """), params).scalar_one())

    db.execute(text("""
        UPDATE orcamentos SET financeiro_status='pendente', financeiro_enviado_em=NOW(),
            financeiro_enviado_por_id=:usuario_id, financeiro_motivo_retorno=NULL, atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"usuario_id": int(current_user.id), "id": budget_id, "empresa_id": company_id})
    add_history(
        db, budget_id, current_user, "enviado_financeiro",
        norm_str(payload.observacao) or "Venda fechada e enviada para autenticação do Financeiro.",
        data={"pendencia_financeira_id": pendencia_id, "valor_total": dec_out(venda["valor_total"]), "tipo_venda": tipo_venda},
    )
    db.commit()
    return {"id": pendencia_id, "status": "pendente", "orcamento_id": budget_id}


@router.post("/{budget_id}/cancelar-envio-financeiro")
def cancelar_envio_financeiro(
    budget_id: int,
    payload: EnviarFinanceiroIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    motivo = norm_str(payload.observacao) or "Envio cancelado pelo Comercial."
    row = db.execute(text("""
        SELECT id, status FROM public.financeiro_vendas_pendentes
        WHERE empresa_id=:empresa_id AND orcamento_id=:orcamento_id FOR UPDATE
    """), {"empresa_id": company_id, "orcamento_id": budget_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Esta venda não possui envio ao Financeiro.")
    if row["status"] == "autenticado":
        raise HTTPException(status_code=409, detail="A venda já foi autenticada. Cancele os títulos pelo Financeiro.")
    if row["status"] != "pendente":
        raise HTTPException(status_code=409, detail="Somente uma venda pendente pode ter o envio cancelado.")
    db.execute(text("""
        UPDATE public.financeiro_vendas_pendentes SET status='cancelado', cancelado_por_usuario_id=:usuario_id,
            cancelado_em=NOW(), motivo_cancelamento=:motivo, atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"usuario_id": int(current_user.id), "motivo": motivo, "id": int(row["id"]), "empresa_id": company_id})
    db.execute(text("""
        UPDATE orcamentos SET financeiro_status='cancelado', financeiro_motivo_retorno=:motivo, atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"motivo": motivo, "id": budget_id, "empresa_id": company_id})
    add_history(db, budget_id, current_user, "envio_financeiro_cancelado", motivo, data={"pendencia_financeira_id": int(row["id"])})
    db.commit()
    return {"status": "cancelado", "orcamento_id": budget_id}


@router.post("/{budget_id}/duplicar", status_code=status.HTTP_201_CREATED)
def duplicate_budget(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "criar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    source = get_budget(budget_id, current_user=current_user, db=db)
    source_emitter_id = source.get("emitente_id")
    active_emitter = db.execute(text("""
        SELECT id FROM orcamento_emitentes
        WHERE id=:id AND empresa_id=:empresa_id AND ativo=TRUE
    """), {"id": source_emitter_id, "empresa_id": company_id}).scalar() if source_emitter_id else None
    payload = BudgetCreate(
        cliente_id=source.get("cliente_id"), emitente_id=int(active_emitter) if active_emitter else None, consultor_id=source.get("consultor_id"), categoria_id=source.get("categoria_id"),
        modelo_id=source.get("modelo_id"), titulo=f"{source.get('titulo') or 'Orçamento'} (cópia)", status="rascunho",
        data_solicitacao=date.today(), data_emissao=date.today(), data_validade=None,
        responsavel_cliente=source.get("responsavel_cliente"), contato_cliente=source.get("contato_cliente"),
        endereco_cep=source.get("endereco_cep"), endereco_logradouro=source.get("endereco_logradouro"), endereco_numero=source.get("endereco_numero"),
        endereco_complemento=source.get("endereco_complemento"), endereco_bairro=source.get("endereco_bairro"), endereco_cidade=source.get("endereco_cidade"), endereco_estado=source.get("endereco_estado"),
        desconto_tipo=source.get("desconto_tipo") or "valor", desconto_valor=money(source.get("desconto_valor")),
        frete=money(source.get("frete")), acrescimo=money(source.get("acrescimo")), prazo_execucao=source.get("prazo_execucao"),
        condicoes=source.get("condicoes"), observacoes=source.get("observacoes"),
        proposta_modelo=source.get("proposta_modelo") or "padrao", proposta_comercial=source.get("proposta_comercial") or {},
        pagamentos=source.get("pagamentos") or [],
        usar_capa=bool(source.get("usar_capa")), titulo_capa=source.get("titulo_capa"), subtitulo_capa=source.get("subtitulo_capa"),
        escala_documento=int(source.get("escala_documento") or 100),
        itens=source.get("itens") or [],
    )
    created = create_budget(payload, current_user=current_user, db=db)
    add_history(db, int(created["id"]), current_user, "duplicado", f"Duplicado do orçamento {source.get('codigo')}.")
    db.commit()
    return get_budget(int(created["id"]), current_user=current_user, db=db)


@router.post("/{budget_id}/status")
def change_status(
    budget_id: int,
    payload: StatusIn,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    row = db.execute(text("SELECT id, status, aprovacao_necessaria, aprovacao_status, financeiro_status FROM orcamentos WHERE id=:id AND empresa_id=:e"), {"id": budget_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    new_status = status_norm(payload.status)
    fin_status = financeiro_status_norm(row.get("financeiro_status"))
    if fin_status == "autenticado" and new_status != "aprovado":
        raise HTTPException(status_code=409, detail="A venda já foi autenticada no Financeiro. Cancele ou renegocie os títulos antes de alterar o status comercial.")
    if fin_status == "pendente" and new_status != "aprovado":
        db.execute(text("""
            UPDATE public.financeiro_vendas_pendentes SET status='cancelado', cancelado_por_usuario_id=:u,
                cancelado_em=NOW(), motivo_cancelamento=:motivo, atualizado_em=NOW()
            WHERE empresa_id=:e AND orcamento_id=:id AND status='pendente'
        """), {"u": int(current_user.id), "motivo": norm_str(payload.observacao) or f"Status comercial alterado para {new_status}.", "e": company_id, "id": budget_id})
    if new_status == "aprovado" and row["aprovacao_necessaria"] and row["aprovacao_status"] != "aprovado" and not can_manage_settings(current_user):
        raise HTTPException(status_code=403, detail="Este orçamento precisa de aprovação gerencial por estar abaixo da margem mínima.")
    db.execute(text("""
        UPDATE orcamentos SET status=:s,
            financeiro_status=CASE WHEN financeiro_status='pendente' AND :s<>'aprovado' THEN 'cancelado' ELSE financeiro_status END,
            financeiro_motivo_retorno=CASE WHEN financeiro_status='pendente' AND :s<>'aprovado' THEN :obs ELSE financeiro_motivo_retorno END,
            data_aprovacao=CASE WHEN :s='aprovado' THEN NOW() ELSE data_aprovacao END,
            aprovado_por_id=CASE WHEN :s='aprovado' THEN :u ELSE aprovado_por_id END,
            aprovado_em=CASE WHEN :s='aprovado' THEN NOW() ELSE aprovado_em END,
            aprovacao_status=CASE WHEN :s='aprovado' AND aprovacao_necessaria THEN 'aprovado' ELSE aprovacao_status END,
            atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:e
    """), {"s": new_status, "u": int(current_user.id), "id": budget_id, "e": company_id, "obs": norm_str(payload.observacao) or f"Status comercial alterado para {new_status}."})
    add_history(db, budget_id, current_user, "status_alterado", norm_str(payload.observacao) or f"Status alterado para {new_status}.", row["status"], new_status)
    db.commit()
    return get_budget(budget_id, current_user=current_user, db=db)


@router.post("/{budget_id}/aprovar-margem")
def approve_margin(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "editar")),
    db: Session = Depends(get_db),
):
    assert_settings_access(current_user)
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    found = db.execute(text("""
        UPDATE orcamentos SET aprovacao_status='aprovado', aprovado_por_id=:u, aprovado_em=NOW(), atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:e AND aprovacao_necessaria=TRUE RETURNING id
    """), {"u": int(current_user.id), "id": budget_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Orçamento sem aprovação pendente.")
    add_history(db, budget_id, current_user, "margem_aprovada", "Margem comercial aprovada pelo gestor.")
    db.commit()
    return get_budget(budget_id, current_user=current_user, db=db)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: int,
    current_user: models.Usuario = Depends(require_permission("orcamentos", "excluir")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare_write(db, company_id)
    row = db.execute(text("SELECT id, financeiro_status FROM orcamentos WHERE id=:id AND empresa_id=:e"), {"id": budget_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    fin_status = financeiro_status_norm(row.get("financeiro_status"))
    if fin_status in {"pendente", "autenticado"}:
        raise HTTPException(status_code=409, detail="Orçamento enviado ao Financeiro não pode ser excluído. Cancele o envio ou os títulos primeiro.")
    found = db.execute(text("DELETE FROM orcamentos WHERE id=:id AND empresa_id=:e RETURNING id"), {"id": budget_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    db.commit()
    return None
