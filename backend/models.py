from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
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

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    nome = Column(String(120), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
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

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    nome = Column(String(180), nullable=False, index=True)
    whatsapp = Column(String(30), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)

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


class Fornecedor(Base):
    __tablename__ = "fornecedores"
    __allow_unmapped__ = True

    id = Column(BigInteger, primary_key=True, index=True)

    empresa_id = Column(
        BigInteger,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    codigo = Column(String(50), nullable=False, index=True)
    nome = Column(String(180), nullable=False, index=True)
    whatsapp = Column(String(30), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)

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