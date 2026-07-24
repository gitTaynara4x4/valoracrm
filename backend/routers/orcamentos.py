from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
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
_SCHEMA_READY = False
_PREPARED_COMPANIES: set[int] = set()


def norm_str(value: Any) -> Optional[str]:
    value = str(value or "").strip()
    return value or None


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
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS cadastro_sequencias (
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(40) NOT NULL,
            ultimo_codigo BIGINT NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (empresa_id, modulo)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_configuracoes (
            empresa_id BIGINT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
            nome_documento VARCHAR(80) NOT NULL DEFAULT 'Orçamento',
            prefixo VARCHAR(20) NOT NULL DEFAULT 'ORC',
            validade_padrao_dias INTEGER NOT NULL DEFAULT 7,
            prazo_execucao_padrao VARCHAR(160),
            condicoes_padrao TEXT,
            observacoes_padrao TEXT,
            rodape_padrao TEXT,
            cor_primaria VARCHAR(20) NOT NULL DEFAULT '#65ACDE',
            titulo_capa VARCHAR(180),
            subtitulo_capa VARCHAR(220),
            usar_capa BOOLEAN NOT NULL DEFAULT FALSE,
            escala_documento_padrao INTEGER NOT NULL DEFAULT 100,
            mostrar_codigo BOOLEAN NOT NULL DEFAULT TRUE,
            mostrar_desconto BOOLEAN NOT NULL DEFAULT TRUE,
            mostrar_imagens BOOLEAN NOT NULL DEFAULT FALSE,
            controlar_custos BOOLEAN NOT NULL DEFAULT TRUE,
            margem_minima NUMERIC(14,4) NOT NULL DEFAULT 0,
            exigir_aprovacao_margem BOOLEAN NOT NULL DEFAULT FALSE,
            formas_pagamento_json TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    for sql in (
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS modelo_documento VARCHAR(30) NOT NULL DEFAULT 'padrao'",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS dav_titulo VARCHAR(140) NOT NULL DEFAULT 'DAV - Documento Auxiliar de Venda'",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_razao_social VARCHAR(180)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_nome_fantasia VARCHAR(180)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_cnpj VARCHAR(30)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_email VARCHAR(255)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_site VARCHAR(255)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_telefone VARCHAR(60)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_endereco TEXT",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_rodape TEXT",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS preset_aplicado VARCHAR(80)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS escala_documento_padrao INTEGER NOT NULL DEFAULT 100",
    ):
        db.execute(text(sql))

    # Remove somente o cabeçalho gravado pelo preset antigo. Os dados corretos
    # passam a vir do perfil emitente escolhido, sem alterar o cadastro principal.
    db.execute(text("""
        UPDATE orcamento_configuracoes SET
            cabecalho_razao_social=NULL,
            cabecalho_nome_fantasia=NULL,
            cabecalho_cnpj=NULL,
            cabecalho_email=NULL,
            cabecalho_site=NULL,
            cabecalho_telefone=NULL,
            cabecalho_endereco=NULL,
            cabecalho_rodape=NULL,
            preset_aplicado=NULL,
            atualizado_em=NOW()
        WHERE preset_aplicado='segsis_dav_v1'
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_emitentes (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(160) NOT NULL,
            razao_social VARCHAR(180) NOT NULL,
            nome_fantasia VARCHAR(180),
            cnpj VARCHAR(30),
            inscricao_estadual VARCHAR(40),
            email VARCHAR(255),
            site VARCHAR(255),
            telefone VARCHAR(60),
            cep VARCHAR(20),
            endereco VARCHAR(240),
            numero VARCHAR(30),
            complemento VARCHAR(120),
            bairro VARCHAR(120),
            cidade VARCHAR(120),
            estado VARCHAR(20),
            logo_url TEXT,
            rodape TEXT,
            padrao BOOLEAN NOT NULL DEFAULT FALSE,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_emitente_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_orcamento_emitentes_empresa ON orcamento_emitentes (empresa_id, ativo, nome)"))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_categorias (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(140) NOT NULL,
            descricao TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_categoria_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_modelos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            categoria_id BIGINT REFERENCES orcamento_categorias(id) ON DELETE SET NULL,
            nome VARCHAR(160) NOT NULL,
            titulo VARCHAR(180),
            descricao TEXT,
            validade_dias INTEGER,
            prazo_execucao VARCHAR(160),
            condicoes TEXT,
            observacoes TEXT,
            pagamentos_json TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_modelo_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_modelo_itens (
            id BIGSERIAL PRIMARY KEY,
            modelo_id BIGINT NOT NULL REFERENCES orcamento_modelos(id) ON DELETE CASCADE,
            produto_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
            codigo VARCHAR(50),
            descricao TEXT NOT NULL,
            referencia VARCHAR(160),
            unidade VARCHAR(30),
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            valor_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            observacao TEXT,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_kits (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(160) NOT NULL,
            descricao TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_kit_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_kit_itens (
            id BIGSERIAL PRIMARY KEY,
            kit_id BIGINT NOT NULL REFERENCES orcamento_kits(id) ON DELETE CASCADE,
            produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_kit_produto UNIQUE (kit_id, produto_id)
        )
    """))

    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orcamento_kits_empresa_ativo ON orcamento_kits (empresa_id, ativo, nome)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orcamento_kit_itens_kit_ordem ON orcamento_kit_itens (kit_id, ordem, id)"))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamentos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
            usuario_criador_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            consultor_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            categoria_id BIGINT REFERENCES orcamento_categorias(id) ON DELETE SET NULL,
            modelo_id BIGINT REFERENCES orcamento_modelos(id) ON DELETE SET NULL,
            codigo VARCHAR(50) NOT NULL,
            titulo VARCHAR(180) NOT NULL,
            nome_documento VARCHAR(80) NOT NULL DEFAULT 'Orçamento',
            status VARCHAR(40) NOT NULL DEFAULT 'rascunho',
            versao INTEGER NOT NULL DEFAULT 1,
            data_solicitacao DATE,
            data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
            data_validade DATE,
            data_aprovacao TIMESTAMPTZ,
            responsavel_cliente VARCHAR(160),
            contato_cliente VARCHAR(100),
            endereco_cep VARCHAR(20),
            endereco_logradouro VARCHAR(200),
            endereco_numero VARCHAR(30),
            endereco_complemento VARCHAR(120),
            endereco_bairro VARCHAR(120),
            endereco_cidade VARCHAR(120),
            endereco_estado VARCHAR(20),
            desconto_tipo VARCHAR(20) NOT NULL DEFAULT 'valor',
            desconto_valor NUMERIC(18,4) NOT NULL DEFAULT 0,
            desconto_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            frete NUMERIC(18,4) NOT NULL DEFAULT 0,
            acrescimo NUMERIC(18,4) NOT NULL DEFAULT 0,
            subtotal NUMERIC(18,4) NOT NULL DEFAULT 0,
            total NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            lucro_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            margem_percentual NUMERIC(18,4) NOT NULL DEFAULT 0,
            prazo_execucao VARCHAR(160),
            condicoes TEXT,
            observacoes TEXT,
            pagamentos_json TEXT,
            usar_capa BOOLEAN NOT NULL DEFAULT FALSE,
            titulo_capa VARCHAR(180),
            subtitulo_capa VARCHAR(220),
            escala_documento INTEGER NOT NULL DEFAULT 100,
            aprovacao_necessaria BOOLEAN NOT NULL DEFAULT FALSE,
            aprovacao_status VARCHAR(30),
            aprovado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            aprovado_em TIMESTAMPTZ,
            legacy_proposta_id BIGINT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamentos_empresa_codigo UNIQUE (empresa_id, codigo),
            CONSTRAINT uq_orcamentos_empresa_legacy UNIQUE (empresa_id, legacy_proposta_id)
        )
    """))

    for sql in (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_nome_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_nome_fantasia_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_cpf_cnpj VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_rg_ie VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_telefone VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_whatsapp_documento VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_fax VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_email_nfe VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_contato_nome VARCHAR(120)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_id BIGINT REFERENCES orcamento_emitentes(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_nome_documento VARCHAR(160)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_razao_social_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_nome_fantasia_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_cnpj_documento VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_ie_documento VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_email_documento VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_site_documento VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_telefone_documento VARCHAR(60)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_endereco_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_logo_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_rodape_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS itens_sem_custo INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS escala_documento INTEGER NOT NULL DEFAULT 100",
    ):
        db.execute(text(sql))

    db.execute(text("""
        UPDATE orcamento_configuracoes
        SET escala_documento_padrao=100
        WHERE escala_documento_padrao IS NULL OR escala_documento_padrao < 70 OR escala_documento_padrao > 125
    """))
    db.execute(text("""
        UPDATE orcamentos
        SET escala_documento=100
        WHERE escala_documento IS NULL OR escala_documento < 70 OR escala_documento > 125
    """))

    db.execute(text("""
        UPDATE orcamentos o SET
            cliente_nome_documento=COALESCE(o.cliente_nome_documento, c.nome),
            cliente_nome_fantasia_documento=COALESCE(o.cliente_nome_fantasia_documento, c.nome_fantasia),
            cliente_cpf_cnpj=COALESCE(o.cliente_cpf_cnpj, c.cpf_cnpj),
            cliente_rg_ie=COALESCE(o.cliente_rg_ie, c.rg_ie),
            cliente_telefone=COALESCE(o.cliente_telefone, c.telefone),
            cliente_whatsapp_documento=COALESCE(o.cliente_whatsapp_documento, c.whatsapp),
            cliente_fax=COALESCE(o.cliente_fax, c.fax),
            cliente_email_nfe=COALESCE(o.cliente_email_nfe, c.email_nfe),
            cliente_contato_nome=COALESCE(o.cliente_contato_nome, c.contato)
        FROM clientes c
        WHERE o.cliente_id=c.id AND o.empresa_id=c.empresa_id
          AND (o.cliente_nome_documento IS NULL OR o.cliente_cpf_cnpj IS NULL)
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_itens (
            id BIGSERIAL PRIMARY KEY,
            orcamento_id BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
            produto_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
            origem VARCHAR(30) NOT NULL DEFAULT 'manual',
            codigo VARCHAR(50),
            descricao TEXT NOT NULL,
            referencia VARCHAR(160),
            unidade VARCHAR(30),
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            valor_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            desconto NUMERIC(18,4) NOT NULL DEFAULT 0,
            valor_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_informado BOOLEAN NOT NULL DEFAULT FALSE,
            custo_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            lucro_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            margem_percentual NUMERIC(18,4) NOT NULL DEFAULT 0,
            observacao TEXT,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    db.execute(text("ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS custo_informado BOOLEAN NOT NULL DEFAULT FALSE"))
    db.execute(text("""
        UPDATE orcamento_itens
        SET custo_informado=TRUE
        WHERE custo_informado=FALSE AND COALESCE(custo_unitario, 0) <> 0
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_historico (
            id BIGSERIAL PRIMARY KEY,
            orcamento_id BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            usuario_nome VARCHAR(160),
            acao VARCHAR(60) NOT NULL,
            status_anterior VARCHAR(40),
            status_novo VARCHAR(40),
            descricao TEXT,
            dados_json TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    for sql in (
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_status ON orcamentos (empresa_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_cliente ON orcamentos (empresa_id, cliente_id)",
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_data_emissao ON orcamentos (data_emissao DESC)",
        "CREATE INDEX IF NOT EXISTS ix_orcamento_itens_orcamento ON orcamento_itens (orcamento_id, ordem)",
        "CREATE INDEX IF NOT EXISTS ix_orcamento_historico_orcamento ON orcamento_historico (orcamento_id, criado_em DESC)",
    ):
        db.execute(text(sql))

    # Mantém compatibilidade com as permissões que antes eram usadas pela tela de Propostas.
    # A cópia só ocorre quando ainda não existe uma permissão específica de Orçamentos.
    db.execute(text("""
        INSERT INTO usuarios_permissoes (
            empresa_id, usuario_id, modulo, pode_ver, pode_criar, pode_editar, pode_excluir
        )
        SELECT empresa_id, usuario_id, 'orcamentos', pode_ver, pode_criar, pode_editar, pode_excluir
        FROM usuarios_permissoes origem
        WHERE origem.modulo='propostas'
        ON CONFLICT (usuario_id, modulo) DO NOTHING
    """))

    db.commit()
    _SCHEMA_READY = True


def ensure_default_config(db: Session, empresa_id: int) -> None:
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

    db.commit()


def maybe_import_legacy(db: Session, empresa_id: int) -> None:
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

    db.commit()


def prepare(db: Session, empresa_id: int) -> None:
    if empresa_id in _PREPARED_COMPANIES:
        return
    ensure_schema(db)
    ensure_default_config(db, empresa_id)
    try:
        maybe_import_legacy(db, empresa_id)
    except Exception:
        db.rollback()
    _PREPARED_COMPANIES.add(empresa_id)


def next_code(db: Session, empresa_id: int, consume: bool) -> str:
    prepare(db, empresa_id)
    config = db.execute(text("SELECT prefixo FROM orcamento_configuracoes WHERE empresa_id=:e"), {"e": empresa_id}).mappings().first()
    prefix = re.sub(r"[^A-Za-z0-9_-]", "", (config or {}).get("prefixo") or "ORC").upper()[:20] or "ORC"

    max_existing = db.execute(text("""
        SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '\\D', '', 'g'), '')::bigint), 0)
        FROM orcamentos WHERE empresa_id=:e
    """), {"e": empresa_id}).scalar() or 0

    db.execute(text("""
        INSERT INTO cadastro_sequencias (empresa_id, modulo, ultimo_codigo)
        VALUES (:e, 'orcamentos', :m)
        ON CONFLICT (empresa_id, modulo)
        DO UPDATE SET ultimo_codigo=GREATEST(cadastro_sequencias.ultimo_codigo, EXCLUDED.ultimo_codigo), atualizado_em=NOW()
    """), {"e": empresa_id, "m": int(max_existing)})

    if consume:
        number = db.execute(text("""
            UPDATE cadastro_sequencias
            SET ultimo_codigo=ultimo_codigo+1, atualizado_em=NOW()
            WHERE empresa_id=:e AND modulo='orcamentos'
            RETURNING ultimo_codigo
        """), {"e": empresa_id}).scalar_one()
        db.commit()
    else:
        number = db.execute(text("""
            SELECT ultimo_codigo+1 FROM cadastro_sequencias
            WHERE empresa_id=:e AND modulo='orcamentos'
        """), {"e": empresa_id}).scalar_one()
        db.rollback()
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
    return db.execute(text("""
        SELECT id, codigo, nome, descricao, unidade, preco_venda, custo
        FROM produtos WHERE id=:id AND empresa_id=:e
    """), {"id": product_id, "e": company_id}).mappings().first()


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
        if not description:
            continue

        qty = max(money(item.quantidade, Decimal("1")), Decimal("0.0001"))
        unit_value = max(money(item.valor_unitario), Decimal("0"))
        discount = max(money(item.desconto), Decimal("0"))
        product = product_for_company(db, int(item.produto_id), company_id) if item.produto_id else None
        previous_entry = existing_costs.get(int(item.id)) if item.id else None
        if isinstance(previous_entry, tuple):
            previous_cost, previous_cost_known = previous_entry
        elif previous_entry is not None:
            previous_cost, previous_cost_known = previous_entry, True
        else:
            previous_cost, previous_cost_known = None, False
        submitted_cost = None if item.custo_unitario is None else max(money(item.custo_unitario), Decimal("0"))

        if product:
            code = norm_str(item.codigo) or product["codigo"]
            unit = norm_str(item.unidade) or product["unidade"] or "UN"
            product_sale_raw = product.get("preco_venda")
            product_has_sale = product_sale_raw is not None and str(product_sale_raw).strip() != ""
            if refresh_product_prices and product_has_sale:
                unit_value = max(money(product_sale_raw), Decimal("0"))

            product_cost_raw = product.get("custo")
            product_cost = max(money(product_cost_raw), Decimal("0"))
            product_has_cost = product_cost_raw is not None and str(product_cost_raw).strip() != ""

            # Na atualização explícita de preços, o cadastro do produto é a fonte
            # principal. Campo vazio no cadastro preserva o valor antigo para não
            # apagar preços já negociados por acidente.
            if refresh_product_prices and product_has_cost:
                cost_unit = product_cost
                cost_known = True
            # O custo cadastrado no banco é a fonte padrão. Um zero enviado pelo
            # navegador não apaga o custo do produto. Usuários autorizados podem
            # substituir o custo quando enviam um valor explícito.
            elif allow_cost and submitted_cost is not None and (submitted_cost > 0 or not product_has_cost):
                cost_unit = submitted_cost
                cost_known = True
            elif previous_cost is not None and previous_cost_known:
                cost_unit = max(previous_cost, Decimal("0"))
                cost_known = True
            else:
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
            "referencia": norm_str(item.referencia),
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


def get_config_row(db: Session, company_id: int) -> dict:
    prepare(db, company_id)
    row = db.execute(text("SELECT * FROM orcamento_configuracoes WHERE empresa_id=:e"), {"e": company_id}).mappings().first()
    return dict(row or {})


def validate_company_fk(db: Session, table: str, row_id: Optional[int], company_id: int, label: str) -> None:
    if not row_id:
        return
    if table not in {"clientes", "usuarios", "orcamento_categorias", "orcamento_modelos"}:
        raise ValueError("Tabela inválida")
    found = db.execute(text(f"SELECT id FROM {table} WHERE id=:id AND empresa_id=:e"), {"id": row_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=422, detail=f"{label} não pertence a esta empresa.")


def serialize_items(db: Session, budget_id: int, show_costs: bool) -> List[dict]:
    rows = db.execute(text("""
        SELECT * FROM orcamento_itens WHERE orcamento_id=:o ORDER BY ordem, id
    """), {"o": budget_id}).mappings().all()
    output = []
    for row in rows:
        item = dict(row)
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


def serialize_budget(db: Session, row: dict, user: models.Usuario, complete: bool = True) -> dict:
    out = dict(row)
    show_costs = can_view_costs(user, db)
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
    out["pode_ver_custos"] = show_costs
    if complete:
        out["itens"] = serialize_items(db, int(out["id"]), show_costs)
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
        "usuario": {"id": int(current_user.id), "nome": current_user.nome, "papel": current_user.papel},
        "configuracao": config_out,
        "emitentes": [serialize_emitter(dict(row)) for row in emitters],
    }


@router.get("/proximo-codigo")
def get_next_code(
    current_user: models.Usuario = Depends(require_permission("orcamentos", "criar")),
    db: Session = Depends(get_db),
):
    return {"codigo": next_code(db, int(current_user.empresa_id), consume=False)}


@router.get("")
def list_budgets(
    busca: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare(db, company_id)
    where = ["o.empresa_id=:e"]
    params: Dict[str, Any] = {"e": company_id}
    if norm_str(busca):
        where.append("(o.codigo ILIKE :q OR o.titulo ILIKE :q OR c.nome ILIKE :q OR c.nome_fantasia ILIKE :q)")
        params["q"] = f"%{str(busca).strip()}%"
    if norm_str(status_filter):
        where.append("o.status=:s")
        params["s"] = status_norm(status_filter)
    rows = db.execute(text(base_select() + " WHERE " + " AND ".join(where) + " ORDER BY o.data_emissao DESC, o.id DESC"), params).mappings().all()
    return [serialize_budget(db, dict(row), current_user, complete=False) for row in rows]


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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: models.Usuario = Depends(require_permission("orcamentos", "ver")),
    db: Session = Depends(get_db),
):
    company_id = int(current_user.empresa_id)
    prepare(db, company_id)
    where = ["empresa_id=:empresa_id", "ativo=TRUE"]
    params: Dict[str, Any] = {"empresa_id": company_id}
    if norm_str(busca):
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
    rows = ordered_rows[offset:offset + limit]

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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
        result = []
        for item in items:
            obj = dict(item)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    prepare(db, company_id)
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
    code = next_code(db, company_id, consume=True)

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
    prepare(db, company_id)
    old = budget_row(db, budget_id, company_id)
    if not old:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    data = dict(old)
    if atualizar_precos and status_norm(data.get("status")) in STATUS_PRECOS_BLOQUEADOS:
        raise HTTPException(
            status_code=409,
            detail="Este orçamento já está encerrado. Duplique-o para atualizar os preços em uma nova versão.",
        )

    incoming = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    current_items = serialize_items(db, budget_id, show_costs=True)
    base_fields = list(getattr(BudgetBase, "model_fields", {}).keys()) or list(getattr(BudgetBase, "__fields__", {}).keys())
    merged = {**{k: data.get(k) for k in base_fields}, **incoming}
    merged["itens"] = incoming.get("itens", current_items)
    merged["pagamentos"] = incoming.get("pagamentos", json_load(data.get("pagamentos_json"), []))
    effective = BudgetCreate(**merged)
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
        condicoes=source.get("condicoes"), observacoes=source.get("observacoes"), pagamentos=source.get("pagamentos") or [],
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
    prepare(db, company_id)
    row = db.execute(text("SELECT id, status, aprovacao_necessaria, aprovacao_status FROM orcamentos WHERE id=:id AND empresa_id=:e"), {"id": budget_id, "e": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    new_status = status_norm(payload.status)
    if new_status == "aprovado" and row["aprovacao_necessaria"] and row["aprovacao_status"] != "aprovado" and not can_manage_settings(current_user):
        raise HTTPException(status_code=403, detail="Este orçamento precisa de aprovação gerencial por estar abaixo da margem mínima.")
    db.execute(text("""
        UPDATE orcamentos SET status=:s,
            data_aprovacao=CASE WHEN :s='aprovado' THEN NOW() ELSE data_aprovacao END,
            aprovado_por_id=CASE WHEN :s='aprovado' THEN :u ELSE aprovado_por_id END,
            aprovado_em=CASE WHEN :s='aprovado' THEN NOW() ELSE aprovado_em END,
            aprovacao_status=CASE WHEN :s='aprovado' AND aprovacao_necessaria THEN 'aprovado' ELSE aprovacao_status END,
            atualizado_em=NOW()
        WHERE id=:id AND empresa_id=:e
    """), {"s": new_status, "u": int(current_user.id), "id": budget_id, "e": company_id})
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
    prepare(db, company_id)
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
    prepare(db, company_id)
    found = db.execute(text("DELETE FROM orcamentos WHERE id=:id AND empresa_id=:e RETURNING id"), {"id": budget_id, "e": company_id}).scalar()
    if not found:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    db.commit()
    return None
