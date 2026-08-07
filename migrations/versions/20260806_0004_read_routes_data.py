"""Move preparações de dados para uma migration única.

Revision ID: 20260806_0004
Revises: 20260806_0003

Esta revisão substitui efeitos colaterais que antes aconteciam ao abrir rotas
GET. Depois dela, configurações padrão, importação legada de propostas e
vínculos de formulários já ficam persistidos durante o deploy.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import context, op
from sqlalchemy import text
from sqlalchemy.orm import Session

revision: str = "20260806_0004"
down_revision: Union[str, Sequence[str], None] = "20260806_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A revisão depende do conteúdo atual do banco e não possui representação
    # útil em `alembic upgrade --sql`.
    if context.is_offline_mode():
        return

    connection = op.get_bind()
    session = Session(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    try:
        from backend import models
        from backend.routers.formularios import (
            garantir_data_cadastro_no_modelo,
            sincronizar_modelo_apos_escrita,
        )
        from backend.routers.orcamentos import ensure_default_config, maybe_import_legacy

        company_ids = [
            int(row[0])
            for row in session.execute(text("SELECT id FROM empresas ORDER BY id")).all()
        ]
        for company_id in company_ids:
            ensure_default_config(session, company_id, commit=False)
            maybe_import_legacy(session, company_id, commit=False)

        formularios = (
            session.query(models.FormularioModelo)
            .order_by(
                models.FormularioModelo.empresa_id.asc(),
                models.FormularioModelo.modulo.asc(),
                models.FormularioModelo.id.asc(),
            )
            .all()
        )

        # Todos os modelos antigos recebem o campo virtual de cadastro.
        for formulario in formularios:
            garantir_data_cadastro_no_modelo(session, formulario)

        # Apenas o modelo efetivamente usado por empresa/módulo alimenta as
        # tabelas de campos personalizados. A prioridade reproduz a escolha da
        # aplicação: ficha principal, padrão e, por fim, o modelo mais recente.
        escolhidos: dict[tuple[int, str], object] = {}
        for formulario in formularios:
            if not bool(getattr(formulario, "ativo", True)):
                continue
            key = (int(formulario.empresa_id), str(formulario.modulo or ""))
            atual = escolhidos.get(key)
            prioridade = (
                bool(getattr(formulario, "usar_como_ficha_principal", False)),
                bool(getattr(formulario, "padrao", False)),
                int(formulario.id),
            )
            if atual is None:
                escolhidos[key] = formulario
                continue
            prioridade_atual = (
                bool(getattr(atual, "usar_como_ficha_principal", False)),
                bool(getattr(atual, "padrao", False)),
                int(getattr(atual, "id")),
            )
            if prioridade > prioridade_atual:
                escolhidos[key] = formulario

        for formulario in escolhidos.values():
            sincronizar_modelo_apos_escrita(session, formulario)

        session.flush()
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def downgrade() -> None:
    raise RuntimeError(
        "A migration 20260806_0004 consolida dados existentes e não possui downgrade seguro."
    )
