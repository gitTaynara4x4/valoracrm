from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)

from backend.database import Base


class ClienteAcessoPortal(Base):
    __tablename__ = "clientes_acessos_portal"
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

    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    token_hint = Column(String(20), nullable=True)

    senha_provisoria_hash = Column(String(255), nullable=False)

    codigo_cliente = Column(String(80), nullable=True)

    status = Column(String(30), nullable=False, server_default="pendente", index=True)

    expira_em = Column(DateTime(timezone=True), nullable=False)
    usado_em = Column(DateTime(timezone=True), nullable=True)
    revogado_em = Column(DateTime(timezone=True), nullable=True)
    ultimo_acesso_em = Column(DateTime(timezone=True), nullable=True)

    tentativas = Column(Integer, nullable=False, server_default="0")

    criado_por_id = Column(
        BigInteger,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )

    criado_por_nome = Column(String(180), nullable=True)

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
            f"<ClienteAcessoPortal id={self.id} cliente_id={self.cliente_id} "
            f"status={self.status!r}>"
        )