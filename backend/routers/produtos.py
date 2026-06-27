from __future__ import annotations

from typing import Dict, List, Optional
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text
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


def iso_datetime(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def normalizar_codigo_sistema(codigo: Optional[str]) -> str:
    """Mantém códigos internos do sistema apenas numéricos.

    Ex.: "PRO-0007" vira "0007".
    """
    return re.sub(r"\D+", "", str(codigo or "")).strip()


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
    # O user_id é a fonte segura da sessão.
    # Não use o cookie empresa_id para validar o vínculo, pois ele pode ficar
    # antigo no navegador e derrubar a tela com "Usuário inválido para esta empresa".
    user_id = get_user_id_from_cookie(request)

    user = (
        db.query(models.Usuario)
        .filter(models.Usuario.id == user_id)
        .first()
    )

    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(user, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    if hasattr(user, "ativo") and user.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return int(user.empresa_id)


def garantir_tabela_sequencias_codigo(db: Session) -> None:
    """Cria a tabela de sequência se ela ainda não existir.

    Essa tabela evita usar o ID do banco como código do produto.
    O código passa a seguir uma sequência própria por empresa e por módulo.
    """
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS cadastro_sequencias (
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(40) NOT NULL,
            ultimo_codigo BIGINT NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (empresa_id, modulo)
        )
    """))


def maior_codigo_produto_existente(db: Session, empresa_id: int) -> int:
    rows = (
        db.query(models.Produto.codigo)
        .filter(models.Produto.empresa_id == empresa_id)
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


def preparar_sequencia_produto(db: Session, empresa_id: int) -> int:
    garantir_tabela_sequencias_codigo(db)

    maior_atual = maior_codigo_produto_existente(db, empresa_id)

    db.execute(
        text("""
            INSERT INTO cadastro_sequencias (empresa_id, modulo, ultimo_codigo)
            VALUES (:empresa_id, 'produtos', :maior_atual)
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
            WHERE empresa_id = :empresa_id AND modulo = 'produtos'
        """),
        {"empresa_id": empresa_id},
    ).scalar_one()

    return int(ultimo or 0)


def prever_proximo_codigo_produto(db: Session, empresa_id: int) -> str:
    """Mostra uma previsão sem consumir código.

    Abrir o modal não pode pular numeração. O número só é consumido no POST.
    """
    ultimo = preparar_sequencia_produto(db, empresa_id)
    return f"{ultimo + 1:04d}"


def gerar_codigo_produto(db: Session, empresa_id: int) -> str:
    """Gera e consome o próximo código sequencial do produto.

    Não usa ID do banco.
    Não reutiliza código consumido depois que esta sequência existe.
    Se hoje só existe código 0001, o próximo será 0002, mesmo que o ID do banco esteja em 10.
    """
    preparar_sequencia_produto(db, empresa_id)

    ultimo = db.execute(
        text("""
            SELECT ultimo_codigo
            FROM cadastro_sequencias
            WHERE empresa_id = :empresa_id AND modulo = 'produtos'
            FOR UPDATE
        """),
        {"empresa_id": empresa_id},
    ).scalar_one()

    proximo = int(ultimo or 0) + 1

    db.execute(
        text("""
            UPDATE cadastro_sequencias
            SET ultimo_codigo = :proximo, atualizado_em = NOW()
            WHERE empresa_id = :empresa_id AND modulo = 'produtos'
        """),
        {"empresa_id": empresa_id, "proximo": proximo},
    )

    return f"{proximo:04d}"


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
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None


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


# =========================================================
# Sincronização com o construtor de Formulários
# Produtos deve aceitar campos que vêm de /api/formularios,
# igual Clientes e Fornecedores.
# =========================================================

def slugify_formulario(value: Optional[str]) -> str:
    text = str(value or "").strip().lower()
    repl = {
        "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a",
        "é": "e", "è": "e", "ê": "e", "ë": "e",
        "í": "i", "ì": "i", "î": "i", "ï": "i",
        "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o",
        "ú": "u", "ù": "u", "û": "u", "ü": "u",
        "ç": "c",
    }
    for a, b in repl.items():
        text = text.replace(a, b)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"^_+|_+$", "", text)
    return text[:120]


def normalizar_tipo_formulario(tipo: Optional[str]) -> str:
    t = str(tipo or "texto").strip().lower()
    mapa = {
        "text": "texto",
        "texto": "texto",
        "textarea": "textarea",
        "numero": "numero",
        "number": "numero",
        "data": "data",
        "date": "data",
        "select": "select",
        "lista": "select",
        "checkbox": "checkbox",
        "email": "email",
        "telefone": "telefone",
        "phone": "telefone",
        "tel": "telefone",
        "moeda": "moeda",
        "money": "moeda",
        "percentual": "percentual",
        "percent": "percentual",
    }
    return mapa.get(t, "texto")


def campo_formulario_slug(campo: models.FormularioCampo) -> str:
    return str(
        getattr(campo, "slug", None)
        or getattr(campo, "campo_personalizado_slug", None)
        or getattr(campo, "campo_sistema", None)
        or slugify_formulario(getattr(campo, "label", None))
    ).strip()


def campo_formulario_nome(campo: models.FormularioCampo) -> str:
    return str(
        getattr(campo, "label", None)
        or getattr(campo, "nome", None)
        or getattr(campo, "campo_sistema", None)
        or campo_formulario_slug(campo)
        or "Campo"
    ).strip()


def campo_formulario_visual(campo: models.FormularioCampo) -> bool:
    origem = str(getattr(campo, "origem", "") or "").lower()
    return origem == "visual" or bool(getattr(campo, "tipo_visual", None))


def buscar_formulario_produtos_principal(db: Session, empresa_id: int) -> Optional[models.FormularioModelo]:
    return (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == "produtos")
        .filter(models.FormularioModelo.ativo == True)  # noqa: E712
        .order_by(
            models.FormularioModelo.usar_como_ficha_principal.desc(),
            models.FormularioModelo.padrao.desc(),
            models.FormularioModelo.id.desc(),
        )
        .first()
    )


def campos_formulario_produtos_map(db: Session, empresa_id: int) -> Dict[str, models.FormularioCampo]:
    modelo = buscar_formulario_produtos_principal(db, empresa_id)
    if not modelo:
        return {}

    rows = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.ativo == True)  # noqa: E712
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )

    out: Dict[str, models.FormularioCampo] = {}
    for campo in rows:
        if campo_formulario_visual(campo):
            continue
        slug = campo_formulario_slug(campo)
        if slug:
            out[slug] = campo
    return out


def sincronizar_campos_produtos_com_formulario(
    db: Session,
    empresa_id: int,
    somente_slugs: Optional[set[str]] = None,
) -> Dict[str, models.CampoProduto]:
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    campos_formulario = campos_formulario_produtos_map(db, empresa_id)

    for slug, campo_form in campos_formulario.items():
        if somente_slugs is not None and slug not in somente_slugs:
            continue
        if slug in campos_map:
            campo_produto = campos_map[slug]
            if not campo_produto.nome:
                campo_produto.nome = campo_formulario_nome(campo_form)
            if not campo_produto.tipo:
                campo_produto.tipo = normalizar_tipo_formulario(getattr(campo_form, "tipo_campo", None))
            continue

        novo = models.CampoProduto(
            empresa_id=empresa_id,
            nome=campo_formulario_nome(campo_form),
            slug=slug,
            tipo=normalizar_tipo_formulario(getattr(campo_form, "tipo_campo", None)),
            obrigatorio=bool(getattr(campo_form, "obrigatorio", False)),
            ativo=bool(getattr(campo_form, "ativo", True)),
            opcoes_json=norm_str(getattr(campo_form, "opcoes_json", None)),
            ordem=int(getattr(campo_form, "ordem", 0) or 0),
        )
        db.add(novo)
        db.flush()
        campos_map[slug] = novo

    return buscar_campos_empresa_map(db, empresa_id)


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

    # Garante que campos criados no construtor de Formulários também sejam
    # aceitos pelo módulo Produtos. Sem isso, o front envia custom_fields
    # do formulário e o backend responde "campos personalizados inválidos".
    slugs_payload = set(str(k).strip() for k in payload.keys() if str(k).strip())
    campos_map = sincronizar_campos_produtos_com_formulario(
        db=db,
        empresa_id=empresa_id,
        somente_slugs=slugs_payload or None,
    )
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


def produto_to_out(db: Session, p: models.Produto, *, include_custom_fields: bool = True) -> ProdutoOut:
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
        criado_em=iso_datetime(getattr(p, "criado_em", None)),
        atualizado_em=iso_datetime(getattr(p, "atualizado_em", None)),
        custom_fields=(buscar_custom_fields_produto(db, empresa_id, int(p.id)) if include_custom_fields else {}),
    )


def produto_to_list_out(p: models.Produto) -> Dict[str, object]:
    return {
        "id": int(p.id),
        "empresa_id": int(p.empresa_id),
        "codigo": getattr(p, "codigo", None) or "",
        "cod_ref_id": getattr(p, "codigo", None) or "",
        "codigo_barras": getattr(p, "codigo_barras", None),
        "nome": getattr(p, "nome", None) or "",
        "nome_produto": getattr(p, "nome", None) or "",
        "nome_generico": getattr(p, "nome_generico", None),
        "descricao": getattr(p, "descricao", None),
        "categoria": getattr(p, "categoria", None),
        "categorias": getattr(p, "categoria", None),
        "unidade": getattr(p, "unidade", None),
        "preco_venda": getattr(p, "preco_venda", None),
        "custo": getattr(p, "custo", None),
        "estoque_atual": getattr(p, "estoque_atual", None),
        "ativo": bool(getattr(p, "ativo", True)),
        "criado_em": iso_datetime(getattr(p, "criado_em", None)),
        "atualizado_em": iso_datetime(getattr(p, "atualizado_em", None)),
        "custom_fields": {},
    }

@router.get("")
def listar_produtos(
    request: Request,
    busca: Optional[str] = Query(default=None),
    ativo: Optional[bool] = Query(default=None),
    categoria: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """
    Lista leve e paginada para Produtos.

    A tabela não precisa trazer valores de campos personalizados de todos os
    produtos. O produto completo continua vindo em /api/produtos/{id}.
    """
    empresa_id = validar_usuario_empresa(request, db)

    query = db.query(models.Produto).filter(models.Produto.empresa_id == empresa_id)

    if ativo is not None:
        query = query.filter(models.Produto.ativo == ativo)

    if norm_str(categoria):
        query = query.filter(models.Produto.categoria.ilike(f"%{str(categoria).strip()}%"))

    texto = norm_str(busca)
    if texto:
        q = f"%{texto}%"
        filtros = [models.Produto.codigo.ilike(q), models.Produto.nome.ilike(q)]
        if hasattr(models.Produto, "descricao"):
            filtros.append(models.Produto.descricao.ilike(q))
        if hasattr(models.Produto, "categoria"):
            filtros.append(models.Produto.categoria.ilike(q))
        cond = filtros[0]
        for item in filtros[1:]:
            cond = cond | item
        query = query.filter(cond)

    query = query.order_by(models.Produto.nome.asc(), models.Produto.id.asc())

    if paginated:
        total = query.count()
        rows = query.offset(offset).limit(limit).all()
        items = [produto_to_list_out(p) for p in rows]
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
        }

    rows = query.all()
    return [produto_to_list_out(p) for p in rows]


@router.get("/proximo-codigo")
def obter_proximo_codigo_produto(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = prever_proximo_codigo_produto(db, empresa_id)
    db.commit()
    return {"codigo": codigo}


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_produto(payload: ProdutoCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    # Código de produto é gerado pelo sistema, único e imutável.
    # Não confiar em payload.codigo vindo do front/importação.
    codigo = gerar_codigo_produto(db, empresa_id)

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


@router.get("/campos", response_model=List[CampoProdutoOut])
@router.get("/campos/lista", response_model=List[CampoProdutoOut])
def listar_campos_produtos(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    # Mantém campos_produtos sincronizado com o construtor de Formulários.
    sincronizar_campos_produtos_com_formulario(db, empresa_id)
    db.commit()

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


@router.get("/{produto_id}", response_model=ProdutoOut)
def obter_produto(produto_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)

    p = buscar_produto_empresa(db, produto_id, empresa_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    return produto_to_out(db, p)


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

    # Código de produto é imutável: edição nunca altera p.codigo.

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
