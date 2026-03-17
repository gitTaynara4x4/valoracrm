from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/produtos", tags=["Produtos"])


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


def norm_str(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip()
    return v or None


def get_empresa_id_from_cookie(request: Request) -> int:
    empresa_id = request.cookies.get("empresa_id")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    try:
        return int(empresa_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="empresa_id inválido.")


def get_user_id_from_cookie(request: Request) -> int:
    user_id = request.cookies.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="user_id inválido.")


def validar_usuario_empresa(request: Request, db: Session) -> int:
    empresa_id = get_empresa_id_from_cookie(request)
    user_id = get_user_id_from_cookie(request)

    user = (
        db.query(models.Usuario)
        .filter(models.Usuario.id == user_id)
        .filter(models.Usuario.empresa_id == empresa_id)
        .first()
    )

    if not user:
        raise HTTPException(status_code=401, detail="Usuário inválido para esta empresa.")

    if hasattr(user, "ativo") and user.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return empresa_id


def gerar_codigo_produto(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(models.Produto)
        .filter(models.Produto.empresa_id == empresa_id)
        .order_by(models.Produto.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"PRO-{proximo:04d}"


class ProdutoBase(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    descricao: Optional[str] = None
    categoria: Optional[str] = None
    unidade: Optional[str] = None
    preco_venda: Optional[str] = None
    custo: Optional[str] = None
    estoque_atual: Optional[str] = None
    ativo: Optional[bool] = True
    custom_fields: Optional[Dict[str, str]] = None


class ProdutoCreate(ProdutoBase):
    nome: str


class ProdutoUpdate(ProdutoBase):
    pass


class ProdutoOut(ProdutoBase, _Cfg):
    id: int
    empresa_id: int


class CampoProdutoBase(BaseModel):
    nome: Optional[str] = None
    slug: Optional[str] = None
    tipo: Optional[str] = None
    obrigatorio: Optional[bool] = False
    ativo: Optional[bool] = True
    opcoes_json: Optional[str] = None
    ordem: Optional[int] = 0


class CampoProdutoCreate(CampoProdutoBase):
    nome: str
    slug: str
    tipo: str


class CampoProdutoUpdate(CampoProdutoBase):
    pass


class CampoProdutoOut(CampoProdutoBase, _Cfg):
    id: int
    empresa_id: int


def campo_to_out(c: models.CampoProduto) -> CampoProdutoOut:
    return CampoProdutoOut(
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


def buscar_campo_empresa(db: Session, campo_id: int, empresa_id: int) -> Optional[models.CampoProduto]:
    return (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.id == campo_id)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .first()
    )


def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, models.CampoProduto]:
    campos = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .all()
    )
    return {str(c.slug): c for c in campos}


def buscar_produto_empresa(db: Session, produto_id: int, empresa_id: int) -> Optional[models.Produto]:
    return (
        db.query(models.Produto)
        .filter(models.Produto.id == produto_id)
        .filter(models.Produto.empresa_id == empresa_id)
        .first()
    )


def buscar_custom_fields_produto(
    db: Session,
    empresa_id: int,
    produto_id: int,
) -> Dict[str, str]:
    rows = (
        db.query(models.ProdutoCampoValor, models.CampoProduto)
        .join(
            models.CampoProduto,
            models.CampoProduto.id == models.ProdutoCampoValor.campo_id,
        )
        .filter(models.ProdutoCampoValor.produto_id == produto_id)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .all()
    )

    out: Dict[str, str] = {}
    for valor_row, campo_row in rows:
        out[str(campo_row.slug)] = valor_row.valor or ""
    return out


def salvar_custom_fields_produto(
    db: Session,
    empresa_id: int,
    produto_id: int,
    custom_fields: Optional[Dict[str, str]],
) -> None:
    payload = custom_fields or {}

    campos_map = buscar_campos_empresa_map(db, empresa_id)
    slugs_payload = set(payload.keys())
    slugs_validos = set(campos_map.keys())

    slugs_invalidos = sorted(slugs_payload - slugs_validos)
    if slugs_invalidos:
        raise HTTPException(
            status_code=400,
            detail=f"Campos personalizados inválidos: {', '.join(slugs_invalidos)}",
        )

    valores_existentes = (
        db.query(models.ProdutoCampoValor)
        .join(
            models.CampoProduto,
            models.CampoProduto.id == models.ProdutoCampoValor.campo_id,
        )
        .filter(models.ProdutoCampoValor.produto_id == produto_id)
        .filter(models.CampoProduto.empresa_id == empresa_id)
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
            novo = models.ProdutoCampoValor(
                produto_id=produto_id,
                campo_id=campo_id,
                valor=value_str,
            )
            db.add(novo)


def produto_to_out(db: Session, p: models.Produto) -> ProdutoOut:
    empresa_id = int(p.empresa_id)
    return ProdutoOut(
        id=int(p.id),
        empresa_id=empresa_id,
        codigo=p.codigo or "",
        nome=p.nome or "",
        descricao=p.descricao,
        categoria=p.categoria,
        unidade=p.unidade,
        preco_venda=p.preco_venda,
        custo=p.custo,
        estoque_atual=p.estoque_atual,
        ativo=bool(p.ativo),
        custom_fields=buscar_custom_fields_produto(db, empresa_id, int(p.id)),
    )


@router.get("", response_model=List[ProdutoOut])
def listar_produtos(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    rows = (
        db.query(models.Produto)
        .filter(models.Produto.empresa_id == empresa_id)
        .order_by(models.Produto.nome.asc())
        .all()
    )
    return [produto_to_out(db, p) for p in rows]


@router.get("/{produto_id}", response_model=ProdutoOut)
def obter_produto(produto_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    p = buscar_produto_empresa(db, produto_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    return produto_to_out(db, p)


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_produto(payload: ProdutoCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = (payload.codigo or "").strip() or gerar_codigo_produto(db, empresa_id)

    p = models.Produto(
        empresa_id=empresa_id,
        codigo=codigo,
        nome=payload.nome.strip(),
        descricao=norm_str(payload.descricao),
        categoria=norm_str(payload.categoria),
        unidade=norm_str(payload.unidade),
        preco_venda=norm_str(payload.preco_venda),
        custo=norm_str(payload.custo),
        estoque_atual=norm_str(payload.estoque_atual),
        ativo=bool(payload.ativo if payload.ativo is not None else True),
    )

    try:
        db.add(p)
        db.flush()

        salvar_custom_fields_produto(
            db=db,
            empresa_id=empresa_id,
            produto_id=int(p.id),
            custom_fields=payload.custom_fields,
        )

        db.commit()
        db.refresh(p)
        return produto_to_out(db, p)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de produto já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar produto: {e}")


@router.put("/{produto_id}", response_model=ProdutoOut)
def atualizar_produto(
    produto_id: int,
    payload: ProdutoUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    p = buscar_produto_empresa(db, produto_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    if payload.codigo is not None and payload.codigo.strip():
        p.codigo = payload.codigo.strip()

    if payload.nome is not None and payload.nome.strip():
        p.nome = payload.nome.strip()

    if payload.descricao is not None:
        p.descricao = norm_str(payload.descricao)

    if payload.categoria is not None:
        p.categoria = norm_str(payload.categoria)

    if payload.unidade is not None:
        p.unidade = norm_str(payload.unidade)

    if payload.preco_venda is not None:
        p.preco_venda = norm_str(payload.preco_venda)

    if payload.custo is not None:
        p.custo = norm_str(payload.custo)

    if payload.estoque_atual is not None:
        p.estoque_atual = norm_str(payload.estoque_atual)

    if payload.ativo is not None:
        p.ativo = bool(payload.ativo)

    try:
        if payload.custom_fields is not None:
            salvar_custom_fields_produto(
                db=db,
                empresa_id=empresa_id,
                produto_id=int(p.id),
                custom_fields=payload.custom_fields,
            )

        db.commit()
        db.refresh(p)
        return produto_to_out(db, p)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de produto já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar produto: {e}")


@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_produto(produto_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    p = buscar_produto_empresa(db, produto_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    db.delete(p)
    db.commit()
    return None


@router.get("/campos/lista", response_model=List[CampoProdutoOut])
def listar_campos_produtos(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    rows = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .order_by(models.CampoProduto.ordem.asc(), models.CampoProduto.nome.asc())
        .all()
    )
    return [campo_to_out(c) for c in rows]


@router.get("/campos/{campo_id}", response_model=CampoProdutoOut)
def obter_campo_produto(campo_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    return campo_to_out(c)


@router.post("/campos", response_model=CampoProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_campo_produto(payload: CampoProdutoCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    c = models.CampoProduto(
        empresa_id=empresa_id,
        nome=payload.nome.strip(),
        slug=payload.slug.strip(),
        tipo=payload.tipo.strip(),
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
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar campo: {e}")


@router.put("/campos/{campo_id}", response_model=CampoProdutoOut)
def atualizar_campo_produto(
    campo_id: int,
    payload: CampoProdutoUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    if payload.nome is not None and payload.nome.strip():
        c.nome = payload.nome.strip()

    if payload.slug is not None and payload.slug.strip():
        c.slug = payload.slug.strip()

    if payload.tipo is not None and payload.tipo.strip():
        c.tipo = payload.tipo.strip()

    if payload.obrigatorio is not None:
        c.obrigatorio = bool(payload.obrigatorio)

    if payload.ativo is not None:
        c.ativo = bool(payload.ativo)

    if payload.opcoes_json is not None:
        c.opcoes_json = norm_str(payload.opcoes_json)

    if payload.ordem is not None:
        c.ordem = int(payload.ordem)

    try:
        db.commit()
        db.refresh(c)
        return campo_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse identificador.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar campo: {e}")


@router.delete("/campos/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo_produto(campo_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")

    db.delete(c)
    db.commit()
    return None
