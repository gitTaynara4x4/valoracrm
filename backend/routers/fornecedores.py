from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal

router = APIRouter(tags=["Fornecedores"])

Fornecedor = models.Fornecedor
CampoFornecedor = models.CampoFornecedor
FornecedorCampoValor = models.FornecedorCampoValor


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_empresa_id(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> int:
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


try:
    from pydantic import ConfigDict  # type: ignore

    class ORMBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class ORMBaseModel(BaseModel):
        class Config:
            orm_mode = True


def pydantic_dump(obj: BaseModel) -> Dict[str, Any]:
    return obj.model_dump() if hasattr(obj, "model_dump") else obj.dict()


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def parse_decimal(value: Any) -> Optional[Decimal]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, Decimal):
        return value

    text = str(value).strip()
    if not text:
        return None

    try:
        text = text.replace(".", "").replace(",", ".") if ("," in text and "." in text) else text.replace(",", ".")
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


class FornecedorBaseSchema(BaseModel):
    codigo: Optional[str] = None
    tipo_fornecedor: Optional[str] = None
    situacao: str = "ativo"

    nome: str
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None

    contato: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    site: Optional[str] = None

    cep: Optional[str] = None
    endereco: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    pais: Optional[str] = None
    codigo_ibge_cidade: Optional[str] = None
    codigo_ibge_uf: Optional[str] = None

    limite_compras: Optional[str] = None
    classificacao: Optional[str] = None
    plano_contas: Optional[str] = None
    observacoes: Optional[str] = None

    custom_fields: Optional[Dict[str, Any]] = None


class FornecedorCreate(FornecedorBaseSchema):
    pass


class FornecedorUpdate(FornecedorBaseSchema):
    pass


class CampoFornecedorBase(BaseModel):
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    ativo: bool = True
    opcoes_json: Optional[str] = None
    ordem: int = 0


class CampoFornecedorCreate(CampoFornecedorBase):
    pass


class CampoFornecedorUpdate(CampoFornecedorBase):
    pass


class CampoFornecedorOut(CampoFornecedorBase, ORMBaseModel):
    id: int
    empresa_id: int


class FornecedorOut(ORMBaseModel):
    id: int
    empresa_id: int
    codigo: str
    tipo_fornecedor: Optional[str] = None
    situacao: str
    nome: str
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    inscricao_municipal: Optional[str] = None
    contato: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    site: Optional[str] = None
    cep: Optional[str] = None
    endereco: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    estado: Optional[str] = None
    pais: Optional[str] = None
    codigo_ibge_cidade: Optional[str] = None
    codigo_ibge_uf: Optional[str] = None
    limite_compras: Optional[str] = None
    classificacao: Optional[str] = None
    plano_contas: Optional[str] = None
    observacoes: Optional[str] = None
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


def gerar_codigo_fornecedor(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(Fornecedor)
        .filter(Fornecedor.empresa_id == empresa_id)
        .order_by(Fornecedor.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"FOR-{proximo:04d}"


def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, CampoFornecedor]:
    campos = db.query(CampoFornecedor).filter(CampoFornecedor.empresa_id == empresa_id).all()
    return {str(c.slug): c for c in campos}


def buscar_custom_fields_fornecedor(db: Session, empresa_id: int, fornecedor_id: int) -> Dict[str, Any]:
    rows = (
        db.query(FornecedorCampoValor, CampoFornecedor)
        .join(CampoFornecedor, CampoFornecedor.id == FornecedorCampoValor.campo_id)
        .filter(FornecedorCampoValor.fornecedor_id == fornecedor_id)
        .filter(CampoFornecedor.empresa_id == empresa_id)
        .all()
    )

    out: Dict[str, Any] = {}
    for valor_row, campo_row in rows:
        out[str(campo_row.slug)] = valor_row.valor
    return out


def salvar_custom_fields_fornecedor(
    db: Session,
    empresa_id: int,
    fornecedor_id: int,
    custom_fields: Optional[Dict[str, Any]],
) -> None:
    payload = custom_fields or {}
    campos_map = buscar_campos_empresa_map(db, empresa_id)

    slugs_payload = set(payload.keys())
    slugs_validos = set(campos_map.keys())

    invalidos = sorted(slugs_payload - slugs_validos)
    if invalidos:
        raise HTTPException(
            status_code=400,
            detail=f"Campos personalizados inválidos: {', '.join(invalidos)}",
        )

    valores_existentes = (
        db.query(FornecedorCampoValor)
        .join(CampoFornecedor, CampoFornecedor.id == FornecedorCampoValor.campo_id)
        .filter(FornecedorCampoValor.fornecedor_id == fornecedor_id)
        .filter(CampoFornecedor.empresa_id == empresa_id)
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
            db.add(
                FornecedorCampoValor(
                    fornecedor_id=fornecedor_id,
                    campo_id=campo_id,
                    valor=value_str,
                )
            )


def buscar_fornecedor_empresa(db: Session, fornecedor_id: int, empresa_id: int) -> Optional[Fornecedor]:
    return (
        db.query(Fornecedor)
        .filter(Fornecedor.id == fornecedor_id, Fornecedor.empresa_id == empresa_id)
        .first()
    )


def apply_fornecedor_payload(f: Fornecedor, payload: FornecedorBaseSchema) -> None:
    f.codigo = (payload.codigo or "").strip() or f.codigo
    f.tipo_fornecedor = norm_str(payload.tipo_fornecedor)
    f.situacao = norm_str(payload.situacao) or "ativo"

    f.nome = payload.nome.strip()
    f.nome_fantasia = norm_str(payload.nome_fantasia)

    f.cpf_cnpj = norm_str(payload.cpf_cnpj)
    f.inscricao_estadual = norm_str(payload.inscricao_estadual)
    f.inscricao_municipal = norm_str(payload.inscricao_municipal)

    f.contato = norm_str(payload.contato)
    f.telefone = norm_str(payload.telefone)
    f.whatsapp = norm_str(payload.whatsapp)
    f.fax = norm_str(payload.fax)
    f.email = norm_str(payload.email)
    f.site = norm_str(payload.site)

    f.cep = norm_str(payload.cep)
    f.endereco = norm_str(payload.endereco)
    f.numero = norm_str(payload.numero)
    f.complemento = norm_str(payload.complemento)
    f.bairro = norm_str(payload.bairro)
    f.cidade = norm_str(payload.cidade)
    f.estado = norm_str(payload.estado)
    f.pais = norm_str(payload.pais)
    f.codigo_ibge_cidade = norm_str(payload.codigo_ibge_cidade)
    f.codigo_ibge_uf = norm_str(payload.codigo_ibge_uf)

    f.limite_compras = parse_decimal(payload.limite_compras)
    f.classificacao = norm_str(payload.classificacao)
    f.plano_contas = norm_str(payload.plano_contas)
    f.observacoes = norm_str(payload.observacoes)


def fornecedor_to_out(db: Session, f: Fornecedor) -> FornecedorOut:
    empresa_id = int(f.empresa_id)
    return FornecedorOut(
        id=int(f.id),
        empresa_id=empresa_id,
        codigo=f.codigo or "",
        tipo_fornecedor=f.tipo_fornecedor,
        situacao=f.situacao or "ativo",
        nome=f.nome or "",
        nome_fantasia=f.nome_fantasia,
        cpf_cnpj=f.cpf_cnpj,
        inscricao_estadual=f.inscricao_estadual,
        inscricao_municipal=f.inscricao_municipal,
        contato=f.contato,
        telefone=f.telefone,
        whatsapp=f.whatsapp,
        fax=f.fax,
        email=f.email,
        site=f.site,
        cep=f.cep,
        endereco=f.endereco,
        numero=f.numero,
        complemento=f.complemento,
        bairro=f.bairro,
        cidade=f.cidade,
        estado=f.estado,
        pais=f.pais,
        codigo_ibge_cidade=f.codigo_ibge_cidade,
        codigo_ibge_uf=f.codigo_ibge_uf,
        limite_compras=(f"{f.limite_compras:.2f}" if f.limite_compras is not None else None),
        classificacao=f.classificacao,
        plano_contas=f.plano_contas,
        observacoes=f.observacoes,
        custom_fields=buscar_custom_fields_fornecedor(db, empresa_id, int(f.id)),
    )


# =========================================================
# CAMPOS PERSONALIZADOS - FORNECEDORES
# ESSAS ROTAS FICAM ANTES DA ROTA DINÂMICA /{fornecedor_id}
# =========================================================

@router.get("/api/fornecedores/campos", response_model=List[CampoFornecedorOut])
def listar_campos(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    return (
        db.query(CampoFornecedor)
        .filter(CampoFornecedor.empresa_id == empresa_id)
        .order_by(CampoFornecedor.ordem.asc(), CampoFornecedor.id.asc())
        .all()
    )


@router.get("/api/fornecedores/campos/{campo_id}", response_model=CampoFornecedorOut)
def obter_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(CampoFornecedor)
        .filter(CampoFornecedor.id == campo_id, CampoFornecedor.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    return campo


@router.post("/api/fornecedores/campos", response_model=CampoFornecedorOut, status_code=status.HTTP_201_CREATED)
def criar_campo(
    payload: CampoFornecedorCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    data = pydantic_dump(payload)
    campo = CampoFornecedor(empresa_id=empresa_id, **data)

    try:
        db.add(campo)
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.put("/api/fornecedores/campos/{campo_id}", response_model=CampoFornecedorOut)
def atualizar_campo(
    campo_id: int,
    payload: CampoFornecedorUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(CampoFornecedor)
        .filter(CampoFornecedor.id == campo_id, CampoFornecedor.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    data = pydantic_dump(payload)
    for key, value in data.items():
        setattr(campo, key, value)

    try:
        db.commit()
        db.refresh(campo)
        return campo
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Identificador (slug) deste campo já existe.")


@router.delete("/api/fornecedores/campos/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo(
    campo_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    campo = (
        db.query(CampoFornecedor)
        .filter(CampoFornecedor.id == campo_id, CampoFornecedor.empresa_id == empresa_id)
        .first()
    )
    if not campo:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    db.delete(campo)
    db.commit()
    return None


# =========================================================
# FORNECEDORES
# =========================================================

@router.get("/api/fornecedores", response_model=List[FornecedorOut])
def listar_fornecedores(
    busca: Optional[str] = Query(default=None),
    situacao: Optional[str] = Query(default=None),
    tipo_fornecedor: Optional[str] = Query(default=None),
    cidade: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        query = db.query(Fornecedor).filter(Fornecedor.empresa_id == empresa_id)

        if norm_str(situacao):
            query = query.filter(Fornecedor.situacao == str(situacao).strip().lower())

        if norm_str(tipo_fornecedor):
            query = query.filter(Fornecedor.tipo_fornecedor.ilike(f"%{str(tipo_fornecedor).strip()}%"))

        if norm_str(cidade):
            query = query.filter(Fornecedor.cidade.ilike(f"%{str(cidade).strip()}%"))

        texto = norm_str(busca)
        if texto:
            q = f"%{texto}%"
            query = query.filter(
                (Fornecedor.codigo.ilike(q))
                | (Fornecedor.nome.ilike(q))
                | (Fornecedor.nome_fantasia.ilike(q))
                | (Fornecedor.cpf_cnpj.ilike(q))
                | (Fornecedor.telefone.ilike(q))
                | (Fornecedor.whatsapp.ilike(q))
                | (Fornecedor.email.ilike(q))
                | (Fornecedor.cidade.ilike(q))
            )

        rows = query.order_by(Fornecedor.nome.asc(), Fornecedor.id.asc()).all()
        return [fornecedor_to_out(db, f) for f in rows]
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura nova de fornecedores ainda não existe no banco. Rode a query SQL antes de abrir esta tela.",
        ) from exc


@router.post("/api/fornecedores", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
def criar_fornecedor(
    payload: FornecedorCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        codigo = (payload.codigo or "").strip() or gerar_codigo_fornecedor(db, empresa_id)
        f = Fornecedor(empresa_id=empresa_id, codigo=codigo, nome=payload.nome.strip())
        apply_fornecedor_payload(f, payload)

        db.add(f)
        db.flush()
        salvar_custom_fields_fornecedor(db, empresa_id, int(f.id), payload.custom_fields)

        db.commit()
        db.refresh(f)
        return fornecedor_to_out(db, f)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Fornecedores antes de criar registros.") from exc
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe fornecedor com este código para a empresa.")


@router.get("/api/fornecedores/{fornecedor_id}", response_model=FornecedorOut)
def obter_fornecedor(
    fornecedor_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    except OperationalError as exc:
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Fornecedores antes de usar esta rota.") from exc

    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return fornecedor_to_out(db, f)


@router.put("/api/fornecedores/{fornecedor_id}", response_model=FornecedorOut)
def atualizar_fornecedor(
    fornecedor_id: int,
    payload: FornecedorUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")

    try:
        if norm_str(payload.codigo):
            f.codigo = str(payload.codigo).strip()

        apply_fornecedor_payload(f, payload)
        salvar_custom_fields_fornecedor(db, empresa_id, int(f.id), payload.custom_fields)

        db.commit()
        db.refresh(f)
        return fornecedor_to_out(db, f)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Fornecedores antes de atualizar registros.") from exc
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe fornecedor com este código para a empresa.")


@router.delete("/api/fornecedores/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_fornecedor(
    fornecedor_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")

    db.delete(f)
    db.commit()
    return None