"""Homologa conciliação/estorno do núcleo financeiro JCC.

Revision ID: 20260821_0032
Revises: 20260821_0031
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260821_0032"
down_revision: Union[str, Sequence[str], None] = "20260821_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Pedido de reembolso ainda não significa que o dinheiro voltou. Mantemos a
    # baixa financeira até o gateway confirmar REFUNDED.
    op.execute("""
        UPDATE financeiro_cobrancas_externas
        SET conciliacao_status='estorno_pendente_gateway', atualizado_em=NOW()
        WHERE provider='asaas'
          AND UPPER(COALESCE(provider_status,'')) IN ('REFUND_REQUESTED','REFUND_IN_PROGRESS')
    """)

    # Corrige cobranças já reembolsadas antes desta versão: a baixa que entrou no
    # Banco/Caixa precisa ter um estorno correspondente. O vínculo de origem e o
    # índice de estorno garantem idempotência.
    op.execute("""
        INSERT INTO financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            valor_principal, valor_desconto, valor_acrescimo, valor_multa, valor_mora,
            dias_atraso, modalidade_baixa, data_movimentacao, forma_pagamento_id,
            conta_banco_id, conta_contabil_id, centro_custo_principal_id, centro_custo_secundario_id,
            movimentacao_origem_id, observacoes, usuario_id, criado_em
        )
        SELECT
            b.empresa_id, b.lancamento_id, 'estorno', b.valor,
            b.valor_principal, b.valor_desconto, b.valor_acrescimo, b.valor_multa, b.valor_mora,
            b.dias_atraso, b.modalidade_baixa, CURRENT_DATE, b.forma_pagamento_id,
            b.conta_banco_id, b.conta_contabil_id, b.centro_custo_principal_id, b.centro_custo_secundario_id,
            b.id,
            'Estorno automático de cobrança Asaas já marcada como REFUNDED na homologação financeira.',
            NULL, NOW()
        FROM financeiro_cobrancas_externas ce
        JOIN financeiro_movimentacoes b
          ON b.id=ce.conciliado_movimentacao_id
         AND b.empresa_id=ce.empresa_id
         AND b.lancamento_id=ce.lancamento_id
         AND b.tipo_movimentacao='baixa'
        WHERE ce.provider='asaas'
          AND UPPER(COALESCE(ce.provider_status,''))='REFUNDED'
          AND NOT EXISTS (
              SELECT 1
              FROM financeiro_movimentacoes e
              WHERE e.empresa_id=b.empresa_id
                AND e.movimentacao_origem_id=b.id
                AND e.tipo_movimentacao='estorno'
          )
        ON CONFLICT DO NOTHING
    """)

    # Recalcula os títulos afetados pelos reembolsos confirmados para que
    # Contas a Receber, Caixa e saldo da Conta Corrente voltem a concordar.
    op.execute("""
        WITH afetados AS (
            SELECT DISTINCT ce.empresa_id, ce.lancamento_id
            FROM financeiro_cobrancas_externas ce
            WHERE ce.provider='asaas'
              AND UPPER(COALESCE(ce.provider_status,''))='REFUNDED'
        ), totais AS (
            SELECT
                a.empresa_id,
                a.lancamento_id,
                GREATEST(0, COALESCE(SUM(
                    CASE
                        WHEN m.tipo_movimentacao='baixa'
                            THEN COALESCE(NULLIF(m.valor_principal,0), m.valor)
                        WHEN m.tipo_movimentacao='estorno'
                            THEN -COALESCE(NULLIF(m.valor_principal,0), m.valor)
                        ELSE 0
                    END
                ),0)) AS valor_pago,
                MAX(m.data_movimentacao) FILTER (
                    WHERE m.tipo_movimentacao='baixa'
                      AND NOT EXISTS (
                          SELECT 1 FROM financeiro_movimentacoes e
                          WHERE e.empresa_id=m.empresa_id
                            AND e.movimentacao_origem_id=m.id
                            AND e.tipo_movimentacao='estorno'
                      )
                ) AS ultima_baixa_ativa
            FROM afetados a
            LEFT JOIN financeiro_movimentacoes m
              ON m.empresa_id=a.empresa_id
             AND m.lancamento_id=a.lancamento_id
             AND m.tipo_movimentacao IN ('baixa','estorno')
            GROUP BY a.empresa_id, a.lancamento_id
        )
        UPDATE financeiro_lancamentos l
        SET valor_pago=t.valor_pago,
            data_pagamento=t.ultima_baixa_ativa,
            status=CASE
                WHEN l.status='cancelado' THEN 'cancelado'
                WHEN l.valor_total > 0 AND t.valor_pago >= l.valor_total THEN 'recebido'
                WHEN t.valor_pago > 0 THEN 'parcial'
                WHEN l.data_vencimento < CURRENT_DATE THEN 'vencido'
                ELSE 'aberto'
            END,
            atualizado_em=NOW()
        FROM totais t
        WHERE l.empresa_id=t.empresa_id AND l.id=t.lancamento_id
    """)

    op.execute("""
        UPDATE financeiro_cobrancas_externas
        SET conciliacao_status='estornado_no_gateway', atualizado_em=NOW()
        WHERE provider='asaas'
          AND UPPER(COALESCE(provider_status,''))='REFUNDED'
    """)

    # Se o operador estornou manualmente uma baixa mas o gateway continua
    # informando RECEIVED, não podemos chamar isso de conciliado silenciosamente.
    op.execute("""
        UPDATE financeiro_cobrancas_externas ce
        SET conciliacao_status='divergencia_baixa_estornada', atualizado_em=NOW()
        WHERE ce.provider='asaas'
          AND UPPER(COALESCE(ce.provider_status,'')) IN ('RECEIVED','RECEIVED_IN_CASH')
          AND ce.conciliado_movimentacao_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM financeiro_movimentacoes e
              WHERE e.empresa_id=ce.empresa_id
                AND e.movimentacao_origem_id=ce.conciliado_movimentacao_id
                AND e.tipo_movimentacao='estorno'
          )
    """)


def downgrade() -> None:
    # Os estornos financeiros materializados por esta migration representam
    # fatos já confirmados pelo gateway e não podem ser apagados com segurança
    # em downgrade. Reverte apenas a nomenclatura de status não destrutiva.
    op.execute("""
        UPDATE financeiro_cobrancas_externas
        SET conciliacao_status='estornado_no_gateway', atualizado_em=NOW()
        WHERE provider='asaas' AND conciliacao_status='estorno_pendente_gateway'
    """)
