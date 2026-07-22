from __future__ import annotations

from typing import Dict, List, Optional
from decimal import Decimal, InvalidOperation
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.dynamic_filters import apply_dynamic_filters
from backend import models
from backend.security.permissions import user_has_permission

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



def aplicar_filtros_dinamicos_produtos(query, request: Request, db: Session, empresa_id: int):
    return apply_dynamic_filters(
        query,
        request=request,
        db=db,
        empresa_id=empresa_id,
        parent_model=models.Produto,
        custom_field_model=models.CampoProduto,
        custom_value_model=models.ProdutoCampoValor,
        custom_parent_fk="produto_id",
        system_aliases={
            "produto": "nome",
            "nome_produto": "nome",
            "preco": "preco_venda",
            "estoque": "estoque_atual",
            "situacao": "ativo",
            "status": "ativo",
            "data_cadastro": "criado_em",
        },
        exact_system_fields={"unidade"},
        digit_system_fields={"codigo", "codigo_barras"},
    )


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


def validar_permissao_produtos(request: Request, db: Session, acao: str):
    empresa_id = validar_usuario_empresa(request, db)
    user_id = get_user_id_from_cookie(request)
    usuario = (
        db.query(models.Usuario)
        .filter(models.Usuario.id == user_id)
        .filter(models.Usuario.empresa_id == empresa_id)
        .first()
    )
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")
    if not user_has_permission(db, usuario, "produtos", acao):
        raise HTTPException(status_code=403, detail=f"Sem permissão para {acao} em produtos.")
    return empresa_id, usuario


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


class AtualizacaoPrecoItem(BaseModel):
    produto_id: int
    valores: Dict[str, Optional[str]]


class AtualizacaoPrecosLote(BaseModel):
    itens: List[AtualizacaoPrecoItem]
    motivo: Optional[str] = None


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


def produto_to_list_out(db: Session, p: models.Produto, *, include_custom_fields: bool = True) -> Dict[str, object]:
    empresa_id = int(getattr(p, "empresa_id", 0) or 0)
    produto_id = int(getattr(p, "id", 0) or 0)

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
        "custom_fields": (
            buscar_custom_fields_produto(db, empresa_id, produto_id)
            if include_custom_fields and empresa_id and produto_id
            else {}
        ),
    }


# =========================================================
# Atualização rápida e formação de preços
# =========================================================

PRICE_FIELD_TERMS = (
    "preco", "valor", "custo", "margem", "markup", "mark_up", "lucro",
    "frete", "imposto", "tributo", "icms", "ipi", "pis", "cofins",
    "despesa", "comissao", "taxa", "desconto", "adicional", "acrescimo",
    "financeiro", "venda", "compra",
)

PRICE_SECTION_TERMS = (
    "formacao de preco", "formacao dos precos", "precos", "precificacao",
    "custos", "valores comerciais",
)

FILTER_FIELD_ALIASES = {
    "situacao_comercial": (
        "situacao_comercial", "status_comercial", "situacao_do_produto",
        "status_do_produto", "situacao", "status_atual",
    ),
    "tipo_produto": (
        "tipo_produto", "tipo_de_produto", "tipo_do_produto", "tipo",
    ),
    "origem_produto": (
        "origem_produto", "origem_do_produto", "origem", "procedencia",
    ),
    "fornecedor": (
        "fornecedor", "fornecedor_principal", "fornecedor_do_produto",
        "fornecedor_preferencial",
    ),
    "fabricante": (
        "fabricante", "fabricante_do_produto", "marca_fabricante", "marca",
    ),
}

NATIVE_PRICE_ALIASES = {
    "preco_venda", "valor_de_venda", "valor_venda", "preco_de_venda",
    "custo", "valor_de_custo", "preco_custo", "custo_efetivo",
}


def normalizar_token(value: Optional[str]) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower().strip()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    return re.sub(r"_+", "_", raw).strip("_")


def token_contem_termo(token: str, terms) -> bool:
    padded = f"_{normalizar_token(token)}_"
    return any(f"_{normalizar_token(term)}_" in padded or normalizar_token(term) in padded for term in terms)


def garantir_tabela_historico_precos(db: Session) -> None:
    models.ProdutoPrecoHistorico.__table__.create(bind=db.get_bind(), checkfirst=True)


def parse_field_options(raw_options) -> List[str]:
    if raw_options is None:
        return []
    if isinstance(raw_options, (list, tuple, set)):
        values = list(raw_options)
    else:
        text_value = str(raw_options).strip()
        if not text_value:
            return []
        try:
            import json
            parsed = json.loads(text_value)
            values = parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            values = re.split(r"[;\n,]+", text_value)

    out = []
    seen = set()
    for item in values:
        if isinstance(item, dict):
            value = item.get("value", item.get("label", ""))
        else:
            value = item
        value = str(value or "").strip()
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def normalizar_valor_numerico(raw_value: Optional[str]) -> Optional[str]:
    if raw_value is None:
        return None

    raw = str(raw_value).strip()
    if not raw:
        return None

    if len(raw) > 80:
        raise HTTPException(status_code=422, detail="Valor numérico muito longo.")

    cleaned = (
        raw.replace("R$", "")
        .replace("r$", "")
        .replace("%", "")
        .replace(" ", "")
        .replace("\u00a0", "")
    )

    if not cleaned:
        return None

    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") > 1:
        parts = cleaned.split(".")
        cleaned = "".join(parts[:-1]) + "." + parts[-1]

    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", cleaned):
        raise HTTPException(status_code=422, detail=f"Valor inválido: {raw}")

    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        raise HTTPException(status_code=422, detail=f"Valor inválido: {raw}")

    if not value.is_finite():
        raise HTTPException(status_code=422, detail=f"Valor inválido: {raw}")
    if value < 0:
        raise HTTPException(status_code=422, detail="Valores de preço não podem ser negativos.")
    if value > Decimal("999999999999999999"):
        raise HTTPException(status_code=422, detail="Valor excede o limite permitido.")

    normalized = format(value.normalize(), "f")
    if "." in normalized:
        normalized = normalized.rstrip("0").rstrip(".")
    if normalized in {"", "-0"}:
        normalized = "0"

    return normalized.replace(".", ",")


def normalizar_valor_campo_preco(raw_value: Optional[str], tipo: Optional[str]) -> Optional[str]:
    tipo_norm = normalizar_token(tipo)
    if tipo_norm in {"moeda", "numero", "percentual", "money", "number", "percent"}:
        return normalizar_valor_numerico(raw_value)

    if raw_value is None:
        return None
    value = str(raw_value).strip()
    if not value:
        return None
    if len(value) > 500:
        raise HTTPException(status_code=422, detail="Valor do campo muito longo.")
    return value


def campos_formulario_produtos_com_secao(db: Session, empresa_id: int) -> Dict[str, dict]:
    modelo = buscar_formulario_produtos_principal(db, empresa_id)
    if not modelo:
        return {}

    secoes = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.formulario_id == modelo.id)
        .all()
    )
    secoes_map = {int(row.id): row for row in secoes}

    campos = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.ativo == True)  # noqa: E712
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )

    out: Dict[str, dict] = {}
    for campo in campos:
        if campo_formulario_visual(campo):
            continue
        slug = campo_formulario_slug(campo)
        if not slug:
            continue
        secao = secoes_map.get(int(campo.secao_id)) if campo.secao_id else None
        out[slug] = {
            "campo": campo,
            "secao": secao,
            "secao_titulo": getattr(secao, "titulo", None),
            "secao_ordem": int(getattr(secao, "ordem", 0) or 0),
        }
    return out


def obter_campos_formacao_preco(
    db: Session, empresa_id: int, *, sincronizar: bool = True
) -> List[dict]:
    if sincronizar:
        sincronizar_campos_produtos_com_formulario(db, empresa_id)
    campos_formulario = campos_formulario_produtos_com_secao(db, empresa_id)

    result = [
        {
            "key": "custo",
            "label": "Custo",
            "kind": "native",
            "tipo": "moeda",
            "editable": True,
            "campo_id": None,
            "slug": "custo",
            "secao": "Formação de preços",
            "options": [],
            "ordem": 0,
        },
        {
            "key": "preco_venda",
            "label": "Preço de venda",
            "kind": "native",
            "tipo": "moeda",
            "editable": True,
            "campo_id": None,
            "slug": "preco_venda",
            "secao": "Formação de preços",
            "options": [],
            "ordem": 1,
        },
    ]

    rows = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.ativo == True)  # noqa: E712
        .order_by(models.CampoProduto.ordem.asc(), models.CampoProduto.id.asc())
        .all()
    )

    for row in rows:
        slug = str(row.slug or "").strip()
        slug_norm = normalizar_token(slug)
        if not slug or slug_norm in NATIVE_PRICE_ALIASES:
            continue

        form_meta = campos_formulario.get(slug, {})
        form_field = form_meta.get("campo")
        label = str(getattr(form_field, "label", None) or row.nome or slug).strip()
        section_title = str(form_meta.get("secao_titulo") or "").strip()
        tipo = normalizar_tipo_formulario(
            getattr(form_field, "tipo_campo", None) or getattr(row, "tipo", None)
        )

        section_is_price = token_contem_termo(section_title, PRICE_SECTION_TERMS)
        field_is_price = token_contem_termo(f"{slug} {label}", PRICE_FIELD_TERMS)
        currency_is_price = tipo == "moeda"

        if not (section_is_price or field_is_price or currency_is_price):
            continue

        result.append({
            "key": f"custom:{slug}",
            "label": label,
            "kind": "custom",
            "tipo": tipo,
            "editable": not bool(getattr(form_field, "somente_leitura", False)),
            "campo_id": int(row.id),
            "slug": slug,
            "secao": section_title or "Formação de preços",
            "options": parse_field_options(
                getattr(form_field, "opcoes_json", None) or getattr(row, "opcoes_json", None)
            ),
            "ordem": 1000 + (int(form_meta.get("secao_ordem") or 0) * 10000) + int(getattr(row, "ordem", 0) or 0),
        })

    seen = set()
    unique = []
    for item in sorted(result, key=lambda x: (int(x.get("ordem", 0)), str(x.get("label", "")).lower())):
        key = item["key"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def encontrar_campo_filtro(campos: List[models.CampoProduto], aliases) -> Optional[models.CampoProduto]:
    aliases_norm = [normalizar_token(alias) for alias in aliases]
    exact = {normalizar_token(row.slug): row for row in campos if row.slug}
    for alias in aliases_norm:
        if alias in exact:
            return exact[alias]

    for row in campos:
        candidate = normalizar_token(f"{row.slug or ''} {row.nome or ''}")
        if any(alias and alias in candidate for alias in aliases_norm):
            return row
    return None


def obter_campos_filtro_produtos(
    db: Session, empresa_id: int, *, sincronizar: bool = True
) -> Dict[str, Optional[models.CampoProduto]]:
    if sincronizar:
        sincronizar_campos_produtos_com_formulario(db, empresa_id)
    rows = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.ativo == True)  # noqa: E712
        .order_by(models.CampoProduto.ordem.asc(), models.CampoProduto.id.asc())
        .all()
    )
    return {key: encontrar_campo_filtro(rows, aliases) for key, aliases in FILTER_FIELD_ALIASES.items()}


def opcoes_campo_filtro(db: Session, empresa_id: int, campo: Optional[models.CampoProduto]) -> List[str]:
    if not campo:
        return []
    configured = parse_field_options(getattr(campo, "opcoes_json", None))
    rows = (
        db.query(models.ProdutoCampoValor.valor)
        .join(models.Produto, models.Produto.id == models.ProdutoCampoValor.produto_id)
        .filter(models.Produto.empresa_id == empresa_id)
        .filter(models.ProdutoCampoValor.campo_id == int(campo.id))
        .filter(models.ProdutoCampoValor.valor.isnot(None))
        .distinct()
        .order_by(models.ProdutoCampoValor.valor.asc())
        .all()
    )
    values = []
    seen = set()
    for value in configured:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            values.append(value)
    for row in rows:
        value = str(row[0] if isinstance(row, tuple) else getattr(row, "valor", "") or "").strip()
        norm = value.casefold()
        if not value or norm in seen:
            continue
        seen.add(norm)
        values.append(value)
    return values[:500]


def aplicar_filtro_campo_produto(query, db: Session, empresa_id: int, campo, value: Optional[str]):
    raw = norm_str(value)
    if not raw or not campo:
        return query
    subquery = (
        db.query(models.ProdutoCampoValor.produto_id)
        .filter(models.ProdutoCampoValor.campo_id == int(campo.id))
        .filter(func.lower(func.trim(models.ProdutoCampoValor.valor)) == raw.lower())
    )
    return query.filter(models.Produto.id.in_(subquery))


def carregar_valores_custom_lote(db: Session, produto_ids: List[int], campo_ids: List[int]) -> Dict[int, Dict[int, str]]:
    if not produto_ids or not campo_ids:
        return {}
    rows = (
        db.query(models.ProdutoCampoValor)
        .filter(models.ProdutoCampoValor.produto_id.in_(produto_ids))
        .filter(models.ProdutoCampoValor.campo_id.in_(campo_ids))
        .all()
    )
    out: Dict[int, Dict[int, str]] = {}
    for row in rows:
        out.setdefault(int(row.produto_id), {})[int(row.campo_id)] = row.valor or ""
    return out


def valor_atual_campo_preco(produto, campo_meta: dict, custom_values: Dict[int, str]) -> Optional[str]:
    if campo_meta["kind"] == "native":
        return getattr(produto, campo_meta["key"], None)
    return custom_values.get(int(campo_meta["campo_id"]))

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

    query = aplicar_filtros_dinamicos_produtos(query, request, db, empresa_id)

    query = query.order_by(models.Produto.nome.asc(), models.Produto.id.asc())

    if paginated:
        total = query.count()
        rows = query.offset(offset).limit(limit).all()
        items = [produto_to_list_out(db, p, include_custom_fields=True) for p in rows]
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
        }

    rows = query.all()
    return [produto_to_list_out(db, p, include_custom_fields=True) for p in rows]


@router.get("/atualizacao-precos/meta")
def obter_meta_atualizacao_precos(request: Request, db: Session = Depends(get_db)):
    empresa_id, _ = validar_permissao_produtos(request, db, "ver")

    # Sincroniza uma única vez ao abrir a tela. Filtros e paginação seguintes
    # consultam os campos já sincronizados, sem refazer o formulário.
    sincronizar_campos_produtos_com_formulario(db, empresa_id)
    campos_preco = obter_campos_formacao_preco(db, empresa_id, sincronizar=False)
    campos_filtro = obter_campos_filtro_produtos(db, empresa_id, sincronizar=False)
    db.commit()

    categorias_rows = (
        db.query(models.Produto.categoria)
        .filter(models.Produto.empresa_id == empresa_id)
        .filter(models.Produto.categoria.isnot(None))
        .distinct()
        .order_by(models.Produto.categoria.asc())
        .all()
    )
    categorias = sorted({str(row[0]).strip() for row in categorias_rows if row[0] and str(row[0]).strip()}, key=str.casefold)

    filtros = {
        "situacao_comercial": {
            "label": "Situação comercial",
            "campo": campos_filtro["situacao_comercial"].slug if campos_filtro["situacao_comercial"] else None,
            "source": "custom" if campos_filtro["situacao_comercial"] else "native",
            "options": (
                opcoes_campo_filtro(db, empresa_id, campos_filtro["situacao_comercial"])
                if campos_filtro["situacao_comercial"]
                else ["Ativo", "Inativo"]
            ),
        },
        "tipo_produto": {
            "label": "Tipo de produto",
            "campo": campos_filtro["tipo_produto"].slug if campos_filtro["tipo_produto"] else None,
            "source": "custom",
            "options": opcoes_campo_filtro(db, empresa_id, campos_filtro["tipo_produto"]),
        },
        "origem_produto": {
            "label": "Origem do produto",
            "campo": campos_filtro["origem_produto"].slug if campos_filtro["origem_produto"] else None,
            "source": "custom",
            "options": opcoes_campo_filtro(db, empresa_id, campos_filtro["origem_produto"]),
        },
        "categoria": {
            "label": "Categoria",
            "campo": "categoria",
            "source": "native",
            "options": categorias[:500],
        },
        "fornecedor": {
            "label": "Fornecedor",
            "campo": campos_filtro["fornecedor"].slug if campos_filtro["fornecedor"] else None,
            "source": "custom",
            "options": opcoes_campo_filtro(db, empresa_id, campos_filtro["fornecedor"]),
        },
        "fabricante": {
            "label": "Fabricante",
            "campo": campos_filtro["fabricante"].slug if campos_filtro["fabricante"] else None,
            "source": "custom",
            "options": opcoes_campo_filtro(db, empresa_id, campos_filtro["fabricante"]),
        },
    }

    return {
        "campos_preco": campos_preco,
        "filtros": filtros,
        "limite_lote": 500,
    }


@router.get("/atualizacao-precos")
def listar_atualizacao_precos(
    request: Request,
    busca: Optional[str] = Query(default=None),
    situacao_comercial: Optional[str] = Query(default=None),
    tipo_produto: Optional[str] = Query(default=None),
    origem_produto: Optional[str] = Query(default=None),
    categoria: Optional[str] = Query(default=None),
    fornecedor: Optional[str] = Query(default=None),
    fabricante: Optional[str] = Query(default=None),
    campos: Optional[str] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    empresa_id, _ = validar_permissao_produtos(request, db, "ver")
    todos_campos_preco = obter_campos_formacao_preco(db, empresa_id, sincronizar=False)
    campos_filtro = obter_campos_filtro_produtos(db, empresa_id, sincronizar=False)

    chaves_solicitadas = {
        chave.strip()
        for chave in str(campos or "").split(",")
        if chave and chave.strip()
    }
    campos_preco = (
        [campo for campo in todos_campos_preco if str(campo["key"]) in chaves_solicitadas]
        if chaves_solicitadas
        else todos_campos_preco
    )
    if not campos_preco:
        campos_preco = [
            campo for campo in todos_campos_preco
            if str(campo["key"]) in {"custo", "preco_venda"}
        ] or todos_campos_preco[:2]

    query = db.query(models.Produto).filter(models.Produto.empresa_id == empresa_id)

    texto = norm_str(busca)
    if texto:
        like = f"%{texto}%"
        query = query.filter(
            models.Produto.codigo.ilike(like) |
            models.Produto.nome.ilike(like) |
            models.Produto.descricao.ilike(like)
        )

    categoria_value = norm_str(categoria)
    if categoria_value:
        query = query.filter(func.lower(func.trim(models.Produto.categoria)) == categoria_value.lower())

    situacao_value = norm_str(situacao_comercial)
    if situacao_value:
        if campos_filtro["situacao_comercial"]:
            query = aplicar_filtro_campo_produto(
                query, db, empresa_id, campos_filtro["situacao_comercial"], situacao_value
            )
        else:
            situacao_norm = normalizar_token(situacao_value)
            if situacao_norm in {"ativo", "ativos", "true", "1", "sim"}:
                query = query.filter(models.Produto.ativo == True)  # noqa: E712
            elif situacao_norm in {"inativo", "inativos", "false", "0", "nao"}:
                query = query.filter(models.Produto.ativo == False)  # noqa: E712

    for key, value in (
        ("tipo_produto", tipo_produto),
        ("origem_produto", origem_produto),
        ("fornecedor", fornecedor),
        ("fabricante", fabricante),
    ):
        query = aplicar_filtro_campo_produto(query, db, empresa_id, campos_filtro[key], value)

    query = query.order_by(func.lower(models.Produto.nome).asc(), models.Produto.nome.asc(), models.Produto.id.asc())
    total = query.count()
    rows = query.offset(offset).limit(limit).all()

    produto_ids = [int(row.id) for row in rows]
    custom_field_ids = [int(item["campo_id"]) for item in campos_preco if item["kind"] == "custom"]
    custom_values = carregar_valores_custom_lote(db, produto_ids, custom_field_ids)

    items = []
    for produto in rows:
        pid = int(produto.id)
        valores_produto = custom_values.get(pid, {})
        items.append({
            "id": pid,
            "codigo": produto.codigo or "",
            "nome": produto.nome or "",
            "categoria": produto.categoria or "",
            "ativo": bool(produto.ativo),
            "atualizado_em": iso_datetime(getattr(produto, "atualizado_em", None)),
            "valores": {
                campo["key"]: valor_atual_campo_preco(produto, campo, valores_produto)
                for campo in campos_preco
            },
        })

    return {
        "items": items,
        "campos_preco": campos_preco,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }


@router.patch("/atualizacao-precos")
def salvar_atualizacao_precos(
    payload: AtualizacaoPrecosLote,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id, usuario = validar_permissao_produtos(request, db, "editar")
    usuario_id = int(usuario.id)

    if not payload.itens:
        raise HTTPException(status_code=422, detail="Nenhuma alteração foi enviada.")
    if len(payload.itens) > 500:
        raise HTTPException(status_code=422, detail="O limite é de 500 produtos por salvamento.")

    produto_ids = [int(item.produto_id) for item in payload.itens]
    if len(produto_ids) != len(set(produto_ids)):
        raise HTTPException(status_code=422, detail="Há produtos repetidos no lote enviado.")

    campos_preco = obter_campos_formacao_preco(db, empresa_id)
    campos_map = {str(item["key"]): item for item in campos_preco}

    produtos_rows = (
        db.query(models.Produto)
        .filter(models.Produto.empresa_id == empresa_id)
        .filter(models.Produto.id.in_(produto_ids))
        .all()
    )
    produtos_map = {int(row.id): row for row in produtos_rows}
    faltantes = sorted(set(produto_ids) - set(produtos_map))
    if faltantes:
        raise HTTPException(status_code=404, detail="Um ou mais produtos não foram encontrados nesta empresa.")

    custom_field_ids = [int(item["campo_id"]) for item in campos_preco if item["kind"] == "custom"]
    custom_rows = (
        db.query(models.ProdutoCampoValor)
        .filter(models.ProdutoCampoValor.produto_id.in_(produto_ids))
        .filter(models.ProdutoCampoValor.campo_id.in_(custom_field_ids))
        .all()
        if custom_field_ids
        else []
    )
    custom_map = {(int(row.produto_id), int(row.campo_id)): row for row in custom_rows}

    motivo = norm_str(payload.motivo)
    if motivo and len(motivo) > 500:
        raise HTTPException(status_code=422, detail="O motivo deve ter no máximo 500 caracteres.")

    try:
        garantir_tabela_historico_precos(db)
        alteracoes = 0
        produtos_alterados = set()

        for item in payload.itens:
            produto = produtos_map[int(item.produto_id)]
            if not item.valores:
                continue

            for key, raw_value in item.valores.items():
                campo = campos_map.get(str(key))
                if not campo:
                    raise HTTPException(status_code=422, detail=f"Campo de preço não permitido: {key}")
                if not bool(campo.get("editable", False)):
                    raise HTTPException(status_code=403, detail=f"O campo {campo['label']} é somente leitura.")

                novo_valor = normalizar_valor_campo_preco(raw_value, campo.get("tipo"))

                if campo["kind"] == "native":
                    valor_anterior = norm_str(getattr(produto, campo["key"], None))
                else:
                    map_key = (int(produto.id), int(campo["campo_id"]))
                    row = custom_map.get(map_key)
                    valor_anterior = norm_str(row.valor if row else None)

                valor_anterior_normalizado = normalizar_valor_campo_preco(
                    valor_anterior, campo.get("tipo")
                )
                if valor_anterior_normalizado == novo_valor:
                    continue

                if campo["kind"] == "native":
                    setattr(produto, campo["key"], novo_valor)
                else:
                    map_key = (int(produto.id), int(campo["campo_id"]))
                    row = custom_map.get(map_key)
                    if novo_valor is None:
                        if row:
                            db.delete(row)
                            custom_map.pop(map_key, None)
                    elif row:
                        row.valor = novo_valor
                    else:
                        row = models.ProdutoCampoValor(
                            produto_id=int(produto.id),
                            campo_id=int(campo["campo_id"]),
                            valor=novo_valor,
                        )
                        db.add(row)
                        custom_map[map_key] = row

                db.add(models.ProdutoPrecoHistorico(
                    empresa_id=empresa_id,
                    produto_id=int(produto.id),
                    usuario_id=usuario_id,
                    campo_chave=str(campo["key"]),
                    campo_nome=str(campo["label"]),
                    valor_anterior=valor_anterior,
                    valor_novo=novo_valor,
                    motivo=motivo,
                ))
                alteracoes += 1
                produtos_alterados.add(int(produto.id))

        if not alteracoes:
            db.rollback()
            return {"alteracoes": 0, "produtos_alterados": 0, "message": "Nenhum valor foi modificado."}

        db.commit()
        return {
            "alteracoes": alteracoes,
            "produtos_alterados": len(produtos_alterados),
            "message": "Valores atualizados com sucesso.",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Não foi possível salvar a atualização de preços.")


@router.get("/atualizacao-precos/historico")
def listar_historico_atualizacao_precos(
    request: Request,
    produto_id: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    empresa_id, _ = validar_permissao_produtos(request, db, "ver")
    garantir_tabela_historico_precos(db)

    query = (
        db.query(
            models.ProdutoPrecoHistorico,
            models.Produto.nome.label("produto_nome"),
            models.Produto.codigo.label("produto_codigo"),
            models.Usuario.nome.label("usuario_nome"),
        )
        .join(models.Produto, models.Produto.id == models.ProdutoPrecoHistorico.produto_id)
        .outerjoin(models.Usuario, models.Usuario.id == models.ProdutoPrecoHistorico.usuario_id)
        .filter(models.ProdutoPrecoHistorico.empresa_id == empresa_id)
    )

    if produto_id is not None:
        query = query.filter(models.ProdutoPrecoHistorico.produto_id == produto_id)

    rows = (
        query
        .order_by(models.ProdutoPrecoHistorico.criado_em.desc(), models.ProdutoPrecoHistorico.id.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": int(hist.id),
            "produto_id": int(hist.produto_id),
            "produto_codigo": produto_codigo or "",
            "produto_nome": produto_nome or "",
            "campo_chave": hist.campo_chave,
            "campo_nome": hist.campo_nome,
            "valor_anterior": hist.valor_anterior,
            "valor_novo": hist.valor_novo,
            "motivo": hist.motivo,
            "usuario_nome": usuario_nome or "Usuário removido",
            "criado_em": iso_datetime(hist.criado_em),
        }
        for hist, produto_nome, produto_codigo, usuario_nome in rows
    ]


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
