from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)

from backend.database import Base


class Contrato(Base):
    __tablename__ = "contratos"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "numero_contrato", name="uq_contratos_empresa_numero"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    proposta_id = Column(
        BigInteger,
        ForeignKey("propostas.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    numero_contrato = Column(String(80), nullable=False, index=True)

    tipo_contrato = Column(String(120), nullable=False, server_default="outro", index=True)
    status = Column(String(40), nullable=False, server_default="rascunho", index=True)

    valor_mensal = Column(Numeric(14, 2), nullable=True)
    data_pagamento = Column(Date, nullable=True)
    data_inicio = Column(Date, nullable=True)
    data_fim = Column(Date, nullable=True)
    data_assinatura = Column(Date, nullable=True)

    # Snapshot/importação da proposta/orçamento aprovado
    proposta_codigo = Column(String(80), nullable=True, index=True)
    proposta_titulo = Column(String(180), nullable=True)
    proposta_data = Column(Date, nullable=True)
    vendedor_nome = Column(String(180), nullable=True)
    data_aprovacao = Column(Date, nullable=True)
    indicacao = Column(String(180), nullable=True)

    observacoes = Column(Text, nullable=True)

    criado_em = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ContratoAnexo(Base):
    __tablename__ = "contratos_anexos"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    contrato_id = Column(
        BigInteger,
        ForeignKey("contratos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    tipo_documento = Column(String(80), nullable=True, index=True)
    descricao = Column(String(180), nullable=True)

    arquivo_nome = Column(String(255), nullable=False)
    arquivo_path = Column(Text, nullable=False)
    arquivo_mime = Column(String(120), nullable=True)
    arquivo_tamanho = Column(BigInteger, nullable=True)

    usuario_id = Column(BigInteger, nullable=True, index=True)
    usuario_nome = Column(String(120), nullable=True)

    criado_em = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ContratoHistoricoAlteracao(Base):
    __tablename__ = "contratos_historico_alteracoes"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    contrato_id = Column(
        BigInteger,
        ForeignKey("contratos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    usuario_id = Column(BigInteger, nullable=True, index=True)
    usuario_nome = Column(String(120), nullable=True)

    tipo = Column(String(60), nullable=False, server_default="contrato", index=True)
    campo = Column(String(120), nullable=True)
    valor_anterior = Column(Text, nullable=True)
    valor_novo = Column(Text, nullable=True)
    descricao = Column(Text, nullable=False)

    criado_em = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)