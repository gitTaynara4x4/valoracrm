from __future__ import annotations

from sqlalchemy import BigInteger, Column, Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func

from backend.database import Base


class ClienteDadosComplementares(Base):
    __tablename__ = "clientes_dados_complementares"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("cliente_id", name="uq_clientes_dados_complementares_cliente"),
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

    tipo_pessoa = Column(String(2), nullable=False, server_default="PF", index=True)
    status_preenchimento = Column(String(30), nullable=False, server_default="rascunho", index=True)
    origem_preenchimento = Column(String(40), nullable=True)
    origem_solicitacao = Column(String(40), nullable=True)

    # Pessoa física / dados pessoais do titular
    nome_completo = Column(String(180), nullable=True)
    cpf = Column(String(30), nullable=True, index=True)
    rg = Column(String(30), nullable=True)
    nacionalidade = Column(String(80), nullable=True)
    profissao = Column(String(120), nullable=True)
    estado_civil = Column(String(60), nullable=True)
    data_nascimento = Column(Date, nullable=True)
    email_pessoal = Column(String(255), nullable=True)
    telefone_pessoal = Column(String(30), nullable=True)

    # Pessoa jurídica / representante legal
    representante_nome = Column(String(180), nullable=True)
    representante_cpf = Column(String(30), nullable=True, index=True)
    representante_rg = Column(String(30), nullable=True)
    representante_nacionalidade = Column(String(80), nullable=True)
    representante_profissao = Column(String(120), nullable=True)
    representante_estado_civil = Column(String(60), nullable=True)
    representante_data_nascimento = Column(Date, nullable=True)
    representante_email_pessoal = Column(String(255), nullable=True)
    representante_telefone_pessoal = Column(String(30), nullable=True)

    # Dados da empresa contratante
    razao_social = Column(String(180), nullable=True, index=True)
    cnpj = Column(String(30), nullable=True, index=True)
    email_empresa = Column(String(255), nullable=True)
    telefone_whatsapp_empresa = Column(String(30), nullable=True)

    # Endereço do imóvel atendido/monitorado
    imovel_cep = Column(String(20), nullable=True)
    imovel_rua = Column(String(200), nullable=True)
    imovel_numero = Column(String(20), nullable=True)
    imovel_complemento = Column(String(120), nullable=True)
    imovel_bairro = Column(String(120), nullable=True)
    imovel_cidade = Column(String(120), nullable=True, index=True)
    imovel_uf = Column(String(10), nullable=True, index=True)

    # Contato principal para contrato/área do cliente
    contato_principal_nome = Column(String(180), nullable=True)
    contato_principal_telefone = Column(String(30), nullable=True)
    contato_principal_whatsapp = Column(String(30), nullable=True)
    contato_principal_email = Column(String(255), nullable=True)
    contato_principal_observacao = Column(Text, nullable=True)

    observacoes_contrato = Column(Text, nullable=True)

    criado_em = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteHistoricoAlteracao(Base):
    __tablename__ = "clientes_historico_alteracoes"
    __allow_unmapped__ = True

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

    usuario_id = Column(BigInteger, nullable=True, index=True)
    usuario_nome = Column(String(120), nullable=True)

    tipo = Column(String(60), nullable=False, server_default="dados_complementares", index=True)
    origem = Column(String(40), nullable=True)
    canal_solicitacao = Column(String(40), nullable=True)

    campo = Column(String(120), nullable=True)
    valor_anterior = Column(Text, nullable=True)
    valor_novo = Column(Text, nullable=True)
    descricao = Column(Text, nullable=False)

    criado_em = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)