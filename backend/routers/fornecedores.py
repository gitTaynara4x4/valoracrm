from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
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


def iso_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def normalizar_codigo_sistema(codigo: Any) -> str:
    """Mantém códigos internos do sistema apenas numéricos.

    Ex.: "FOR-0007" vira "0007".
    """
    return re.sub(r"\D+", "", str(codigo or "")).strip()


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
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


def codigo_fornecedor_existe(db: Session, empresa_id: int, codigo: str) -> bool:
    codigo_norm = normalizar_codigo_sistema(codigo)
    if not codigo_norm:
        return False

    return (
        db.query(Fornecedor.id)
        .filter(Fornecedor.empresa_id == empresa_id)
        .filter(Fornecedor.codigo == codigo_norm)
        .first()
        is not None
    )


def gerar_codigo_fornecedor(db: Session, empresa_id: int) -> str:
    """Gera o próximo código numérico livre por empresa.

    Código de fornecedor é interno do sistema:
    - aparece na tela;
    - é único por empresa;
    - não pode ser alterado pelo front.
    """
    rows = (
        db.query(Fornecedor.codigo)
        .filter(Fornecedor.empresa_id == empresa_id)
        .all()
    )

    maior = 0

    for row in rows:
        raw = row[0] if isinstance(row, tuple) else getattr(row, "codigo", None)
        codigo = normalizar_codigo_sistema(raw)

        if not codigo:
            continue

        try:
            maior = max(maior, int(codigo))
        except (TypeError, ValueError):
            continue

    proximo = maior + 1

    while codigo_fornecedor_existe(db, empresa_id, f"{proximo:04d}"):
        proximo += 1

    return f"{proximo:04d}"


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

    # O formulário/ficha principal pode renderizar campos-base com data-custom-field.
    # Esses campos não pertencem à tabela campos_fornecedores e não devem bloquear o cadastro.
    payload = {
        str(slug): value
        for slug, value in payload.items()
        if str(slug) in campos_map
    }

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
    # Não alterar f.codigo aqui.
    # O código é único/imutável e só é definido pelo backend no POST.
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



def fornecedor_to_list_out(f: Fornecedor) -> Dict[str, Any]:
    return {
        "id": int(f.id),
        "empresa_id": int(f.empresa_id),
        "codigo": getattr(f, "codigo", None) or "",
        "tipo_fornecedor": getattr(f, "tipo_fornecedor", None),
        "situacao": getattr(f, "situacao", None) or "ativo",
        "nome": getattr(f, "nome", None) or "",
        "nome_fantasia": getattr(f, "nome_fantasia", None),
        "cpf_cnpj": getattr(f, "cpf_cnpj", None),
        "telefone": getattr(f, "telefone", None),
        "whatsapp": getattr(f, "whatsapp", None),
        "email": getattr(f, "email", None),
        "cidade": getattr(f, "cidade", None),
        "estado": getattr(f, "estado", None),
        "criado_em": iso_datetime(getattr(f, "criado_em", None)),
        "atualizado_em": iso_datetime(getattr(f, "atualizado_em", None)),
        "custom_fields": {},
    }

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
        criado_em=iso_datetime(getattr(f, "criado_em", None)),
        atualizado_em=iso_datetime(getattr(f, "atualizado_em", None)),
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

@router.get("/api/fornecedores")
def listar_fornecedores(
    busca: Optional[str] = Query(default=None),
    situacao: Optional[str] = Query(default=None),
    tipo_fornecedor: Optional[str] = Query(default=None),
    cidade: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    """
    Lista leve e paginada para a tela de Fornecedores.

    Não carrega custom_fields na tabela. Os valores personalizados continuam
    sendo carregados apenas quando abre um fornecedor específico.
    """
    try:
        query = db.query(Fornecedor).filter(Fornecedor.empresa_id == empresa_id)

        if norm_str(situacao) and hasattr(Fornecedor, "situacao"):
            query = query.filter(Fornecedor.situacao == str(situacao).strip().lower())

        if norm_str(tipo_fornecedor) and hasattr(Fornecedor, "tipo_fornecedor"):
            query = query.filter(Fornecedor.tipo_fornecedor.ilike(f"%{str(tipo_fornecedor).strip()}%"))

        if norm_str(cidade) and hasattr(Fornecedor, "cidade"):
            query = query.filter(Fornecedor.cidade.ilike(f"%{str(cidade).strip()}%"))

        texto = norm_str(busca)
        if texto:
            q = f"%{texto}%"
            filtros = [Fornecedor.codigo.ilike(q), Fornecedor.nome.ilike(q)]
            for attr in ("nome_fantasia", "cpf_cnpj", "telefone", "whatsapp", "email", "cidade"):
                col = getattr(Fornecedor, attr, None)
                if col is not None:
                    filtros.append(col.ilike(q))
            cond = filtros[0]
            for item in filtros[1:]:
                cond = cond | item
            query = query.filter(cond)

        query = query.order_by(Fornecedor.nome.asc(), Fornecedor.id.asc())

        if paginated:
            total = query.count()
            rows = query.offset(offset).limit(limit).all()
            items = [fornecedor_to_list_out(f) for f in rows]
            return {
                "items": items,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": (offset + len(items)) < total,
            }

        rows = query.all()
        return [fornecedor_to_list_out(f) for f in rows]
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="A estrutura nova de fornecedores ainda não existe no banco. Rode a query SQL antes de abrir esta tela.",
        ) from exc


@router.get("/api/fornecedores/proximo-codigo")
def obter_proximo_codigo_fornecedor(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    try:
        return {"codigo": gerar_codigo_fornecedor(db, empresa_id)}
    except OperationalError as exc:
        raise HTTPException(
            status_code=500,
            detail="Rode a query SQL do módulo Fornecedores antes de gerar código.",
        ) from exc


@router.post("/api/fornecedores", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
def criar_fornecedor(
    payload: FornecedorCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id),
):
    # Código de fornecedor é gerado pelo backend.
    # O front pode mostrar uma previsão, mas o POST nunca manda/define código.
    ultima_integrity: Optional[IntegrityError] = None

    for _tentativa in range(10):
        try:
            codigo = gerar_codigo_fornecedor(db, empresa_id)
            f = Fornecedor(empresa_id=empresa_id, codigo=codigo, nome=payload.nome.strip())
            apply_fornecedor_payload(f, payload)

            db.add(f)
            db.flush()
            salvar_custom_fields_fornecedor(db, empresa_id, int(f.id), payload.custom_fields)

            db.commit()
            db.refresh(f)
            return fornecedor_to_out(db, f)
        except IntegrityError as exc:
            # Pode acontecer se duas pessoas cadastrarem ao mesmo tempo.
            # Volta e tenta gerar o próximo código livre.
            ultima_integrity = exc
            db.rollback()
            continue
        except OperationalError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="Rode a query SQL do módulo Fornecedores antes de criar registros.") from exc
        except HTTPException:
            db.rollback()
            raise

    raise HTTPException(status_code=409, detail="Não foi possível gerar um código livre para o fornecedor.") from ultima_integrity


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
        # Código é imutável: edição de fornecedor nunca altera o código.
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