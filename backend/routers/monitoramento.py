from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models as core_models


router = APIRouter(prefix="/api/monitoramento", tags=["Monitoramento"])


# =========================================================
# DB / AUTH
# =========================================================

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

    usuario = db.query(core_models.Usuario).filter(core_models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    return int(usuario.empresa_id)


def check_modulo_monitoramento(
    empresa_id: int,
    db: Session,
) -> None:
    row = db.execute(
        text("""
            SELECT ativo
            FROM empresa_modulos
            WHERE empresa_id = :empresa_id
              AND modulo = 'monitoramento'
            LIMIT 1
        """),
        {"empresa_id": empresa_id},
    ).mappings().first()

    if not row or not bool(row["ativo"]):
        raise HTTPException(
            status_code=403,
            detail="Módulo Monitoramento não está ativo para esta empresa.",
        )


def cliente_pertence_empresa(
    cliente_id: int,
    empresa_id: int,
    db: Session,
) -> bool:
    row = db.execute(
        text("""
            SELECT id
            FROM clientes
            WHERE id = :cliente_id
              AND empresa_id = :empresa_id
            LIMIT 1
        """),
        {"cliente_id": cliente_id, "empresa_id": empresa_id},
    ).first()

    return bool(row)


def conta_pertence_empresa(
    conta_id: int,
    empresa_id: int,
    db: Session,
) -> Optional[Dict[str, Any]]:
    row = db.execute(
        text("""
            SELECT *
            FROM cliente_monitoramento_contas
            WHERE id = :conta_id
              AND empresa_id = :empresa_id
            LIMIT 1
        """),
        {"conta_id": conta_id, "empresa_id": empresa_id},
    ).mappings().first()

    return dict(row) if row else None


def clean_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def clean_row(row: Any) -> Dict[str, Any]:
    if not row:
        return {}

    data = dict(row)
    return {k: clean_value(v) for k, v in data.items()}


def clean_rows(rows: Any) -> List[Dict[str, Any]]:
    return [clean_row(row) for row in rows]


def norm_str(value: Any) -> Optional[str]:
    text_value = str(value or "").strip()
    return text_value or None


# =========================================================
# SCHEMAS
# =========================================================

class MonitoramentoContaIn(BaseModel):
    cliente_id: int

    codigo_conta: Optional[str] = None
    sistema_origem: Optional[str] = "segware"

    grupo_cliente: Optional[str] = None
    empresa_monitoramento: Optional[str] = None

    monitoramento_habilitado: bool = True
    status_monitoramento: Optional[str] = None

    data_cadastro: Optional[str] = None

    nome_responsavel: Optional[str] = None
    email_responsavel: Optional[str] = None

    contrato: Optional[str] = None

    rota_1: Optional[str] = None
    rota_2: Optional[str] = None
    ramo_atividade: Optional[str] = None
    instalador: Optional[str] = None
    vendedor: Optional[str] = None
    nivel_risco: Optional[str] = None

    possui_chaves: bool = False
    numero_chaveiro: Optional[str] = None

    latitude: Optional[str] = None
    longitude: Optional[str] = None

    referencia_localizacao: Optional[str] = None
    informacoes_adicionais: Optional[str] = None
    providencias_local: Optional[str] = None
    observacoes: Optional[str] = None

    ativo: bool = True


class MonitoramentoContaUpdate(BaseModel):
    codigo_conta: Optional[str] = None
    sistema_origem: Optional[str] = "segware"

    grupo_cliente: Optional[str] = None
    empresa_monitoramento: Optional[str] = None

    monitoramento_habilitado: bool = True
    status_monitoramento: Optional[str] = None

    data_cadastro: Optional[str] = None

    nome_responsavel: Optional[str] = None
    email_responsavel: Optional[str] = None

    contrato: Optional[str] = None

    rota_1: Optional[str] = None
    rota_2: Optional[str] = None
    ramo_atividade: Optional[str] = None
    instalador: Optional[str] = None
    vendedor: Optional[str] = None
    nivel_risco: Optional[str] = None

    possui_chaves: bool = False
    numero_chaveiro: Optional[str] = None

    latitude: Optional[str] = None
    longitude: Optional[str] = None

    referencia_localizacao: Optional[str] = None
    informacoes_adicionais: Optional[str] = None
    providencias_local: Optional[str] = None
    observacoes: Optional[str] = None

    ativo: bool = True


class MonitoramentoContatoIn(BaseModel):
    lista: Optional[int] = None
    prioridade: Optional[int] = None

    nome: Optional[str] = None
    funcao: Optional[str] = None
    codigo_painel: Optional[str] = None

    telefone_1: Optional[str] = None
    whatsapp_1: Optional[str] = None
    telefone_2: Optional[str] = None
    whatsapp_2: Optional[str] = None

    observacoes: Optional[str] = None
    ativo: bool = True


class MonitoramentoProdutoIn(BaseModel):
    codigo_produto: Optional[str] = None
    nome_produto: Optional[str] = None

    valor: Optional[float] = 0
    marca: Optional[str] = None
    grupo_produto: Optional[str] = None

    habilitado: bool = True
    observacoes: Optional[str] = None


class MonitoramentoCaracteristicaIn(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    grupo: Optional[str] = None

    exibe_monitoramento: bool = True
    habilitado: bool = True


# =========================================================
# HELPERS DE CONSULTA
# =========================================================

def get_conta_completa(
    conta_id: int,
    empresa_id: int,
    db: Session,
) -> Dict[str, Any]:
    conta = db.execute(
        text("""
            SELECT
                cmc.*,
                c.nome AS cliente_nome,
                c.codigo AS cliente_codigo,
                c.telefone AS cliente_telefone,
                c.whatsapp AS cliente_whatsapp,
                c.email AS cliente_email,
                c.cidade AS cliente_cidade,
                c.estado AS cliente_estado
            FROM cliente_monitoramento_contas cmc
            JOIN clientes c ON c.id = cmc.cliente_id
            WHERE cmc.id = :conta_id
              AND cmc.empresa_id = :empresa_id
            LIMIT 1
        """),
        {"conta_id": conta_id, "empresa_id": empresa_id},
    ).mappings().first()

    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    contatos = db.execute(
        text("""
            SELECT *
            FROM cliente_monitoramento_contatos
            WHERE empresa_id = :empresa_id
              AND conta_monitoramento_id = :conta_id
            ORDER BY COALESCE(lista, 999), COALESCE(prioridade, 999), id
        """),
        {"empresa_id": empresa_id, "conta_id": conta_id},
    ).mappings().all()

    produtos = db.execute(
        text("""
            SELECT *
            FROM cliente_monitoramento_produtos
            WHERE empresa_id = :empresa_id
              AND conta_monitoramento_id = :conta_id
            ORDER BY id
        """),
        {"empresa_id": empresa_id, "conta_id": conta_id},
    ).mappings().all()

    caracteristicas = db.execute(
        text("""
            SELECT *
            FROM cliente_monitoramento_caracteristicas
            WHERE empresa_id = :empresa_id
              AND conta_monitoramento_id = :conta_id
            ORDER BY grupo, codigo, nome, id
        """),
        {"empresa_id": empresa_id, "conta_id": conta_id},
    ).mappings().all()

    data = clean_row(conta)
    data["contatos"] = clean_rows(contatos)
    data["produtos"] = clean_rows(produtos)
    data["caracteristicas"] = clean_rows(caracteristicas)

    return data


# =========================================================
# ROTAS PRINCIPAIS
# =========================================================

@router.get("/modulo")
def status_modulo_monitoramento(
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("""
            SELECT *
            FROM empresa_modulos
            WHERE empresa_id = :empresa_id
              AND modulo = 'monitoramento'
            LIMIT 1
        """),
        {"empresa_id": empresa_id},
    ).mappings().first()

    return {
        "empresa_id": empresa_id,
        "modulo": "monitoramento",
        "ativo": bool(row and row["ativo"]),
        "configuracoes_json": row["configuracoes_json"] if row else None,
    }


@router.get("/clientes")
def buscar_clientes_para_monitoramento(
    busca: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=100),
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    termo = f"%{str(busca or '').strip()}%"

    rows = db.execute(
        text("""
            SELECT
                id,
                codigo,
                nome,
                nome_fantasia,
                cpf_cnpj,
                telefone,
                whatsapp,
                email,
                cidade,
                estado
            FROM clientes
            WHERE empresa_id = :empresa_id
              AND (
                :busca_vazia = true
                OR nome ILIKE :termo
                OR nome_fantasia ILIKE :termo
                OR codigo ILIKE :termo
                OR cpf_cnpj ILIKE :termo
                OR telefone ILIKE :termo
                OR whatsapp ILIKE :termo
              )
            ORDER BY nome ASC
            LIMIT :limit
        """),
        {
            "empresa_id": empresa_id,
            "termo": termo,
            "busca_vazia": not bool(str(busca or "").strip()),
            "limit": limit,
        },
    ).mappings().all()

    return clean_rows(rows)


@router.get("/contas")
def listar_contas_monitoramento(
    busca: str = Query(default=""),
    status_monitoramento: str = Query(default=""),
    ativo: Optional[bool] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    termo = f"%{str(busca or '').strip()}%"
    status_termo = str(status_monitoramento or "").strip()

    rows = db.execute(
        text("""
            SELECT
                cmc.id,
                cmc.cliente_id,
                c.codigo AS cliente_codigo,
                c.nome AS cliente_nome,
                c.nome_fantasia AS cliente_nome_fantasia,
                c.telefone AS cliente_telefone,
                c.whatsapp AS cliente_whatsapp,
                c.cidade AS cliente_cidade,
                c.estado AS cliente_estado,

                cmc.codigo_conta,
                cmc.sistema_origem,
                cmc.grupo_cliente,
                cmc.monitoramento_habilitado,
                cmc.status_monitoramento,
                cmc.contrato,
                cmc.rota_1,
                cmc.rota_2,
                cmc.ramo_atividade,
                cmc.nivel_risco,
                cmc.ativo,

                (
                    SELECT COUNT(*)
                    FROM cliente_monitoramento_contatos x
                    WHERE x.conta_monitoramento_id = cmc.id
                ) AS total_contatos,

                (
                    SELECT COUNT(*)
                    FROM cliente_monitoramento_produtos x
                    WHERE x.conta_monitoramento_id = cmc.id
                ) AS total_produtos,

                (
                    SELECT COUNT(*)
                    FROM cliente_monitoramento_caracteristicas x
                    WHERE x.conta_monitoramento_id = cmc.id
                ) AS total_caracteristicas

            FROM cliente_monitoramento_contas cmc
            JOIN clientes c ON c.id = cmc.cliente_id
            WHERE cmc.empresa_id = :empresa_id
              AND (
                :busca_vazia = true
                OR c.nome ILIKE :termo
                OR c.nome_fantasia ILIKE :termo
                OR c.codigo ILIKE :termo
                OR c.telefone ILIKE :termo
                OR c.whatsapp ILIKE :termo
                OR cmc.codigo_conta ILIKE :termo
                OR cmc.contrato ILIKE :termo
                OR cmc.grupo_cliente ILIKE :termo
              )
              AND (
                :status_vazio = true
                OR cmc.status_monitoramento = :status_monitoramento
              )
              AND (
                :ativo_null = true
                OR cmc.ativo = :ativo
              )
            ORDER BY cmc.codigo_conta NULLS LAST, c.nome ASC
            LIMIT :limit
        """),
        {
            "empresa_id": empresa_id,
            "termo": termo,
            "busca_vazia": not bool(str(busca or "").strip()),
            "status_vazio": not bool(status_termo),
            "status_monitoramento": status_termo,
            "ativo_null": ativo is None,
            "ativo": ativo,
            "limit": limit,
        },
    ).mappings().all()

    return clean_rows(rows)


@router.get("/clientes/{cliente_id}")
def listar_monitoramento_do_cliente(
    cliente_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    if not cliente_pertence_empresa(cliente_id, empresa_id, db):
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    contas = db.execute(
        text("""
            SELECT *
            FROM cliente_monitoramento_contas
            WHERE empresa_id = :empresa_id
              AND cliente_id = :cliente_id
            ORDER BY codigo_conta NULLS LAST, id
        """),
        {"empresa_id": empresa_id, "cliente_id": cliente_id},
    ).mappings().all()

    return clean_rows(contas)


@router.get("/contas/{conta_id}")
def obter_conta_monitoramento(
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)
    return get_conta_completa(conta_id, empresa_id, db)


@router.post("/contas", status_code=status.HTTP_201_CREATED)
def criar_conta_monitoramento(
    payload: MonitoramentoContaIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    if not cliente_pertence_empresa(payload.cliente_id, empresa_id, db):
        raise HTTPException(status_code=404, detail="Cliente não encontrado para esta empresa.")

    row = db.execute(
        text("""
            INSERT INTO cliente_monitoramento_contas (
                empresa_id,
                cliente_id,
                codigo_conta,
                sistema_origem,
                grupo_cliente,
                empresa_monitoramento,
                monitoramento_habilitado,
                status_monitoramento,
                data_cadastro,
                nome_responsavel,
                email_responsavel,
                contrato,
                rota_1,
                rota_2,
                ramo_atividade,
                instalador,
                vendedor,
                nivel_risco,
                possui_chaves,
                numero_chaveiro,
                latitude,
                longitude,
                referencia_localizacao,
                informacoes_adicionais,
                providencias_local,
                observacoes,
                ativo,
                criado_em,
                atualizado_em
            )
            VALUES (
                :empresa_id,
                :cliente_id,
                :codigo_conta,
                :sistema_origem,
                :grupo_cliente,
                :empresa_monitoramento,
                :monitoramento_habilitado,
                :status_monitoramento,
                NULLIF(:data_cadastro, '')::date,
                :nome_responsavel,
                :email_responsavel,
                :contrato,
                :rota_1,
                :rota_2,
                :ramo_atividade,
                :instalador,
                :vendedor,
                :nivel_risco,
                :possui_chaves,
                :numero_chaveiro,
                :latitude,
                :longitude,
                :referencia_localizacao,
                :informacoes_adicionais,
                :providencias_local,
                :observacoes,
                :ativo,
                now(),
                now()
            )
            RETURNING id
        """),
        {
            **payload.dict(),
            "empresa_id": empresa_id,
        },
    ).mappings().first()

    db.commit()

    return get_conta_completa(int(row["id"]), empresa_id, db)


@router.put("/contas/{conta_id}")
def atualizar_conta_monitoramento(
    conta_id: int,
    payload: MonitoramentoContaUpdate,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    conta = conta_pertence_empresa(conta_id, empresa_id, db)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    db.execute(
        text("""
            UPDATE cliente_monitoramento_contas
            SET
                codigo_conta = :codigo_conta,
                sistema_origem = :sistema_origem,
                grupo_cliente = :grupo_cliente,
                empresa_monitoramento = :empresa_monitoramento,
                monitoramento_habilitado = :monitoramento_habilitado,
                status_monitoramento = :status_monitoramento,
                data_cadastro = NULLIF(:data_cadastro, '')::date,
                nome_responsavel = :nome_responsavel,
                email_responsavel = :email_responsavel,
                contrato = :contrato,
                rota_1 = :rota_1,
                rota_2 = :rota_2,
                ramo_atividade = :ramo_atividade,
                instalador = :instalador,
                vendedor = :vendedor,
                nivel_risco = :nivel_risco,
                possui_chaves = :possui_chaves,
                numero_chaveiro = :numero_chaveiro,
                latitude = :latitude,
                longitude = :longitude,
                referencia_localizacao = :referencia_localizacao,
                informacoes_adicionais = :informacoes_adicionais,
                providencias_local = :providencias_local,
                observacoes = :observacoes,
                ativo = :ativo,
                atualizado_em = now()
            WHERE id = :conta_id
              AND empresa_id = :empresa_id
        """),
        {
            **payload.dict(),
            "conta_id": conta_id,
            "empresa_id": empresa_id,
        },
    )

    db.commit()

    return get_conta_completa(conta_id, empresa_id, db)


@router.delete("/contas/{conta_id}")
def excluir_conta_monitoramento(
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    conta = conta_pertence_empresa(conta_id, empresa_id, db)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    db.execute(
        text("""
            DELETE FROM cliente_monitoramento_contas
            WHERE id = :conta_id
              AND empresa_id = :empresa_id
        """),
        {"conta_id": conta_id, "empresa_id": empresa_id},
    )

    db.commit()

    return {"ok": True}


# =========================================================
# CONTATOS
# =========================================================

@router.post("/contas/{conta_id}/contatos", status_code=status.HTTP_201_CREATED)
def criar_contato_monitoramento(
    conta_id: int,
    payload: MonitoramentoContatoIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    conta = conta_pertence_empresa(conta_id, empresa_id, db)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    row = db.execute(
        text("""
            INSERT INTO cliente_monitoramento_contatos (
                empresa_id,
                cliente_id,
                conta_monitoramento_id,
                lista,
                prioridade,
                nome,
                funcao,
                codigo_painel,
                telefone_1,
                whatsapp_1,
                telefone_2,
                whatsapp_2,
                observacoes,
                ativo,
                criado_em,
                atualizado_em
            )
            VALUES (
                :empresa_id,
                :cliente_id,
                :conta_id,
                :lista,
                :prioridade,
                :nome,
                :funcao,
                :codigo_painel,
                :telefone_1,
                :whatsapp_1,
                :telefone_2,
                :whatsapp_2,
                :observacoes,
                :ativo,
                now(),
                now()
            )
            RETURNING *
        """),
        {
            **payload.dict(),
            "empresa_id": empresa_id,
            "cliente_id": conta["cliente_id"],
            "conta_id": conta_id,
        },
    ).mappings().first()

    db.commit()

    return clean_row(row)


@router.put("/contatos/{contato_id}")
def atualizar_contato_monitoramento(
    contato_id: int,
    payload: MonitoramentoContatoIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    row = db.execute(
        text("""
            UPDATE cliente_monitoramento_contatos
            SET
                lista = :lista,
                prioridade = :prioridade,
                nome = :nome,
                funcao = :funcao,
                codigo_painel = :codigo_painel,
                telefone_1 = :telefone_1,
                whatsapp_1 = :whatsapp_1,
                telefone_2 = :telefone_2,
                whatsapp_2 = :whatsapp_2,
                observacoes = :observacoes,
                ativo = :ativo,
                atualizado_em = now()
            WHERE id = :contato_id
              AND empresa_id = :empresa_id
            RETURNING *
        """),
        {
            **payload.dict(),
            "contato_id": contato_id,
            "empresa_id": empresa_id,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Contato não encontrado.")

    db.commit()

    return clean_row(row)


@router.delete("/contatos/{contato_id}")
def excluir_contato_monitoramento(
    contato_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    db.execute(
        text("""
            DELETE FROM cliente_monitoramento_contatos
            WHERE id = :contato_id
              AND empresa_id = :empresa_id
        """),
        {"contato_id": contato_id, "empresa_id": empresa_id},
    )

    db.commit()

    return {"ok": True}


# =========================================================
# PRODUTOS
# =========================================================

@router.post("/contas/{conta_id}/produtos", status_code=status.HTTP_201_CREATED)
def criar_produto_monitoramento(
    conta_id: int,
    payload: MonitoramentoProdutoIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    conta = conta_pertence_empresa(conta_id, empresa_id, db)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    row = db.execute(
        text("""
            INSERT INTO cliente_monitoramento_produtos (
                empresa_id,
                cliente_id,
                conta_monitoramento_id,
                codigo_produto,
                nome_produto,
                valor,
                marca,
                grupo_produto,
                habilitado,
                observacoes,
                criado_em,
                atualizado_em
            )
            VALUES (
                :empresa_id,
                :cliente_id,
                :conta_id,
                :codigo_produto,
                :nome_produto,
                :valor,
                :marca,
                :grupo_produto,
                :habilitado,
                :observacoes,
                now(),
                now()
            )
            RETURNING *
        """),
        {
            **payload.dict(),
            "empresa_id": empresa_id,
            "cliente_id": conta["cliente_id"],
            "conta_id": conta_id,
        },
    ).mappings().first()

    db.commit()

    return clean_row(row)


@router.put("/produtos/{produto_id}")
def atualizar_produto_monitoramento(
    produto_id: int,
    payload: MonitoramentoProdutoIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    row = db.execute(
        text("""
            UPDATE cliente_monitoramento_produtos
            SET
                codigo_produto = :codigo_produto,
                nome_produto = :nome_produto,
                valor = :valor,
                marca = :marca,
                grupo_produto = :grupo_produto,
                habilitado = :habilitado,
                observacoes = :observacoes,
                atualizado_em = now()
            WHERE id = :produto_id
              AND empresa_id = :empresa_id
            RETURNING *
        """),
        {
            **payload.dict(),
            "produto_id": produto_id,
            "empresa_id": empresa_id,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    db.commit()

    return clean_row(row)


@router.delete("/produtos/{produto_id}")
def excluir_produto_monitoramento(
    produto_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    db.execute(
        text("""
            DELETE FROM cliente_monitoramento_produtos
            WHERE id = :produto_id
              AND empresa_id = :empresa_id
        """),
        {"produto_id": produto_id, "empresa_id": empresa_id},
    )

    db.commit()

    return {"ok": True}


# =========================================================
# CARACTERÍSTICAS
# =========================================================

@router.post("/contas/{conta_id}/caracteristicas", status_code=status.HTTP_201_CREATED)
def criar_caracteristica_monitoramento(
    conta_id: int,
    payload: MonitoramentoCaracteristicaIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    conta = conta_pertence_empresa(conta_id, empresa_id, db)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta de monitoramento não encontrada.")

    row = db.execute(
        text("""
            INSERT INTO cliente_monitoramento_caracteristicas (
                empresa_id,
                cliente_id,
                conta_monitoramento_id,
                codigo,
                nome,
                grupo,
                exibe_monitoramento,
                habilitado,
                criado_em,
                atualizado_em
            )
            VALUES (
                :empresa_id,
                :cliente_id,
                :conta_id,
                :codigo,
                :nome,
                :grupo,
                :exibe_monitoramento,
                :habilitado,
                now(),
                now()
            )
            RETURNING *
        """),
        {
            **payload.dict(),
            "empresa_id": empresa_id,
            "cliente_id": conta["cliente_id"],
            "conta_id": conta_id,
        },
    ).mappings().first()

    db.commit()

    return clean_row(row)


@router.put("/caracteristicas/{caracteristica_id}")
def atualizar_caracteristica_monitoramento(
    caracteristica_id: int,
    payload: MonitoramentoCaracteristicaIn,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    row = db.execute(
        text("""
            UPDATE cliente_monitoramento_caracteristicas
            SET
                codigo = :codigo,
                nome = :nome,
                grupo = :grupo,
                exibe_monitoramento = :exibe_monitoramento,
                habilitado = :habilitado,
                atualizado_em = now()
            WHERE id = :caracteristica_id
              AND empresa_id = :empresa_id
            RETURNING *
        """),
        {
            **payload.dict(),
            "caracteristica_id": caracteristica_id,
            "empresa_id": empresa_id,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Característica não encontrada.")

    db.commit()

    return clean_row(row)


@router.delete("/caracteristicas/{caracteristica_id}")
def excluir_caracteristica_monitoramento(
    caracteristica_id: int,
    empresa_id: int = Depends(get_empresa_id),
    db: Session = Depends(get_db),
):
    check_modulo_monitoramento(empresa_id, db)

    db.execute(
        text("""
            DELETE FROM cliente_monitoramento_caracteristicas
            WHERE id = :caracteristica_id
              AND empresa_id = :empresa_id
        """),
        {"caracteristica_id": caracteristica_id, "empresa_id": empresa_id},
    )

    db.commit()

    return {"ok": True}