"""Auditoria exclusiva da programadora e estado ao vivo do usuário monitorado.

Revision ID: 20260810_0009
Revises: 20260810_0008
"""
from __future__ import annotations

from alembic import op

revision = "20260810_0009"
down_revision = "20260810_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS deixa a migration segura em ambientes que tenham recebido
    # uma tentativa parcial de deploy antes do Alembic gravar a revisão.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auditoria_usuario_atividade (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            usuario_email VARCHAR(255) NOT NULL,
            usuario_nome VARCHAR(160),
            tipo VARCHAR(40) NOT NULL,
            pagina VARCHAR(180),
            rota TEXT,
            metodo VARCHAR(12),
            status_code INTEGER,
            ip VARCHAR(80),
            user_agent TEXT,
            detalhes_json TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_aud_usuario_atividade_email_data
        ON auditoria_usuario_atividade (LOWER(usuario_email), criado_em DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_aud_usuario_atividade_usuario_data
        ON auditoria_usuario_atividade (usuario_id, criado_em DESC, id DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auditoria_usuario_estado (
            usuario_id BIGINT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            usuario_email VARCHAR(255) NOT NULL,
            usuario_nome VARCHAR(160),
            pagina_atual VARCHAR(180),
            rota_atual TEXT,
            metodo VARCHAR(12),
            status_code INTEGER,
            ultimo_ip VARCHAR(80),
            user_agent TEXT,
            sessao_ativa BOOLEAN NOT NULL DEFAULT TRUE,
            ultima_atividade TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ultimo_login TIMESTAMPTZ,
            ultimo_logout TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_aud_usuario_estado_email
        ON auditoria_usuario_estado (LOWER(usuario_email), ultima_atividade DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS auditoria_usuario_estado")
    op.execute("DROP TABLE IF EXISTS auditoria_usuario_atividade")
