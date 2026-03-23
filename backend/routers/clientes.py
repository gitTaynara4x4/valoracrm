from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Cookie
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(tags=["Clientes e Campos"])


# =========================================================
# DEPENDÊNCIAS
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_empresa_id(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db)
) -> int:
    """
    Dependência de autenticação via cookie.
    Pega o usuário logado e retorna o ID da empresa dele.
    """
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return int(usuario.empresa_id)


# =========================================================
# COMPATIBILIDADE PYDANTIC V1 / V2
# =========================================================
try:
    from pydantic import ConfigDict  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True


def norm_str(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip()
    return v or None


# =========================================================
# SCHEMAS - CLIENTES
# =========================================================
class ClienteBase(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None


class ClienteCreate(ClienteBase):
    nome: str


class ClienteUpdate(ClienteBase):
    pass


class ClienteOut(ClienteBase, _Cfg):
    id: int
    empresa_id: int


# =========================================================
# SCHEMAS - CAMPOS PERSONALIZADOS
# =========================================================
class CampoClienteBase(BaseModel):
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    ativo: bool = True
    opcoes_json: Optional[str] = None
    ordem: int = 0


class CampoClienteCreate(CampoClienteBase):
    pass


class CampoClienteUpdate(CampoClienteBase):
    pass


class CampoClienteOut(CampoClienteBase, _Cfg):
    id: int
    empresa_id: int


# =========================================================
# FUNÇÕES DE APOIO
# =========================================================
def gerar_codigo_cliente(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(models.Cliente)
        .filter(models.Cliente.empresa_id == empresa_id)
        .order_by(models.Cliente.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"CLI-{proximo:04d}"


def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, models.CampoCliente]:
    campos = db.query(models.CampoCliente).filter(models.CampoCliente.empresa_id == empresa_id).all()
    return {str(c.slug): c for c in campos}


def buscar_custom_fields_cliente(db: Session, empresa_id: int, cliente_id: int) -> Dict[str, Any]:
    rows = (
        db.query(models.ClienteCampoValor, models.CampoCliente)
        .join(models.CampoCliente, models.CampoCliente.id == models.ClienteCampoValor.campo_id)
        .filter(models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(models.CampoCliente.empresa_id == empresa_id)
        .all()
    )

    out: Dict[str, Any] = {}
    for valor_row, campo_row in rows:
        slug = str(campo_row.slug)
        out[slug] = valor_row.valor

    return out


def salvar_custom_fields_cliente(
    db: Session,
    empresa_id: int,
    cliente_id: int,
    custom_fields: Optional[Dict[str, Any]]
) -> None:
    payload = custom_fields or {}
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    slugs_payload = set(payload.keys())
    slugs_validos = set(campos_map.keys())

    slugs_invalidos = sorted(slugs_payload - slugs_validos)
    if slugs_invalidos:
        raise HTTPException(
            status_code=400,
            detail=f"Campos personalizados inválidos: {', '.join(slugs_invalidos)}"
        )

    valores_existentes = (
        db.query(models.ClienteCampoValor)
        .join(models.CampoCliente, models.CampoCliente.id == models.ClienteCampoValor.campo_id)
        .filter(models.ClienteCampoValor.cliente_id == cliente_id)
        .filter(models.CampoCliente.empresa_id == empresa_id)
        .all()
    )

    existentes_por_campo_id = {int(v.campo_id): v for v in valores_existentes}

    for slug, raw_value in payload.items():
        campo = campos_map[slug]
        campo_id = int(campo.id)
        value_str = None if raw_value is None else str(raw_value).strip()

        if not value_str:
            existente = existentes_por_campo_id.get(campo_id)
            if existente:
                db.delete(existente)
            continue

        existente = existentes_por_campo_id.get(campo_id)
        if existente:
            existente.valor = value_str
        else:
            novo = models.ClienteCampoValor(
                cliente_id=cliente_id,
                campo_id=campo_id,
                valor=value_str
            )
            db.add(novo)


def cliente_to_out(db: Session, c: models.Cliente) -> ClienteOut:
    empresa_id = int(c.empresa_id)
    return ClienteOut(
        id=int(c.id),
        empresa_id=empresa_id,
        codigo=getattr(c, "codigo", None) or "",
        nome=getattr(c, "nome", None) or "",
        whatsapp=getattr(c, "whatsapp", None),
        email=getattr(c, "email", None),
        custom_fields=buscar_custom_fields_cliente(db, empresa_id, int(c.id)),
    )


def buscar_cliente_empresa(db: Session, cliente_id: int, empresa_id: int) -> Optional[models.Cliente]:
    return (
        db.query(models.Cliente)
        .filter(models.Cliente.id == cliente_id, models.Cliente.empresa_id == empresa_id)
        .first()
    )


# =========================================================
# ROTAS - CAMPOS PERSONALIZADOS (/api/campos-clientes)
# =========================================================
@router.get("/api/campos-clientes", response_model=List[CampoClienteOut])
def listar_campos(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    campos = (
        db.query(models.CampoCliente)
        .filter(models.CampoCliente.empresa_id == empresa_id)
        .order_by(models.CampoCliente.ordem.asc())
        .all()
    )
    return campos


@router.get("/api/campos-clientes/{campo_id}", response_model=CampoClienteOut)
def obter_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    campo = (
        db.query(models.CampoCliente)
        .filter(models.CampoCliente.id == campo_id, models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    return campo


@router.post("/api/campos-clientes", response_model=CampoClienteOut, status_code=status.HTTP_201_CREATED)
def criar_campo(
    payload: CampoClienteCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    novo_campo = models.CampoCliente(empresa_id=empresa_id, **data)

    try:
        db.add(novo_campo)
        db.commit()
        db.refresh(novo_campo)
        return novo_campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.put("/api/campos-clientes/{campo_id}", response_model=CampoClienteOut)
def atualizar_campo(
    campo_id: int,
    payload: CampoClienteUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    campo = (
        db.query(models.CampoCliente)
        .filter(models.CampoCliente.id == campo_id, models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    for k, v in data.items():
        setattr(campo, k, v)

    try:
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.delete("/api/campos-clientes/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    campo = (
        db.query(models.CampoCliente)
        .filter(models.CampoCliente.id == campo_id, models.CampoCliente.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    db.delete(campo)
    db.commit()
    return None


# =========================================================
# ROTAS - CLIENTES (/api/clientes)
# =========================================================
@router.get("/api/clientes", response_model=List[ClienteOut])
def listar_clientes(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    rows = (
        db.query(models.Cliente)
        .filter(models.Cliente.empresa_id == empresa_id)
        .order_by(models.Cliente.nome.asc())
        .all()
    )
    return [cliente_to_out(db, c) for c in rows]


@router.get("/api/clientes/{cliente_id}", response_model=ClienteOut)
def obter_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    c = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return cliente_to_out(db, c)


@router.post("/api/clientes", response_model=ClienteOut, status_code=status.HTTP_201_CREATED)
def criar_cliente(
    payload: ClienteCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    codigo = (payload.codigo or "").strip() or gerar_codigo_cliente(db, empresa_id)

    c = models.Cliente(
        empresa_id=empresa_id,
        codigo=codigo,
        nome=payload.nome.strip(),
        whatsapp=norm_str(payload.whatsapp),
        email=norm_str(payload.email),
    )

    try:
        db.add(c)
        db.flush()

        salvar_custom_fields_cliente(
            db=db,
            empresa_id=empresa_id,
            cliente_id=int(c.id),
            custom_fields=payload.custom_fields
        )

        db.commit()
        db.refresh(c)
        return cliente_to_out(db, c)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de cliente já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar cliente: {e}")


@router.put("/api/clientes/{cliente_id}", response_model=ClienteOut)
def atualizar_cliente(
    cliente_id: int,
    payload: ClienteUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    c = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    if payload.codigo is not None and payload.codigo.strip():
        c.codigo = payload.codigo.strip()

    if payload.nome is not None and payload.nome.strip():
        c.nome = payload.nome.strip()

    if payload.whatsapp is not None:
        c.whatsapp = norm_str(payload.whatsapp)

    if payload.email is not None:
        c.email = norm_str(payload.email)

    try:
        if payload.custom_fields is not None:
            salvar_custom_fields_cliente(
                db=db,
                empresa_id=empresa_id,
                cliente_id=int(c.id),
                custom_fields=payload.custom_fields
            )

        db.commit()
        db.refresh(c)
        return cliente_to_out(db, c)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de cliente já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar cliente: {e}")


@router.delete("/api/clientes/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id)
):
    c = buscar_cliente_empresa(db, cliente_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    db.delete(c)
    db.commit()
    return None