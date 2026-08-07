"""Índices compostos para as listagens mais acessadas do Valora.

Revision ID: 20260806_0005
Revises: 20260806_0004
"""
from __future__ import annotations

from alembic import op

revision = "20260806_0005"
down_revision = "20260806_0004"
branch_labels = None
depends_on = None


INDEXES = [
    # Clientes / fornecedores / produtos: empresa é sempre o primeiro filtro.
    ("ix_clientes_empresa_nome_id", "clientes", "empresa_id, nome, id"),
    ("ix_clientes_empresa_situacao_nome", "clientes", "empresa_id, situacao, nome, id"),
    ("ix_fornecedores_empresa_nome_id", "fornecedores", "empresa_id, nome, id"),
    ("ix_fornecedores_empresa_situacao_nome", "fornecedores", "empresa_id, situacao, nome, id"),
    ("ix_produtos_empresa_nome_id", "produtos", "empresa_id, nome, id"),
    ("ix_produtos_empresa_ativo_nome", "produtos", "empresa_id, ativo, nome, id"),

    # Cotações / propostas: cobrem filtro por empresa/status e ordenação da página.
    ("ix_cotacoes_empresa_atualizado_id", "cotacoes", "empresa_id, atualizado_em DESC, id DESC"),
    ("ix_cotacoes_empresa_status_atualizado", "cotacoes", "empresa_id, status, atualizado_em DESC, id DESC"),
    ("ix_propostas_empresa_criado_id", "propostas", "empresa_id, criado_em DESC, id DESC"),
    ("ix_propostas_empresa_status_criado", "propostas", "empresa_id, status, criado_em DESC, id DESC"),
    ("ix_propostas_empresa_cliente_criado", "propostas", "empresa_id, cliente_id, criado_em DESC, id DESC"),

    # Orçamentos: paginação ordena por emissão + id.
    ("ix_orcamentos_empresa_emissao_id", "orcamentos", "empresa_id, data_emissao DESC, id DESC"),
    ("ix_orcamentos_empresa_status_emissao", "orcamentos", "empresa_id, status, data_emissao DESC, id DESC"),
    ("ix_orcamentos_empresa_cliente_emissao", "orcamentos", "empresa_id, cliente_id, data_emissao DESC, id DESC"),

    # Financeiro: as telas e relatórios partem de empresa/tipo e vencimento.
    ("ix_financeiro_lancamentos_empresa_vencimento", "financeiro_lancamentos", "empresa_id, data_vencimento, id DESC"),
    ("ix_financeiro_lancamentos_empresa_tipo_vencimento", "financeiro_lancamentos", "empresa_id, tipo, data_vencimento, id DESC"),
]


TRIGRAM_INDEXES = [
    ("ix_clientes_nome_trgm", "clientes", "nome"),
    ("ix_clientes_nome_fantasia_trgm", "clientes", "nome_fantasia"),
    ("ix_fornecedores_nome_trgm", "fornecedores", "nome"),
    ("ix_fornecedores_nome_fantasia_trgm", "fornecedores", "nome_fantasia"),
    ("ix_produtos_nome_trgm", "produtos", "nome"),
    ("ix_cotacoes_item_nome_trgm", "cotacoes", "item_nome"),
    ("ix_propostas_titulo_trgm", "propostas", "titulo"),
    ("ix_orcamentos_titulo_trgm", "orcamentos", "titulo"),
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")

    # As buscas do Valora usam ILIKE '%texto%'. B-tree não acelera esse padrão.
    # pg_trgm é habilitado quando o usuário do banco possui permissão; caso o
    # provedor bloqueie CREATE EXTENSION, a migration continua normalmente.
    op.execute("""
        DO $$
        BEGIN
          BEGIN
            EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_trgm não pôde ser habilitado; índices trigram serão ignorados.';
          END;
        END $$;
    """)
    for name, table, column in TRIGRAM_INDEXES:
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
                EXECUTE 'CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({column} gin_trgm_ops)';
              END IF;
            END $$;
        """)


def downgrade() -> None:
    for name, _table, _column in reversed(TRIGRAM_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for name, _table, _columns in reversed(INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
