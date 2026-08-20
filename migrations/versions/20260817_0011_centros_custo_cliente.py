"""Pré-cadastra a árvore de Centros de Custo definida pelo cliente.

Revision ID: 20260817_0011
Revises: 20260811_0010
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "20260817_0011"
down_revision: Union[str, Sequence[str], None] = "20260811_0010"
branch_labels = None
depends_on = None


# Os nomes abaixo reproduzem literalmente a estrutura entregue pelo cliente.
# O documento contém dois grupos distintos chamados "Serviços"; ambos são
# preservados. Os códigos são apenas identificadores técnicos hierárquicos do
# Valora e não substituem os nomes definidos pelo cliente.
CENTROS_CUSTO_CLIENTE = (
    ("01", "Empresa Geral", (
        ("01.01", "Sócios"),
        ("01.02", "Diretorias"),
        ("01.03", "Gerencias Departamento"),
        ("01.04", "Relação Publicas"),
        ("01.05", "Comunicação Interna"),
    )),
    ("02", "Jurídico", (
        ("02.01", "Contratos"),
        ("02.02", "Compliance"),
    )),
    ("03", "Financeiro", (
        ("03.01", "Planejamento"),
        ("03.02", "Contabilidade"),
        ("03.03", "Faturamento"),
        ("03.04", "Compras"),
        ("03.05", "Contas a Pagar"),
    )),
    ("04", "Recursos Humanos", (
        ("04.01", "Departamento de Pessoal"),
        ("04.02", "Recrutamento / Seleção"),
        ("04.03", "Treinamento"),
        ("04.04", "Segurança do Trabalho"),
        ("04.05", "Benefícios"),
    )),
    ("05", "Suprimentos", (
        ("05.01", "Entrada/Expedição"),
        ("05.02", "Estoque"),
        ("05.03", "Almoxarifado"),
        ("05.04", "Logística"),
        ("05.05", "Conservação Patrimonial"),
    )),
    ("06", "Serviços", (
        ("06.01", "Administrativo"),
        ("06.02", "Equipes de Instalação"),
        ("06.03", "Equipes de Manutenção"),
        ("06.04", "Equipes de Preventiva"),
    )),
    ("07", "Serviços", (
        ("07.01", "T.I. Desenvolvimento"),
        ("07.02", "T.I. Infraestrutura /Nuvem"),
        ("07.03", "T.I. Segurança da Informação"),
        ("07.04", "T.I. Suporte Interno"),
        ("07.05", "T.I. Suporte de Campo"),
    )),
    ("08", "Comercial", (
        ("08.01", "Comercial Administrativo"),
        ("08.02", "Comercial Marketing"),
        ("08.03", "Comercial Prospecção (Busca)"),
        ("08.04", "Comercial Analista de Vendas (SDR)"),
        ("08.05", "Comercial Vendas – Fechamento (Consultor)"),
        ("08.06", "Comercial – Mídias Sociais"),
        ("08.07", "Comercial – E-Commerce"),
        ("08.08", "Help Desk - Atendimento"),
    )),
    ("09", "Monitoramento", (
        ("09.01", "Supervisão Operacional"),
        ("09.02", "Operação de Monitoramento (CCO)"),
        ("09.03", "Gestão de Riscos"),
        ("09.04", "Pronta Resposta INLOCO"),
        ("09.05", "Pronta Resposta Especializada"),
    )),
)


def _normalizar(value: object) -> str:
    return str(value or "").strip().casefold()


def _buscar_por_codigo_e_nome(rows: list[dict], codigo: str, nome: str) -> dict | None:
    codigo_n = _normalizar(codigo)
    nome_n = _normalizar(nome)
    return next(
        (
            r for r in rows
            if _normalizar(r.get("codigo")) == codigo_n
            and _normalizar(r.get("nome")) == nome_n
        ),
        None,
    )


def _buscar_raiz_por_nome(rows: list[dict], nome: str, usados: set[int]) -> dict | None:
    nome_n = _normalizar(nome)
    return next(
        (
            r for r in rows
            if r.get("centro_pai_id") is None
            and _normalizar(r.get("nome")) == nome_n
            and int(r["id"]) not in usados
        ),
        None,
    )


def _buscar_filho_por_nome(rows: list[dict], pai_id: int, nome: str) -> dict | None:
    nome_n = _normalizar(nome)
    return next(
        (
            r for r in rows
            if r.get("centro_pai_id") == pai_id
            and _normalizar(r.get("nome")) == nome_n
        ),
        None,
    )


def _inserir(bind, empresa_id: int, codigo: str, nome: str, pai_id: int | None) -> dict:
    row = bind.execute(text("""
        INSERT INTO financeiro_centros_custo
            (empresa_id, codigo, nome, centro_pai_id, ativo, criado_em, atualizado_em)
        VALUES
            (:empresa_id, :codigo, :nome, :pai_id, TRUE, NOW(), NOW())
        RETURNING id, empresa_id, codigo, nome, centro_pai_id, ativo
    """), {
        "empresa_id": empresa_id,
        "codigo": codigo,
        "nome": nome,
        "pai_id": pai_id,
    }).mappings().one()
    return dict(row)


def _garantir_codigo(bind, row: dict, codigo: str) -> None:
    if str(row.get("codigo") or "").strip():
        return
    bind.execute(text("""
        UPDATE financeiro_centros_custo
           SET codigo=:codigo, atualizado_em=NOW()
         WHERE id=:id
    """), {"codigo": codigo, "id": int(row["id"])})
    row["codigo"] = codigo


def _seed_empresa(bind, empresa_id: int) -> None:
    rows = [dict(r) for r in bind.execute(text("""
        SELECT id, empresa_id, codigo, nome, centro_pai_id, ativo
          FROM financeiro_centros_custo
         WHERE empresa_id=:empresa_id
         ORDER BY id
    """), {"empresa_id": empresa_id}).mappings().all()]

    raizes_usadas: set[int] = set()

    for codigo_raiz, nome_raiz, filhos in CENTROS_CUSTO_CLIENTE:
        raiz = _buscar_por_codigo_e_nome(rows, codigo_raiz, nome_raiz)
        if raiz is not None and raiz.get("centro_pai_id") is not None:
            raiz = None

        if raiz is None:
            raiz = _buscar_raiz_por_nome(rows, nome_raiz, raizes_usadas)

        if raiz is None:
            raiz = _inserir(bind, empresa_id, codigo_raiz, nome_raiz, None)
            rows.append(raiz)
        else:
            _garantir_codigo(bind, raiz, codigo_raiz)

        raiz_id = int(raiz["id"])
        raizes_usadas.add(raiz_id)

        for codigo_filho, nome_filho in filhos:
            filho = _buscar_por_codigo_e_nome(rows, codigo_filho, nome_filho)
            if filho is not None and filho.get("centro_pai_id") != raiz_id:
                filho = None

            if filho is None:
                filho = _buscar_filho_por_nome(rows, raiz_id, nome_filho)

            if filho is None:
                filho = _inserir(bind, empresa_id, codigo_filho, nome_filho, raiz_id)
                rows.append(filho)
            else:
                _garantir_codigo(bind, filho, codigo_filho)


def _remover_unicidade_incompativel_de_nome(bind) -> None:
    """Permite os dois grupos raiz chamados "Serviços" definidos pelo cliente.

    Bancos mais antigos podem possuir a constraint/index
    ``uq_fin_centro_empresa_nome`` em (empresa_id, lower(nome)). Essa regra
    conflita com a especificação funcional do cliente, que possui dois grupos
    raiz distintos com o mesmo nome e códigos diferentes (06 e 07).

    A remoção é idempotente e funciona tanto se o objeto tiver sido criado
    como constraint quanto como índice único.
    """
    bind.execute(text("""
        ALTER TABLE public.financeiro_centros_custo
        DROP CONSTRAINT IF EXISTS uq_fin_centro_empresa_nome
    """))
    bind.execute(text("""
        DROP INDEX IF EXISTS public.uq_fin_centro_empresa_nome
    """))


def upgrade() -> None:
    bind = op.get_bind()
    _remover_unicidade_incompativel_de_nome(bind)
    empresas = bind.execute(text("SELECT id FROM empresas ORDER BY id")).scalars().all()
    for empresa_id in empresas:
        _seed_empresa(bind, int(empresa_id))


def downgrade() -> None:
    # Não removemos centros de custo automaticamente: depois que a estrutura é
    # usada por lançamentos, apagá-la quebraria histórico financeiro.
    raise RuntimeError(
        "A migration de Centros de Custo é irreversível automaticamente para proteger o histórico financeiro."
    )
