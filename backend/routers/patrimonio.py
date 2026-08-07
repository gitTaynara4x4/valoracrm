from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, Optional
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.security.permissions import get_request_user
from backend import models

router = APIRouter(prefix="/api/patrimonio", tags=["Patrimônio"])

_SCHEMA_OK = False


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


try:
    from pydantic import ConfigDict  # type: ignore

    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def normalizar_codigo_sistema(codigo: Optional[str]) -> str:
    return re.sub(r"\D+", "", str(codigo or "")).strip()


def parse_date(value: Any) -> Optional[date]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text_value = str(value).strip()
    if not text_value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text_value, fmt).date()
        except ValueError:
            pass
    return None


def iso_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def iso_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value).strip()
    return text or None



def validar_usuario_empresa(request: Request, db: Session) -> int:
    usuario = get_request_user(request, db)
    return int(usuario.empresa_id)


def garantir_tabela_sequencias_codigo(db: Session) -> None:
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


def maior_codigo_patrimonio_existente(db: Session, empresa_id: int) -> int:
    rows = (
        db.query(models.Patrimonio.codigo)
        .filter(models.Patrimonio.empresa_id == empresa_id)
        .all()
    )

    maior = 0

    for row in rows:
        raw = row[0] if isinstance(row, tuple) else getattr(row, "codigo", None)
        codigo_norm = normalizar_codigo_sistema(raw)

        if not codigo_norm:
            continue

        try:
            maior = max(maior, int(codigo_norm))
        except (TypeError, ValueError):
            continue

    return maior


def preparar_sequencia_patrimonio(db: Session, empresa_id: int) -> int:

    maior_atual = maior_codigo_patrimonio_existente(db, empresa_id)

    db.execute(
        text("""
            INSERT INTO cadastro_sequencias (empresa_id, modulo, ultimo_codigo)
            VALUES (:empresa_id, 'patrimonio', :maior_atual)
            ON CONFLICT (empresa_id, modulo)
            DO UPDATE SET
                ultimo_codigo = GREATEST(cadastro_sequencias.ultimo_codigo, EXCLUDED.ultimo_codigo),
                atualizado_em = NOW()
        """),
        {"empresa_id": empresa_id, "maior_atual": maior_atual},
    )

    ultimo = db.execute(
        text("""
            SELECT ultimo_codigo
            FROM cadastro_sequencias
            WHERE empresa_id = :empresa_id AND modulo = 'patrimonio'
        """),
        {"empresa_id": empresa_id},
    ).scalar_one()

    return int(ultimo or 0)


def prever_proximo_codigo_patrimonio(db: Session, empresa_id: int) -> str:
    """Mostra uma previsão sem alterar a sequência persistida."""
    maior_existente = maior_codigo_patrimonio_existente(db, empresa_id)
    ultimo_sequencia = db.execute(
        text("""
            SELECT ultimo_codigo
            FROM cadastro_sequencias
            WHERE empresa_id = :empresa_id AND modulo = 'patrimonio'
        """),
        {"empresa_id": empresa_id},
    ).scalar()
    ultimo = max(maior_existente, int(ultimo_sequencia or 0))
    return f"{ultimo + 1:04d}"


def gerar_codigo_patrimonio(db: Session, empresa_id: int) -> str:
    """Gera e consome o próximo código sequencial do patrimônio.

    Regras:
    - Não usa ID do banco.
    - Não confia no código vindo do front.
    - Depois que a sequência existe, código consumido não volta a ser reutilizado.
    """
    preparar_sequencia_patrimonio(db, empresa_id)

    ultimo = db.execute(
        text("""
            SELECT ultimo_codigo
            FROM cadastro_sequencias
            WHERE empresa_id = :empresa_id AND modulo = 'patrimonio'
            FOR UPDATE
        """),
        {"empresa_id": empresa_id},
    ).scalar_one()

    proximo = int(ultimo or 0) + 1

    db.execute(
        text("""
            UPDATE cadastro_sequencias
            SET ultimo_codigo = :proximo, atualizado_em = NOW()
            WHERE empresa_id = :empresa_id AND modulo = 'patrimonio'
        """),
        {"empresa_id": empresa_id, "proximo": proximo},
    )

    return f"{proximo:04d}"


class PatrimonioBase(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    descricao: Optional[str] = None
    categoria: Optional[str] = None
    marca: Optional[str] = None
    modelo: Optional[str] = None
    numero_serie: Optional[str] = None
    localizacao: Optional[str] = None
    responsavel: Optional[str] = None
    status: Optional[str] = "ativo"
    valor_aquisicao: Optional[str] = None
    data_aquisicao: Optional[str] = None
    observacoes: Optional[str] = None
    ativo: Optional[bool] = True
    custom_fields: Optional[Dict[str, str]] = None


class PatrimonioCreate(PatrimonioBase):
    nome: str


class PatrimonioUpdate(PatrimonioBase):
    pass


class PatrimonioOut(PatrimonioBase, _Cfg):
    id: int
    empresa_id: int
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None


class CampoPatrimonioBase(BaseModel):
    nome: Optional[str] = None
    slug: Optional[str] = None
    tipo: Optional[str] = None
    obrigatorio: Optional[bool] = False
    ativo: Optional[bool] = True
    opcoes_json: Optional[str] = None
    ordem: Optional[int] = 0


class CampoPatrimonioCreate(CampoPatrimonioBase):
    nome: str
    slug: str
    tipo: str


class CampoPatrimonioUpdate(CampoPatrimonioBase):
    pass


class CampoPatrimonioOut(CampoPatrimonioBase, _Cfg):
    id: int
    empresa_id: int


def buscar_patrimonio_empresa(db: Session, patrimonio_id: int, empresa_id: int) -> Optional[models.Patrimonio]:
    return (
        db.query(models.Patrimonio)
        .filter(models.Patrimonio.id == patrimonio_id)
        .filter(models.Patrimonio.empresa_id == empresa_id)
        .first()
    )


def buscar_campo_empresa(db: Session, campo_id: int, empresa_id: int) -> Optional[models.CampoPatrimonio]:
    return (
        db.query(models.CampoPatrimonio)
        .filter(models.CampoPatrimonio.id == campo_id)
        .filter(models.CampoPatrimonio.empresa_id == empresa_id)
        .first()
    )


def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, models.CampoPatrimonio]:
    campos = (
        db.query(models.CampoPatrimonio)
        .filter(models.CampoPatrimonio.empresa_id == empresa_id)
        .all()
    )
    return {str(c.slug): c for c in campos}


def buscar_custom_fields(db: Session, empresa_id: int, patrimonio_id: int) -> Dict[str, str]:
    rows = (
        db.query(models.PatrimonioCampoValor, models.CampoPatrimonio)
        .join(models.CampoPatrimonio, models.CampoPatrimonio.id == models.PatrimonioCampoValor.campo_id)
        .filter(models.PatrimonioCampoValor.patrimonio_id == patrimonio_id)
        .filter(models.CampoPatrimonio.empresa_id == empresa_id)
        .all()
    )
    return {str(campo.slug): valor.valor or "" for valor, campo in rows}


def salvar_custom_fields(db: Session, empresa_id: int, patrimonio_id: int, custom_fields: Optional[Dict[str, str]]) -> None:
    payload = custom_fields or {}
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    invalidos = sorted(set(payload.keys()) - set(campos_map.keys()))
    if invalidos:
        raise HTTPException(status_code=400, detail=f"Campos personalizados inválidos: {', '.join(invalidos)}")

    existentes = (
        db.query(models.PatrimonioCampoValor)
        .join(models.CampoPatrimonio, models.CampoPatrimonio.id == models.PatrimonioCampoValor.campo_id)
        .filter(models.PatrimonioCampoValor.patrimonio_id == patrimonio_id)
        .filter(models.CampoPatrimonio.empresa_id == empresa_id)
        .all()
    )
    existentes_map = {int(v.campo_id): v for v in existentes}

    for slug, raw_value in payload.items():
        campo = campos_map[slug]
        campo_id = int(campo.id)
        value_str = None if raw_value is None else str(raw_value).strip()

        existente = existentes_map.get(campo_id)
        if not value_str:
            if existente:
                db.delete(existente)
            continue

        if existente:
            existente.valor = value_str
        else:
            db.add(models.PatrimonioCampoValor(patrimonio_id=patrimonio_id, campo_id=campo_id, valor=value_str))


def patrimonio_to_out(db: Session, p: models.Patrimonio, *, include_custom_fields: bool = True) -> PatrimonioOut:
    empresa_id = int(p.empresa_id)
    return PatrimonioOut(
        id=int(p.id),
        empresa_id=empresa_id,
        codigo=p.codigo or "",
        nome=p.nome or "",
        descricao=p.descricao,
        categoria=p.categoria,
        marca=p.marca,
        modelo=p.modelo,
        numero_serie=p.numero_serie,
        localizacao=p.localizacao,
        responsavel=p.responsavel,
        status=p.status or "ativo",
        valor_aquisicao=p.valor_aquisicao,
        data_aquisicao=iso_date(p.data_aquisicao),
        observacoes=p.observacoes,
        ativo=bool(p.ativo),
        criado_em=iso_datetime(getattr(p, "criado_em", None)),
        atualizado_em=iso_datetime(getattr(p, "atualizado_em", None)),
        custom_fields=(buscar_custom_fields(db, empresa_id, int(p.id)) if include_custom_fields else {}),
    )


def patrimonio_to_list_out(p: models.Patrimonio) -> Dict[str, object]:
    return {
        "id": int(p.id),
        "empresa_id": int(p.empresa_id),
        "codigo": p.codigo or "",
        "nome": p.nome or "",
        "descricao": p.descricao,
        "categoria": p.categoria,
        "marca": p.marca,
        "modelo": p.modelo,
        "numero_serie": p.numero_serie,
        "localizacao": p.localizacao,
        "responsavel": p.responsavel,
        "status": p.status or "ativo",
        "valor_aquisicao": p.valor_aquisicao,
        "data_aquisicao": iso_date(p.data_aquisicao),
        "ativo": bool(p.ativo),
        "criado_em": iso_datetime(getattr(p, "criado_em", None)),
        "atualizado_em": iso_datetime(getattr(p, "atualizado_em", None)),
        "custom_fields": {},
    }


def campo_to_out(c: models.CampoPatrimonio) -> CampoPatrimonioOut:
    return CampoPatrimonioOut(
        id=int(c.id),
        empresa_id=int(c.empresa_id),
        nome=c.nome,
        slug=c.slug,
        tipo=c.tipo,
        obrigatorio=bool(c.obrigatorio),
        ativo=bool(c.ativo),
        opcoes_json=c.opcoes_json,
        ordem=int(c.ordem or 0),
    )


@router.get("")
def listar_patrimonios(
    request: Request,
    busca: Optional[str] = Query(default=None),
    ativo: Optional[bool] = Query(default=None),
    status_item: Optional[str] = Query(default=None, alias="status"),
    categoria: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    query = db.query(models.Patrimonio).filter(models.Patrimonio.empresa_id == empresa_id)

    if ativo is not None:
        query = query.filter(models.Patrimonio.ativo == ativo)
    if norm_str(status_item):
        query = query.filter(models.Patrimonio.status == status_item)
    if norm_str(categoria):
        query = query.filter(models.Patrimonio.categoria.ilike(f"%{str(categoria).strip()}%"))

    texto = norm_str(busca)
    if texto:
        q = f"%{texto}%"
        query = query.filter(
            models.Patrimonio.codigo.ilike(q)
            | models.Patrimonio.nome.ilike(q)
            | models.Patrimonio.numero_serie.ilike(q)
            | models.Patrimonio.localizacao.ilike(q)
            | models.Patrimonio.responsavel.ilike(q)
        )

    query = query.order_by(models.Patrimonio.nome.asc(), models.Patrimonio.id.asc())

    if paginated:
        total = query.count()
        rows = query.offset(offset).limit(limit).all()
        items = [patrimonio_to_list_out(p) for p in rows]
        return {"items": items, "total": total, "limit": limit, "offset": offset, "has_more": (offset + len(items)) < total}

    return [patrimonio_to_list_out(p) for p in query.all()]


@router.get("/proximo-codigo")
def obter_proximo_codigo_patrimonio(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = prever_proximo_codigo_patrimonio(db, empresa_id)
    return {"codigo": codigo}


@router.post("", response_model=PatrimonioOut, status_code=status.HTTP_201_CREATED)
def criar_patrimonio(payload: PatrimonioCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    nome = norm_str(payload.nome)
    if not nome:
        raise HTTPException(status_code=422, detail="Informe o nome do patrimônio.")

    # Código de patrimônio é gerado pelo sistema, único e imutável.
    # Não confiar em payload.codigo vindo do front/importação.
    codigo = gerar_codigo_patrimonio(db, empresa_id)
    item = models.Patrimonio(
        empresa_id=empresa_id,
        codigo=codigo,
        nome=nome,
        descricao=norm_str(payload.descricao),
        categoria=norm_str(payload.categoria),
        marca=norm_str(payload.marca),
        modelo=norm_str(payload.modelo),
        numero_serie=norm_str(payload.numero_serie),
        localizacao=norm_str(payload.localizacao),
        responsavel=norm_str(payload.responsavel),
        status=norm_str(payload.status) or "ativo",
        valor_aquisicao=norm_str(payload.valor_aquisicao),
        data_aquisicao=parse_date(payload.data_aquisicao),
        observacoes=norm_str(payload.observacoes),
        ativo=bool(payload.ativo),
    )

    try:
        db.add(item)
        db.flush()
        salvar_custom_fields(db, empresa_id, int(item.id), payload.custom_fields)
        db.commit()
        db.refresh(item)
        return patrimonio_to_out(db, item)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de patrimônio já existe.")
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar patrimônio: {exc}")


@router.get("/campos", response_model=list[CampoPatrimonioOut])
def listar_campos_patrimonio(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    rows = (
        db.query(models.CampoPatrimonio)
        .filter(models.CampoPatrimonio.empresa_id == empresa_id)
        .order_by(models.CampoPatrimonio.ordem.asc(), models.CampoPatrimonio.nome.asc())
        .all()
    )
    return [campo_to_out(c) for c in rows]


@router.post("/campos", response_model=CampoPatrimonioOut, status_code=status.HTTP_201_CREATED)
def criar_campo_patrimonio(payload: CampoPatrimonioCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    nome = norm_str(payload.nome)
    slug = norm_str(payload.slug)
    tipo = norm_str(payload.tipo)
    if not nome or not slug or not tipo:
        raise HTTPException(status_code=422, detail="Informe nome, slug e tipo do campo.")

    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", slug.strip().lower()).strip("_")
    if not slug:
        raise HTTPException(status_code=422, detail="Slug inválido.")

    c = models.CampoPatrimonio(
        empresa_id=empresa_id,
        nome=nome,
        slug=slug,
        tipo=tipo,
        obrigatorio=bool(payload.obrigatorio),
        ativo=bool(payload.ativo),
        opcoes_json=norm_str(payload.opcoes_json),
        ordem=int(payload.ordem or 0),
    )
    try:
        db.add(c)
        db.commit()
        db.refresh(c)
        return campo_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse identificador.")


@router.put("/campos/{campo_id}", response_model=CampoPatrimonioOut)
def atualizar_campo_patrimonio(campo_id: int, payload: CampoPatrimonioUpdate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")

    if payload.nome is not None and payload.nome.strip():
        c.nome = payload.nome.strip()
    if payload.slug is not None and payload.slug.strip():
        c.slug = re.sub(r"[^a-zA-Z0-9_]+", "_", payload.slug.strip().lower()).strip("_")
    if payload.tipo is not None and payload.tipo.strip():
        c.tipo = payload.tipo.strip()
    if payload.obrigatorio is not None:
        c.obrigatorio = bool(payload.obrigatorio)
    if payload.ativo is not None:
        c.ativo = bool(payload.ativo)
    if payload.opcoes_json is not None:
        c.opcoes_json = norm_str(payload.opcoes_json)
    if payload.ordem is not None:
        c.ordem = int(payload.ordem or 0)

    try:
        db.commit()
        db.refresh(c)
        return campo_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse identificador.")


@router.delete("/campos/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo_patrimonio(campo_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")
    db.delete(c)
    db.commit()
    return None


@router.get("/{patrimonio_id}", response_model=PatrimonioOut)
def obter_patrimonio(patrimonio_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    item = buscar_patrimonio_empresa(db, patrimonio_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Patrimônio não encontrado.")
    return patrimonio_to_out(db, item)


@router.put("/{patrimonio_id}", response_model=PatrimonioOut)
def atualizar_patrimonio(patrimonio_id: int, payload: PatrimonioUpdate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    item = buscar_patrimonio_empresa(db, patrimonio_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Patrimônio não encontrado.")

    # Código de patrimônio é imutável: edição nunca altera item.codigo.
    if payload.nome is not None and payload.nome.strip():
        item.nome = payload.nome.strip()
    if payload.descricao is not None:
        item.descricao = norm_str(payload.descricao)
    if payload.categoria is not None:
        item.categoria = norm_str(payload.categoria)
    if payload.marca is not None:
        item.marca = norm_str(payload.marca)
    if payload.modelo is not None:
        item.modelo = norm_str(payload.modelo)
    if payload.numero_serie is not None:
        item.numero_serie = norm_str(payload.numero_serie)
    if payload.localizacao is not None:
        item.localizacao = norm_str(payload.localizacao)
    if payload.responsavel is not None:
        item.responsavel = norm_str(payload.responsavel)
    if payload.status is not None:
        item.status = norm_str(payload.status) or "ativo"
    if payload.valor_aquisicao is not None:
        item.valor_aquisicao = norm_str(payload.valor_aquisicao)
    if payload.data_aquisicao is not None:
        item.data_aquisicao = parse_date(payload.data_aquisicao)
    if payload.observacoes is not None:
        item.observacoes = norm_str(payload.observacoes)
    if payload.ativo is not None:
        item.ativo = bool(payload.ativo)

    try:
        if payload.custom_fields is not None:
            salvar_custom_fields(db, empresa_id, int(item.id), payload.custom_fields)
        db.commit()
        db.refresh(item)
        return patrimonio_to_out(db, item)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de patrimônio já existe.")
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar patrimônio: {exc}")


@router.delete("/{patrimonio_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_patrimonio(patrimonio_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    item = buscar_patrimonio_empresa(db, patrimonio_id, empresa_id)
    if not item:
        raise HTTPException(status_code=404, detail="Patrimônio não encontrado.")
    db.delete(item)
    db.commit()
    return None
