"""Boleto, retorno bancário e conciliação integrada ao Caixa.

Revision ID: 20260821_0031
Revises: 20260821_0030
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0031"
down_revision: Union[str, Sequence[str], None] = "20260821_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS conciliacao_status VARCHAR(40)")
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS conciliado_em TIMESTAMPTZ")
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS conciliado_movimentacao_id BIGINT REFERENCES financeiro_movimentacoes(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS conciliado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS data_recebimento_gateway DATE")
    op.execute("ALTER TABLE financeiro_cobrancas_externas ADD COLUMN IF NOT EXISTS valor_recebido_gateway NUMERIC(18,2)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_conciliacao
        ON financeiro_cobrancas_externas (empresa_id, conciliacao_status, ultima_sincronizacao_em DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_provider_status
        ON financeiro_cobrancas_externas (provider, provider_status, atualizado_em DESC)
    """)

    # A versão anterior do webhook marcava o título como recebido diretamente,
    # sem criar financeiro_movimentacoes. Quando for possível reconstruir o
    # vínculo com segurança (título recebido + conta definida + nenhuma baixa
    # válida), materializamos uma única baixa legada para o Caixa não perder o
    # movimento. Se já existir baixa, apenas vinculamos a conciliação a ela.
    op.execute("""
        INSERT INTO financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            valor_principal, valor_desconto, valor_acrescimo, valor_multa, valor_mora,
            dias_atraso, modalidade_baixa, data_movimentacao, forma_pagamento_id,
            conta_banco_id, conta_contabil_id, centro_custo_principal_id, centro_custo_secundario_id,
            chave_idempotencia, observacoes, usuario_id, criado_em
        )
        SELECT
            l.empresa_id, l.id, 'baixa', LEAST(l.valor_pago, l.valor_total),
            LEAST(l.valor_pago, l.valor_total), 0, 0, 0, 0,
            GREATEST(0, COALESCE(l.data_pagamento, l.data_vencimento) - l.data_vencimento),
            CASE WHEN l.valor_pago >= l.valor_total THEN 'total' ELSE 'parcial' END,
            COALESCE(l.data_pagamento, l.data_vencimento, CURRENT_DATE), l.forma_pagamento_id,
            l.conta_banco_id, l.conta_contabil_id, l.centro_custo_principal_id, l.centro_custo_secundario_id,
            LEFT('asaas' || chr(58) || ce.provider_payment_id || chr(58) || 'received', 100),
            'Baixa reconstruída da cobrança Asaas já recebida antes da conciliação integrada.',
            NULL, COALESCE(ce.ultima_sincronizacao_em, ce.atualizado_em, NOW())
        FROM financeiro_cobrancas_externas ce
        JOIN financeiro_lancamentos l ON l.id=ce.lancamento_id AND l.empresa_id=ce.empresa_id
        WHERE ce.provider='asaas'
          AND UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
          AND l.tipo='receber'
          AND l.status <> 'cancelado'
          AND COALESCE(l.valor_pago,0) > 0
          AND l.conta_banco_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM financeiro_movimentacoes b
              WHERE b.empresa_id=l.empresa_id AND b.lancamento_id=l.id AND b.tipo_movimentacao='baixa'
                AND NOT EXISTS (
                    SELECT 1 FROM financeiro_movimentacoes e
                    WHERE e.empresa_id=b.empresa_id AND e.movimentacao_origem_id=b.id AND e.tipo_movimentacao='estorno'
                )
          )
        ON CONFLICT DO NOTHING
    """)

    op.execute("""
        UPDATE financeiro_cobrancas_externas ce
        SET conciliado_movimentacao_id = mov.id,
            conciliacao_status = 'conciliado',
            conciliado_em = COALESCE(ce.conciliado_em, ce.ultima_sincronizacao_em, ce.atualizado_em, NOW()),
            conciliado_automaticamente = CASE WHEN mov.chave_idempotencia LIKE 'asaas:%' THEN TRUE ELSE FALSE END,
            data_recebimento_gateway = COALESCE(ce.data_recebimento_gateway, l.data_pagamento),
            valor_recebido_gateway = COALESCE(ce.valor_recebido_gateway, l.valor_pago)
        FROM financeiro_lancamentos l
        JOIN LATERAL (
            SELECT b.id, b.chave_idempotencia
            FROM financeiro_movimentacoes b
            WHERE b.empresa_id=l.empresa_id AND b.lancamento_id=l.id AND b.tipo_movimentacao='baixa'
              AND NOT EXISTS (
                  SELECT 1 FROM financeiro_movimentacoes e
                  WHERE e.empresa_id=b.empresa_id AND e.movimentacao_origem_id=b.id AND e.tipo_movimentacao='estorno'
              )
            ORDER BY CASE WHEN b.chave_idempotencia LIKE 'asaas:%' THEN 0 ELSE 1 END, b.id DESC
            LIMIT 1
        ) mov ON TRUE
        WHERE l.id=ce.lancamento_id AND l.empresa_id=ce.empresa_id
          AND UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
          AND ce.conciliacao_status IS NULL
    """)

    # Retorno recebido sem Conta Corrente não pode virar baixa automática:
    # fica explicitamente pendente para o operador escolher o destino.
    op.execute("""
        UPDATE financeiro_cobrancas_externas ce
        SET conciliacao_status = CASE
            WHEN UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
                 AND l.status='cancelado' THEN 'divergencia_titulo_cancelado'
            WHEN UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
                 THEN 'aguardando_conta'
            WHEN UPPER(COALESCE(ce.provider_status,'')) IN ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS')
                 THEN 'estornado_no_gateway'
            ELSE 'aguardando_retorno'
        END,
        data_recebimento_gateway = CASE
            WHEN UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
                THEN COALESCE(ce.data_recebimento_gateway, l.data_pagamento)
            ELSE ce.data_recebimento_gateway
        END,
        valor_recebido_gateway = CASE
            WHEN UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
                THEN COALESCE(ce.valor_recebido_gateway, l.valor_pago)
            ELSE ce.valor_recebido_gateway
        END
        FROM financeiro_lancamentos l
        WHERE l.id=ce.lancamento_id AND l.empresa_id=ce.empresa_id
          AND ce.conciliacao_status IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fin_cobranca_externa_provider_status")
    op.execute("DROP INDEX IF EXISTS ix_fin_cobranca_externa_conciliacao")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS valor_recebido_gateway")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS data_recebimento_gateway")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS conciliado_automaticamente")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS conciliado_movimentacao_id")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS conciliado_em")
    op.execute("ALTER TABLE financeiro_cobrancas_externas DROP COLUMN IF EXISTS conciliacao_status")
