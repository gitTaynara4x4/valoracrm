from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
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


class Empresa(Base):
    __tablename__ = "empresas"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    nome = Column(String(180), nullable=False, index=True)
    email = Column(String(255), nullable=True, index=True)
    telefone = Column(String(20), nullable=True)

    cnpj = Column(String(20), nullable=True)
    cep = Column(String(10), nullable=True)
    estado = Column(String(2), nullable=True)
    cidade = Column(String(120), nullable=True)
    rua = Column(String(200), nullable=True)
    numero = Column(String(20), nullable=True)
    complemento = Column(String(120), nullable=True)
    logo_url = Column(Text, nullable=True)

    plano = Column(String(30), nullable=False, server_default="essencial", index=True)
    ativo = Column(Boolean, nullable=False, server_default="true")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Empresa id={self.id} nome={self.nome!r} plano={self.plano!r}>"


class Usuario(Base):
    __tablename__ = "usuarios"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "email", name="uq_usuarios_empresa_email"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    telefone = Column(String(20), nullable=True)

    senha_hash = Column(String(255), nullable=False)

    cargo = Column(String(80), nullable=True)
    avatar_url = Column(Text, nullable=True)

    papel = Column(String(20), nullable=False, server_default="colaborador", index=True)

    exigir_token_login = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<Usuario id={self.id} email={self.email!r} "
            f"papel={self.papel!r} empresa_id={self.empresa_id}>"
        )


class UsuarioPermissao(Base):
    __tablename__ = "usuarios_permissoes"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("usuario_id", "modulo", name="uq_usuarios_permissoes_usuario_modulo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    usuario_id = Column(
        BigInteger,
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    modulo = Column(String(50), nullable=False, index=True)

    pode_ver = Column(Boolean, nullable=False, server_default="false")
    pode_criar = Column(Boolean, nullable=False, server_default="false")
    pode_editar = Column(Boolean, nullable=False, server_default="false")
    pode_excluir = Column(Boolean, nullable=False, server_default="false")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<UsuarioPermissao id={self.id} usuario_id={self.usuario_id} "
            f"modulo={self.modulo!r}>"
        )


class LoginToken(Base):
    __tablename__ = "login_tokens"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    email = Column(String(255), nullable=False, index=True)
    token = Column(String(6), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=False), nullable=False)

    created_at = Column(
        DateTime(timezone=False),
        nullable=False,
        default=datetime.utcnow,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<LoginToken id={self.id} email={self.email!r}>"


class CadastroToken(Base):
    __tablename__ = "cadastro_tokens"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_nome = Column(String(180), nullable=False)
    responsavel_nome = Column(String(120), nullable=False)

    email = Column(String(255), nullable=False, index=True)
    telefone = Column(String(20), nullable=True)

    senha_hash = Column(String(255), nullable=False)
    cargo = Column(String(80), nullable=True)

    plano = Column(String(30), nullable=False, server_default="essencial", index=True)
    exigir_token_login = Column(Boolean, nullable=False, server_default="false")

    token = Column(String(6), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=False), nullable=False)

    created_at = Column(
        DateTime(timezone=False),
        nullable=False,
        default=datetime.utcnow,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CadastroToken id={self.id} email={self.email!r} plano={self.plano!r}>"


class Cliente(Base):
    __tablename__ = "clientes"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo", name="uq_clientes_empresa_codigo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    nome = Column(String(180), nullable=False, index=True)
    nome_fantasia = Column(String(180), nullable=True, index=True)

    tipo_pessoa = Column(String(2), nullable=False, server_default="PF", index=True)
    situacao = Column(String(20), nullable=False, server_default="ativo", index=True)

    cpf_cnpj = Column(String(30), nullable=True, index=True)
    rg_ie = Column(String(30), nullable=True)
    inscricao_municipal = Column(String(30), nullable=True)
    suframa = Column(String(30), nullable=True)

    data_nascimento = Column(Date, nullable=True)
    codigo_referencia = Column(String(50), nullable=True)
    retencao_percentual = Column(Numeric(10, 2), nullable=True)

    telefone = Column(String(30), nullable=True)
    whatsapp = Column(String(30), nullable=True, index=True)
    fax = Column(String(30), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    email_nfe = Column(String(255), nullable=True)
    email_cobranca = Column(String(255), nullable=True)
    email_fiscal = Column(String(255), nullable=True)
    site = Column(String(255), nullable=True)
    contato = Column(String(120), nullable=True)

    parceiro_comercial = Column(String(120), nullable=True)
    percentual_comissao = Column(Numeric(10, 2), nullable=True)
    percentual_desconto = Column(Numeric(10, 2), nullable=True)
    regiao = Column(String(120), nullable=True)
    segmento = Column(String(120), nullable=True)
    modalidade_pagamento = Column(String(120), nullable=True)
    classificacao = Column(String(120), nullable=True)

    cep = Column(String(20), nullable=True)
    endereco = Column(String(200), nullable=True)
    numero = Column(String(20), nullable=True)
    complemento = Column(String(120), nullable=True)
    bairro = Column(String(120), nullable=True)
    cidade = Column(String(120), nullable=True, index=True)
    estado = Column(String(10), nullable=True, index=True)
    pais = Column(String(120), nullable=True)
    codigo_ibge_cidade = Column(String(20), nullable=True)
    codigo_ibge_uf = Column(String(20), nullable=True)

    observacoes = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Cliente id={self.id} codigo={self.codigo!r} nome={self.nome!r} empresa_id={self.empresa_id}>"


class CampoCliente(Base):
    __tablename__ = "campos_clientes"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "slug", name="uq_campos_clientes_empresa_slug"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoCliente id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class ClienteCampoValor(Base):
    __tablename__ = "clientes_campos_valores"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("cliente_id", "campo_id", name="uq_clientes_campos_valores_cliente_campo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<ClienteCampoValor id={self.id} cliente_id={self.cliente_id} campo_id={self.campo_id}>"


class ClienteEndereco(Base):
    __tablename__ = "clientes_enderecos"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    tipo_endereco = Column(String(30), nullable=False, server_default="entrega", index=True)
    descricao = Column(String(120), nullable=True)

    cep = Column(String(20), nullable=True)
    logradouro = Column(String(200), nullable=True)
    numero = Column(String(20), nullable=True)
    complemento = Column(String(120), nullable=True)
    bairro = Column(String(120), nullable=True)
    cidade = Column(String(120), nullable=True)
    estado = Column(String(10), nullable=True)
    pais = Column(String(120), nullable=True)
    codigo_ibge_cidade = Column(String(20), nullable=True)
    codigo_ibge_uf = Column(String(20), nullable=True)
    email_destino = Column(String(255), nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteReferenciaComercial(Base):
    __tablename__ = "clientes_referencias_comerciais"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    empresa_nome = Column(String(180), nullable=False)
    telefone = Column(String(30), nullable=True)
    data_ultima_compra = Column(Date, nullable=True)
    valor_ultima_compra = Column(Numeric(14, 2), nullable=True)
    valor_prestacao = Column(Numeric(14, 2), nullable=True)
    vencimento_ultima_parcela = Column(Date, nullable=True)
    observacoes = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteReferenciaBancaria(Base):
    __tablename__ = "clientes_referencias_bancarias"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    banco = Column(String(120), nullable=False)
    agencia = Column(String(50), nullable=True)
    conta_corrente = Column(String(80), nullable=True)
    gerente = Column(String(120), nullable=True)
    telefone_agencia = Column(String(30), nullable=True)
    limite_credito = Column(Numeric(14, 2), nullable=True)
    status = Column(String(20), nullable=True)
    observacoes = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteSocio(Base):
    __tablename__ = "clientes_socios"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(180), nullable=False)
    cpf = Column(String(30), nullable=True)
    rg = Column(String(30), nullable=True)
    data_nascimento = Column(Date, nullable=True)
    telefone = Column(String(30), nullable=True)
    cargo = Column(String(120), nullable=True)
    participacao_percentual = Column(Numeric(10, 2), nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteOcorrencia(Base):
    __tablename__ = "clientes_ocorrencias"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    data_movimento = Column(DateTime(timezone=True), nullable=True)
    tipo = Column(String(50), nullable=True)
    status = Column(String(50), nullable=True)
    usuario_id = Column(BigInteger, nullable=True)
    usuario_nome = Column(String(120), nullable=True)
    descricao = Column(Text, nullable=False)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ClienteAnexo(Base):
    __tablename__ = "clientes_anexos"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cliente_id = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    descricao = Column(String(180), nullable=True)
    tipo_documento = Column(String(80), nullable=True)
    arquivo_nome = Column(String(255), nullable=False)
    arquivo_path = Column(Text, nullable=False)
    usuario_id = Column(BigInteger, nullable=True)
    usuario_nome = Column(String(120), nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Fornecedor(Base):
    __tablename__ = "fornecedores"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo", name="uq_fornecedores_empresa_codigo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    tipo_fornecedor = Column(String(120), nullable=True, index=True)
    situacao = Column(String(20), nullable=False, server_default="ativo", index=True)

    nome = Column(String(180), nullable=False, index=True)
    nome_fantasia = Column(String(180), nullable=True, index=True)
    cpf_cnpj = Column(String(30), nullable=True, index=True)
    inscricao_estadual = Column(String(30), nullable=True)
    inscricao_municipal = Column(String(30), nullable=True)

    contato = Column(String(120), nullable=True)
    telefone = Column(String(30), nullable=True)
    whatsapp = Column(String(30), nullable=True, index=True)
    fax = Column(String(30), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    site = Column(String(255), nullable=True)

    cep = Column(String(20), nullable=True)
    endereco = Column(String(200), nullable=True)
    numero = Column(String(20), nullable=True)
    complemento = Column(String(120), nullable=True)
    bairro = Column(String(120), nullable=True)
    cidade = Column(String(120), nullable=True, index=True)
    estado = Column(String(10), nullable=True, index=True)
    pais = Column(String(120), nullable=True)
    codigo_ibge_cidade = Column(String(20), nullable=True)
    codigo_ibge_uf = Column(String(20), nullable=True)

    limite_compras = Column(Numeric(14, 2), nullable=True)
    classificacao = Column(String(120), nullable=True)
    plano_contas = Column(String(120), nullable=True)
    observacoes = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Fornecedor id={self.id} codigo={self.codigo!r} nome={self.nome!r} empresa_id={self.empresa_id}>"


class CampoFornecedor(Base):
    __tablename__ = "campos_fornecedores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoFornecedor id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class FornecedorCampoValor(Base):
    __tablename__ = "fornecedores_campos_valores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    fornecedor_id = Column(
        BigInteger,
        ForeignKey("fornecedores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_fornecedores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<FornecedorCampoValor id={self.id} fornecedor_id={self.fornecedor_id} campo_id={self.campo_id}>"


class Produto(Base):
    __tablename__ = "produtos"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo", name="uq_produtos_empresa_codigo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    nome = Column(String(180), nullable=False, index=True)
    descricao = Column(Text, nullable=True)

    categoria = Column(String(120), nullable=True, index=True)
    unidade = Column(String(30), nullable=True)
    preco_venda = Column(String(40), nullable=True)
    custo = Column(String(40), nullable=True)

    estoque_atual = Column(String(40), nullable=True)
    ativo = Column(Boolean, nullable=False, server_default="true")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Produto id={self.id} codigo={self.codigo!r} nome={self.nome!r} empresa_id={self.empresa_id}>"


class CampoProduto(Base):
    __tablename__ = "campos_produtos"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoProduto id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class ProdutoCampoValor(Base):
    __tablename__ = "produtos_campos_valores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    produto_id = Column(
        BigInteger,
        ForeignKey("produtos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_produtos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<ProdutoCampoValor id={self.id} produto_id={self.produto_id} campo_id={self.campo_id}>"




class Patrimonio(Base):
    __tablename__ = "patrimonios"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo", name="uq_patrimonios_empresa_codigo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    nome = Column(String(180), nullable=False, index=True)
    descricao = Column(Text, nullable=True)

    categoria = Column(String(120), nullable=True, index=True)
    marca = Column(String(120), nullable=True)
    modelo = Column(String(120), nullable=True)
    numero_serie = Column(String(120), nullable=True, index=True)
    localizacao = Column(String(180), nullable=True, index=True)
    responsavel = Column(String(180), nullable=True, index=True)
    status = Column(String(40), nullable=False, server_default="ativo", index=True)

    valor_aquisicao = Column(String(40), nullable=True)
    data_aquisicao = Column(Date, nullable=True)
    observacoes = Column(Text, nullable=True)
    ativo = Column(Boolean, nullable=False, server_default="true")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Patrimonio id={self.id} codigo={self.codigo!r} nome={self.nome!r} empresa_id={self.empresa_id}>"


class CampoPatrimonio(Base):
    __tablename__ = "campos_patrimonios"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoPatrimonio id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class PatrimonioCampoValor(Base):
    __tablename__ = "patrimonios_campos_valores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    patrimonio_id = Column(
        BigInteger,
        ForeignKey("patrimonios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_patrimonios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<PatrimonioCampoValor id={self.id} patrimonio_id={self.patrimonio_id} campo_id={self.campo_id}>"


class Cotacao(Base):
    __tablename__ = "cotacoes"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo", name="uq_cotacoes_empresa_codigo"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    item_nome = Column(String(180), nullable=False, index=True)
    descricao = Column(Text, nullable=True)

    quantidade = Column(String(40), nullable=True)
    unidade = Column(String(30), nullable=True)
    categoria = Column(String(120), nullable=True, index=True)

    status = Column(String(40), nullable=False, server_default="rascunho", index=True)
    urgencia = Column(String(30), nullable=True, index=True)
    observacoes = Column(Text, nullable=True)

    fornecedor_vencedor_id = Column(
        BigInteger,
        ForeignKey("fornecedores.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    fornecedor_vencedor_item_id = Column(BigInteger, nullable=True, index=True)

    valor_aprovado = Column(String(40), nullable=True)
    data_aprovacao = Column(DateTime(timezone=True), nullable=True)

    produto_id = Column(
        BigInteger,
        ForeignKey("produtos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Cotacao id={self.id} codigo={self.codigo!r} item={self.item_nome!r} empresa_id={self.empresa_id}>"


class CotacaoFornecedor(Base):
    __tablename__ = "cotacoes_fornecedores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cotacao_id = Column(
        BigInteger,
        ForeignKey("cotacoes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    fornecedor_id = Column(
        BigInteger,
        ForeignKey("fornecedores.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    fornecedor_nome = Column(String(180), nullable=True, index=True)
    valor_unitario = Column(String(40), nullable=True)
    frete = Column(String(40), nullable=True)
    valor_total = Column(String(40), nullable=True)
    prazo_entrega = Column(String(80), nullable=True)
    condicao_pagamento = Column(String(160), nullable=True)
    observacoes = Column(Text, nullable=True)
    vencedor = Column(Boolean, nullable=False, server_default="false", index=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CotacaoFornecedor id={self.id} cotacao_id={self.cotacao_id} fornecedor={self.fornecedor_nome!r}>"


class CampoCotacao(Base):
    __tablename__ = "campos_cotacoes"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "slug", name="uq_campos_cotacoes_empresa_slug"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoCotacao id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class CotacaoCampoValor(Base):
    __tablename__ = "cotacoes_campos_valores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    cotacao_id = Column(
        BigInteger,
        ForeignKey("cotacoes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_cotacoes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CotacaoCampoValor id={self.id} cotacao_id={self.cotacao_id} campo_id={self.campo_id}>"


class Proposta(Base):
    __tablename__ = "propostas"
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
        ForeignKey("clientes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    titulo = Column(String(180), nullable=False, index=True)
    status = Column(String(40), nullable=False, server_default="rascunho", index=True)

    observacoes = Column(Text, nullable=True)
    validade_dias = Column(String(20), nullable=True)

    subtotal = Column(String(40), nullable=True)
    desconto = Column(String(40), nullable=True)
    total = Column(String(40), nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Proposta id={self.id} codigo={self.codigo!r} titulo={self.titulo!r} empresa_id={self.empresa_id}>"


class PropostaItem(Base):
    __tablename__ = "propostas_itens"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    proposta_id = Column(
        BigInteger,
        ForeignKey("propostas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    produto_id = Column(
        BigInteger,
        ForeignKey("produtos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    origem = Column(String(30), nullable=False, server_default="manual", index=True)

    codigo = Column(String(50), nullable=True, index=True)
    descricao = Column(Text, nullable=False)
    unidade = Column(String(20), nullable=True)

    quantidade = Column(String(40), nullable=True)
    valor_unitario = Column(String(40), nullable=True)
    valor_total = Column(String(40), nullable=True)

    observacao = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<PropostaItem id={self.id} proposta_id={self.proposta_id} descricao={self.descricao!r}>"


class CampoProposta(Base):
    __tablename__ = "campos_propostas"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint("empresa_id", "slug", name="uq_campos_propostas_empresa_slug"),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, index=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    opcoes_json = Column(Text, nullable=True)
    ordem = Column(BigInteger, nullable=False, server_default="0")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CampoProposta id={self.id} empresa_id={self.empresa_id} slug={self.slug!r} tipo={self.tipo!r}>"


class PropostaCampoValor(Base):
    __tablename__ = "propostas_campos_valores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    proposta_id = Column(
        BigInteger,
        ForeignKey("propostas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    campo_id = Column(
        BigInteger,
        ForeignKey("campos_propostas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<PropostaCampoValor id={self.id} proposta_id={self.proposta_id} campo_id={self.campo_id}>"


# =========================================================
# FORMULÁRIOS / CONSTRUTOR DE FORMULÁRIOS
# =========================================================

class FormularioModelo(Base):
    __tablename__ = "formularios_modelos"
    __allow_unmapped__ = True

    __table_args__ = (
        UniqueConstraint(
            "empresa_id",
            "modulo",
            "nome",
            name="uq_formularios_modelos_empresa_modulo_nome",
        ),
    )

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    modulo = Column(String(60), nullable=False, index=True)
    nome = Column(String(160), nullable=False)
    descricao = Column(Text, nullable=True)

    ativo = Column(Boolean, nullable=False, server_default="true")
    padrao = Column(Boolean, nullable=False, server_default="false")
    usar_como_ficha_principal = Column(Boolean, nullable=False, server_default="false")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<FormularioModelo id={self.id} empresa_id={self.empresa_id} "
            f"modulo={self.modulo!r} nome={self.nome!r}>"
        )


class FormularioSecao(Base):
    __tablename__ = "formularios_secoes"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    formulario_id = Column(
        BigInteger,
        ForeignKey("formularios_modelos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    titulo = Column(String(180), nullable=False)
    descricao = Column(Text, nullable=True)
    icone = Column(String(80), nullable=True)

    ordem = Column(BigInteger, nullable=False, server_default="0")
    ativo = Column(Boolean, nullable=False, server_default="true")

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<FormularioSecao id={self.id} formulario_id={self.formulario_id} "
            f"titulo={self.titulo!r}>"
        )


class FormularioCampo(Base):
    __tablename__ = "formularios_campos"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    formulario_id = Column(
        BigInteger,
        ForeignKey("formularios_modelos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    secao_id = Column(
        BigInteger,
        ForeignKey("formularios_secoes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    origem = Column(String(30), nullable=False, server_default="personalizado", index=True)

    campo_sistema = Column(String(120), nullable=True, index=True)
    campo_personalizado_id = Column(BigInteger, nullable=True, index=True)

    tipo_visual = Column(String(30), nullable=True)
    tipo_campo = Column(String(30), nullable=True)

    label = Column(String(180), nullable=False)
    placeholder = Column(String(180), nullable=True)
    ajuda = Column(Text, nullable=True)

    opcoes_json = Column(Text, nullable=True)

    obrigatorio = Column(Boolean, nullable=False, server_default="false")
    somente_leitura = Column(Boolean, nullable=False, server_default="false")
    ativo = Column(Boolean, nullable=False, server_default="true")

    largura = Column(String(30), nullable=False, server_default="100")
    ordem = Column(BigInteger, nullable=False, server_default="0")
    visibilidade = Column(String(30), nullable=False, server_default="todos")

    condicao_json = Column(Text, nullable=True)

    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    atualizado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<FormularioCampo id={self.id} formulario_id={self.formulario_id} "
            f"origem={self.origem!r} label={self.label!r}>"
        )