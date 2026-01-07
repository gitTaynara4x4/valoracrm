# backend/models.py
from __future__ import annotations
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import (
    BigInteger,
    Boolean, 
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy import Date 
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from backend.database import Base


# =========================================================
# CLIENTES (OrçaPro - versão final)
# =========================================================
class Cliente(Base):
    __tablename__ = "clientes"
    __allow_unmapped__ = True  # SQLAlchemy 2.x: ignora type hints "antigos"

    id: int = Column(BigInteger, primary_key=True, index=True)

    # Código de Cadastro Cliente
    codigo_cadastro_cliente: str = Column(String(20), nullable=False, unique=True)

    # Data Cadastro
    data_cadastro: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Tipo Cliente
    tipo_cliente: str = Column(String(2), nullable=False)  # 'pf' | 'pj'

    # Cliente (Nome de Identificação)
    nome_identificacao: str = Column(Text, nullable=False)

    # Contato
    pessoa_contato: Optional[str] = Column(Text)
    whatsapp_contato: Optional[str] = Column(String(20))  # Telefone contato (WhatsApp)

    # Endereço principal (completo)
    end_rua: Optional[str] = Column(Text)
    end_numero: Optional[str] = Column(String(20))
    end_bairro: Optional[str] = Column(String(80))
    end_cidade: Optional[str] = Column(String(80))
    end_estado: Optional[str] = Column(String(2))
    end_pais: str = Column(String(60), nullable=False, server_default="BR")
    end_cep: Optional[str] = Column(String(12))

    # Perfil / origem
    tipo_imovel: Optional[str] = Column(String(50))
    onde_conheceu_empresa: Optional[str] = Column(String(80))

    # PJ
    razao_social: Optional[str] = Column(Text)
    cnpj: Optional[str] = Column(String(18))
    inscricao_estadual: Optional[str] = Column(String(30))
    inscricao_municipal: Optional[str] = Column(String(30))
    cpf_responsavel_administrador: Optional[str] = Column(String(14))

    # PF
    rg: Optional[str] = Column(String(20))
    data_nascimento: Optional[date] = Column(Date)
    estado_civil: Optional[str] = Column(String(30))
    profissao: Optional[str] = Column(String(80))
    responsavel_contratante = Column(Text) 
    # Contato principal
    whatsapp_principal: Optional[str] = Column(String(20))
    email_principal: Optional[str] = Column(Text)

    # Cobrança (fatura) - só CEP
    cep_cobranca: Optional[str] = Column(String(12))

    # Web / redes
    home_page: Optional[str] = Column(Text)
    redes_sociais = Column(JSONB)  # ex: {"instagram":"...", "facebook":"..."}

    # Relação com propostas (um cliente pode ter várias propostas)
    propostas: List["Proposta"] = relationship(
        "Proposta",
        back_populates="cliente",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<Cliente id={self.id} codigo={self.codigo_cadastro_cliente!r} "
            f"nome={self.nome_identificacao!r}>"
        )


# =========================================================
# FORNECEDORES (mesmos campos do Cliente - versão final)
# =========================================================
class Fornecedor(Base):
    __tablename__ = "fornecedores"
    __allow_unmapped__ = True

    id: int = Column(BigInteger, primary_key=True, index=True)

    # Código de Cadastro Fornecedor
    codigo_cadastro_fornecedor: str = Column(String(20), nullable=False, unique=True)

    # Data Cadastro
    data_cadastro: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Tipo Fornecedor
    tipo_fornecedor: str = Column(String(2), nullable=False)  # 'pf' | 'pj'

    # Fornecedor (Nome de Identificação)
    nome_identificacao: str = Column(Text, nullable=False)

    # Contato
    pessoa_contato: Optional[str] = Column(Text)
    whatsapp_contato: Optional[str] = Column(String(20))

    # Endereço principal (completo)
    end_rua: Optional[str] = Column(Text)
    end_numero: Optional[str] = Column(String(20))
    end_bairro: Optional[str] = Column(String(80))
    end_cidade: Optional[str] = Column(String(80))
    end_estado: Optional[str] = Column(String(2))
    end_pais: str = Column(String(60), nullable=False, server_default="BR")
    end_cep: Optional[str] = Column(String(12))

    # Perfil / origem
    tipo_imovel: Optional[str] = Column(String(50))
    onde_conheceu_empresa: Optional[str] = Column(String(80))

    # PJ
    razao_social: Optional[str] = Column(Text)
    cnpj: Optional[str] = Column(String(18))
    inscricao_estadual: Optional[str] = Column(String(30))
    inscricao_municipal: Optional[str] = Column(String(30))
    cpf_responsavel_administrador: Optional[str] = Column(String(14))

    # PF
    rg: Optional[str] = Column(String(20))
    data_nascimento: Optional[date] = Column(Date)
    estado_civil: Optional[str] = Column(String(30))
    profissao: Optional[str] = Column(String(80))

    # Contato principal
    whatsapp_principal: Optional[str] = Column(String(20))
    email_principal: Optional[str] = Column(Text)

    # Cobrança (fatura) - só CEP
    cep_cobranca: Optional[str] = Column(String(12))

    # Web / redes
    home_page: Optional[str] = Column(Text)
    redes_sociais = Column(JSONB)
    telefone_pabx: Optional[str] = Column(String(20))
    telefone: Optional[str] = Column(String(20))

    tipo_categoria: Optional[str] = Column(String(80))

    contato_representante_comercial: Optional[str] = Column(Text)
    representante_telefone_whatsapp: Optional[str] = Column(String(20))
    representante_telefone_ramal: Optional[str] = Column(String(20))

    limite_creditos: Optional[Decimal] = Column(Numeric(12, 2))

    opcao_transportadoras_fretes: Optional[str] = Column(Text)

    linha_produtos: Optional[str] = Column(Text)
    contato_rma: Optional[str] = Column(Text)
    informacoes_rma: Optional[str] = Column(Text)
    def __repr__(self) -> str:
        return (
            f"<Fornecedor id={self.id} codigo={self.codigo_cadastro_fornecedor!r} "
            f"nome={self.nome_identificacao!r}>"
        )


# =========================================================
# PRODUTOS
# =========================================================
class Produto(Base):
    __tablename__ = "produtos"
    __allow_unmapped__ = True  # SQLAlchemy 2.x: ignora type hints "antigos"

    id: int = Column(BigInteger, primary_key=True, index=True)

    data_cadastro: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    cod_ref_id: Optional[str] = Column(String(50), nullable=True)
    codigo_barras: Optional[str] = Column(String(50), nullable=True)

    nome_generico: Optional[str] = Column(String(200), nullable=True)
    nome_produto: Optional[str] = Column(Text, nullable=True)

    modelo: Optional[str] = Column(String(100), nullable=True)
    cod_ref_fabric: Optional[str] = Column(String(50), nullable=True)
    origem: Optional[str] = Column(String(30), nullable=True)
    status_atual: Optional[int] = Column(SmallInteger, nullable=True)   # 1..4
    tipo_mercado: Optional[int] = Column(SmallInteger, nullable=True)   # 1..2
    utilizacao: Optional[int] = Column(SmallInteger, nullable=True)     # 1..4
    tipo_material: Optional[int] = Column(SmallInteger, nullable=True)  # 1..3
    fabricante = Column(String(80), nullable=True)

    # SITUAÇÃO
    status_atual = Column(SmallInteger, nullable=True)   # 1..4
    tipo_mercado = Column(SmallInteger, nullable=True)   # 1..2
    utilizacao = Column(SmallInteger, nullable=True)     # 1..4
    tipo_material = Column(SmallInteger, nullable=True)  # 1..3

    # CLASSIFICAÇÃO (novos)
    prod_controlado = Column(Boolean, nullable=True)
    segmentos = Column(String(120), nullable=True)
    tipo_sistema = Column(String(120), nullable=True)
    classe = Column(String(120), nullable=True)
    categorias = Column(String(120), nullable=True)
    subcategoria = Column(String(120), nullable=True)
    fornecedor = Column(String(120), nullable=True)
    ultima_compra = Column(Date, nullable=True)


    
    # 🔥 FIX do erro: PropostaItem.back_populates="itens" exige Produto.itens
    itens: List["PropostaItem"] = relationship(
        "PropostaItem",
        back_populates="produto",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Produto id={self.id} nome={self.nome_produto!r} modelo={self.modelo!r}>"


# =========================================================
# PROPOSTAS (cabeçalho)
# =========================================================
class Proposta(Base):
    __tablename__ = "propostas"
    __allow_unmapped__ = True

    id: int = Column(BigInteger, primary_key=True, index=True)

    # Identificador human-readable
    numero: str = Column(String(30), nullable=False, unique=True)  # ex: PROP-0001

    # Ligação com cliente
    cliente_id: Optional[int] = Column(
        BigInteger,
        ForeignKey("clientes.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Snapshot do cliente na época da proposta
    cliente_nome: str = Column(Text, nullable=False)
    cliente_telefone: Optional[str] = Column(String(20))
    cliente_email: Optional[str] = Column(Text)

    # Dados da proposta
    tipo_proposta: Optional[str] = Column(Text)  # ex: "Alarme monitorado + Sensores"
    status: str = Column(
        String(20),
        nullable=False,
        server_default="rascunho",
    )  # 'rascunho','enviada','aprovada','recusada'

    valor_total: Decimal = Column(
        Numeric(12, 2),
        nullable=False,
        server_default="0",
    )

    data_proposta: date = Column(
        Date,
        nullable=False,
        server_default=func.current_date(),
    )
    validade_dias: Optional[int] = Column(SmallInteger)

    observacoes: Optional[str] = Column(Text)

    criado_em: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    atualizado_em: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relações
    cliente: Optional[Cliente] = relationship(
        "Cliente",
        back_populates="propostas",
        lazy="joined",
    )

    itens: List["PropostaItem"] = relationship(
        "PropostaItem",
        back_populates="proposta",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="PropostaItem.ordem",
    )

    def __repr__(self) -> str:
        return f"<Proposta id={self.id} numero={self.numero!r} status={self.status!r}>"


# =========================================================
# PROPOSTA_ITENS (itens da proposta)
# =========================================================
class PropostaItem(Base):
    __tablename__ = "proposta_itens"
    __allow_unmapped__ = True

    id: int = Column(BigInteger, primary_key=True, index=True)

    proposta_id: int = Column(
        BigInteger,
        ForeignKey("propostas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    produto_id: Optional[int] = Column(
        BigInteger,
        ForeignKey("produtos.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Snapshot do item na época da proposta
    codigo: str = Column(String(30), nullable=False)
    descricao: str = Column(Text, nullable=False)
    unid: Optional[str] = Column(String(10))  # 'un', 'm', 'kit', 'dia', etc.

    quantidade: Decimal = Column(
        Numeric(12, 2),
        nullable=False,
        server_default="1",
    )
    valor_unitario: Decimal = Column(
        Numeric(12, 2),
        nullable=False,
        server_default="0",
    )
    desconto_percent: Decimal = Column(
        Numeric(5, 2),
        nullable=False,
        server_default="0",
    )
    valor_total: Decimal = Column(
        Numeric(12, 2),
        nullable=False,
        server_default="0",
    )

    origem: str = Column(
        String(20),
        nullable=False,
        server_default="catalogo",
    )  # 'catalogo', 'modelo', 'manual'

    observacoes: Optional[str] = Column(Text)
    ordem: int = Column(Integer, nullable=False, server_default="0")

    criado_em: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    atualizado_em: datetime = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relações
    proposta: Proposta = relationship(
        "Proposta",
        back_populates="itens",
        lazy="joined",
    )
    produto: Optional[Produto] = relationship(
        "Produto",
        back_populates="itens",
        lazy="joined",
    )

    def __repr__(self) -> str:
        return (
            f"<PropostaItem id={self.id} proposta_id={self.proposta_id} "
            f"codigo={self.codigo!r} qtd={self.quantidade}>"
        )
