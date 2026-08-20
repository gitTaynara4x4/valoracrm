"""Integra Unidades de Consumo às bases de RH/Funções e Patrimônio.

Revision ID: 20260817_0012
Revises: 20260817_0011
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260817_0012"
down_revision: Union[str, Sequence[str], None] = "20260817_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Vínculos reais com as fontes já existentes no Valora. Cargo/função ainda
    # é armazenado pela chave textual porque o RH atual mantém a função no campo
    # usuarios.cargo, sem uma tabela própria de funções.
    op.execute(
        "ALTER TABLE financeiro_unidades_consumo ADD COLUMN IF NOT EXISTS "
        "referencia_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE financeiro_unidades_consumo ADD COLUMN IF NOT EXISTS "
        "referencia_patrimonio_id BIGINT REFERENCES patrimonios(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE financeiro_unidades_consumo ADD COLUMN IF NOT EXISTS "
        "referencia_cargo VARCHAR(80)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_uc_referencia_usuario "
        "ON financeiro_unidades_consumo (empresa_id, referencia_usuario_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_uc_referencia_patrimonio "
        "ON financeiro_unidades_consumo (empresa_id, referencia_patrimonio_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_uc_referencia_cargo "
        "ON financeiro_unidades_consumo (empresa_id, referencia_cargo)"
    )

    # Migração conservadora dos cadastros antigos: só cria o vínculo quando há
    # uma única correspondência inequívoca na empresa. O restante permanece
    # visível como "vínculo pendente" para o usuário corrigir pela tela.
    op.execute(
        """
        WITH candidatos AS (
            SELECT uc.id AS unidade_id, MIN(p.id) AS patrimonio_id
            FROM financeiro_unidades_consumo uc
            JOIN patrimonios p
              ON p.empresa_id = uc.empresa_id
             AND (
                  LOWER(TRIM(p.nome)) = LOWER(TRIM(uc.nome))
                  OR (uc.departamento_referencia IS NOT NULL AND LOWER(TRIM(p.nome)) = LOWER(TRIM(uc.departamento_referencia)))
                  OR (uc.departamento_referencia IS NOT NULL AND LOWER(TRIM(p.codigo)) = LOWER(TRIM(uc.departamento_referencia)))
             )
            WHERE LOWER(COALESCE(uc.tipo_referencia, '')) = 'patrimonio'
              AND uc.referencia_patrimonio_id IS NULL
            GROUP BY uc.id
            HAVING COUNT(*) = 1
        )
        UPDATE financeiro_unidades_consumo uc
           SET referencia_patrimonio_id = c.patrimonio_id,
               atualizado_em = NOW()
          FROM candidatos c
         WHERE uc.id = c.unidade_id
        """
    )
    op.execute(
        """
        WITH candidatos AS (
            SELECT uc.id AS unidade_id, MIN(u.id) AS usuario_id
            FROM financeiro_unidades_consumo uc
            JOIN usuarios u
              ON u.empresa_id = uc.empresa_id
             AND (
                  LOWER(TRIM(u.nome)) = LOWER(TRIM(uc.nome))
                  OR (uc.departamento_referencia IS NOT NULL AND LOWER(TRIM(u.nome)) = LOWER(TRIM(uc.departamento_referencia)))
             )
            WHERE LOWER(COALESCE(uc.tipo_referencia, '')) = 'colaborador'
              AND uc.referencia_usuario_id IS NULL
            GROUP BY uc.id
            HAVING COUNT(*) = 1
        )
        UPDATE financeiro_unidades_consumo uc
           SET referencia_usuario_id = c.usuario_id,
               atualizado_em = NOW()
          FROM candidatos c
         WHERE uc.id = c.unidade_id
        """
    )
    op.execute(
        """
        UPDATE financeiro_unidades_consumo uc
           SET referencia_cargo = src.cargo,
               atualizado_em = NOW()
          FROM (
              SELECT empresa_id, LOWER(TRIM(cargo)) AS cargo_key, MIN(TRIM(cargo)) AS cargo
              FROM usuarios
              WHERE cargo IS NOT NULL AND TRIM(cargo) <> ''
              GROUP BY empresa_id, LOWER(TRIM(cargo))
          ) src
         WHERE src.empresa_id = uc.empresa_id
           AND LOWER(COALESCE(uc.tipo_referencia, '')) = 'cargo'
           AND uc.referencia_cargo IS NULL
           AND (
                LOWER(TRIM(uc.nome)) = src.cargo_key
                OR (uc.departamento_referencia IS NOT NULL AND LOWER(TRIM(uc.departamento_referencia)) = src.cargo_key)
           )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_financeiro_uc_referencia_cargo")
    op.execute("DROP INDEX IF EXISTS ix_financeiro_uc_referencia_patrimonio")
    op.execute("DROP INDEX IF EXISTS ix_financeiro_uc_referencia_usuario")
    op.execute("ALTER TABLE financeiro_unidades_consumo DROP COLUMN IF EXISTS referencia_cargo")
    op.execute("ALTER TABLE financeiro_unidades_consumo DROP COLUMN IF EXISTS referencia_patrimonio_id")
    op.execute("ALTER TABLE financeiro_unidades_consumo DROP COLUMN IF EXISTS referencia_usuario_id")
