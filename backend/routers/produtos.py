from __future__ import annotations

from typing import Any, Dict, List, Optional
from decimal import Decimal, InvalidOperation
import json
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.dynamic_filters import apply_dynamic_filters
from backend import models

try:
    from backend import models_contratos
except Exception:  # pragma: no cover
    models_contratos = None
from backend.security.permissions import get_request_user, user_has_permission

router = APIRouter(prefix="/api/produtos", tags=["Produtos"])


# O formulário de Produtos permite que a empresa renomeie o campo de custo.
# Estes aliases representam o mesmo conceito comercial: custo/valor de compra.
PRODUCT_COST_ALIASES = (
    "custo",
    "valor_custo",
    "valor_de_custo",
    "custo_efetivo",
    "preco_custo",
    "preco_de_custo",
    "valor_compra",
    "valor_de_compra",
    "preco_compra",
    "preco_de_compra",
    "custo_compra",
    "custo_de_compra",
)
PRODUCT_COST_ALIAS_SET = set(PRODUCT_COST_ALIASES)

PRODUCT_SALE_ALIASES = (
    "preco_venda",
    "preco_de_venda",
    "valor_venda",
    "valor_de_venda",
    "preco_final_venda_tabela_01",
    "preco_final",
    "venda",
)
PRODUCT_SALE_ALIAS_SET = set(PRODUCT_SALE_ALIASES)


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


def normalizar_slug_custo(value: Any) -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower().strip()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    return re.sub(r"_+", "_", raw).strip("_")


def prioridade_campo_custo(slug: Any, nome: Any = None) -> Optional[int]:
    identifiers = [normalizar_slug_custo(slug), normalizar_slug_custo(nome)]
    for offset, identifier in enumerate(identifiers):
        if not identifier:
            continue
        if identifier in PRODUCT_COST_ALIAS_SET:
            return PRODUCT_COST_ALIASES.index(identifier) + offset * 20

        without_suffix = re.sub(r"_\d+$", "", identifier)
        if without_suffix in PRODUCT_COST_ALIAS_SET:
            return PRODUCT_COST_ALIASES.index(without_suffix) + 40 + offset * 20

        tokens = set(identifier.split("_"))
        if "custo" in tokens:
            return 100 + offset
        if "compra" in tokens and ({"valor", "preco"} & tokens):
            return 110 + offset

    return None


def campo_representa_custo(slug: Any, nome: Any = None) -> bool:
    return prioridade_campo_custo(slug, nome) is not None


def campo_representa_preco_venda(slug: Any, nome: Any = None) -> bool:
    identifiers = [normalizar_slug_custo(slug), normalizar_slug_custo(nome)]
    for identifier in identifiers:
        if not identifier:
            continue
        if identifier in PRODUCT_SALE_ALIAS_SET:
            return True
        without_suffix = re.sub(r"_\d+$", "", identifier)
        if without_suffix in PRODUCT_SALE_ALIAS_SET:
            return True
        tokens = set(identifier.split("_"))
        if "venda" in tokens and ({"preco", "valor", "final"} & tokens):
            return True
    return False


def preco_venda_produto_efetivo(
    preco_nativo: Any,
    custom_fields: Optional[Dict[str, Any]],
) -> Optional[str]:
    custom = custom_fields if isinstance(custom_fields, dict) else {}
    for alias in PRODUCT_SALE_ALIASES:
        raw = custom.get(alias)
        if raw is not None and str(raw).strip() != "":
            return str(raw).strip()

    for slug, raw in custom.items():
        if campo_representa_preco_venda(slug, slug) and raw is not None and str(raw).strip() != "":
            return str(raw).strip()

    return norm_str(None if preco_nativo is None else str(preco_nativo))


def extrair_custo_custom_fields(
    custom_fields: Optional[Dict[str, Any]],
    field_names: Optional[Dict[str, str]] = None,
) -> tuple[bool, Optional[str]]:
    """Retorna (campo_encontrado, valor_normalizado).

    O nome exibido também é considerado. Isso cobre bases antigas em que o
    campo foi renomeado para "Valor Compra", mas manteve um slug legado.
    """
    if not isinstance(custom_fields, dict):
        return False, None

    candidates: List[tuple[int, int, Optional[str]]] = []
    found = False
    for index, (slug, raw_value) in enumerate(custom_fields.items()):
        priority = prioridade_campo_custo(slug, (field_names or {}).get(str(slug)))
        if priority is None:
            continue
        found = True
        value = norm_str(None if raw_value is None else str(raw_value))
        candidates.append((priority, index, value))

    if not candidates:
        return found, None

    candidates.sort(key=lambda item: (item[0], item[1]))
    for _, _, value in candidates:
        if value is not None:
            return True, value
    return True, None


def extrair_custo_custom_fields_empresa(
    db: Session,
    empresa_id: int,
    custom_fields: Optional[Dict[str, Any]],
) -> tuple[bool, Optional[str]]:
    if not isinstance(custom_fields, dict):
        return False, None
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    field_names = {slug: str(getattr(campo, "nome", "") or "") for slug, campo in campos_map.items()}
    return extrair_custo_custom_fields(custom_fields, field_names)


def custo_produto_efetivo(
    custo_nativo: Any,
    custom_fields: Optional[Dict[str, Any]],
    field_names: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    found, custom_cost = extrair_custo_custom_fields(custom_fields, field_names)
    # A tela de Formação de Preços é a fonte principal. Inclusive substitui
    # custo nativo antigo igual a zero, que era a causa do DAV mostrar R$ 0,00.
    if found:
        return custom_cost
    return norm_str(None if custo_nativo is None else str(custo_nativo))



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



def validar_usuario_empresa(request: Request, db: Session) -> int:
    return int(get_request_user(request, db).empresa_id)


def validar_permissao_produtos(request: Request, db: Session, acao: str):
    usuario = get_request_user(request, db)
    empresa_id = int(usuario.empresa_id)
    if not user_has_permission(db, usuario, "produtos", acao):
        raise HTTPException(status_code=403, detail=f"Sem permissão para {acao} em produtos.")
    return empresa_id, usuario


def garantir_tabela_sequencias_codigo(db: Session) -> None:
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


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
    """Mostra uma previsão sem alterar a sequência persistida."""
    maior_existente = maior_codigo_produto_existente(db, empresa_id)
    ultimo_sequencia = db.execute(
        text("""
            SELECT ultimo_codigo
            FROM cadastro_sequencias
            WHERE empresa_id = :empresa_id AND modulo = 'produtos'
        """),
        {"empresa_id": empresa_id},
    ).scalar()
    ultimo = max(maior_existente, int(ultimo_sequencia or 0))
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


def garantir_tabela_produto_kit(db: Session) -> None:
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


def decimal_kit(value: Any, *, default: Decimal = Decimal("0")) -> Decimal:
    raw = str(value if value is not None else "").strip()
    if not raw:
        return default
    raw = re.sub(r"[^0-9,.-]", "", raw)
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        return default


def decimal_kit_str(value: Decimal, casas: int = 2) -> str:
    quant = Decimal("1").scaleb(-casas)
    return format(value.quantize(quant), "f")


def sincronizar_valores_comerciais_custom_produto(
    db: Session,
    empresa_id: int,
    produto_id: int,
    *,
    custo: Optional[str] = None,
    preco_venda: Optional[str] = None,
) -> None:
    campos = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.ativo == True)  # noqa: E712
        .all()
    )
    relevantes = [
        campo for campo in campos
        if campo_representa_custo(campo.slug, campo.nome)
        or campo_representa_preco_venda(campo.slug, campo.nome)
    ]
    if not relevantes:
        return

    field_ids = [int(campo.id) for campo in relevantes]
    existentes = (
        db.query(models.ProdutoCampoValor)
        .filter(models.ProdutoCampoValor.produto_id == produto_id)
        .filter(models.ProdutoCampoValor.campo_id.in_(field_ids))
        .all()
    )
    existentes_map = {int(row.campo_id): row for row in existentes}

    for campo in relevantes:
        novo_valor: Optional[str] = None
        if campo_representa_custo(campo.slug, campo.nome):
            novo_valor = custo
        elif campo_representa_preco_venda(campo.slug, campo.nome):
            novo_valor = preco_venda

        if novo_valor is None:
            continue

        row = existentes_map.get(int(campo.id))
        if row:
            row.valor = novo_valor
        else:
            db.add(models.ProdutoCampoValor(
                produto_id=produto_id,
                campo_id=int(campo.id),
                valor=novo_valor,
            ))


def carregar_itens_kit_produto(
    db: Session,
    empresa_id: int,
    kit_produto_id: int,
) -> List[Dict[str, Any]]:
    rows = db.execute(text("""
        SELECT
            ki.componente_produto_id AS produto_id,
            ki.quantidade,
            ki.perda_percentual,
            ki.ordem,
            p.codigo,
            p.nome,
            p.unidade,
            p.custo,
            p.preco_venda,
            p.ativo
        FROM produto_kit_itens ki
        JOIN produtos p ON p.id = ki.componente_produto_id
        WHERE ki.empresa_id = :empresa_id
          AND ki.kit_produto_id = :kit_produto_id
          AND p.empresa_id = :empresa_id
        ORDER BY ki.ordem ASC, ki.id ASC
    """), {
        "empresa_id": empresa_id,
        "kit_produto_id": kit_produto_id,
    }).mappings().all()

    itens: List[Dict[str, Any]] = []
    for row in rows:
        produto_id = int(row["produto_id"])
        custom = buscar_custom_fields_produto(db, empresa_id, produto_id)
        custo_unitario = decimal_kit(custo_produto_efetivo(row.get("custo"), custom))
        venda_unitaria = decimal_kit(preco_venda_produto_efetivo(row.get("preco_venda"), custom))
        quantidade = decimal_kit(row.get("quantidade"), default=Decimal("1"))
        perda = decimal_kit(row.get("perda_percentual"))
        quantidade_calculo = quantidade * (Decimal("1") + (perda / Decimal("100")))

        itens.append({
            "produto_id": produto_id,
            "codigo": row.get("codigo") or "",
            "nome": row.get("nome") or "",
            "unidade": row.get("unidade") or "",
            "quantidade": decimal_kit_str(quantidade, 4),
            "perda_percentual": decimal_kit_str(perda, 4),
            "ordem": int(row.get("ordem") or 0),
            "custo_unitario": decimal_kit_str(custo_unitario, 2),
            "preco_venda_unitario": decimal_kit_str(venda_unitaria, 2),
            "custo_total": decimal_kit_str(custo_unitario * quantidade_calculo, 2),
            "preco_venda_total": decimal_kit_str(venda_unitaria * quantidade_calculo, 2),
            "ativo": bool(row.get("ativo", True)),
        })
    return itens


def totais_itens_kit(itens: List[Dict[str, Any]]) -> tuple[Decimal, Decimal]:
    custo_total = sum((decimal_kit(item.get("custo_total")) for item in itens), Decimal("0"))
    venda_total = sum((decimal_kit(item.get("preco_venda_total")) for item in itens), Decimal("0"))
    return custo_total, venda_total


def composicao_kit_tem_caminho(
    db: Session,
    empresa_id: int,
    origem_id: int,
    alvo_id: int,
) -> bool:
    rows = db.execute(text("""
        SELECT kit_produto_id, componente_produto_id
        FROM produto_kit_itens
        WHERE empresa_id = :empresa_id
    """), {"empresa_id": empresa_id}).mappings().all()

    adjacency: Dict[int, List[int]] = {}
    for row in rows:
        adjacency.setdefault(int(row["kit_produto_id"]), []).append(int(row["componente_produto_id"]))

    stack = [int(origem_id)]
    visited: set[int] = set()
    while stack:
        current = stack.pop()
        if current == int(alvo_id):
            return True
        if current in visited:
            continue
        visited.add(current)
        stack.extend(adjacency.get(current, []))
    return False


def salvar_itens_kit_produto(
    db: Session,
    empresa_id: int,
    kit_produto_id: int,
    itens: List["ProdutoKitItemIn"],
) -> None:
    if len(itens) > 200:
        raise HTTPException(status_code=422, detail="Um KIT pode ter no máximo 200 itens.")

    db.execute(text("""
        DELETE FROM produto_kit_itens
        WHERE empresa_id = :empresa_id AND kit_produto_id = :kit_produto_id
    """), {"empresa_id": empresa_id, "kit_produto_id": kit_produto_id})

    ids = [int(item.produto_id) for item in itens]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="O mesmo produto não pode aparecer duas vezes no KIT.")
    if kit_produto_id in ids:
        raise HTTPException(status_code=422, detail="O produto não pode compor o próprio KIT.")

    if ids:
        encontrados = {
            int(row[0]) for row in (
                db.query(models.Produto.id)
                .filter(models.Produto.empresa_id == empresa_id)
                .filter(models.Produto.id.in_(ids))
                .all()
            )
        }
        if encontrados != set(ids):
            raise HTTPException(status_code=404, detail="Um ou mais itens do KIT não pertencem à empresa atual.")

    for ordem, item in enumerate(itens):
        quantidade = decimal_kit(item.quantidade, default=Decimal("0"))
        perda = decimal_kit(item.perda_percentual)
        if quantidade <= 0:
            raise HTTPException(status_code=422, detail="A quantidade de cada item do KIT deve ser maior que zero.")
        if perda < 0 or perda > Decimal("10000"):
            raise HTTPException(status_code=422, detail="A perda do item do KIT deve ficar entre 0% e 10000%.")
        if composicao_kit_tem_caminho(db, empresa_id, int(item.produto_id), kit_produto_id):
            raise HTTPException(status_code=422, detail="A composição informada criaria um ciclo entre produtos KIT.")

        db.execute(text("""
            INSERT INTO produto_kit_itens (
                empresa_id, kit_produto_id, componente_produto_id,
                quantidade, perda_percentual, ordem, atualizado_em
            ) VALUES (
                :empresa_id, :kit_produto_id, :componente_produto_id,
                :quantidade, :perda_percentual, :ordem, NOW()
            )
        """), {
            "empresa_id": empresa_id,
            "kit_produto_id": kit_produto_id,
            "componente_produto_id": int(item.produto_id),
            "quantidade": quantidade,
            "perda_percentual": perda,
            "ordem": ordem,
        })


def recalcular_produto_kit(db: Session, empresa_id: int, kit_produto_id: int) -> bool:
    itens = carregar_itens_kit_produto(db, empresa_id, kit_produto_id)
    if not itens:
        return False

    produto = buscar_produto_empresa(db, kit_produto_id, empresa_id)
    if not produto:
        return False

    custo_total, venda_total = totais_itens_kit(itens)
    custo_str = decimal_kit_str(custo_total, 2)
    venda_str = decimal_kit_str(venda_total, 2)
    produto.custo = custo_str
    produto.preco_venda = venda_str
    sincronizar_valores_comerciais_custom_produto(
        db,
        empresa_id,
        kit_produto_id,
        custo=custo_str,
        preco_venda=venda_str,
    )
    db.flush()
    return True


def recalcular_kits_dependentes(
    db: Session,
    empresa_id: int,
    produto_ids: List[int] | set[int],
) -> None:
    fila = [int(pid) for pid in produto_ids if int(pid) > 0]
    visitados: set[int] = set()

    while fila:
        lote = sorted(set(fila))
        fila = []
        stmt = text("""
            SELECT DISTINCT kit_produto_id
            FROM produto_kit_itens
            WHERE empresa_id = :empresa_id
              AND componente_produto_id IN :produto_ids
        """).bindparams(bindparam("produto_ids", expanding=True))
        pais = db.execute(stmt, {
            "empresa_id": empresa_id,
            "produto_ids": lote,
        }).scalars().all()

        for parent_id_raw in pais:
            parent_id = int(parent_id_raw)
            if parent_id in visitados:
                continue
            visitados.add(parent_id)
            if recalcular_produto_kit(db, empresa_id, parent_id):
                fila.append(parent_id)


class ProdutoKitItemIn(BaseModel):
    produto_id: int
    quantidade: str = "1"
    perda_percentual: str = "0"


class ProdutoKitItemOut(ProdutoKitItemIn):
    codigo: str = ""
    nome: str = ""
    unidade: str = ""
    ordem: int = 0
    custo_unitario: str = "0.00"
    preco_venda_unitario: str = "0.00"
    custo_total: str = "0.00"
    preco_venda_total: str = "0.00"
    ativo: bool = True


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
    itens_kit: Optional[List[ProdutoKitItemIn]] = None


class ProdutoCreate(ProdutoBase):
    nome: str


class ProdutoUpdate(ProdutoBase):
    pass


class ProdutoOut(ProdutoBase, _Cfg):
    id: int
    empresa_id: int
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None
    itens_kit: List[ProdutoKitItemOut] = Field(default_factory=list)
    kit_custo_total: Optional[str] = None
    kit_preco_venda_total: Optional[str] = None


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
        .order_by(models.CampoProduto.id.asc())
        .all()
    )

    # Em bases antigas pode existir mais de uma definição com o mesmo slug.
    # Prioriza o ID efetivamente ligado à ficha principal; depois usa o campo
    # mais antigo como fallback estável. Isso evita salvar novos valores em uma
    # duplicata diferente daquela que o formulário exibe.
    linked_ids: List[int] = []
    modelo = (
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
    if modelo is not None:
        rows = (
            db.query(models.FormularioCampo.campo_personalizado_id)
            .filter(models.FormularioCampo.formulario_id == modelo.id)
            .filter(models.FormularioCampo.origem == "personalizado")
            .filter(models.FormularioCampo.campo_personalizado_id.isnot(None))
            .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
            .all()
        )
        for row in rows:
            raw_id = row[0] if isinstance(row, tuple) else getattr(row, "campo_personalizado_id", None)
            try:
                linked_ids.append(int(raw_id))
            except (TypeError, ValueError):
                continue

    por_id = {int(c.id): c for c in campos}
    out: Dict[str, models.CampoProduto] = {}
    for linked_id in linked_ids:
        campo = por_id.get(linked_id)
        if campo is not None:
            out[str(campo.slug)] = campo
    for campo in campos:
        out.setdefault(str(campo.slug), campo)
    return out


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


TIPOS_CAMPOS_PRODUTO = {
    "texto",
    "textarea",
    "numero",
    "data",
    "select",
    "multiselect",
    "checkbox",
    "email",
    "telefone",
    "moeda",
    "percentual",
    "relacao_cliente",
    "relacao_fornecedor",
    "relacao_produto",
    "relacao_patrimonio",
    "relacao_cotacao",
    "relacao_proposta",
    "relacao_contrato",
    "relacao_cliente_multi",
    "relacao_fornecedor_multi",
    "relacao_produto_multi",
    "relacao_patrimonio_multi",
    "relacao_cotacao_multi",
    "relacao_proposta_multi",
    "relacao_contrato_multi",
}


def _token_tipo_formulario(value: Optional[str]) -> str:
    raw = unicodedata.normalize("NFKD", str(value or "texto"))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = raw.lower().strip()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    return re.sub(r"_+", "_", raw).strip("_")


def normalizar_tipo_formulario(tipo: Optional[str]) -> str:
    """Converte qualquer nome aceito pelo construtor para o tipo canônico.

    Produtos precisa conservar o tipo real do formulário. Em especial,
    multiselect e relações múltiplas são salvos como arrays JSON e não podem ser
    tratados como ``select``/texto simples durante a filtragem.
    """
    token = _token_tipo_formulario(tipo)

    aliases = {
        "text": "texto",
        "texto": "texto",
        "texto_curto": "texto",
        "campo_texto": "texto",
        "textarea": "textarea",
        "texto_longo": "textarea",
        "area_de_texto": "textarea",
        "numero": "numero",
        "number": "numero",
        "data": "data",
        "date": "data",
        "select": "select",
        "lista": "select",
        "lista_simples": "select",
        "checkbox": "checkbox",
        "flag": "checkbox",
        "fleg": "checkbox",
        "email": "email",
        "e_mail": "email",
        "telefone": "telefone",
        "phone": "telefone",
        "tel": "telefone",
        "moeda": "moeda",
        "money": "moeda",
        "percentual": "percentual",
        "percent": "percentual",
        "multiselect": "multiselect",
        "multi_select": "multiselect",
        "lista_multipla": "multiselect",
        "lista_multiplas": "multiselect",
        "lista_com_multipla_selecao": "multiselect",
        "multipla_selecao": "multiselect",
        "multipla_escolha": "multiselect",
        "multiplas_escolhas": "multiselect",
        "multivalor": "multiselect",
        "multivaloravel": "multiselect",
        "multvaloravel": "multiselect",
    }
    if token in aliases:
        return aliases[token]
    if token in TIPOS_CAMPOS_PRODUTO:
        return token

    # Relações podem chegar tanto no nome técnico quanto no nome amigável
    # mostrado pelo construtor ("Puxar vários fornecedores", por exemplo).
    relation_token = token
    multi = bool(
        relation_token.endswith("_multi")
        or re.search(r"(^|_)(multi|multiplo|multipla|multiplos|multiplas|varios|varias)($|_)", relation_token)
    )
    relation_token = re.sub(r"(^|_)(relacao|lookup|puxar|puxa)($|_)", "_", relation_token)
    relation_token = re.sub(r"(^|_)(multi|multiplo|multipla|multiplos|multiplas|varios|varias)($|_)", "_", relation_token)
    relation_token = re.sub(r"_+", "_", relation_token).strip("_")

    entidades = {
        "cliente": "cliente",
        "clientes": "cliente",
        "fornecedor": "fornecedor",
        "fornecedores": "fornecedor",
        "produto": "produto",
        "produtos": "produto",
        "patrimonio": "patrimonio",
        "patrimonios": "patrimonio",
        "cotacao": "cotacao",
        "cotacoes": "cotacao",
        "proposta": "proposta",
        "propostas": "proposta",
        "contrato": "contrato",
        "contratos": "contrato",
    }
    entidade = entidades.get(relation_token)
    if entidade:
        return f"relacao_{entidade}{'_multi' if multi else ''}"

    return "texto"


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


def _buscar_formulario_produtos(
    db: Session,
    empresa_id: int,
    modelo_id: Optional[int] = None,
) -> Optional[models.FormularioModelo]:
    if modelo_id is None:
        return buscar_formulario_produtos_principal(db, empresa_id)
    return (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.id == int(modelo_id))
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == "produtos")
        .first()
    )


def _campo_produto_ligado(
    campo_form: models.FormularioCampo,
    campos_por_id: Dict[int, models.CampoProduto],
    campos_por_slug: Dict[str, models.CampoProduto],
) -> Optional[models.CampoProduto]:
    linked_id = getattr(campo_form, "campo_personalizado_id", None)
    try:
        linked_id = int(linked_id) if linked_id is not None else None
    except (TypeError, ValueError):
        linked_id = None
    if linked_id is not None and linked_id in campos_por_id:
        return campos_por_id[linked_id]

    slug = slugify_formulario(getattr(campo_form, "label", None))
    return campos_por_slug.get(slug) if slug else None


def campos_formulario_produtos_map(db: Session, empresa_id: int) -> Dict[str, models.FormularioCampo]:
    modelo = buscar_formulario_produtos_principal(db, empresa_id)
    if not modelo:
        return {}

    rows = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.origem == "personalizado")
        .filter(models.FormularioCampo.ativo == True)  # noqa: E712
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )
    campos_produtos = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .order_by(models.CampoProduto.id.asc())
        .all()
    )
    por_id = {int(row.id): row for row in campos_produtos}
    por_slug: Dict[str, models.CampoProduto] = {}
    for row in campos_produtos:
        por_slug.setdefault(str(row.slug), row)

    out: Dict[str, models.FormularioCampo] = {}
    for campo in rows:
        if campo_formulario_visual(campo):
            continue
        campo_produto = _campo_produto_ligado(campo, por_id, por_slug)
        slug = str(getattr(campo_produto, "slug", "") or "").strip()
        if slug:
            out[slug] = campo
    return out


def sincronizar_campos_produtos_com_formulario(
    db: Session,
    empresa_id: int,
    somente_slugs: Optional[set[str]] = None,
    *,
    modelo_id: Optional[int] = None,
    commit: bool = False,
) -> Dict[str, models.CampoProduto]:
    """Sincroniza a ficha de Produtos com ``campos_produtos`` sem perder valores.

    O vínculo estável é gravado em ``campo_personalizado_id``. Renomear um campo
    passa a atualizar apenas o nome exibido, preservando slug, ID e todos os
    valores já cadastrados. ``somente_slugs`` é mantido por compatibilidade; a
    sincronização completa é intencional para também corrigir tipos antigos.
    """
    del somente_slugs  # compatibilidade com chamadas antigas

    modelo = _buscar_formulario_produtos(db, empresa_id, modelo_id=modelo_id)
    if not modelo:
        return buscar_campos_empresa_map(db, empresa_id)

    campos_formulario = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.origem == "personalizado")
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )

    existentes = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .order_by(models.CampoProduto.id.asc())
        .all()
    )
    por_id = {int(row.id): row for row in existentes}
    por_slug: Dict[str, models.CampoProduto] = {}
    for row in existentes:
        por_slug.setdefault(str(row.slug), row)
    ids_reivindicados: set[int] = set()
    changed = False

    def slug_livre(base: str) -> str:
        base = (base or "campo")[:120]
        slug = base
        suffix = 2
        while slug in por_slug:
            suffix_text = f"_{suffix}"
            slug = f"{base[: max(1, 120 - len(suffix_text))]}{suffix_text}"
            suffix += 1
        return slug

    for campo_form in campos_formulario:
        label = campo_formulario_nome(campo_form)
        if not label:
            continue

        tipo = normalizar_tipo_formulario(getattr(campo_form, "tipo_campo", None))
        obrigatorio = bool(getattr(campo_form, "obrigatorio", False))
        ativo = bool(getattr(campo_form, "ativo", True))
        opcoes_json = norm_str(getattr(campo_form, "opcoes_json", None))
        ordem = int(getattr(campo_form, "ordem", 0) or 0)

        campo_produto = None
        linked_id = getattr(campo_form, "campo_personalizado_id", None)
        try:
            linked_id = int(linked_id) if linked_id is not None else None
        except (TypeError, ValueError):
            linked_id = None
        if linked_id is not None:
            campo_produto = por_id.get(linked_id)

        base_slug = slugify_formulario(label)
        if campo_produto is None and base_slug:
            candidate = por_slug.get(base_slug)
            if candidate is not None and int(candidate.id) not in ids_reivindicados:
                campo_produto = candidate

        # Recupera fichas antigas cujo rótulo foi alterado antes de existir o
        # vínculo estável. A ordem é o identificador legado mais confiável. Se
        # houver colisão de ordem, o tipo é usado para desambiguar; assim também
        # preservamos os valores quando nome e tipo foram alterados juntos.
        if campo_produto is None:
            candidates_by_order = [
                item
                for item in existentes
                if int(item.id) not in ids_reivindicados
                and int(item.ordem or 0) == ordem
            ]
            if len(candidates_by_order) == 1:
                campo_produto = candidates_by_order[0]
            elif len(candidates_by_order) > 1:
                candidates_by_type = [
                    item
                    for item in candidates_by_order
                    if normalizar_tipo_formulario(getattr(item, "tipo", None)) == tipo
                ]
                if len(candidates_by_type) == 1:
                    campo_produto = candidates_by_type[0]

        if campo_produto is None:
            slug = slug_livre(base_slug or f"campo_{int(campo_form.id)}")
            campo_produto = models.CampoProduto(
                empresa_id=empresa_id,
                nome=label,
                slug=slug,
                tipo=tipo,
                obrigatorio=obrigatorio,
                ativo=ativo,
                opcoes_json=opcoes_json,
                ordem=ordem,
            )
            db.add(campo_produto)
            db.flush()
            existentes.append(campo_produto)
            por_id[int(campo_produto.id)] = campo_produto
            por_slug[str(campo_produto.slug)] = campo_produto
            changed = True

        ids_reivindicados.add(int(campo_produto.id))

        if getattr(campo_form, "campo_personalizado_id", None) != int(campo_produto.id):
            campo_form.campo_personalizado_id = int(campo_produto.id)
            changed = True
        if campo_produto.nome != label:
            campo_produto.nome = label
            changed = True
        if normalizar_tipo_formulario(campo_produto.tipo) != tipo or campo_produto.tipo != tipo:
            campo_produto.tipo = tipo
            changed = True
        if bool(campo_produto.obrigatorio) != obrigatorio:
            campo_produto.obrigatorio = obrigatorio
            changed = True
        if bool(campo_produto.ativo) != ativo:
            campo_produto.ativo = ativo
            changed = True
        if (campo_produto.opcoes_json or None) != (opcoes_json or None):
            campo_produto.opcoes_json = opcoes_json
            changed = True
        if int(campo_produto.ordem or 0) != ordem:
            campo_produto.ordem = ordem
            changed = True

    if changed:
        db.flush()
        if commit:
            db.commit()

    return buscar_campos_empresa_map(db, empresa_id)


def buscar_produto_empresa(db: Session, produto_id: int, empresa_id: int) -> Optional[models.Produto]:
    return (
        db.query(models.Produto)
        .filter(models.Produto.id == produto_id)
        .filter(models.Produto.empresa_id == empresa_id)
        .first()
    )


def buscar_custom_fields_produtos_em_lote(
    db: Session,
    empresa_id: int,
    produto_ids: List[int],
) -> Dict[int, Dict[str, str]]:
    ids = sorted({int(produto_id) for produto_id in produto_ids if int(produto_id) > 0})
    out: Dict[int, Dict[str, str]] = {produto_id: {} for produto_id in ids}
    if not ids:
        return out

    rows = (
        db.query(
            models.ProdutoCampoValor.produto_id,
            models.CampoProduto.slug,
            models.ProdutoCampoValor.valor,
        )
        .join(
            models.CampoProduto,
            models.CampoProduto.id == models.ProdutoCampoValor.campo_id,
        )
        .filter(models.ProdutoCampoValor.produto_id.in_(ids))
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .all()
    )

    for produto_id, slug, valor in rows:
        out.setdefault(int(produto_id), {})[str(slug)] = valor or ""
    return out


def buscar_custom_fields_produto(
    db: Session,
    empresa_id: int,
    produto_id: int,
) -> Dict[str, str]:
    return buscar_custom_fields_produtos_em_lote(db, empresa_id, [produto_id]).get(int(produto_id), {})


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
    custom_fields = (
        buscar_custom_fields_produto(db, empresa_id, int(p.id))
        if include_custom_fields
        else {}
    )
    itens_kit = carregar_itens_kit_produto(db, empresa_id, int(p.id))
    kit_custo_total, kit_venda_total = totais_itens_kit(itens_kit)
    return ProdutoOut(
        id=int(p.id),
        empresa_id=empresa_id,
        codigo=p.codigo or "",
        nome=p.nome or "",
        descricao=p.descricao,
        categoria=p.categoria,
        unidade=p.unidade,
        preco_venda=p.preco_venda,
        custo=custo_produto_efetivo(p.custo, custom_fields),
        estoque_atual=p.estoque_atual,
        ativo=bool(p.ativo),
        criado_em=iso_datetime(getattr(p, "criado_em", None)),
        atualizado_em=iso_datetime(getattr(p, "atualizado_em", None)),
        custom_fields=custom_fields,
        itens_kit=itens_kit,
        kit_custo_total=decimal_kit_str(kit_custo_total, 2) if itens_kit else None,
        kit_preco_venda_total=decimal_kit_str(kit_venda_total, 2) if itens_kit else None,
    )

def produto_to_list_out(
    db: Session,
    p: models.Produto,
    *,
    include_custom_fields: bool = True,
    custom_fields: Optional[Dict[str, str]] = None,
) -> Dict[str, object]:
    empresa_id = int(getattr(p, "empresa_id", 0) or 0)
    produto_id = int(getattr(p, "id", 0) or 0)
    if custom_fields is None:
        custom_fields = (
            buscar_custom_fields_produto(db, empresa_id, produto_id)
            if include_custom_fields and empresa_id and produto_id
            else {}
        )

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
        "custo": custo_produto_efetivo(getattr(p, "custo", None), custom_fields),
        "estoque_atual": getattr(p, "estoque_atual", None),
        "ativo": bool(getattr(p, "ativo", True)),
        "criado_em": iso_datetime(getattr(p, "criado_em", None)),
        "atualizado_em": iso_datetime(getattr(p, "atualizado_em", None)),
        "custom_fields": custom_fields,
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
        .filter(models.FormularioCampo.origem == "personalizado")
        .filter(models.FormularioCampo.ativo == True)  # noqa: E712
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )
    campos_produtos = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .order_by(models.CampoProduto.id.asc())
        .all()
    )
    por_id = {int(row.id): row for row in campos_produtos}
    por_slug: Dict[str, models.CampoProduto] = {}
    for row in campos_produtos:
        por_slug.setdefault(str(row.slug), row)

    out: Dict[str, dict] = {}
    for campo in campos:
        if campo_formulario_visual(campo):
            continue
        campo_produto = _campo_produto_ligado(campo, por_id, por_slug)
        slug = str(getattr(campo_produto, "slug", "") or "").strip()
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
    db: Session, empresa_id: int, *, sincronizar: bool = False
) -> List[dict]:
    del sincronizar  # compatibilidade; leituras nunca persistem sincronização
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
    db: Session, empresa_id: int, *, sincronizar: bool = False
) -> Dict[str, Optional[models.CampoProduto]]:
    del sincronizar  # compatibilidade; leituras nunca persistem sincronização
    rows = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.ativo == True)  # noqa: E712
        .order_by(models.CampoProduto.ordem.asc(), models.CampoProduto.id.asc())
        .all()
    )
    return {key: encontrar_campo_filtro(rows, aliases) for key, aliases in FILTER_FIELD_ALIASES.items()}


def _valores_salvos_campo(raw_value: Any) -> List[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, (list, tuple, set)):
        parsed = list(raw_value)
    else:
        text_value = str(raw_value).strip()
        if not text_value:
            return []
        try:
            loaded = json.loads(text_value)
            parsed = loaded if isinstance(loaded, list) else [loaded]
        except Exception:
            parsed = [text_value]

    out: List[str] = []
    seen = set()
    for item in parsed:
        if isinstance(item, dict):
            value = item.get("value", item.get("id", item.get("label", "")))
        else:
            value = item
        text_value = str(value or "").strip()
        key = text_value.casefold()
        if text_value and key not in seen:
            seen.add(key)
            out.append(text_value)
    return out


def _tipo_relacao_produto(tipo: Optional[str]) -> Optional[str]:
    tipo_norm = normalizar_tipo_formulario(tipo)
    if not tipo_norm.startswith("relacao_"):
        return None
    base = tipo_norm[len("relacao_"):]
    if base.endswith("_multi"):
        base = base[:-6]
    return base or None


def _modelo_relacao_produto(tipo_base: str):
    mapping = {
        "cliente": getattr(models, "Cliente", None),
        "fornecedor": getattr(models, "Fornecedor", None),
        "produto": getattr(models, "Produto", None),
        "patrimonio": getattr(models, "Patrimonio", None),
        "cotacao": getattr(models, "Cotacao", None),
        "proposta": getattr(models, "Proposta", None),
    }
    if tipo_base == "contrato":
        return getattr(models_contratos, "Contrato", None) if models_contratos is not None else None
    return mapping.get(tipo_base)


def _texto_relacao(*values: Any) -> str:
    for value in values:
        text_value = str(value or "").strip()
        if text_value:
            return text_value
    return ""


def _rotulo_relacao_produto(item: Any, tipo_base: str) -> str:
    item_id = _texto_relacao(getattr(item, "id", None))
    codigo = _texto_relacao(getattr(item, "codigo", None), getattr(item, "numero_contrato", None))
    nome = _texto_relacao(
        getattr(item, "nome", None),
        getattr(item, "razao_social", None),
        getattr(item, "nome_fantasia", None),
        getattr(item, "titulo", None),
        getattr(item, "item_nome", None),
        getattr(item, "cliente_nome", None),
        getattr(item, "descricao", None),
    )
    if nome and codigo:
        marcador = "Nº" if tipo_base == "contrato" else "Cód."
        return f"{nome} — {marcador} {codigo}"
    return _texto_relacao(nome, codigo, f"Registro #{item_id}")


def _opcoes_relacao_produto(db: Session, empresa_id: int, campo: models.CampoProduto) -> List[dict]:
    tipo_base = _tipo_relacao_produto(getattr(campo, "tipo", None))
    Model = _modelo_relacao_produto(tipo_base or "")
    if not tipo_base or Model is None:
        return []

    query = db.query(Model).filter(Model.empresa_id == empresa_id)
    if hasattr(Model, "ativo"):
        query = query.filter(Model.ativo == True)  # noqa: E712

    order_columns = []
    for attr in ("nome", "razao_social", "titulo", "item_nome", "codigo", "numero_contrato", "id"):
        column = getattr(Model, attr, None)
        if column is not None:
            order_columns.append(column.asc())
            if len(order_columns) >= 2:
                break
    if order_columns:
        query = query.order_by(*order_columns)

    items = query.limit(500).all()
    return [
        {
            "value": str(getattr(item, "id", "") or ""),
            "label": _rotulo_relacao_produto(item, tipo_base),
        }
        for item in items
        if getattr(item, "id", None) is not None
    ]


def opcoes_campo_filtro(db: Session, empresa_id: int, campo: Optional[models.CampoProduto]) -> List[Any]:
    if not campo:
        return []

    relation_options = _opcoes_relacao_produto(db, empresa_id, campo)
    if relation_options:
        return relation_options

    # Bases antigas podem conter mais de uma definição do mesmo slug. As opções
    # e valores precisam ser reunidos para não esconder produtos ligados ao ID
    # antigo do campo.
    campos_mesmo_slug = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.slug == campo.slug)
        .order_by(models.CampoProduto.id.asc())
        .all()
    ) or [campo]
    campo_ids = [int(item.id) for item in campos_mesmo_slug]

    values: List[str] = []
    seen = set()

    for campo_item in campos_mesmo_slug:
        for value in parse_field_options(getattr(campo_item, "opcoes_json", None)):
            key = value.casefold()
            if key not in seen:
                seen.add(key)
                values.append(value)

    rows = (
        db.query(models.ProdutoCampoValor.valor)
        .join(models.Produto, models.Produto.id == models.ProdutoCampoValor.produto_id)
        .filter(models.Produto.empresa_id == empresa_id)
        .filter(models.ProdutoCampoValor.campo_id.in_(campo_ids))
        .filter(models.ProdutoCampoValor.valor.isnot(None))
        .distinct()
        .all()
    )
    for row in rows:
        raw = row[0] if isinstance(row, tuple) else getattr(row, "valor", None)
        for value in _valores_salvos_campo(raw):
            key = value.casefold()
            if key not in seen:
                seen.add(key)
                values.append(value)

    return sorted(values, key=str.casefold)[:500]


def _escape_like_produto(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _condicao_valor_campo_produto(column, tipo: Optional[str], raw: str):
    tipo_norm = normalizar_tipo_formulario(tipo)
    lowered = func.lower(func.trim(func.coalesce(column, "")))
    normalized = raw.strip().lower()

    if tipo_norm == "multiselect" or tipo_norm.endswith("_multi"):
        json_token = json.dumps(raw.strip(), ensure_ascii=False).lower()
        return or_(
            lowered == normalized,
            lowered.like(f"%{_escape_like_produto(json_token)}%", escape="\\"),
        )
    return lowered == normalized


def aplicar_filtro_campo_produto(query, db: Session, empresa_id: int, campo, value: Optional[str]):
    raw = norm_str(value)
    if not raw or not campo:
        return query

    campos_mesmo_slug = (
        db.query(models.CampoProduto)
        .filter(models.CampoProduto.empresa_id == empresa_id)
        .filter(models.CampoProduto.slug == campo.slug)
        .order_by(models.CampoProduto.id.asc())
        .all()
    ) or [campo]

    conditions = [
        (
            (models.ProdutoCampoValor.campo_id == int(campo_item.id))
            & _condicao_valor_campo_produto(
                models.ProdutoCampoValor.valor,
                getattr(campo_item, "tipo", None),
                raw,
            )
        )
        for campo_item in campos_mesmo_slug
    ]
    subquery = (
        db.query(models.ProdutoCampoValor.produto_id)
        .filter(or_(*conditions))
        .distinct()
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


def valor_atual_campo_preco(
    produto,
    campo_meta: dict,
    custom_values: Dict[int, str],
    cost_custom_field_ids: Optional[List[int]] = None,
) -> Optional[str]:
    if campo_meta["kind"] == "native":
        value = getattr(produto, campo_meta["key"], None)
        if campo_meta.get("key") == "custo" and norm_str(value) is None:
            for field_id in cost_custom_field_ids or []:
                custom_value = norm_str(custom_values.get(int(field_id)))
                if custom_value is not None:
                    return custom_value
        return value
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
        custom_fields_por_produto = buscar_custom_fields_produtos_em_lote(
            db, empresa_id, [int(p.id) for p in rows]
        )
        items = [
            produto_to_list_out(
                db,
                p,
                include_custom_fields=True,
                custom_fields=custom_fields_por_produto.get(int(p.id), {}),
            )
            for p in rows
        ]
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
        }

    rows = query.all()
    custom_fields_por_produto = buscar_custom_fields_produtos_em_lote(
        db, empresa_id, [int(p.id) for p in rows]
    )
    return [
        produto_to_list_out(
            db,
            p,
            include_custom_fields=True,
            custom_fields=custom_fields_por_produto.get(int(p.id), {}),
        )
        for p in rows
    ]


@router.get("/atualizacao-precos/meta")
def obter_meta_atualizacao_precos(request: Request, db: Session = Depends(get_db)):
    empresa_id, _ = validar_permissao_produtos(request, db, "ver")

    campos_preco = obter_campos_formacao_preco(db, empresa_id, sincronizar=False)
    campos_filtro = obter_campos_filtro_produtos(db, empresa_id, sincronizar=False)

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
    cost_custom_fields = sorted(
        [
            item for item in todos_campos_preco
            if item["kind"] == "custom" and campo_representa_custo(item.get("slug"), item.get("label"))
        ],
        key=lambda item: PRODUCT_COST_ALIASES.index(normalizar_slug_custo(item.get("slug"))),
    )
    cost_custom_field_ids = [int(item["campo_id"]) for item in cost_custom_fields]
    custom_field_ids = sorted({
        *[int(item["campo_id"]) for item in campos_preco if item["kind"] == "custom"],
        *cost_custom_field_ids,
    })
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
                campo["key"]: valor_atual_campo_preco(
                    produto,
                    campo,
                    valores_produto,
                    cost_custom_field_ids,
                )
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
    cost_custom_fields = [
        item for item in campos_preco
        if item["kind"] == "custom" and campo_representa_custo(item.get("slug"), item.get("label"))
    ]

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

    def sincronizar_fontes_custo(produto: models.Produto, novo_valor: Optional[str]) -> None:
        """Mantém o custo nativo e os campos equivalentes com o mesmo valor."""
        produto.custo = novo_valor
        produto_id = int(produto.id)

        for cost_field in cost_custom_fields:
            field_id = int(cost_field["campo_id"])
            map_key = (produto_id, field_id)
            row = custom_map.get(map_key)

            if novo_valor is None:
                if row:
                    db.delete(row)
                    custom_map.pop(map_key, None)
                continue

            if row:
                row.valor = novo_valor
                continue

            row = models.ProdutoCampoValor(
                produto_id=produto_id,
                campo_id=field_id,
                valor=novo_valor,
            )
            db.add(row)
            custom_map[map_key] = row

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

                if (
                    (campo["kind"] == "native" and campo.get("key") == "custo")
                    or (campo["kind"] == "custom" and campo_representa_custo(campo.get("slug"), campo.get("label")))
                ):
                    sincronizar_fontes_custo(produto, novo_valor)

                if (
                    (campo["kind"] == "native" and campo.get("key") == "preco_venda")
                    or (campo["kind"] == "custom" and campo_representa_preco_venda(campo.get("slug"), campo.get("label")))
                ):
                    produto.preco_venda = novo_valor

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

        db.flush()
        recalcular_kits_dependentes(db, empresa_id, produtos_alterados)
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


@router.get("/busca-componentes")
def buscar_componentes_kit(
    request: Request,
    q: str = Query(default="", max_length=180),
    excluir_id: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=30, ge=1, le=50),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    texto_busca = str(q or "").strip()
    query = (
        db.query(models.Produto)
        .filter(models.Produto.empresa_id == empresa_id)
        .filter(models.Produto.ativo == True)  # noqa: E712
    )
    if excluir_id is not None:
        query = query.filter(models.Produto.id != excluir_id)
    if texto_busca:
        like = f"%{texto_busca}%"
        query = query.filter(or_(
            models.Produto.codigo.ilike(like),
            models.Produto.nome.ilike(like),
            models.Produto.descricao.ilike(like),
            models.Produto.categoria.ilike(like),
        ))

    rows = (
        query
        .order_by(func.lower(models.Produto.nome).asc(), models.Produto.codigo.asc())
        .limit(limit)
        .all()
    )
    result = []
    for produto in rows:
        custom = buscar_custom_fields_produto(db, empresa_id, int(produto.id))
        result.append({
            "produto_id": int(produto.id),
            "codigo": produto.codigo or "",
            "nome": produto.nome or "",
            "unidade": produto.unidade or "",
            "custo_unitario": decimal_kit_str(decimal_kit(custo_produto_efetivo(produto.custo, custom)), 2),
            "preco_venda_unitario": decimal_kit_str(decimal_kit(preco_venda_produto_efetivo(produto.preco_venda, custom)), 2),
        })
    return result


@router.get("/proximo-codigo")
def obter_proximo_codigo_produto(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = prever_proximo_codigo_produto(db, empresa_id)
    return {"codigo": codigo}


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
def criar_produto(payload: ProdutoCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    # Código de produto é gerado pelo sistema, único e imutável.
    # Não confiar em payload.codigo vindo do front/importação.
    codigo = gerar_codigo_produto(db, empresa_id)
    custom_cost_present, custom_cost = extrair_custo_custom_fields_empresa(
        db, empresa_id, payload.custom_fields
    )
    custo = custom_cost if custom_cost_present else norm_str(payload.custo)

    p = models.Produto(
        empresa_id=empresa_id,
        codigo=codigo,
        nome=payload.nome.strip(),
        descricao=norm_str(payload.descricao),
        categoria=norm_str(payload.categoria),
        unidade=norm_str(payload.unidade),
        preco_venda=norm_str(payload.preco_venda),
        custo=custo,
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

        if payload.itens_kit is not None:
            salvar_itens_kit_produto(db, empresa_id, int(p.id), payload.itens_kit)
            if payload.itens_kit:
                recalcular_produto_kit(db, empresa_id, int(p.id))

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

    custom_cost_present, custom_cost = extrair_custo_custom_fields_empresa(
        db, empresa_id, payload.custom_fields
    )
    if custom_cost_present:
        # O valor visível na Formação de Preços é autoritativo, inclusive para
        # corrigir produtos antigos cujo custo nativo permaneceu como zero.
        p.custo = custom_cost
    elif payload.custo is not None:
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

        if payload.itens_kit is not None:
            salvar_itens_kit_produto(db, empresa_id, int(p.id), payload.itens_kit)

        db.flush()
        if payload.itens_kit:
            recalcular_produto_kit(db, empresa_id, int(p.id))
        recalcular_kits_dependentes(db, empresa_id, [int(p.id)])

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

    kits_afetados = [
        int(value) for value in db.execute(text("""
            SELECT DISTINCT kit_produto_id
            FROM produto_kit_itens
            WHERE empresa_id = :empresa_id AND componente_produto_id = :produto_id
        """), {"empresa_id": empresa_id, "produto_id": produto_id}).scalars().all()
    ]

    try:
        db.delete(p)
        db.flush()
        for kit_id in kits_afetados:
            recalcular_produto_kit(db, empresa_id, kit_id)
        recalcular_kits_dependentes(db, empresa_id, kits_afetados)
        db.commit()
        return None
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao excluir produto: {exc}")
