from __future__ import annotations

import calendar
import json
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal
from backend.security.permissions import get_request_user
from backend.financeiro_recorrencia import (
    FREQUENCIAS_INTERVALO,
    estrutura_recorrencia_disponivel,
    gerar_cobrancas_contrato,
    processar_recorrencias_pendentes,
)

router = APIRouter(prefix="/api/financeiro", tags=["Financeiro"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FINANCEIRO_UPLOAD_DIR = PROJECT_ROOT / "uploads" / "financeiro"
MAX_COMPROVANTE_BYTES = 10 * 1024 * 1024
CENTAVO = Decimal("0.01")


# =========================================================
# Dependências
# =========================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> models.Usuario:
    return get_request_user(request, db)


def empresa_do(usuario: models.Usuario) -> int:
    return int(usuario.empresa_id)


# =========================================================
# Helpers
# =========================================================

def norm_str(value: Any) -> Optional[str]:
    text_value = str(value or "").strip()
    return text_value or None


def parse_money(value: Any) -> Decimal:
    if value in (None, "", "null"):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value

    text_value = str(value).strip()
    if not text_value:
        return Decimal("0")

    text_value = text_value.replace("R$", "").replace(" ", "")
    if "," in text_value and "." in text_value:
        text_value = text_value.replace(".", "").replace(",", ".")
    else:
        text_value = text_value.replace(",", ".")

    try:
        return Decimal(text_value).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Valor inválido: {value}")


def parse_percentage(value: Any) -> Decimal:
    if value in (None, "", "null"):
        return Decimal("0")
    text_value = str(value).strip().replace("%", "").replace(" ", "")
    if "," in text_value and "." in text_value:
        text_value = text_value.replace(".", "").replace(",", ".")
    else:
        text_value = text_value.replace(",", ".")
    try:
        return Decimal(text_value).quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail=f"Percentual inválido: {value}")


def arredondar_moeda(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENTAVO)


def adicionar_meses(data_base: date, meses: int) -> date:
    total = (data_base.year * 12 + (data_base.month - 1)) + meses
    ano, indice_mes = divmod(total, 12)
    mes = indice_mes + 1
    dia = min(data_base.day, calendar.monthrange(ano, mes)[1])
    return date(ano, mes, dia)


def dividir_valor_em_parcelas(valor_total: Decimal, quantidade: int) -> list[Decimal]:
    centavos = int((valor_total * 100).to_integral_value())
    base, resto = divmod(centavos, quantidade)
    return [Decimal(base + (1 if i < resto else 0)) / Decimal(100) for i in range(quantidade)]


def data_from_value(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def calcular_encargos(
    *,
    lancamento: Dict[str, Any],
    data_baixa: date,
    valor_principal: Decimal,
    multa_ja_aplicada: bool,
) -> Dict[str, Any]:
    vencimento = data_from_value(lancamento["data_vencimento"])
    dias_atraso = max(0, (data_baixa - vencimento).days)
    multa = Decimal("0")
    mora = Decimal("0")

    if dias_atraso > 0:
        if bool(lancamento.get("possui_multa")) and not multa_ja_aplicada:
            multa = arredondar_moeda(valor_principal * parse_percentage(lancamento.get("indice_multa_percent")) / Decimal(100))
        if bool(lancamento.get("possui_mora_diaria")):
            mora = arredondar_moeda(
                valor_principal
                * parse_percentage(lancamento.get("indice_mora_diaria_percent"))
                / Decimal(100)
                * Decimal(dias_atraso)
            )

    return {
        "dias_atraso": dias_atraso,
        "valor_multa": multa,
        "valor_mora": mora,
        "multa_ja_aplicada": multa_ja_aplicada,
    }


def multa_ja_aplicada_no_lancamento(db: Session, empresa_id: int, lancamento_id: int) -> bool:
    return bool(db.execute(text("""
        SELECT EXISTS (
            SELECT 1
            FROM public.financeiro_movimentacoes b
            WHERE b.empresa_id = :empresa_id
              AND b.lancamento_id = :lancamento_id
              AND b.tipo_movimentacao = 'baixa'
              AND b.valor_multa > 0
              AND NOT EXISTS (
                  SELECT 1 FROM public.financeiro_movimentacoes e
                  WHERE e.empresa_id = b.empresa_id
                    AND e.movimentacao_origem_id = b.id
                    AND e.tipo_movimentacao = 'estorno'
              )
        )
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar())


def to_json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row_to_dict(row: Any) -> Dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    # Leituras financeiras calculam o status em tempo real. Isso evita UPDATE
    # e COMMIT apenas para marcar um título como vencido ao abrir uma tela.
    if "status_calculado" in data:
        data["status"] = data.pop("status_calculado")
    return {k: to_json_value(v) for k, v in data.items()}


def json_safe(data: Optional[Dict[str, Any]]) -> Optional[str]:
    if data is None:
        return None
    return json.dumps({k: to_json_value(v) for k, v in data.items()}, ensure_ascii=False, default=str)


def validar_tipo_lancamento(tipo: str) -> str:
    tipo_norm = (tipo or "").strip().lower()
    if tipo_norm not in {"receber", "pagar"}:
        raise HTTPException(status_code=422, detail="tipo deve ser 'receber' ou 'pagar'.")
    return tipo_norm


def validar_status(status_value: Optional[str], tipo: str) -> str:
    status_norm = (status_value or "aberto").strip().lower()
    permitidos = {"aberto", "vencido", "parcial", "recebido", "pago", "cancelado"}
    if status_norm not in permitidos:
        raise HTTPException(status_code=422, detail="Status inválido.")
    if tipo == "receber" and status_norm == "pago":
        return "recebido"
    if tipo == "pagar" and status_norm == "recebido":
        return "pago"
    return status_norm


def status_por_valor(
    tipo: str,
    status_base: str,
    valor_total: Decimal,
    valor_pago: Decimal,
    data_vencimento: date,
) -> str:
    if status_base == "cancelado":
        return "cancelado"
    if valor_total > 0 and valor_pago >= valor_total:
        return "recebido" if tipo == "receber" else "pago"
    if valor_pago > 0:
        return "parcial"
    if data_vencimento and data_vencimento < date.today():
        return "vencido"
    return "aberto"


def ensure_tables(db: Session):
    raise RuntimeError("Estrutura administrada pelo Alembic; execute `alembic upgrade head`.")


def registrar_auditoria(
    db: Session,
    *,
    empresa_id: int,
    usuario_id: Optional[int],
    acao: str,
    entidade: str,
    entidade_id: int,
    anteriores: Optional[Dict[str, Any]] = None,
    novos: Optional[Dict[str, Any]] = None,
    motivo: Optional[str] = None,
) -> None:
    db.execute(text("""
        INSERT INTO public.financeiro_auditoria (
            empresa_id, usuario_id, acao, entidade, entidade_id,
            dados_anteriores, dados_novos, motivo, criado_em
        ) VALUES (
            :empresa_id, :usuario_id, :acao, :entidade, :entidade_id,
            CAST(:anteriores AS JSONB), CAST(:novos AS JSONB), :motivo, NOW()
        )
    """), {
        "empresa_id": empresa_id,
        "usuario_id": usuario_id,
        "acao": acao,
        "entidade": entidade,
        "entidade_id": entidade_id,
        "anteriores": json_safe(anteriores),
        "novos": json_safe(novos),
        "motivo": norm_str(motivo),
    })


def validar_id_empresa(
    db: Session,
    *,
    table_name: str,
    item_id: Optional[int],
    empresa_id: int,
    label: str,
) -> None:
    if item_id is None:
        return
    permitidas = {
        "clientes",
        "fornecedores",
        "financeiro_categorias",
        "financeiro_formas_pagamento",
        "financeiro_contas_bancos",
        "financeiro_tipos_documento",
        "financeiro_naturezas_operacao",
        "financeiro_tipos_gasto",
        "financeiro_centros_custo",
        "financeiro_reguas_cobranca",
        "financeiro_unidades_consumo",
        "financeiro_contas_contabeis",
        "financeiro_formas_cobranca",
        "financeiro_regras_encargos",
    }
    if table_name not in permitidas:
        raise RuntimeError("Tabela não permitida na validação financeira.")
    existe = db.execute(
        text(f"SELECT 1 FROM public.{table_name} WHERE id = :id AND empresa_id = :empresa_id LIMIT 1"),
        {"id": item_id, "empresa_id": empresa_id},
    ).first()
    if not existe:
        raise HTTPException(status_code=422, detail=f"{label} não pertence à empresa atual ou não existe.")


def validar_referencias_lancamento(
    db: Session,
    *,
    empresa_id: int,
    tipo: str,
    cliente_id: Optional[int],
    fornecedor_id: Optional[int],
    categoria_id: Optional[int],
    forma_pagamento_id: Optional[int],
    conta_banco_id: Optional[int],
    tipo_documento_id: Optional[int],
    natureza_operacao_id: Optional[int],
    tipo_gasto_id: Optional[int],
    centro_custo_principal_id: Optional[int],
    centro_custo_secundario_id: Optional[int],
    unidade_consumo_principal_id: Optional[int],
    unidade_consumo_secundaria_id: Optional[int],
    conta_contabil_id: Optional[int],
    forma_cobranca_id: Optional[int],
    regra_encargos_id: Optional[int],
    regua_cobranca_id: Optional[int],
    entidade_emissora_id: Optional[int],
) -> None:
    if tipo == "receber" and fornecedor_id is not None:
        raise HTTPException(status_code=422, detail="Conta a receber não pode usar fornecedor.")
    if tipo == "receber" and cliente_id is None:
        raise HTTPException(status_code=422, detail="Selecione o cliente da conta a receber.")
    if tipo == "receber" and forma_cobranca_id is None:
        raise HTTPException(status_code=422, detail="Selecione a forma de cobrança da conta a receber.")
    if tipo == "pagar" and cliente_id is not None:
        raise HTTPException(status_code=422, detail="Conta a pagar não pode usar cliente.")
    if tipo == "pagar" and fornecedor_id is None:
        raise HTTPException(status_code=422, detail="Selecione o sacado da conta a pagar.")
    if tipo == "receber" and tipo_gasto_id is not None:
        raise HTTPException(status_code=422, detail="Tipo de gasto é uma classificação de Contas a Pagar.")
    if tipo == "pagar" and regua_cobranca_id is not None:
        raise HTTPException(status_code=422, detail="Régua de cobrança é usada somente em Contas a Receber.")

    validar_id_empresa(db, table_name="clientes", item_id=cliente_id, empresa_id=empresa_id, label="Cliente")
    validar_id_empresa(
        db,
        table_name="fornecedores",
        item_id=fornecedor_id,
        empresa_id=empresa_id,
        label="Sacado" if tipo == "pagar" else "Fornecedor",
    )
    validar_id_empresa(db, table_name="financeiro_categorias", item_id=categoria_id, empresa_id=empresa_id, label="Categoria")
    validar_id_empresa(db, table_name="financeiro_formas_pagamento", item_id=forma_pagamento_id, empresa_id=empresa_id, label="Forma de pagamento")
    validar_id_empresa(db, table_name="financeiro_contas_bancos", item_id=conta_banco_id, empresa_id=empresa_id, label="Conta/Banco")
    validar_id_empresa(db, table_name="financeiro_tipos_documento", item_id=tipo_documento_id, empresa_id=empresa_id, label="Tipo de documento")
    validar_id_empresa(db, table_name="financeiro_naturezas_operacao", item_id=natureza_operacao_id, empresa_id=empresa_id, label="Natureza da operação")
    validar_id_empresa(db, table_name="financeiro_tipos_gasto", item_id=tipo_gasto_id, empresa_id=empresa_id, label="Tipo de gasto")
    validar_id_empresa(db, table_name="financeiro_centros_custo", item_id=centro_custo_principal_id, empresa_id=empresa_id, label="Centro de custo principal")
    validar_id_empresa(db, table_name="financeiro_centros_custo", item_id=centro_custo_secundario_id, empresa_id=empresa_id, label="Centro de custo secundário")
    validar_id_empresa(db, table_name="financeiro_unidades_consumo", item_id=unidade_consumo_principal_id, empresa_id=empresa_id, label="Unidade de consumo principal")
    validar_id_empresa(db, table_name="financeiro_unidades_consumo", item_id=unidade_consumo_secundaria_id, empresa_id=empresa_id, label="Unidade de consumo secundária")
    validar_id_empresa(db, table_name="financeiro_contas_contabeis", item_id=conta_contabil_id, empresa_id=empresa_id, label="Conta contábil")
    validar_id_empresa(db, table_name="financeiro_formas_cobranca", item_id=forma_cobranca_id, empresa_id=empresa_id, label="Forma de cobrança")
    validar_id_empresa(db, table_name="financeiro_regras_encargos", item_id=regra_encargos_id, empresa_id=empresa_id, label="Regra de multa e mora")
    validar_id_empresa(db, table_name="financeiro_reguas_cobranca", item_id=regua_cobranca_id, empresa_id=empresa_id, label="Régua de cobrança")
    validar_id_empresa(db, table_name="financeiro_contas_bancos", item_id=entidade_emissora_id, empresa_id=empresa_id, label="Entidade emissora")

    if centro_custo_principal_id is not None and centro_custo_principal_id == centro_custo_secundario_id:
        raise HTTPException(status_code=422, detail="Centro de custo principal e secundário devem ser diferentes.")
    if unidade_consumo_principal_id is not None and unidade_consumo_principal_id == unidade_consumo_secundaria_id:
        raise HTTPException(status_code=422, detail="Unidade de consumo principal e secundária devem ser diferentes.")

    for table_name, item_id, label in (
        ("financeiro_tipos_documento", tipo_documento_id, "Tipo de documento"),
        ("financeiro_naturezas_operacao", natureza_operacao_id, "Natureza da operação"),
        ("financeiro_regras_encargos", regra_encargos_id, "Regra de multa e mora"),
    ):
        if item_id is None:
            continue
        aplicacao = db.execute(text(f"""
            SELECT aplicacao FROM public.{table_name}
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": item_id, "empresa_id": empresa_id}).scalar()
        if aplicacao not in {"ambos", tipo}:
            raise HTTPException(status_code=422, detail=f"{label} não aceita lançamentos do tipo {tipo}.")

    if tipo_documento_id is not None:
        exige_entidade = db.execute(text("""
            SELECT exige_entidade_emissora
            FROM public.financeiro_tipos_documento
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": tipo_documento_id, "empresa_id": empresa_id}).scalar()
        if exige_entidade is True and entidade_emissora_id is None:
            raise HTTPException(
                status_code=422,
                detail="O tipo de documento selecionado exige uma entidade emissora (Conta/Banco).",
            )

    if conta_contabil_id is not None:
        aceita = db.execute(text("""
            SELECT aceita_lancamento FROM public.financeiro_contas_contabeis
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": conta_contabil_id, "empresa_id": empresa_id}).scalar()
        if aceita is False:
            raise HTTPException(status_code=422, detail="A conta contábil selecionada é apenas agrupadora e não aceita lançamentos.")

    if categoria_id is not None:
        categoria = db.execute(text("""
            SELECT tipo FROM public.financeiro_categorias
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": categoria_id, "empresa_id": empresa_id}).scalar()
        esperado = "receita" if tipo == "receber" else "despesa"
        if categoria not in {"ambos", esperado}:
            raise HTTPException(status_code=422, detail=f"A categoria selecionada não aceita lançamentos de {esperado}.")


def validar_referencias_baixa(
    db: Session,
    *,
    empresa_id: int,
    forma_pagamento_id: Optional[int],
    conta_banco_id: Optional[int],
) -> None:
    validar_id_empresa(db, table_name="financeiro_formas_pagamento", item_id=forma_pagamento_id, empresa_id=empresa_id, label="Forma de pagamento")
    validar_id_empresa(db, table_name="financeiro_contas_bancos", item_id=conta_banco_id, empresa_id=empresa_id, label="Conta/Banco")


# =========================================================
# Schemas
# =========================================================

class CategoriaIn(BaseModel):
    nome: str
    tipo: str = "ambos"
    cor: Optional[str] = None
    ativo: bool = True


class FormaPagamentoIn(BaseModel):
    nome: str
    tipo: Optional[str] = None
    ativo: bool = True


class ContaBancoIn(BaseModel):
    nome: str
    banco: Optional[str] = None
    agencia: Optional[str] = None
    conta: Optional[str] = None
    saldo_inicial: Optional[Any] = 0
    data_saldo_inicial: Optional[date] = None
    ativo: bool = True


class TipoDocumentoIn(BaseModel):
    nome: str
    codigo: Optional[str] = None
    aplicacao: str = "ambos"
    exige_entidade_emissora: bool = False
    ativo: bool = True


class NaturezaOperacaoIn(BaseModel):
    nome: str
    codigo: Optional[str] = None
    aplicacao: str = "ambos"
    ativo: bool = True


class TipoGastoIn(BaseModel):
    nome: str
    codigo: Optional[str] = None
    ativo: bool = True


class CentroCustoIn(BaseModel):
    nome: str
    codigo: Optional[str] = None
    centro_pai_id: Optional[int] = None
    ativo: bool = True


class UnidadeConsumoIn(BaseModel):
    nome: str
    codigo: Optional[str] = None
    tipo_referencia: str = "outro"
    unidade_pai_id: Optional[int] = None
    departamento_referencia: Optional[str] = None
    ativo: bool = True


class ContaContabilIn(BaseModel):
    codigo: str
    nome: str
    tipo: str = "outros"
    conta_pai_id: Optional[int] = None
    aceita_lancamento: bool = True
    ativo: bool = True


class FormaCobrancaIn(BaseModel):
    nome: str
    tipo: str = "outro"
    ativo: bool = True


class RegraEncargosIn(BaseModel):
    nome: str
    aplicacao: str = "ambos"
    possui_multa: bool = False
    indice_multa_percent: Optional[Any] = 0
    possui_mora_diaria: bool = False
    indice_mora_diaria_percent: Optional[Any] = 0
    padrao: bool = False
    ativo: bool = True


class LancamentoIn(BaseModel):
    tipo: str
    descricao: str
    moeda: str = "BRL"
    valor_total: Any
    valor_pago: Optional[Any] = 0  # compatibilidade; o backend não aceita edição direta

    data_emissao: Optional[date] = None
    data_vencimento: date
    data_pagamento: Optional[date] = None  # calculada pelas movimentações
    status: Optional[str] = "aberto"

    cliente_id: Optional[int] = None
    fornecedor_id: Optional[int] = None
    categoria_id: Optional[int] = None
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: Optional[int] = None

    tipo_documento_id: Optional[int] = None
    natureza_operacao_id: Optional[int] = None
    tipo_gasto_id: Optional[int] = None
    centro_custo_principal_id: Optional[int] = None
    centro_custo_secundario_id: Optional[int] = None
    unidade_consumo_principal_id: Optional[int] = None
    unidade_consumo_secundaria_id: Optional[int] = None
    conta_contabil_id: Optional[int] = None
    forma_cobranca_id: Optional[int] = None
    regra_encargos_id: Optional[int] = None
    regua_cobranca_id: Optional[int] = None
    entidade_emissora_id: Optional[int] = None
    possui_multa: Optional[bool] = None
    indice_multa_percent: Optional[Any] = None
    possui_mora_diaria: Optional[bool] = None
    indice_mora_diaria_percent: Optional[Any] = None

    documento: Optional[str] = None
    observacoes: Optional[str] = None
    anexo_url: Optional[str] = None

    # Cópia dos dados de cobrança usados no momento do lançamento.
    contato_cobranca: Optional[str] = None
    email_cobranca: Optional[str] = None
    whatsapp_cobranca: Optional[str] = None
    modalidade_pagamento: Optional[str] = None
    nota_fiscal_numero: Optional[str] = None
    nota_fiscal_data_emissao: Optional[date] = None

    recorrente: bool = False
    parcelado: bool = False
    parcela_numero: Optional[int] = None
    parcela_total: Optional[int] = None
    grupo_recorrencia: Optional[str] = None
    parcelas_gerar: Optional[int] = 1
    intervalo_parcelas_meses: Optional[int] = 1
    modo_parcelamento: Optional[str] = "dividir_total"


class BaixaIn(BaseModel):
    valor_baixa: Optional[Any] = None  # compatibilidade
    valor_pago: Optional[Any] = None  # compatibilidade com front antigo
    valor_principal: Optional[Any] = None
    valor_desconto: Optional[Any] = 0
    valor_multa: Optional[Any] = None
    valor_mora: Optional[Any] = None
    usar_calculo_automatico: bool = True
    data_pagamento: Optional[date] = None
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: Optional[int] = None
    observacoes: Optional[str] = None


class CancelamentoIn(BaseModel):
    motivo: str


class EstornoIn(BaseModel):
    motivo: str
    data_estorno: Optional[date] = None


class DevolverVendaIn(BaseModel):
    motivo: str


class AutenticarVendaIn(BaseModel):
    data_primeiro_vencimento: date
    parcelas: int = 1
    intervalo_meses: int = 1
    condicao_pagamento_indice: Optional[int] = None
    forma_cobranca_id: int
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: int
    categoria_id: int
    conta_contabil_id: int
    tipo_documento_id: Optional[int] = None
    natureza_operacao_id: Optional[int] = None
    centro_custo_principal_id: Optional[int] = None
    centro_custo_secundario_id: Optional[int] = None
    unidade_consumo_principal_id: Optional[int] = None
    unidade_consumo_secundaria_id: Optional[int] = None
    regra_encargos_id: Optional[int] = None
    entidade_emissora_id: Optional[int] = None
    observacoes: Optional[str] = None


class ContratoRecorrenciaConfigIn(BaseModel):
    frequencia: str = "mensal"
    primeiro_vencimento: date
    dia_vencimento: Optional[int] = None
    meses_antecipacao: int = 1
    forma_cobranca_id: int
    forma_pagamento_id: Optional[int] = None
    conta_banco_id: int
    categoria_id: int
    conta_contabil_id: int
    tipo_documento_id: Optional[int] = None
    natureza_operacao_id: Optional[int] = None
    centro_custo_principal_id: Optional[int] = None
    centro_custo_secundario_id: Optional[int] = None
    unidade_consumo_principal_id: Optional[int] = None
    unidade_consumo_secundaria_id: Optional[int] = None
    regra_encargos_id: Optional[int] = None
    entidade_emissora_id: Optional[int] = None
    observacoes: Optional[str] = None


class AcaoRecorrenciaIn(BaseModel):
    motivo: Optional[str] = None


# =========================================================
# Select base
# =========================================================

STATUS_EFETIVO_SQL = """
CASE
    WHEN {alias}.status = 'cancelado' THEN 'cancelado'
    WHEN {alias}.valor_total > 0 AND {alias}.valor_pago >= {alias}.valor_total
        THEN CASE WHEN {alias}.tipo = 'receber' THEN 'recebido' ELSE 'pago' END
    WHEN {alias}.valor_pago > 0 THEN 'parcial'
    WHEN {alias}.data_vencimento < CURRENT_DATE THEN 'vencido'
    ELSE 'aberto'
END
"""


def status_efetivo_sql(alias: str = "l") -> str:
    return STATUS_EFETIVO_SQL.format(alias=alias)


LANCAMENTO_SELECT = f"""
SELECT
    l.*,
    {status_efetivo_sql('l')} AS status_calculado,
    GREATEST(l.valor_total - l.valor_pago, 0) AS saldo_aberto,
    CASE
        WHEN ({status_efetivo_sql('l')}) NOT IN ('pago', 'recebido', 'cancelado') AND l.data_vencimento < CURRENT_DATE
        THEN CURRENT_DATE - l.data_vencimento
        ELSE 0
    END AS dias_atraso,
    c.nome AS cliente_nome,
    f.nome AS fornecedor_nome,
    f.tipo_fornecedor AS fornecedor_tipo,
    cat.nome AS categoria_nome,
    fp.nome AS forma_pagamento_nome,
    cb.nome AS conta_banco_nome,
    td.nome AS tipo_documento_nome,
    no.nome AS natureza_operacao_nome,
    tg.nome AS tipo_gasto_nome,
    ccp.nome AS centro_custo_principal_nome,
    ccs.nome AS centro_custo_secundario_nome,
    ucp.nome AS unidade_consumo_principal_nome,
    ucs.nome AS unidade_consumo_secundaria_nome,
    ccont.codigo AS conta_contabil_codigo,
    ccont.nome AS conta_contabil_nome,
    fc.nome AS forma_cobranca_nome,
    re.nome AS regra_encargos_nome,
    rc.nome AS regua_cobranca_nome,
    ee.nome AS entidade_emissora_nome,
    uc.nome AS criado_por_nome,
    ua.nome AS atualizado_por_nome,
    ucan.nome AS cancelado_por_nome
FROM public.financeiro_lancamentos l
LEFT JOIN public.clientes c
       ON c.id = l.cliente_id
      AND c.empresa_id = l.empresa_id
LEFT JOIN public.fornecedores f
       ON f.id = l.fornecedor_id
      AND f.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_categorias cat
       ON cat.id = l.categoria_id
      AND cat.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_formas_pagamento fp
       ON fp.id = l.forma_pagamento_id
      AND fp.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_contas_bancos cb
       ON cb.id = l.conta_banco_id
      AND cb.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_tipos_documento td
       ON td.id = l.tipo_documento_id AND td.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_naturezas_operacao no
       ON no.id = l.natureza_operacao_id AND no.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_tipos_gasto tg
       ON tg.id = l.tipo_gasto_id AND tg.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_centros_custo ccp
       ON ccp.id = l.centro_custo_principal_id AND ccp.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_centros_custo ccs
       ON ccs.id = l.centro_custo_secundario_id AND ccs.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_unidades_consumo ucp
       ON ucp.id = l.unidade_consumo_principal_id AND ucp.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_unidades_consumo ucs
       ON ucs.id = l.unidade_consumo_secundaria_id AND ucs.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_contas_contabeis ccont
       ON ccont.id = l.conta_contabil_id AND ccont.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_formas_cobranca fc
       ON fc.id = l.forma_cobranca_id AND fc.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_regras_encargos re
       ON re.id = l.regra_encargos_id AND re.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_reguas_cobranca rc
       ON rc.id = l.regua_cobranca_id AND rc.empresa_id = l.empresa_id
LEFT JOIN public.financeiro_contas_bancos ee
       ON ee.id = l.entidade_emissora_id AND ee.empresa_id = l.empresa_id
LEFT JOIN public.usuarios uc ON uc.id = l.criado_por_usuario_id
LEFT JOIN public.usuarios ua ON ua.id = l.atualizado_por_usuario_id
LEFT JOIN public.usuarios ucan ON ucan.id = l.cancelado_por_usuario_id
"""


def obter_lancamento_dict(db: Session, empresa_id: int, lancamento_id: int) -> Dict[str, Any]:
    row = db.execute(text(LANCAMENTO_SELECT + """
        WHERE l.empresa_id = :empresa_id AND l.id = :id LIMIT 1
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    return row_to_dict(row)


def obter_lancamento_para_update(db: Session, empresa_id: int, lancamento_id: int) -> Dict[str, Any]:
    row = db.execute(text("""
        SELECT * FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id AND id = :id
        FOR UPDATE
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    return row_to_dict(row)


def recalcular_lancamento(db: Session, empresa_id: int, lancamento_id: int, usuario_id: int) -> Dict[str, Any]:
    atual = obter_lancamento_para_update(db, empresa_id, lancamento_id)
    total_movimentado = db.execute(text("""
        SELECT COALESCE(SUM(
            CASE WHEN tipo_movimentacao = 'baixa'
                THEN COALESCE(NULLIF(valor_principal, 0), valor)
                ELSE -COALESCE(NULLIF(valor_principal, 0), valor)
            END
        ), 0)
        FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id AND lancamento_id = :lancamento_id
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar() or Decimal("0")
    total_movimentado = max(Decimal("0"), Decimal(str(total_movimentado)))

    ultima_data = db.execute(text("""
        SELECT MAX(b.data_movimentacao)
        FROM public.financeiro_movimentacoes b
        WHERE b.empresa_id = :empresa_id
          AND b.lancamento_id = :lancamento_id
          AND b.tipo_movimentacao = 'baixa'
          AND NOT EXISTS (
              SELECT 1
              FROM public.financeiro_movimentacoes e
              WHERE e.empresa_id = b.empresa_id
                AND e.movimentacao_origem_id = b.id
                AND e.tipo_movimentacao = 'estorno'
          )
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).scalar()

    valor_total = parse_money(atual["valor_total"])
    status_final = status_por_valor(
        str(atual["tipo"]),
        str(atual["status"]),
        valor_total,
        total_movimentado,
        date.fromisoformat(str(atual["data_vencimento"])[:10]),
    )
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET valor_pago = :valor_pago,
               data_pagamento = :data_pagamento,
               status = :status,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id,
        "id": lancamento_id,
        "valor_pago": total_movimentado,
        "data_pagamento": ultima_data,
        "status": status_final,
        "usuario_id": usuario_id,
    })
    return {
        "valor_pago": float(total_movimentado),
        "data_pagamento": ultima_data.isoformat() if ultima_data else None,
        "status": status_final,
        "saldo_aberto": float(max(Decimal("0"), valor_total - total_movimentado)),
    }


# =========================================================
# Opções para selects
# =========================================================

@router.get("/opcoes")
def opcoes_financeiro(
    busca_cliente: Optional[str] = Query(default=None),
    busca_fornecedor: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    params = {"empresa_id": empresa_id}

    categorias = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_categorias
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    formas = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_formas_pagamento
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    contas = [row_to_dict(r) for r in db.execute(text("""
        SELECT * FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id AND ativo = TRUE
        ORDER BY nome ASC
    """), params).fetchall()]

    cliente_where = "empresa_id = :empresa_id"
    cliente_params = dict(params)
    if busca_cliente and busca_cliente.strip():
        cliente_where += " AND (codigo ILIKE :busca_cliente OR nome ILIKE :busca_cliente OR email ILIKE :busca_cliente)"
        cliente_params["busca_cliente"] = f"%{busca_cliente.strip()}%"

    clientes = [row_to_dict(r) for r in db.execute(text(f"""
        SELECT id, codigo, nome, nome_fantasia, cpf_cnpj,
               email, email_cobranca, telefone, whatsapp, contato, modalidade_pagamento
        FROM public.clientes
        WHERE {cliente_where}
        ORDER BY nome ASC, id ASC
        LIMIT 250
    """), cliente_params).fetchall()]

    fornecedor_where = "empresa_id = :empresa_id"
    fornecedor_params = dict(params)
    if busca_fornecedor and busca_fornecedor.strip():
        fornecedor_where += " AND (codigo ILIKE :busca_fornecedor OR nome ILIKE :busca_fornecedor OR email ILIKE :busca_fornecedor)"
        fornecedor_params["busca_fornecedor"] = f"%{busca_fornecedor.strip()}%"

    fornecedores = [row_to_dict(r) for r in db.execute(text(f"""
        SELECT id, codigo, nome, email, telefone, whatsapp, tipo_fornecedor
        FROM public.fornecedores
        WHERE {fornecedor_where}
        ORDER BY nome ASC, id ASC
        LIMIT 250
    """), fornecedor_params).fetchall()]

    def ativos(nome_tabela: str, order_by: str = "nome ASC") -> list[Dict[str, Any]]:
        rows = db.execute(text(f"""
            SELECT * FROM public.{nome_tabela}
            WHERE empresa_id = :empresa_id AND ativo = TRUE
            ORDER BY {order_by}
        """), params).fetchall()
        return [row_to_dict(r) for r in rows]

    return {
        "categorias": categorias,
        "formas_pagamento": formas,
        "contas_bancos": contas,
        "clientes": clientes,
        "fornecedores": fornecedores,
        "tipos_documento": ativos("financeiro_tipos_documento"),
        "naturezas_operacao": ativos("financeiro_naturezas_operacao"),
        "tipos_gasto": ativos("financeiro_tipos_gasto", "codigo NULLS LAST, nome ASC"),
        "centros_custo": ativos("financeiro_centros_custo", "codigo NULLS LAST, nome ASC"),
        "unidades_consumo": ativos("financeiro_unidades_consumo", "codigo NULLS LAST, nome ASC"),
        "contas_contabeis": ativos("financeiro_contas_contabeis", "codigo ASC, nome ASC"),
        "formas_cobranca": ativos("financeiro_formas_cobranca"),
        "regras_encargos": ativos("financeiro_regras_encargos", "padrao DESC, nome ASC"),
        "reguas_cobranca": ativos("financeiro_reguas_cobranca", "padrao DESC, nome ASC"),
    }


@router.get("/sacados")
def pesquisar_sacados_financeiro(
    busca: str = Query(default="", max_length=160),
    limit: int = Query(default=30, ge=1, le=50),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    """Busca leve de fornecedores usados como sacado em Contas a Pagar."""
    empresa_id = empresa_do(usuario)
    termo = (busca or "").strip()
    if len(termo) < 2:
        return {"items": []}

    rows = db.execute(text("""
        SELECT
            id,
            codigo,
            nome,
            nome_fantasia,
            cpf_cnpj,
            email,
            telefone,
            whatsapp,
            tipo_fornecedor
        FROM public.fornecedores
        WHERE empresa_id = :empresa_id
          AND (
               COALESCE(codigo, '') ILIKE :busca
            OR COALESCE(nome, '') ILIKE :busca
            OR COALESCE(nome_fantasia, '') ILIKE :busca
            OR COALESCE(cpf_cnpj, '') ILIKE :busca
            OR COALESCE(email, '') ILIKE :busca
            OR COALESCE(telefone, '') ILIKE :busca
            OR COALESCE(whatsapp, '') ILIKE :busca
          )
        ORDER BY
            CASE
                WHEN COALESCE(codigo, '') ILIKE :inicio THEN 0
                WHEN COALESCE(nome, '') ILIKE :inicio THEN 1
                WHEN COALESCE(nome_fantasia, '') ILIKE :inicio THEN 2
                ELSE 3
            END,
            nome ASC,
            id ASC
        LIMIT :limit
    """), {
        "empresa_id": empresa_id,
        "busca": f"%{termo}%",
        "inicio": f"{termo}%",
        "limit": limit,
    }).fetchall()

    return {"items": [row_to_dict(row) for row in rows]}


# =========================================================
# Dashboard
# =========================================================

@router.get("/dashboard")
def dashboard_financeiro(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    params = {"empresa_id": empresa_id}

    resumo = row_to_dict(db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status <> 'cancelado'
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS total_receber,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status <> 'cancelado'
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS total_pagar,
            COALESCE(SUM(CASE WHEN tipo = 'receber' AND status <> 'cancelado' AND data_vencimento < CURRENT_DATE
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS receber_vencido,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' AND status <> 'cancelado' AND data_vencimento < CURRENT_DATE
                THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS pagar_vencido,
            COUNT(*) AS total_lancamentos
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
    """), params).first())

    mov = row_to_dict(db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN l.tipo = 'receber'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE 0 END), 0) AS recebido,
            COALESCE(SUM(CASE WHEN l.tipo = 'pagar'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE 0 END), 0) AS pago
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
    """), params).first())

    saldo_inicial = db.execute(text("""
        SELECT COALESCE(SUM(saldo_inicial), 0)
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
    """), params).scalar() or Decimal("0")

    resumo.update(mov)
    total_receber = Decimal(str(resumo.get("total_receber") or 0))
    total_pagar = Decimal(str(resumo.get("total_pagar") or 0))
    recebido = Decimal(str(resumo.get("recebido") or 0))
    pago = Decimal(str(resumo.get("pago") or 0))
    saldo_inicial_dec = Decimal(str(saldo_inicial))
    saldo_realizado = saldo_inicial_dec + recebido - pago
    resumo["saldo_inicial"] = float(saldo_inicial_dec)
    resumo["saldo_realizado"] = float(saldo_realizado)
    resumo["saldo_atual"] = float(saldo_realizado)
    resumo["saldo_previsto"] = float(saldo_realizado + total_receber - total_pagar)

    proximos = db.execute(text(LANCAMENTO_SELECT + f"""
        WHERE l.empresa_id = :empresa_id
          AND ({status_efetivo_sql('l')}) NOT IN ('pago', 'recebido', 'cancelado')
        ORDER BY l.data_vencimento ASC, l.id DESC
        LIMIT 12
    """), params).fetchall()

    return {
        "resumo": resumo,
        "proximos_vencimentos": [row_to_dict(r) for r in proximos],
    }


# =========================================================
# Lançamentos
# =========================================================

def _listar_lancamentos_impl(
    *,
    tipo: Optional[str],
    status_filtro: Optional[str],
    data_inicio: Optional[date],
    data_fim: Optional[date],
    busca: Optional[str],
    cliente_id: Optional[int],
    fornecedor_id: Optional[int],
    forma_cobranca_id: Optional[int],
    forma_pagamento_id: Optional[int],
    categoria_id: Optional[int],
    limit: int,
    offset: int,
    db: Session,
    empresa_id: int,
):
    where = ["l.empresa_id = :empresa_id"]
    params: Dict[str, Any] = {"empresa_id": empresa_id, "limit": limit, "offset": offset}

    if tipo:
        where.append("l.tipo = :tipo")
        params["tipo"] = validar_tipo_lancamento(tipo)

    if status_filtro:
        status_norm = status_filtro.strip().lower()
        if status_norm not in {"aberto", "vencido", "parcial", "recebido", "pago", "cancelado"}:
            raise HTTPException(status_code=422, detail="Status de filtro inválido.")
        where.append(f"({status_efetivo_sql('l')}) = :status")
        params["status"] = status_norm

    if data_inicio:
        where.append("l.data_vencimento >= :data_inicio")
        params["data_inicio"] = data_inicio
    if data_fim:
        where.append("l.data_vencimento <= :data_fim")
        params["data_fim"] = data_fim
    if busca and busca.strip():
        where.append("(l.descricao ILIKE :busca OR l.documento ILIKE :busca OR c.nome ILIKE :busca OR f.nome ILIKE :busca)")
        params["busca"] = f"%{busca.strip()}%"
    if cliente_id is not None:
        validar_id_empresa(db, table_name="clientes", item_id=cliente_id, empresa_id=empresa_id, label="Cliente")
        where.append("l.cliente_id = :cliente_id")
        params["cliente_id"] = cliente_id
    if fornecedor_id is not None:
        validar_id_empresa(db, table_name="fornecedores", item_id=fornecedor_id, empresa_id=empresa_id, label="Fornecedor")
        where.append("l.fornecedor_id = :fornecedor_id")
        params["fornecedor_id"] = fornecedor_id
    if forma_cobranca_id is not None:
        validar_id_empresa(db, table_name="financeiro_formas_cobranca", item_id=forma_cobranca_id, empresa_id=empresa_id, label="Forma de cobrança")
        where.append("l.forma_cobranca_id = :forma_cobranca_id")
        params["forma_cobranca_id"] = forma_cobranca_id
    if forma_pagamento_id is not None:
        validar_id_empresa(db, table_name="financeiro_formas_pagamento", item_id=forma_pagamento_id, empresa_id=empresa_id, label="Forma de pagamento")
        where.append("l.forma_pagamento_id = :forma_pagamento_id")
        params["forma_pagamento_id"] = forma_pagamento_id
    if categoria_id is not None:
        validar_id_empresa(db, table_name="financeiro_categorias", item_id=categoria_id, empresa_id=empresa_id, label="Categoria")
        where.append("l.categoria_id = :categoria_id")
        params["categoria_id"] = categoria_id

    where_sql = " AND ".join(where)
    total = db.execute(text("""
        SELECT COUNT(*)
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
        LEFT JOIN public.fornecedores f ON f.id = l.fornecedor_id AND f.empresa_id = l.empresa_id
        WHERE """ + where_sql), params).scalar() or 0

    resumo = row_to_dict(db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN l.status <> 'cancelado' THEN GREATEST(l.valor_total - l.valor_pago, 0) ELSE 0 END), 0) AS total_em_aberto,
            COALESCE(SUM(CASE WHEN l.status <> 'cancelado' THEN l.valor_pago ELSE 0 END), 0) AS total_baixado,
            COALESCE(SUM(CASE WHEN l.status <> 'cancelado' AND l.data_vencimento < CURRENT_DATE
                THEN GREATEST(l.valor_total - l.valor_pago, 0) ELSE 0 END), 0) AS total_vencido,
            COALESCE(SUM(CASE WHEN l.status <> 'cancelado' AND l.data_vencimento = CURRENT_DATE
                THEN GREATEST(l.valor_total - l.valor_pago, 0) ELSE 0 END), 0) AS total_vence_hoje,
            COUNT(DISTINCT CASE WHEN l.status <> 'cancelado' AND l.data_vencimento < CURRENT_DATE
                AND GREATEST(l.valor_total - l.valor_pago, 0) > 0 THEN l.cliente_id END) AS clientes_inadimplentes
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
        LEFT JOIN public.fornecedores f ON f.id = l.fornecedor_id AND f.empresa_id = l.empresa_id
        WHERE """ + where_sql), params).first())

    rows = db.execute(text(LANCAMENTO_SELECT + f"""
        WHERE {where_sql}
        ORDER BY l.data_vencimento ASC, l.id DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()
    items = [row_to_dict(r) for r in rows]
    return {
        "items": items, "total": int(total), "resumo": resumo,
        "limit": limit, "offset": offset, "has_more": offset + len(items) < int(total),
    }


@router.get("/lancamentos")
def listar_lancamentos(
    tipo: Optional[str] = Query(default=None),
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    cliente_id: Optional[int] = Query(default=None),
    fornecedor_id: Optional[int] = Query(default=None),
    forma_cobranca_id: Optional[int] = Query(default=None),
    forma_pagamento_id: Optional[int] = Query(default=None),
    categoria_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo=tipo, status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, cliente_id=cliente_id, fornecedor_id=fornecedor_id,
        forma_cobranca_id=forma_cobranca_id, forma_pagamento_id=forma_pagamento_id, categoria_id=categoria_id,
        limit=limit, offset=offset,
        db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/contas-receber")
def listar_contas_receber(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    cliente_id: Optional[int] = Query(default=None),
    forma_cobranca_id: Optional[int] = Query(default=None),
    forma_pagamento_id: Optional[int] = Query(default=None),
    categoria_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo="receber", status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, cliente_id=cliente_id, fornecedor_id=None,
        forma_cobranca_id=forma_cobranca_id, forma_pagamento_id=forma_pagamento_id, categoria_id=categoria_id,
        limit=limit, offset=offset, db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/contas-pagar")
def listar_contas_pagar(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    busca: Optional[str] = Query(default=None),
    fornecedor_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _listar_lancamentos_impl(
        tipo="pagar", status_filtro=status_filtro, data_inicio=data_inicio,
        data_fim=data_fim, busca=busca, cliente_id=None, fornecedor_id=fornecedor_id,
        forma_cobranca_id=None, forma_pagamento_id=None, categoria_id=None,
        limit=limit, offset=offset, db=db, empresa_id=empresa_do(usuario),
    )


@router.get("/lancamentos/{lancamento_id}")
def obter_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


def dados_cobranca_cliente(db: Session, empresa_id: int, cliente_id: Optional[int]) -> Dict[str, Any]:
    if cliente_id is None:
        return {}
    row = db.execute(text("""
        SELECT contato, email, email_cobranca, telefone, whatsapp, modalidade_pagamento
        FROM public.clientes
        WHERE id = :cliente_id AND empresa_id = :empresa_id
        LIMIT 1
    """), {"cliente_id": cliente_id, "empresa_id": empresa_id}).first()
    return row_to_dict(row) if row else {}


def montar_params_lancamento(payload: LancamentoIn, empresa_id: int, db: Session) -> Dict[str, Any]:
    tipo = validar_tipo_lancamento(payload.tipo)
    descricao = (payload.descricao or "").strip()
    if not descricao:
        raise HTTPException(status_code=422, detail="Descrição é obrigatória.")
    valor_total = parse_money(payload.valor_total)
    if valor_total <= 0:
        raise HTTPException(status_code=422, detail="Valor total deve ser maior que zero.")
    moeda = (payload.moeda or "BRL").strip().upper()
    if moeda not in {"BRL", "USD", "EUR", "GBP"}:
        raise HTTPException(status_code=422, detail="Moeda inválida.")
    validar_referencias_lancamento(
        db,
        empresa_id=empresa_id,
        tipo=tipo,
        cliente_id=payload.cliente_id,
        fornecedor_id=payload.fornecedor_id,
        categoria_id=payload.categoria_id,
        forma_pagamento_id=payload.forma_pagamento_id,
        conta_banco_id=payload.conta_banco_id,
        tipo_documento_id=payload.tipo_documento_id,
        natureza_operacao_id=payload.natureza_operacao_id,
        tipo_gasto_id=payload.tipo_gasto_id,
        centro_custo_principal_id=payload.centro_custo_principal_id,
        centro_custo_secundario_id=payload.centro_custo_secundario_id,
        unidade_consumo_principal_id=payload.unidade_consumo_principal_id,
        unidade_consumo_secundaria_id=payload.unidade_consumo_secundaria_id,
        conta_contabil_id=payload.conta_contabil_id,
        forma_cobranca_id=payload.forma_cobranca_id,
        regra_encargos_id=payload.regra_encargos_id,
        regua_cobranca_id=payload.regua_cobranca_id,
        entidade_emissora_id=payload.entidade_emissora_id,
    )

    regra = None
    if payload.regra_encargos_id is not None:
        regra_row = db.execute(text("""
            SELECT possui_multa, indice_multa_percent, possui_mora_diaria, indice_mora_diaria_percent
            FROM public.financeiro_regras_encargos
            WHERE id = :id AND empresa_id = :empresa_id
        """), {"id": payload.regra_encargos_id, "empresa_id": empresa_id}).first()
        regra = row_to_dict(regra_row) if regra_row else None

    possui_multa = payload.possui_multa if payload.possui_multa is not None else bool(regra and regra.get("possui_multa"))
    possui_mora = payload.possui_mora_diaria if payload.possui_mora_diaria is not None else bool(regra and regra.get("possui_mora_diaria"))
    indice_multa = parse_percentage(payload.indice_multa_percent if payload.indice_multa_percent is not None else (regra or {}).get("indice_multa_percent", 0))
    indice_mora = parse_percentage(payload.indice_mora_diaria_percent if payload.indice_mora_diaria_percent is not None else (regra or {}).get("indice_mora_diaria_percent", 0))
    if indice_multa < 0 or indice_multa > 100 or indice_mora < 0 or indice_mora > 100:
        raise HTTPException(status_code=422, detail="Índices de multa e mora devem ficar entre 0% e 100%.")
    if not possui_multa:
        indice_multa = Decimal("0")
    if not possui_mora:
        indice_mora = Decimal("0")

    cliente_cobranca = dados_cobranca_cliente(db, empresa_id, payload.cliente_id) if tipo == "receber" else {}
    contato_cobranca = norm_str(payload.contato_cobranca) or norm_str(cliente_cobranca.get("contato"))
    email_cobranca = norm_str(payload.email_cobranca) or norm_str(cliente_cobranca.get("email_cobranca")) or norm_str(cliente_cobranca.get("email"))
    whatsapp_cobranca = norm_str(payload.whatsapp_cobranca) or norm_str(cliente_cobranca.get("whatsapp")) or norm_str(cliente_cobranca.get("telefone"))
    modalidade_pagamento = norm_str(payload.modalidade_pagamento) or norm_str(cliente_cobranca.get("modalidade_pagamento"))

    regua_cobranca_id = payload.regua_cobranca_id
    if tipo == "receber" and regua_cobranca_id is None:
        regua_cobranca_id = db.execute(text("""
            SELECT id FROM public.financeiro_reguas_cobranca
            WHERE empresa_id = :empresa_id AND ativo = TRUE AND padrao = TRUE
            ORDER BY id LIMIT 1
        """), {"empresa_id": empresa_id}).scalar()

    return {
        "empresa_id": empresa_id,
        "tipo": tipo,
        "descricao": descricao,
        "moeda": moeda,
        "valor_total": valor_total,
        "data_emissao": payload.data_emissao or date.today(),
        "data_vencimento": payload.data_vencimento,
        "cliente_id": payload.cliente_id,
        "fornecedor_id": payload.fornecedor_id,
        "categoria_id": payload.categoria_id,
        "forma_pagamento_id": payload.forma_pagamento_id,
        "conta_banco_id": payload.conta_banco_id,
        "tipo_documento_id": payload.tipo_documento_id,
        "natureza_operacao_id": payload.natureza_operacao_id,
        "tipo_gasto_id": payload.tipo_gasto_id,
        "centro_custo_principal_id": payload.centro_custo_principal_id,
        "centro_custo_secundario_id": payload.centro_custo_secundario_id,
        "unidade_consumo_principal_id": payload.unidade_consumo_principal_id,
        "unidade_consumo_secundaria_id": payload.unidade_consumo_secundaria_id,
        "conta_contabil_id": payload.conta_contabil_id,
        "forma_cobranca_id": payload.forma_cobranca_id,
        "regra_encargos_id": payload.regra_encargos_id,
        "regua_cobranca_id": regua_cobranca_id,
        "entidade_emissora_id": payload.entidade_emissora_id,
        "possui_multa": possui_multa,
        "indice_multa_percent": indice_multa,
        "possui_mora_diaria": possui_mora,
        "indice_mora_diaria_percent": indice_mora,
        "documento": norm_str(payload.documento),
        "observacoes": norm_str(payload.observacoes),
        "anexo_url": norm_str(payload.anexo_url),
        "contato_cobranca": contato_cobranca,
        "email_cobranca": email_cobranca,
        "whatsapp_cobranca": whatsapp_cobranca,
        "modalidade_pagamento": modalidade_pagamento,
        "nota_fiscal_numero": norm_str(payload.nota_fiscal_numero),
        "nota_fiscal_data_emissao": payload.nota_fiscal_data_emissao,
        "recorrente": payload.recorrente,
        "parcelado": payload.parcelado,
        "parcela_numero": payload.parcela_numero,
        "parcela_total": payload.parcela_total,
        "grupo_recorrencia": norm_str(payload.grupo_recorrencia),
        "grupo_parcelamento": None,
    }


LANCAMENTO_INSERT_SQL = """
    INSERT INTO public.financeiro_lancamentos (
        empresa_id, tipo, descricao, moeda, valor_total, valor_pago,
        data_emissao, data_vencimento, data_pagamento, status,
        cliente_id, fornecedor_id, categoria_id, forma_pagamento_id, conta_banco_id,
        tipo_documento_id, natureza_operacao_id, tipo_gasto_id,
        centro_custo_principal_id, centro_custo_secundario_id,
        unidade_consumo_principal_id, unidade_consumo_secundaria_id,
        conta_contabil_id, forma_cobranca_id, regra_encargos_id, regua_cobranca_id, entidade_emissora_id,
        possui_multa, indice_multa_percent, possui_mora_diaria, indice_mora_diaria_percent,
        documento, observacoes, anexo_url,
        contato_cobranca, email_cobranca, whatsapp_cobranca, modalidade_pagamento,
        nota_fiscal_numero, nota_fiscal_data_emissao,
        recorrente, parcelado, parcela_numero, parcela_total, grupo_recorrencia, grupo_parcelamento,
        criado_por_usuario_id, atualizado_por_usuario_id, criado_em, atualizado_em
    ) VALUES (
        :empresa_id, :tipo, :descricao, :moeda, :valor_total, 0,
        :data_emissao, :data_vencimento, NULL, :status,
        :cliente_id, :fornecedor_id, :categoria_id, :forma_pagamento_id, :conta_banco_id,
        :tipo_documento_id, :natureza_operacao_id, :tipo_gasto_id,
        :centro_custo_principal_id, :centro_custo_secundario_id,
        :unidade_consumo_principal_id, :unidade_consumo_secundaria_id,
        :conta_contabil_id, :forma_cobranca_id, :regra_encargos_id, :regua_cobranca_id, :entidade_emissora_id,
        :possui_multa, :indice_multa_percent, :possui_mora_diaria, :indice_mora_diaria_percent,
        :documento, :observacoes, :anexo_url,
        :contato_cobranca, :email_cobranca, :whatsapp_cobranca, :modalidade_pagamento,
        :nota_fiscal_numero, :nota_fiscal_data_emissao,
        :recorrente, :parcelado, :parcela_numero, :parcela_total, :grupo_recorrencia, :grupo_parcelamento,
        :usuario_id, :usuario_id, NOW(), NOW()
    ) RETURNING id
"""


@router.post("/lancamentos", status_code=status.HTTP_201_CREATED)
def criar_lancamento(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    if parse_money(payload.valor_pago) != 0:
        raise HTTPException(status_code=422, detail="O valor pago/recebido deve ser registrado pela ação Baixar.")

    params_base = montar_params_lancamento(payload, empresa_id, db)
    quantidade = int(payload.parcelas_gerar or 1)
    intervalo = int(payload.intervalo_parcelas_meses or 1)
    modo = (payload.modo_parcelamento or "dividir_total").strip().lower()

    if quantidade < 1 or quantidade > 120:
        raise HTTPException(status_code=422, detail="A quantidade de parcelas deve ficar entre 1 e 120.")
    if intervalo < 1 or intervalo > 24:
        raise HTTPException(status_code=422, detail="O intervalo entre parcelas deve ficar entre 1 e 24 meses.")
    if modo not in {"dividir_total", "repetir_valor"}:
        raise HTTPException(status_code=422, detail="Modo de parcelamento inválido.")

    if quantidade == 1:
        valores = [params_base["valor_total"]]
        grupo_parcelamento = None
    elif modo == "dividir_total":
        total_centavos = int((params_base["valor_total"] * 100).to_integral_value())
        if total_centavos < quantidade:
            raise HTTPException(
                status_code=422,
                detail="O valor total é insuficiente para gerar essa quantidade de parcelas sem criar parcelas zeradas.",
            )
        valores = dividir_valor_em_parcelas(params_base["valor_total"], quantidade)
        grupo_parcelamento = uuid4().hex
    else:
        valores = [params_base["valor_total"] for _ in range(quantidade)]
        grupo_parcelamento = uuid4().hex

    ids: list[int] = []
    for indice, valor_parcela in enumerate(valores, start=1):
        params = dict(params_base)
        params.update({
            "valor_total": valor_parcela,
            "data_vencimento": adicionar_meses(params_base["data_vencimento"], (indice - 1) * intervalo),
            "parcelado": quantidade > 1,
            "parcela_numero": indice if quantidade > 1 else payload.parcela_numero,
            "parcela_total": quantidade if quantidade > 1 else payload.parcela_total,
            "grupo_parcelamento": grupo_parcelamento,
            "usuario_id": int(usuario.id),
        })
        params["status"] = status_por_valor(
            params["tipo"], "aberto", params["valor_total"], Decimal("0"), params["data_vencimento"]
        )
        row = db.execute(text(LANCAMENTO_INSERT_SQL), params).first()
        lancamento_id = int(row[0])
        ids.append(lancamento_id)
        novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
        registrar_auditoria(
            db,
            empresa_id=empresa_id,
            usuario_id=int(usuario.id),
            acao="criar_parcela" if quantidade > 1 else "criar",
            entidade="lancamento",
            entidade_id=lancamento_id,
            novos=novo,
            motivo=(
                f"Parcela {indice}/{quantidade}; modo={modo}; intervalo={intervalo} mês(es)."
                if quantidade > 1 else None
            ),
        )

    db.commit()
    if quantidade == 1:
        return obter_lancamento_dict(db, empresa_id, ids[0])
    return {
        "quantidade": quantidade,
        "grupo_parcelamento": grupo_parcelamento,
        "modo_parcelamento": modo,
        "lancamentos": [obter_lancamento_dict(db, empresa_id, item_id) for item_id in ids],
    }


@router.post("/contas-receber", status_code=status.HTTP_201_CREATED)
def criar_conta_receber(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    payload.tipo = "receber"
    return criar_lancamento(payload, db=db, usuario=usuario)


@router.post("/contas-pagar", status_code=status.HTTP_201_CREATED)
def criar_conta_pagar(
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    payload.tipo = "pagar"
    return criar_lancamento(payload, db=db, usuario=usuario)


def venda_pendente_dict(row: Any) -> Dict[str, Any]:
    data = row_to_dict(row)
    for campo in ("pagamentos_json", "itens_json", "lancamentos_gerados"):
        valor = data.get(campo)
        if valor is None:
            data[campo] = []
        elif isinstance(valor, str):
            try:
                data[campo] = json.loads(valor)
            except Exception:
                data[campo] = []
    return data


@router.get("/vendas-pendentes")
def listar_vendas_pendentes(
    status_filtro: Optional[str] = Query(default=None, alias="status"),
    busca: Optional[str] = Query(default=None),
    cliente_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    where = ["v.empresa_id=:empresa_id"]
    params: Dict[str, Any] = {"empresa_id": empresa_id, "limit": limit, "offset": offset}
    if status_filtro:
        status_norm = str(status_filtro).strip().lower()
        if status_norm not in {"pendente", "devolvido", "autenticado", "cancelado"}:
            raise HTTPException(status_code=422, detail="Status de venda inválido.")
        where.append("v.status=:status")
        params["status"] = status_norm
    if cliente_id:
        validar_id_empresa(db, table_name="clientes", item_id=cliente_id, empresa_id=empresa_id, label="Cliente")
        where.append("v.cliente_id=:cliente_id")
        params["cliente_id"] = cliente_id
    if busca and str(busca).strip():
        params["busca"] = f"%{str(busca).strip()}%"
        where.append("(v.orcamento_codigo ILIKE :busca OR v.orcamento_titulo ILIKE :busca OR v.cliente_nome ILIKE :busca)")
    where_sql = " AND ".join(where)
    total = int(db.execute(text(f"SELECT COUNT(*) FROM public.financeiro_vendas_pendentes v WHERE {where_sql}"), params).scalar() or 0)
    rows = db.execute(text(f"""
        SELECT v.*, ue.nome AS enviado_por_nome, ud.nome AS devolvido_por_nome,
               ua.nome AS autenticado_por_nome, uc.nome AS cancelado_por_nome
        FROM public.financeiro_vendas_pendentes v
        LEFT JOIN public.usuarios ue ON ue.id=v.enviado_por_usuario_id
        LEFT JOIN public.usuarios ud ON ud.id=v.devolvido_por_usuario_id
        LEFT JOIN public.usuarios ua ON ua.id=v.autenticado_por_usuario_id
        LEFT JOIN public.usuarios uc ON uc.id=v.cancelado_por_usuario_id
        WHERE {where_sql}
        ORDER BY CASE v.status WHEN 'pendente' THEN 0 WHEN 'devolvido' THEN 1 WHEN 'autenticado' THEN 2 ELSE 3 END,
                 v.enviado_em DESC, v.id DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()
    resumo = row_to_dict(db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status='pendente') AS pendentes,
            COALESCE(SUM(valor_total) FILTER (WHERE status='pendente'), 0) AS valor_pendente,
            COUNT(*) FILTER (WHERE status='devolvido') AS devolvidas,
            COUNT(*) FILTER (WHERE status='autenticado') AS autenticadas,
            COALESCE(SUM(valor_total) FILTER (WHERE status='autenticado'), 0) AS valor_autenticado
        FROM public.financeiro_vendas_pendentes WHERE empresa_id=:empresa_id
    """), {"empresa_id": empresa_id}).first())
    return {
        "items": [venda_pendente_dict(row) for row in rows],
        "total": total,
        "resumo": resumo,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < total,
    }


@router.get("/vendas-pendentes/{venda_id}")
def obter_venda_pendente(
    venda_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        SELECT v.*, ue.nome AS enviado_por_nome, ud.nome AS devolvido_por_nome,
               ua.nome AS autenticado_por_nome, uc.nome AS cancelado_por_nome
        FROM public.financeiro_vendas_pendentes v
        LEFT JOIN public.usuarios ue ON ue.id=v.enviado_por_usuario_id
        LEFT JOIN public.usuarios ud ON ud.id=v.devolvido_por_usuario_id
        LEFT JOIN public.usuarios ua ON ua.id=v.autenticado_por_usuario_id
        LEFT JOIN public.usuarios uc ON uc.id=v.cancelado_por_usuario_id
        WHERE v.empresa_id=:empresa_id AND v.id=:id LIMIT 1
    """), {"empresa_id": empresa_id, "id": venda_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Venda financeira não encontrada.")
    return venda_pendente_dict(row)


@router.post("/vendas-pendentes/{venda_id}/devolver")
def devolver_venda_pendente(
    venda_id: int,
    payload: DevolverVendaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="Informe o motivo da devolução ao Comercial.")
    row = db.execute(text("""
        SELECT * FROM public.financeiro_vendas_pendentes
        WHERE empresa_id=:empresa_id AND id=:id FOR UPDATE
    """), {"empresa_id": empresa_id, "id": venda_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Venda financeira não encontrada.")
    if row["status"] != "pendente":
        raise HTTPException(status_code=409, detail="Somente uma venda pendente pode ser devolvida.")
    db.execute(text("""
        UPDATE public.financeiro_vendas_pendentes SET status='devolvido', devolvido_por_usuario_id=:usuario_id,
            devolvido_em=NOW(), motivo_devolucao=:motivo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id
    """), {"usuario_id": int(usuario.id), "motivo": motivo, "empresa_id": empresa_id, "id": venda_id})
    db.execute(text("""
        UPDATE public.orcamentos SET financeiro_status='devolvido', financeiro_motivo_retorno=:motivo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:orcamento_id
    """), {"motivo": motivo, "empresa_id": empresa_id, "orcamento_id": int(row["orcamento_id"])})
    db.execute(text("""
        INSERT INTO public.orcamento_historico (orcamento_id, usuario_id, usuario_nome, acao, descricao, dados_json, criado_em)
        VALUES (:orcamento_id, :usuario_id, :usuario_nome, 'devolvido_financeiro', :motivo,
                CAST(:dados AS TEXT), NOW())
    """), {
        "orcamento_id": int(row["orcamento_id"]), "usuario_id": int(usuario.id),
        "usuario_nome": getattr(usuario, "nome", None), "motivo": motivo,
        "dados": json.dumps({"pendencia_financeira_id": venda_id}, ensure_ascii=False),
    })
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="devolver_venda",
        entidade="venda_pendente", entidade_id=venda_id, anteriores=dict(row),
        novos={"status": "devolvido"}, motivo=motivo,
    )
    db.commit()
    return obter_venda_pendente(venda_id, db=db, usuario=usuario)


@router.post("/vendas-pendentes/{venda_id}/autenticar", status_code=status.HTTP_201_CREATED)
def autenticar_venda_pendente(
    venda_id: int,
    payload: AutenticarVendaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    venda_row = db.execute(text("""
        SELECT * FROM public.financeiro_vendas_pendentes
        WHERE empresa_id=:empresa_id AND id=:id FOR UPDATE
    """), {"empresa_id": empresa_id, "id": venda_id}).mappings().first()
    if not venda_row:
        raise HTTPException(status_code=404, detail="Venda financeira não encontrada.")
    venda = venda_pendente_dict(venda_row)
    if venda["status"] != "pendente":
        raise HTTPException(status_code=409, detail="Somente uma venda pendente pode ser autenticada.")
    if venda.get("tipo_venda") == "contrato":
        raise HTTPException(status_code=409, detail="Esta venda é de contrato recorrente e será tratada na Fase 7.")
    orcamento = db.execute(text("""
        SELECT id, status, financeiro_status FROM public.orcamentos
        WHERE empresa_id=:empresa_id AND id=:id FOR UPDATE
    """), {"empresa_id": empresa_id, "id": int(venda["orcamento_id"])}).mappings().first()
    if not orcamento or str(orcamento["status"]).lower() != "aprovado":
        raise HTTPException(status_code=409, detail="O orçamento não está mais aprovado no Comercial.")
    if str(orcamento.get("financeiro_status") or "") != "pendente":
        raise HTTPException(status_code=409, detail="O orçamento não está mais aguardando autenticação financeira.")

    quantidade = int(payload.parcelas or 1)
    intervalo = int(payload.intervalo_meses or 1)
    if quantidade < 1 or quantidade > 120:
        raise HTTPException(status_code=422, detail="A quantidade de parcelas deve ficar entre 1 e 120.")
    if intervalo < 1 or intervalo > 24:
        raise HTTPException(status_code=422, detail="O intervalo deve ficar entre 1 e 24 meses.")
    if not payload.forma_cobranca_id or not payload.conta_banco_id or not payload.categoria_id or not payload.conta_contabil_id:
        raise HTTPException(status_code=422, detail="Informe forma de cobrança, conta de destino, categoria e conta contábil.")

    pagamentos = venda.get("pagamentos_json") or []
    condicao = None
    if payload.condicao_pagamento_indice is not None:
        indice = int(payload.condicao_pagamento_indice)
        if indice < 0 or indice >= len(pagamentos):
            raise HTTPException(status_code=422, detail="Condição de pagamento inválida.")
        condicao = pagamentos[indice]
    elif len(pagamentos) == 1:
        condicao = pagamentos[0]
    else:
        selecionadas = [item for item in pagamentos if bool(item.get("selecionada"))]
        condicao = selecionadas[0] if len(selecionadas) == 1 else None

    observacoes = "\n".join(filter(None, [
        f"Origem: venda {venda.get('orcamento_codigo')}",
        f"Condição comercial: {condicao.get('nome')}" if condicao and condicao.get("nome") else None,
        venda.get("observacoes_envio"),
        payload.observacoes,
    ]))
    lancamento_payload = LancamentoIn(
        tipo="receber",
        descricao=f"Venda {venda.get('orcamento_codigo')} — {venda.get('orcamento_titulo')}",
        moeda="BRL",
        valor_total=venda.get("valor_total"),
        data_emissao=date.today(),
        data_vencimento=payload.data_primeiro_vencimento,
        cliente_id=int(venda["cliente_id"]),
        categoria_id=payload.categoria_id,
        forma_pagamento_id=payload.forma_pagamento_id,
        conta_banco_id=payload.conta_banco_id,
        tipo_documento_id=payload.tipo_documento_id,
        natureza_operacao_id=payload.natureza_operacao_id,
        centro_custo_principal_id=payload.centro_custo_principal_id,
        centro_custo_secundario_id=payload.centro_custo_secundario_id,
        unidade_consumo_principal_id=payload.unidade_consumo_principal_id,
        unidade_consumo_secundaria_id=payload.unidade_consumo_secundaria_id,
        conta_contabil_id=payload.conta_contabil_id,
        forma_cobranca_id=payload.forma_cobranca_id,
        regra_encargos_id=payload.regra_encargos_id,
        entidade_emissora_id=payload.entidade_emissora_id or payload.conta_banco_id,
        documento=venda.get("orcamento_codigo"),
        observacoes=observacoes or None,
        modalidade_pagamento=condicao.get("nome") if condicao else None,
        parcelado=quantidade > 1,
        parcela_total=quantidade if quantidade > 1 else None,
    )
    params_base = montar_params_lancamento(lancamento_payload, empresa_id, db)
    total = parse_money(venda.get("valor_total"))
    total_centavos = int((total * 100).to_integral_value())
    if total_centavos < quantidade:
        raise HTTPException(status_code=422, detail="O total da venda é insuficiente para a quantidade de parcelas informada.")
    valores = dividir_valor_em_parcelas(total, quantidade)
    grupo = uuid4().hex if quantidade > 1 else None
    ids: list[int] = []
    try:
        for indice, valor in enumerate(valores, start=1):
            params = dict(params_base)
            vencimento = adicionar_meses(payload.data_primeiro_vencimento, (indice - 1) * intervalo)
            params.update({
                "valor_total": valor,
                "data_vencimento": vencimento,
                "parcelado": quantidade > 1,
                "parcela_numero": indice if quantidade > 1 else None,
                "parcela_total": quantidade if quantidade > 1 else None,
                "grupo_parcelamento": grupo,
                "usuario_id": int(usuario.id),
                "status": status_por_valor("receber", "aberto", valor, Decimal("0"), vencimento),
            })
            lancamento_id = int(db.execute(text(LANCAMENTO_INSERT_SQL), params).scalar_one())
            db.execute(text("""
                UPDATE public.financeiro_lancamentos SET venda_pendente_id=:venda_id,
                    origem_tipo='orcamento', origem_id=:orcamento_id, origem_codigo=:origem_codigo
                WHERE empresa_id=:empresa_id AND id=:id
            """), {
                "venda_id": venda_id, "orcamento_id": int(venda["orcamento_id"]),
                "origem_codigo": venda.get("orcamento_codigo"), "empresa_id": empresa_id, "id": lancamento_id,
            })
            ids.append(lancamento_id)
            registrar_auditoria(
                db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar_venda_orcamento",
                entidade="lancamento", entidade_id=lancamento_id,
                novos={"venda_pendente_id": venda_id, "orcamento_id": int(venda["orcamento_id"]),
                       "parcela": indice, "parcelas": quantidade, "valor": float(valor), "vencimento": vencimento.isoformat()},
            )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Esta venda já possui títulos financeiros gerados.")

    db.execute(text("""
        UPDATE public.financeiro_vendas_pendentes SET status='autenticado', autenticado_por_usuario_id=:usuario_id,
            autenticado_em=NOW(), grupo_parcelamento=:grupo,
            lancamentos_gerados=CAST(:lancamentos AS JSONB), atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id
    """), {
        "usuario_id": int(usuario.id), "grupo": grupo,
        "lancamentos": json.dumps(ids), "empresa_id": empresa_id, "id": venda_id,
    })
    db.execute(text("""
        UPDATE public.orcamentos SET financeiro_status='autenticado', financeiro_autenticado_em=NOW(),
            financeiro_autenticado_por_id=:usuario_id, financeiro_motivo_retorno=NULL, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id
    """), {"usuario_id": int(usuario.id), "empresa_id": empresa_id, "id": int(venda["orcamento_id"])})
    db.execute(text("""
        INSERT INTO public.orcamento_historico (orcamento_id, usuario_id, usuario_nome, acao, descricao, dados_json, criado_em)
        VALUES (:orcamento_id, :usuario_id, :usuario_nome, 'autenticado_financeiro', :descricao,
                CAST(:dados AS TEXT), NOW())
    """), {
        "orcamento_id": int(venda["orcamento_id"]), "usuario_id": int(usuario.id),
        "usuario_nome": getattr(usuario, "nome", None),
        "descricao": f"Venda autenticada pelo Financeiro e convertida em {quantidade} título(s).",
        "dados": json.dumps({"pendencia_financeira_id": venda_id, "lancamentos": ids}, ensure_ascii=False),
    })
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="autenticar_venda",
        entidade="venda_pendente", entidade_id=venda_id, anteriores=venda,
        novos={"status": "autenticado", "lancamentos": ids, "grupo_parcelamento": grupo},
        motivo=payload.observacoes,
    )
    db.commit()
    return {"venda_id": venda_id, "status": "autenticado", "quantidade": quantidade, "lancamentos": ids}


@router.post("/vendas-pendentes/{venda_id}/cancelar-autenticacao")
def cancelar_autenticacao_venda(
    venda_id: int,
    payload: DevolverVendaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="Informe o motivo do cancelamento dos títulos.")

    venda_row = db.execute(text("""
        SELECT * FROM public.financeiro_vendas_pendentes
        WHERE empresa_id=:empresa_id AND id=:id FOR UPDATE
    """), {"empresa_id": empresa_id, "id": venda_id}).mappings().first()
    if not venda_row:
        raise HTTPException(status_code=404, detail="Venda financeira não encontrada.")
    venda = venda_pendente_dict(venda_row)
    if venda["status"] != "autenticado":
        raise HTTPException(status_code=409, detail="Somente uma venda autenticada pode ter os títulos cancelados por este fluxo.")

    titulos = db.execute(text("""
        SELECT * FROM public.financeiro_lancamentos
        WHERE empresa_id=:empresa_id AND venda_pendente_id=:venda_id
        ORDER BY id FOR UPDATE
    """), {"empresa_id": empresa_id, "venda_id": venda_id}).mappings().all()
    if not titulos:
        raise HTTPException(status_code=409, detail="Nenhum título vinculado foi encontrado para esta venda.")

    com_saldo_baixado = [int(t["id"]) for t in titulos if parse_money(t.get("valor_pago")) > 0]
    if com_saldo_baixado:
        raise HTTPException(
            status_code=409,
            detail="Existem títulos com recebimento. Estorne todas as baixas antes de cancelar a autenticação.",
        )

    for titulo in titulos:
        if str(titulo.get("status") or "").lower() == "cancelado":
            continue
        db.execute(text("""
            UPDATE public.financeiro_lancamentos
               SET status='cancelado', cancelado_por_usuario_id=:usuario_id, cancelado_em=NOW(),
                   motivo_cancelamento=:motivo, atualizado_por_usuario_id=:usuario_id, atualizado_em=NOW()
             WHERE empresa_id=:empresa_id AND id=:id
        """), {
            "usuario_id": int(usuario.id), "motivo": motivo,
            "empresa_id": empresa_id, "id": int(titulo["id"]),
        })
        registrar_auditoria(
            db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="cancelar_venda_orcamento",
            entidade="lancamento", entidade_id=int(titulo["id"]), anteriores=dict(titulo),
            novos={"status": "cancelado"}, motivo=motivo,
        )

    db.execute(text("""
        UPDATE public.financeiro_vendas_pendentes
           SET status='devolvido', devolvido_por_usuario_id=:usuario_id, devolvido_em=NOW(),
               motivo_devolucao=:motivo, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id
    """), {"usuario_id": int(usuario.id), "motivo": motivo, "empresa_id": empresa_id, "id": venda_id})
    db.execute(text("""
        UPDATE public.orcamentos
           SET financeiro_status='devolvido', financeiro_motivo_retorno=:motivo, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:orcamento_id
    """), {"motivo": motivo, "empresa_id": empresa_id, "orcamento_id": int(venda["orcamento_id"])})
    db.execute(text("""
        INSERT INTO public.orcamento_historico
            (orcamento_id, usuario_id, usuario_nome, acao, descricao, dados_json, criado_em)
        VALUES
            (:orcamento_id, :usuario_id, :usuario_nome, 'autenticacao_financeira_cancelada',
             :motivo, CAST(:dados AS TEXT), NOW())
    """), {
        "orcamento_id": int(venda["orcamento_id"]), "usuario_id": int(usuario.id),
        "usuario_nome": getattr(usuario, "nome", None), "motivo": motivo,
        "dados": json.dumps({
            "pendencia_financeira_id": venda_id,
            "lancamentos_cancelados": [int(t["id"]) for t in titulos],
        }, ensure_ascii=False),
    })
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="cancelar_autenticacao_venda",
        entidade="venda_pendente", entidade_id=venda_id, anteriores=venda,
        novos={"status": "devolvido", "titulos_cancelados": [int(t["id"]) for t in titulos]},
        motivo=motivo,
    )
    db.commit()
    return obter_venda_pendente(venda_id, db=db, usuario=usuario)


@router.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(
    lancamento_id: int,
    payload: LancamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_para_update(db, empresa_id, lancamento_id)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="Lançamento cancelado não pode ser editado.")
    params = montar_params_lancamento(payload, empresa_id, db)
    valor_pago_atual = parse_money(anterior["valor_pago"])
    if params["valor_total"] < valor_pago_atual:
        raise HTTPException(status_code=422, detail="Valor total não pode ser menor que o valor já baixado.")
    if str(anterior["tipo"]) != params["tipo"] and valor_pago_atual > 0:
        raise HTTPException(status_code=409, detail="Não é permitido trocar o tipo de um lançamento que possui movimentações.")

    params.update({
        "id": lancamento_id,
        "usuario_id": int(usuario.id),
        "status": status_por_valor(
            params["tipo"], str(anterior["status"]), params["valor_total"],
            valor_pago_atual, params["data_vencimento"],
        ),
        # Metadados estruturais não pertencem à edição manual de um título.
        # Preservá-los aqui impede que um PUT antigo/cliente incompleto apague
        # recorrência ou transforme uma parcela em lançamento avulso.
        "recorrente": bool(anterior.get("recorrente")),
        "grupo_recorrencia": norm_str(anterior.get("grupo_recorrencia")),
        "parcelado": bool(anterior.get("parcelado")),
        "parcela_numero": anterior.get("parcela_numero"),
        "parcela_total": anterior.get("parcela_total"),
    })
    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET tipo = :tipo,
               descricao = :descricao,
               moeda = :moeda,
               valor_total = :valor_total,
               data_emissao = :data_emissao,
               data_vencimento = :data_vencimento,
               status = :status,
               cliente_id = :cliente_id,
               fornecedor_id = :fornecedor_id,
               categoria_id = :categoria_id,
               forma_pagamento_id = :forma_pagamento_id,
               conta_banco_id = :conta_banco_id,
               tipo_documento_id = :tipo_documento_id,
               natureza_operacao_id = :natureza_operacao_id,
               tipo_gasto_id = :tipo_gasto_id,
               centro_custo_principal_id = :centro_custo_principal_id,
               centro_custo_secundario_id = :centro_custo_secundario_id,
               unidade_consumo_principal_id = :unidade_consumo_principal_id,
               unidade_consumo_secundaria_id = :unidade_consumo_secundaria_id,
               conta_contabil_id = :conta_contabil_id,
               forma_cobranca_id = :forma_cobranca_id,
               regra_encargos_id = :regra_encargos_id,
               regua_cobranca_id = :regua_cobranca_id,
               entidade_emissora_id = :entidade_emissora_id,
               possui_multa = :possui_multa,
               indice_multa_percent = :indice_multa_percent,
               possui_mora_diaria = :possui_mora_diaria,
               indice_mora_diaria_percent = :indice_mora_diaria_percent,
               documento = :documento,
               observacoes = :observacoes,
               anexo_url = :anexo_url,
               contato_cobranca = :contato_cobranca,
               email_cobranca = :email_cobranca,
               whatsapp_cobranca = :whatsapp_cobranca,
               modalidade_pagamento = :modalidade_pagamento,
               nota_fiscal_numero = :nota_fiscal_numero,
               nota_fiscal_data_emissao = :nota_fiscal_data_emissao,
               recorrente = :recorrente,
               parcelado = :parcelado,
               parcela_numero = :parcela_numero,
               parcela_total = :parcela_total,
               grupo_recorrencia = :grupo_recorrencia,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), params)
    novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar",
        entidade="lancamento", entidade_id=lancamento_id,
        anteriores=anterior, novos=novo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.get("/lancamentos/{lancamento_id}/calculo-baixa")
def calcular_previa_baixa(
    lancamento_id: int,
    data_pagamento: Optional[date] = Query(default=None),
    valor_principal: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    lancamento = obter_lancamento_dict(db, empresa_id, lancamento_id)
    if lancamento["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="Não é possível calcular a baixa de um lançamento cancelado.")

    saldo_aberto = max(Decimal("0"), parse_money(lancamento["valor_total"]) - parse_money(lancamento["valor_pago"]))
    principal = parse_money(valor_principal) if valor_principal not in (None, "") else saldo_aberto
    if principal <= 0:
        raise HTTPException(status_code=422, detail="O principal desta baixa deve ser maior que zero.")
    if principal > saldo_aberto:
        raise HTTPException(status_code=422, detail=f"O principal não pode superar o saldo aberto de R$ {saldo_aberto:.2f}.")

    data_baixa = data_pagamento or date.today()
    multa_aplicada = multa_ja_aplicada_no_lancamento(db, empresa_id, lancamento_id)
    encargos = calcular_encargos(
        lancamento=lancamento,
        data_baixa=data_baixa,
        valor_principal=principal,
        multa_ja_aplicada=multa_aplicada,
    )
    total = arredondar_moeda(principal + encargos["valor_multa"] + encargos["valor_mora"])
    return {
        "lancamento_id": lancamento_id,
        "data_pagamento": data_baixa.isoformat(),
        "saldo_aberto": float(saldo_aberto),
        "valor_principal": float(principal),
        "valor_desconto": 0.0,
        "valor_multa": float(encargos["valor_multa"]),
        "valor_mora": float(encargos["valor_mora"]),
        "valor_total_baixa": float(total),
        "dias_atraso": int(encargos["dias_atraso"]),
        "multa_ja_aplicada": bool(encargos["multa_ja_aplicada"]),
        "regra_calculo": "Multa e mora calculadas sobre o principal informado nesta baixa.",
    }


@router.patch("/lancamentos/{lancamento_id}/baixar")
def baixar_lancamento(
    lancamento_id: int,
    payload: BaixaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_para_update(db, empresa_id, lancamento_id)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="Não é possível baixar um lançamento cancelado.")

    saldo_aberto = max(Decimal("0"), parse_money(anterior["valor_total"]) - parse_money(anterior["valor_pago"]))
    principal_input = payload.valor_principal
    if principal_input in (None, ""):
        principal_input = payload.valor_baixa if payload.valor_baixa is not None else payload.valor_pago
    valor_principal = parse_money(principal_input)
    if valor_principal <= 0:
        raise HTTPException(status_code=422, detail="O principal desta baixa deve ser maior que zero.")
    if saldo_aberto <= 0:
        raise HTTPException(status_code=409, detail="Este lançamento já está totalmente baixado.")
    if valor_principal > saldo_aberto:
        raise HTTPException(status_code=422, detail=f"O principal não pode superar o saldo aberto de R$ {saldo_aberto:.2f}.")

    data_baixa = payload.data_pagamento or date.today()
    multa_aplicada = multa_ja_aplicada_no_lancamento(db, empresa_id, lancamento_id)
    encargos = calcular_encargos(
        lancamento=anterior,
        data_baixa=data_baixa,
        valor_principal=valor_principal,
        multa_ja_aplicada=multa_aplicada,
    )

    valor_desconto = parse_money(payload.valor_desconto)
    if valor_desconto < 0 or valor_desconto > valor_principal:
        raise HTTPException(status_code=422, detail="O desconto deve ficar entre zero e o principal desta baixa.")

    if payload.usar_calculo_automatico:
        valor_multa = encargos["valor_multa"] if payload.valor_multa in (None, "") else parse_money(payload.valor_multa)
        valor_mora = encargos["valor_mora"] if payload.valor_mora in (None, "") else parse_money(payload.valor_mora)
    else:
        valor_multa = parse_money(payload.valor_multa)
        valor_mora = parse_money(payload.valor_mora)

    if valor_multa < 0 or valor_mora < 0:
        raise HTTPException(status_code=422, detail="Multa e mora não podem ser negativas.")
    if encargos["dias_atraso"] <= 0 and (valor_multa > 0 or valor_mora > 0):
        raise HTTPException(status_code=422, detail="Multa e mora só podem ser cobradas após o vencimento.")
    if valor_multa > 0 and not bool(anterior.get("possui_multa")):
        raise HTTPException(status_code=422, detail="Este lançamento não possui regra de multa habilitada.")
    if valor_mora > 0 and not bool(anterior.get("possui_mora_diaria")):
        raise HTTPException(status_code=422, detail="Este lançamento não possui regra de mora diária habilitada.")
    if multa_aplicada and valor_multa > 0:
        raise HTTPException(status_code=422, detail="A multa deste título já foi aplicada em outra baixa válida.")

    valor_caixa = arredondar_moeda(valor_principal - valor_desconto + valor_multa + valor_mora)
    if valor_caixa <= 0:
        raise HTTPException(status_code=422, detail="O valor total da baixa deve ser maior que zero.")

    forma_id = payload.forma_pagamento_id or anterior.get("forma_pagamento_id")
    conta_id = payload.conta_banco_id or anterior.get("conta_banco_id")
    validar_referencias_baixa(
        db,
        empresa_id=empresa_id,
        forma_pagamento_id=int(forma_id) if forma_id else None,
        conta_banco_id=int(conta_id) if conta_id else None,
    )
    if not forma_id:
        raise HTTPException(status_code=422, detail="Selecione a forma de pagamento/recebimento para realizar a baixa.")
    if not conta_id:
        destino = "creditada" if anterior.get("tipo") == "receber" else "debitada"
        raise HTTPException(status_code=422, detail=f"Selecione a conta bancária que será {destino}.")

    mov = db.execute(text("""
        INSERT INTO public.financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            valor_principal, valor_desconto, valor_multa, valor_mora, dias_atraso,
            data_movimentacao, forma_pagamento_id, conta_banco_id,
            observacoes, usuario_id, criado_em
        ) VALUES (
            :empresa_id, :lancamento_id, 'baixa', :valor,
            :valor_principal, :valor_desconto, :valor_multa, :valor_mora, :dias_atraso,
            :data_movimentacao, :forma_pagamento_id, :conta_banco_id,
            :observacoes, :usuario_id, NOW()
        ) RETURNING id
    """), {
        "empresa_id": empresa_id,
        "lancamento_id": lancamento_id,
        "valor": valor_caixa,
        "valor_principal": valor_principal,
        "valor_desconto": valor_desconto,
        "valor_multa": valor_multa,
        "valor_mora": valor_mora,
        "dias_atraso": int(encargos["dias_atraso"]),
        "data_movimentacao": data_baixa,
        "forma_pagamento_id": forma_id,
        "conta_banco_id": conta_id,
        "observacoes": norm_str(payload.observacoes),
        "usuario_id": int(usuario.id),
    }).first()
    movimento_id = int(mov[0])

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET forma_pagamento_id = COALESCE(:forma_pagamento_id, forma_pagamento_id),
               conta_banco_id = COALESCE(:conta_banco_id, conta_banco_id),
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id,
        "id": lancamento_id,
        "forma_pagamento_id": forma_id,
        "conta_banco_id": conta_id,
        "usuario_id": int(usuario.id),
    })
    calculado = recalcular_lancamento(db, empresa_id, lancamento_id, int(usuario.id))
    registrar_auditoria(
        db,
        empresa_id=empresa_id,
        usuario_id=int(usuario.id),
        acao="baixar",
        entidade="lancamento",
        entidade_id=lancamento_id,
        anteriores=anterior,
        novos={
            "movimentacao_id": movimento_id,
            "valor_principal": float(valor_principal),
            "valor_desconto": float(valor_desconto),
            "valor_multa": float(valor_multa),
            "valor_mora": float(valor_mora),
            "valor_total_baixa": float(valor_caixa),
            "dias_atraso": int(encargos["dias_atraso"]),
            **calculado,
        },
        motivo=payload.observacoes,
    )
    db.commit()
    resultado = obter_lancamento_dict(db, empresa_id, lancamento_id)
    resultado["movimentacao_id"] = movimento_id
    resultado["valor_total_baixa"] = float(valor_caixa)
    return resultado


@router.get("/lancamentos/{lancamento_id}/historico")
def historico_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    lancamento = obter_lancamento_dict(db, empresa_id, lancamento_id)
    movimentacoes = [row_to_dict(r) for r in db.execute(text("""
        SELECT
            m.*,
            u.nome AS usuario_nome,
            fp.nome AS forma_pagamento_nome,
            cb.nome AS conta_banco_nome,
            EXISTS (
                SELECT 1 FROM public.financeiro_movimentacoes e
                WHERE e.empresa_id = m.empresa_id
                  AND e.movimentacao_origem_id = m.id
                  AND e.tipo_movimentacao = 'estorno'
            ) AS estornada
        FROM public.financeiro_movimentacoes m
        LEFT JOIN public.usuarios u ON u.id = m.usuario_id
        LEFT JOIN public.financeiro_formas_pagamento fp
               ON fp.id = m.forma_pagamento_id AND fp.empresa_id = m.empresa_id
        LEFT JOIN public.financeiro_contas_bancos cb
               ON cb.id = m.conta_banco_id AND cb.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id AND m.lancamento_id = :lancamento_id
        ORDER BY m.criado_em DESC, m.id DESC
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).fetchall()]
    auditoria = [row_to_dict(r) for r in db.execute(text("""
        SELECT a.*, u.nome AS usuario_nome
        FROM public.financeiro_auditoria a
        LEFT JOIN public.usuarios u ON u.id = a.usuario_id
        WHERE a.empresa_id = :empresa_id
          AND a.entidade = 'lancamento'
          AND a.entidade_id = :lancamento_id
        ORDER BY a.criado_em DESC, a.id DESC
    """), {"empresa_id": empresa_id, "lancamento_id": lancamento_id}).fetchall()]
    return {"lancamento": lancamento, "movimentacoes": movimentacoes, "auditoria": auditoria}


@router.post("/movimentacoes/{movimentacao_id}/comprovante")
async def anexar_comprovante_movimentacao(
    movimentacao_id: int,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        SELECT m.*, l.id AS lancamento_id_validado
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id AND m.id = :id
        FOR UPDATE
    """), {"empresa_id": empresa_id, "id": movimentacao_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada.")
    movimento = row_to_dict(row)
    if movimento.get("tipo_movimentacao") != "baixa":
        raise HTTPException(status_code=409, detail="O comprovante só pode ser anexado a uma baixa.")

    nome_original = Path(arquivo.filename or "comprovante.pdf").name
    mime = (arquivo.content_type or "").lower()
    mimes_pdf_aceitos = {"application/pdf", "application/x-pdf", "application/octet-stream", ""}
    if not nome_original.lower().endswith(".pdf") or mime not in mimes_pdf_aceitos:
        raise HTTPException(status_code=422, detail="O comprovante deve ser um arquivo PDF.")

    conteudo = await arquivo.read(MAX_COMPROVANTE_BYTES + 1)
    if not conteudo:
        raise HTTPException(status_code=422, detail="O comprovante enviado está vazio.")
    if len(conteudo) > MAX_COMPROVANTE_BYTES:
        raise HTTPException(status_code=422, detail="O comprovante PDF deve ter no máximo 10 MB.")
    if not conteudo.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="O arquivo enviado não possui conteúdo PDF válido.")

    pasta_empresa = FINANCEIRO_UPLOAD_DIR / str(empresa_id)
    try:
        pasta_empresa.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Não foi possível preparar a pasta de comprovantes.") from exc

    nome_salvo = f"mov-{movimentacao_id}-{uuid4().hex}.pdf"
    caminho = pasta_empresa / nome_salvo
    url = f"/uploads/financeiro/{empresa_id}/{nome_salvo}"
    comprovante_antigo = norm_str(movimento.get("comprovante_url"))

    try:
        caminho.write_bytes(conteudo)
        db.execute(text("""
            UPDATE public.financeiro_movimentacoes
               SET comprovante_url = :url,
                   comprovante_nome = :nome,
                   comprovante_mime = 'application/pdf',
                   comprovante_tamanho = :tamanho
             WHERE empresa_id = :empresa_id AND id = :id
        """), {
            "url": url, "nome": nome_original, "tamanho": len(conteudo),
            "empresa_id": empresa_id, "id": movimentacao_id,
        })
        registrar_auditoria(
            db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="anexar_comprovante",
            entidade="lancamento", entidade_id=int(movimento["lancamento_id"]),
            anteriores={"comprovante_url": comprovante_antigo},
            novos={"movimentacao_id": movimentacao_id, "comprovante_url": url, "comprovante_nome": nome_original},
        )
        db.commit()
    except Exception:
        db.rollback()
        try:
            if caminho.exists():
                caminho.unlink()
        except OSError:
            pass
        raise

    if comprovante_antigo and comprovante_antigo.startswith(f"/uploads/financeiro/{empresa_id}/"):
        antigo = (PROJECT_ROOT / comprovante_antigo.lstrip("/")).resolve()
        pasta_permitida = pasta_empresa.resolve()
        if antigo.parent == pasta_permitida and antigo.exists() and antigo != caminho.resolve():
            try:
                antigo.unlink()
            except OSError:
                pass

    return {
        "movimentacao_id": movimentacao_id,
        "comprovante_url": url,
        "comprovante_nome": nome_original,
        "comprovante_tamanho": len(conteudo),
    }


@router.patch("/movimentacoes/{movimentacao_id}/estornar")
def estornar_movimentacao(
    movimentacao_id: int,
    payload: EstornoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="O motivo do estorno é obrigatório.")

    origem_row = db.execute(text("""
        SELECT m.*, l.tipo, l.valor_total, l.valor_pago, l.status, l.data_vencimento
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id AND m.id = :id
        FOR UPDATE
    """), {"empresa_id": empresa_id, "id": movimentacao_id}).first()
    if not origem_row:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada.")
    origem = row_to_dict(origem_row)
    if origem["tipo_movimentacao"] != "baixa":
        raise HTTPException(status_code=409, detail="Somente uma baixa pode ser estornada.")
    ja_estornada = db.execute(text("""
        SELECT 1 FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id
          AND movimentacao_origem_id = :origem_id
          AND tipo_movimentacao = 'estorno'
        LIMIT 1
    """), {"empresa_id": empresa_id, "origem_id": movimentacao_id}).first()
    if ja_estornada:
        raise HTTPException(status_code=409, detail="Esta movimentação já foi estornada.")

    estorno = db.execute(text("""
        INSERT INTO public.financeiro_movimentacoes (
            empresa_id, lancamento_id, tipo_movimentacao, valor,
            valor_principal, valor_desconto, valor_multa, valor_mora, dias_atraso,
            data_movimentacao, forma_pagamento_id, conta_banco_id,
            movimentacao_origem_id, observacoes, usuario_id, criado_em
        ) VALUES (
            :empresa_id, :lancamento_id, 'estorno', :valor,
            :valor_principal, :valor_desconto, :valor_multa, :valor_mora, :dias_atraso,
            :data_movimentacao, :forma_pagamento_id, :conta_banco_id,
            :origem_id, :observacoes, :usuario_id, NOW()
        ) RETURNING id
    """), {
        "empresa_id": empresa_id,
        "lancamento_id": origem["lancamento_id"],
        "valor": parse_money(origem["valor"]),
        "valor_principal": parse_money(origem.get("valor_principal") or origem["valor"]),
        "valor_desconto": parse_money(origem.get("valor_desconto")),
        "valor_multa": parse_money(origem.get("valor_multa")),
        "valor_mora": parse_money(origem.get("valor_mora")),
        "dias_atraso": int(origem.get("dias_atraso") or 0),
        "data_movimentacao": payload.data_estorno or date.today(),
        "forma_pagamento_id": origem.get("forma_pagamento_id"),
        "conta_banco_id": origem.get("conta_banco_id"),
        "origem_id": movimentacao_id,
        "observacoes": motivo,
        "usuario_id": int(usuario.id),
    }).first()
    calculado = recalcular_lancamento(db, empresa_id, int(origem["lancamento_id"]), int(usuario.id))
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="estornar",
        entidade="lancamento", entidade_id=int(origem["lancamento_id"]),
        anteriores=origem,
        novos={"movimentacao_estorno_id": int(estorno[0]), "movimentacao_origem_id": movimentacao_id, **calculado},
        motivo=motivo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, int(origem["lancamento_id"]))


@router.patch("/lancamentos/{lancamento_id}/cancelar")
def cancelar_lancamento(
    lancamento_id: int,
    payload: CancelamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    motivo = norm_str(payload.motivo)
    if not motivo:
        raise HTTPException(status_code=422, detail="O motivo do cancelamento é obrigatório.")
    anterior = obter_lancamento_para_update(db, empresa_id, lancamento_id)
    if anterior["status"] == "cancelado":
        raise HTTPException(status_code=409, detail="O lançamento já está cancelado.")
    if parse_money(anterior["valor_pago"]) > 0:
        raise HTTPException(status_code=409, detail="Estorne todas as baixas antes de cancelar o lançamento.")

    db.execute(text("""
        UPDATE public.financeiro_lancamentos
           SET status = 'cancelado',
               cancelado_por_usuario_id = :usuario_id,
               cancelado_em = NOW(),
               motivo_cancelamento = :motivo,
               atualizado_por_usuario_id = :usuario_id,
               atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id
    """), {
        "empresa_id": empresa_id, "id": lancamento_id,
        "usuario_id": int(usuario.id), "motivo": motivo,
    })
    novo = obter_lancamento_dict(db, empresa_id, lancamento_id)
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="cancelar",
        entidade="lancamento", entidade_id=lancamento_id,
        anteriores=anterior, novos=novo, motivo=motivo,
    )
    db.commit()
    return obter_lancamento_dict(db, empresa_id, lancamento_id)


@router.delete("/lancamentos/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    anterior = obter_lancamento_para_update(db, empresa_id, lancamento_id)
    if anterior.get("venda_pendente_id") is not None:
        raise HTTPException(status_code=409, detail="Título originado de venda autenticada não pode ser excluído. Use cancelamento para preservar o vínculo e a auditoria.")
    possui_movimentacoes = db.execute(text("""
        SELECT 1 FROM public.financeiro_movimentacoes
        WHERE empresa_id = :empresa_id AND lancamento_id = :id LIMIT 1
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if possui_movimentacoes:
        raise HTTPException(status_code=409, detail="Lançamento com movimentações não pode ser excluído. Use estorno e cancelamento.")
    possui_historico_cobranca = db.execute(text("""
        SELECT 1 FROM public.financeiro_cobrancas_envios
        WHERE empresa_id = :empresa_id AND lancamento_id = :id LIMIT 1
    """), {"empresa_id": empresa_id, "id": lancamento_id}).first()
    if possui_historico_cobranca:
        raise HTTPException(status_code=409, detail="Lançamento com histórico de cobrança não pode ser excluído. Use cancelamento para preservar a auditoria.")
    registrar_auditoria(
        db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="excluir",
        entidade="lancamento", entidade_id=lancamento_id, anteriores=anterior,
    )
    db.execute(text("DELETE FROM public.financeiro_lancamentos WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": lancamento_id})
    db.commit()
    return None


# =========================================================
# Fluxo de caixa e relatório
# =========================================================

@router.get("/fluxo-caixa")
def fluxo_caixa(
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    inicio = data_inicio or date.today().replace(day=1)
    fim = data_fim or (date.today() + timedelta(days=60))
    if fim < inicio:
        raise HTTPException(status_code=422, detail="A data final deve ser igual ou posterior à data inicial.")
    params = {"empresa_id": empresa_id, "data_inicio": inicio, "data_fim": fim}

    saldo_inicial_anterior = Decimal(str(db.execute(text("""
        SELECT COALESCE(SUM(saldo_inicial), 0)
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
          AND data_saldo_inicial < :data_inicio
    """), params).scalar() or 0))

    movimento_anterior = Decimal(str(db.execute(text("""
        SELECT COALESCE(SUM(
            CASE
                WHEN l.tipo = 'receber' THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                ELSE -1 * CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
            END
        ), 0)
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
          AND m.data_movimentacao < :data_inicio
    """), params).scalar() or 0))
    saldo_base = saldo_inicial_anterior + movimento_anterior

    previstos = db.execute(text("""
        SELECT
            data_vencimento AS data,
            COALESCE(SUM(CASE WHEN tipo = 'receber' THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS entradas_previstas,
            COALESCE(SUM(CASE WHEN tipo = 'pagar' THEN GREATEST(valor_total - valor_pago, 0) ELSE 0 END), 0) AS saidas_previstas
        FROM public.financeiro_lancamentos
        WHERE empresa_id = :empresa_id
          AND status <> 'cancelado'
          AND GREATEST(valor_total - valor_pago, 0) > 0
          AND data_vencimento BETWEEN :data_inicio AND :data_fim
        GROUP BY data_vencimento
    """), params).fetchall()

    realizados = db.execute(text("""
        SELECT
            m.data_movimentacao AS data,
            COALESCE(SUM(CASE WHEN l.tipo = 'receber'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END ELSE 0 END), 0) AS entradas_realizadas,
            COALESCE(SUM(CASE WHEN l.tipo = 'pagar'
                THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END ELSE 0 END), 0) AS saidas_realizadas
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
          AND m.data_movimentacao BETWEEN :data_inicio AND :data_fim
        GROUP BY m.data_movimentacao
    """), params).fetchall()

    saldos_no_periodo = db.execute(text("""
        SELECT
            data_saldo_inicial AS data,
            COALESCE(SUM(CASE WHEN saldo_inicial >= 0 THEN saldo_inicial ELSE 0 END), 0) AS entradas_realizadas,
            COALESCE(SUM(CASE WHEN saldo_inicial < 0 THEN ABS(saldo_inicial) ELSE 0 END), 0) AS saidas_realizadas
        FROM public.financeiro_contas_bancos
        WHERE empresa_id = :empresa_id
          AND data_saldo_inicial BETWEEN :data_inicio AND :data_fim
        GROUP BY data_saldo_inicial
    """), params).fetchall()

    por_data: Dict[date, Dict[str, Decimal]] = {}
    def bucket(d: date) -> Dict[str, Decimal]:
        return por_data.setdefault(d, {
            "entradas_previstas": Decimal("0"), "saidas_previstas": Decimal("0"),
            "entradas_realizadas": Decimal("0"), "saidas_realizadas": Decimal("0"),
        })

    for row in previstos:
        r = row_to_dict(row)
        d = date.fromisoformat(str(r["data"])[:10])
        bucket(d)["entradas_previstas"] += Decimal(str(r["entradas_previstas"] or 0))
        bucket(d)["saidas_previstas"] += Decimal(str(r["saidas_previstas"] or 0))
    for colecao in (realizados, saldos_no_periodo):
        for row in colecao:
            r = row_to_dict(row)
            d = date.fromisoformat(str(r["data"])[:10])
            bucket(d)["entradas_realizadas"] += Decimal(str(r["entradas_realizadas"] or 0))
            bucket(d)["saidas_realizadas"] += Decimal(str(r["saidas_realizadas"] or 0))

    saldo_previsto = saldo_base
    saldo_realizado = saldo_base
    items = []
    for d in sorted(por_data):
        valores = por_data[d]
        saldo_previsto += valores["entradas_previstas"] - valores["saidas_previstas"]
        saldo_realizado += valores["entradas_realizadas"] - valores["saidas_realizadas"]
        items.append({
            "data": d.isoformat(),
            **{k: float(v) for k, v in valores.items()},
            "saldo_previsto_acumulado": float(saldo_previsto),
            "saldo_realizado_acumulado": float(saldo_realizado),
        })
    return {"items": items, "saldo_inicial_periodo": float(saldo_base)}


@router.get("/relatorios/resumo")
def relatorio_resumo(
    data_inicio: Optional[date] = Query(default=None),
    data_fim: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    params = {
        "empresa_id": empresa_id,
        "data_inicio": data_inicio or date.today().replace(day=1),
        "data_fim": data_fim or (date.today() + timedelta(days=60)),
    }
    por_categoria = [row_to_dict(r) for r in db.execute(text("""
        SELECT
            l.tipo,
            COALESCE(cat.nome, 'Sem categoria') AS categoria,
            COUNT(*) AS quantidade,
            COALESCE(SUM(l.valor_total), 0) AS valor_total,
            COALESCE(SUM(l.valor_pago), 0) AS valor_pago,
            COALESCE(SUM(GREATEST(l.valor_total - l.valor_pago, 0)), 0) AS saldo_aberto
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_categorias cat
               ON cat.id = l.categoria_id AND cat.empresa_id = l.empresa_id
        WHERE l.empresa_id = :empresa_id
          AND l.data_vencimento BETWEEN :data_inicio AND :data_fim
          AND l.status <> 'cancelado'
        GROUP BY l.tipo, COALESCE(cat.nome, 'Sem categoria')
        ORDER BY l.tipo, valor_total DESC
    """), params).fetchall()]

    contas_receber_row = db.execute(text("""
        SELECT
            COALESCE(SUM(l.valor_total), 0) AS emitido_periodo,
            COALESCE(SUM(GREATEST(l.valor_total - l.valor_pago, 0)), 0) AS em_aberto_periodo,
            COALESCE(SUM(
                CASE WHEN l.data_vencimento < CURRENT_DATE
                     THEN GREATEST(l.valor_total - l.valor_pago, 0)
                     ELSE 0 END
            ), 0) AS vencido_periodo,
            COUNT(DISTINCT CASE
                WHEN l.data_vencimento < CURRENT_DATE
                 AND GREATEST(l.valor_total - l.valor_pago, 0) > 0
                THEN l.cliente_id END
            ) AS clientes_inadimplentes
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id = :empresa_id
          AND l.tipo = 'receber'
          AND l.data_vencimento BETWEEN :data_inicio AND :data_fim
          AND l.status <> 'cancelado'
    """), params).first()
    contas_receber = row_to_dict(contas_receber_row) if contas_receber_row else {}

    recebido_row = db.execute(text("""
        SELECT COALESCE(SUM(
            CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
        ), 0) AS recebido_periodo
        FROM public.financeiro_movimentacoes m
        JOIN public.financeiro_lancamentos l
          ON l.id = m.lancamento_id
         AND l.empresa_id = m.empresa_id
        WHERE m.empresa_id = :empresa_id
          AND l.tipo = 'receber'
          AND m.data_movimentacao BETWEEN :data_inicio AND :data_fim
    """), params).first()
    recebido = row_to_dict(recebido_row) if recebido_row else {}
    contas_receber["recebido_periodo"] = recebido.get("recebido_periodo", 0)

    por_tipo_gasto = [row_to_dict(r) for r in db.execute(text("""
        SELECT COALESCE(tg.nome, 'Sem tipo de gasto') AS tipo_gasto, COUNT(*) AS quantidade,
               COALESCE(SUM(l.valor_total), 0) AS valor_total,
               COALESCE(SUM(l.valor_pago), 0) AS valor_pago,
               COALESCE(SUM(GREATEST(l.valor_total-l.valor_pago, 0)), 0) AS saldo_aberto
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_tipos_gasto tg
               ON tg.id=l.tipo_gasto_id AND tg.empresa_id=l.empresa_id
        WHERE l.empresa_id=:empresa_id AND l.tipo='pagar'
          AND l.data_vencimento BETWEEN :data_inicio AND :data_fim
          AND l.status <> 'cancelado'
        GROUP BY COALESCE(tg.nome, 'Sem tipo de gasto')
        ORDER BY valor_total DESC
    """), params).fetchall()]

    por_centro_custo = [row_to_dict(r) for r in db.execute(text("""
        SELECT COALESCE(ccp.nome, 'Sem centro de custo') AS centro_custo,
               COALESCE(ccs.nome, '-') AS subcentro, COUNT(*) AS quantidade,
               COALESCE(SUM(l.valor_total), 0) AS valor_total,
               COALESCE(SUM(l.valor_pago), 0) AS valor_pago,
               COALESCE(SUM(GREATEST(l.valor_total-l.valor_pago, 0)), 0) AS saldo_aberto
        FROM public.financeiro_lancamentos l
        LEFT JOIN public.financeiro_centros_custo ccp
               ON ccp.id=l.centro_custo_principal_id AND ccp.empresa_id=l.empresa_id
        LEFT JOIN public.financeiro_centros_custo ccs
               ON ccs.id=l.centro_custo_secundario_id AND ccs.empresa_id=l.empresa_id
        WHERE l.empresa_id=:empresa_id
          AND l.data_vencimento BETWEEN :data_inicio AND :data_fim
          AND l.status <> 'cancelado'
        GROUP BY COALESCE(ccp.nome, 'Sem centro de custo'), COALESCE(ccs.nome, '-')
        ORDER BY valor_total DESC
    """), params).fetchall()]

    return {
        "por_categoria": por_categoria,
        "por_tipo_gasto": por_tipo_gasto,
        "por_centro_custo": por_centro_custo,
        "contas_receber": contas_receber,
    }


# =========================================================
# Cadastros auxiliares
# =========================================================

def listar_auxiliar(table_name: str, empresa_id: int, db: Session):
    permitidas = {
        "financeiro_categorias", "financeiro_formas_pagamento",
        "financeiro_tipos_documento", "financeiro_naturezas_operacao", "financeiro_tipos_gasto",
        "financeiro_centros_custo", "financeiro_unidades_consumo",
        "financeiro_contas_contabeis", "financeiro_formas_cobranca",
        "financeiro_regras_encargos",
    }
    if table_name not in permitidas:
        raise RuntimeError("Tabela auxiliar não permitida.")
    rows = db.execute(text(f"SELECT * FROM public.{table_name} WHERE empresa_id = :empresa_id ORDER BY ativo DESC, nome ASC, id ASC"), {"empresa_id": empresa_id}).fetchall()
    return [row_to_dict(r) for r in rows]


def excluir_auxiliar(table_name: str, item_id: int, empresa_id: int, db: Session, usuario_id: int):
    permitidas = {
        "financeiro_categorias", "financeiro_formas_pagamento", "financeiro_contas_bancos",
        "financeiro_tipos_documento", "financeiro_naturezas_operacao", "financeiro_tipos_gasto",
        "financeiro_centros_custo", "financeiro_unidades_consumo",
        "financeiro_contas_contabeis", "financeiro_formas_cobranca",
        "financeiro_regras_encargos",
    }
    if table_name not in permitidas:
        raise RuntimeError("Tabela auxiliar não permitida.")
    anterior_row = db.execute(text(f"SELECT * FROM public.{table_name} WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado.")
    anterior = row_to_dict(anterior_row)
    try:
        db.execute(text(f"DELETE FROM public.{table_name} WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id})
        registrar_auditoria(
            db, empresa_id=empresa_id, usuario_id=usuario_id, acao="excluir",
            entidade=table_name, entidade_id=item_id, anteriores=anterior,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Este cadastro já está sendo usado e não pode ser excluído.") from exc
    return None


@router.get("/categorias")
def listar_categorias(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_categorias", empresa_do(usuario), db)


@router.post("/categorias", status_code=status.HTTP_201_CREATED)
def criar_categoria(payload: CategoriaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    tipo = (payload.tipo or "ambos").strip().lower()
    if tipo not in {"receita", "despesa", "ambos"}:
        raise HTTPException(status_code=422, detail="Tipo de categoria inválido.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_categorias (empresa_id, nome, tipo, cor, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :cor, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_categorias", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    return novo


@router.put("/categorias/{item_id}")
def atualizar_categoria(item_id: int, payload: CategoriaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_categorias WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    tipo = (payload.tipo or "ambos").strip().lower()
    if tipo not in {"receita", "despesa", "ambos"}:
        raise HTTPException(status_code=422, detail="Tipo de categoria inválido.")
    row = db.execute(text("""
        UPDATE public.financeiro_categorias
           SET nome = :nome, tipo = :tipo, cor = :cor, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": tipo, "cor": norm_str(payload.cor), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_categorias", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/categorias/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_categoria(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_categorias", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/formas-pagamento")
def listar_formas(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_formas_pagamento", empresa_do(usuario), db)


@router.post("/formas-pagamento", status_code=status.HTTP_201_CREATED)
def criar_forma(payload: FormaPagamentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_formas_pagamento (empresa_id, nome, tipo, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_formas_pagamento", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    return novo


@router.put("/formas-pagamento/{item_id}")
def atualizar_forma(item_id: int, payload: FormaPagamentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_formas_pagamento WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Forma de pagamento não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_formas_pagamento
           SET nome = :nome, tipo = :tipo, ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": payload.nome.strip(), "tipo": norm_str(payload.tipo), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_formas_pagamento", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/formas-pagamento/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_forma(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_formas_pagamento", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/contas-bancos")
def listar_contas_bancos(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    rows = db.execute(text("""
        SELECT
            cb.*,
            cb.saldo_inicial + COALESCE((
                SELECT SUM(
                    CASE
                        WHEN l.tipo = 'receber' THEN CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                        ELSE -1 * CASE WHEN m.tipo_movimentacao = 'baixa' THEN m.valor ELSE -m.valor END
                    END
                )
                FROM public.financeiro_movimentacoes m
                JOIN public.financeiro_lancamentos l
                  ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
                WHERE m.empresa_id = cb.empresa_id
                  AND m.conta_banco_id = cb.id
                  AND m.data_movimentacao >= cb.data_saldo_inicial
            ), 0) AS saldo_atual
        FROM public.financeiro_contas_bancos cb
        WHERE cb.empresa_id = :empresa_id
        ORDER BY cb.ativo DESC, cb.nome ASC, cb.id ASC
    """), {"empresa_id": empresa_id}).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/contas-bancos", status_code=status.HTTP_201_CREATED)
def criar_conta_banco(payload: ContaBancoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_contas_bancos (
            empresa_id, nome, banco, agencia, conta, saldo_inicial,
            data_saldo_inicial, ativo, criado_em, atualizado_em
        ) VALUES (
            :empresa_id, :nome, :banco, :agencia, :conta, :saldo_inicial,
            :data_saldo_inicial, :ativo, NOW(), NOW()
        ) RETURNING *
    """), {
        "empresa_id": empresa_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "data_saldo_inicial": payload.data_saldo_inicial or date.today(),
        "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="criar", entidade="financeiro_contas_bancos", entidade_id=int(novo["id"]), novos=novo)
    db.commit()
    novo["saldo_atual"] = novo["saldo_inicial"]
    return novo


@router.put("/contas-bancos/{item_id}")
def atualizar_conta_banco(item_id: int, payload: ContaBancoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_contas_bancos WHERE empresa_id = :empresa_id AND id = :id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Conta/Banco não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_contas_bancos
           SET nome = :nome, banco = :banco, agencia = :agencia, conta = :conta,
               saldo_inicial = :saldo_inicial, data_saldo_inicial = :data_saldo_inicial,
               ativo = :ativo, atualizado_em = NOW()
         WHERE empresa_id = :empresa_id AND id = :id RETURNING *
    """), {
        "empresa_id": empresa_id,
        "id": item_id,
        "nome": payload.nome.strip(),
        "banco": norm_str(payload.banco),
        "agencia": norm_str(payload.agencia),
        "conta": norm_str(payload.conta),
        "saldo_inicial": parse_money(payload.saldo_inicial),
        "data_saldo_inicial": payload.data_saldo_inicial or date.today(),
        "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    registrar_auditoria(db, empresa_id=empresa_id, usuario_id=int(usuario.id), acao="editar", entidade="financeiro_contas_bancos", entidade_id=item_id, anteriores=row_to_dict(anterior_row), novos=novo)
    db.commit()
    return novo


@router.delete("/contas-bancos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_conta_banco(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_contas_bancos", item_id, empresa_do(usuario), db, int(usuario.id))


# =========================================================
# Cadastros financeiros configuráveis (Fase 3)
# =========================================================

def _nome_obrigatorio(value: str, label: str = "Nome") -> str:
    value_norm = (value or "").strip()
    if not value_norm:
        raise HTTPException(status_code=422, detail=f"{label} é obrigatório.")
    return value_norm


def _aplicacao(value: str) -> str:
    value_norm = (value or "ambos").strip().lower()
    if value_norm not in {"pagar", "receber", "ambos"}:
        raise HTTPException(status_code=422, detail="Aplicação deve ser pagar, receber ou ambos.")
    return value_norm


def _percentual(value: Any, label: str) -> Decimal:
    parsed = parse_percentage(value)
    if parsed < 0 or parsed > 100:
        raise HTTPException(status_code=422, detail=f"{label} deve ficar entre 0% e 100%.")
    return parsed


def _auditar_salvar_auxiliar(db: Session, usuario: models.Usuario, entidade: str, item_id: int, anterior: Optional[Dict[str, Any]], novo: Dict[str, Any]) -> None:
    registrar_auditoria(
        db,
        empresa_id=empresa_do(usuario),
        usuario_id=int(usuario.id),
        acao="editar" if anterior else "criar",
        entidade=entidade,
        entidade_id=item_id,
        anteriores=anterior,
        novos=novo,
    )


def _validar_hierarquia_sem_ciclo(
    db: Session,
    *,
    table_name: str,
    parent_column: str,
    item_id: int,
    parent_id: Optional[int],
    empresa_id: int,
    label: str,
) -> None:
    if parent_id is None:
        return
    permitidas = {
        ("financeiro_centros_custo", "centro_pai_id"),
        ("financeiro_unidades_consumo", "unidade_pai_id"),
        ("financeiro_contas_contabeis", "conta_pai_id"),
    }
    if (table_name, parent_column) not in permitidas:
        raise RuntimeError("Hierarquia financeira não permitida.")
    forma_ciclo = db.execute(text(f"""
        WITH RECURSIVE descendentes AS (
            SELECT id
              FROM public.{table_name}
             WHERE empresa_id = :empresa_id AND id = :item_id
            UNION ALL
            SELECT filho.id
              FROM public.{table_name} filho
              JOIN descendentes pai ON filho.{parent_column} = pai.id
             WHERE filho.empresa_id = :empresa_id
        )
        SELECT 1 FROM descendentes WHERE id = :parent_id LIMIT 1
    """), {
        "empresa_id": empresa_id,
        "item_id": item_id,
        "parent_id": parent_id,
    }).first()
    if forma_ciclo:
        raise HTTPException(status_code=422, detail=f"{label} criaria uma hierarquia circular.")


@router.get("/tipos-documento")
def listar_tipos_documento(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_tipos_documento", empresa_do(usuario), db)


@router.post("/tipos-documento", status_code=status.HTTP_201_CREATED)
def criar_tipo_documento(payload: TipoDocumentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_tipos_documento
            (empresa_id, codigo, nome, aplicacao, exige_entidade_emissora, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :aplicacao, :exige, :ativo, NOW(), NOW())
        RETURNING *
    """), {
        "empresa_id": empresa_id, "codigo": norm_str(payload.codigo),
        "nome": _nome_obrigatorio(payload.nome), "aplicacao": _aplicacao(payload.aplicacao),
        "exige": payload.exige_entidade_emissora, "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_tipos_documento", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/tipos-documento/{item_id}")
def atualizar_tipo_documento(item_id: int, payload: TipoDocumentoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_tipos_documento WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Tipo de documento não encontrado.")
    row = db.execute(text("""
        UPDATE public.financeiro_tipos_documento SET codigo=:codigo, nome=:nome, aplicacao=:aplicacao,
            exige_entidade_emissora=:exige, ativo=:ativo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {
        "empresa_id": empresa_id, "id": item_id, "codigo": norm_str(payload.codigo),
        "nome": _nome_obrigatorio(payload.nome), "aplicacao": _aplicacao(payload.aplicacao),
        "exige": payload.exige_entidade_emissora, "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_tipos_documento", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/tipos-documento/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_tipo_documento(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_tipos_documento", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/naturezas-operacao")
def listar_naturezas_operacao(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_naturezas_operacao", empresa_do(usuario), db)


@router.post("/naturezas-operacao", status_code=status.HTTP_201_CREATED)
def criar_natureza_operacao(payload: NaturezaOperacaoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_naturezas_operacao
            (empresa_id, codigo, nome, aplicacao, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :aplicacao, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "aplicacao": _aplicacao(payload.aplicacao), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_naturezas_operacao", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/naturezas-operacao/{item_id}")
def atualizar_natureza_operacao(item_id: int, payload: NaturezaOperacaoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_naturezas_operacao WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Natureza da operação não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_naturezas_operacao SET codigo=:codigo, nome=:nome, aplicacao=:aplicacao,
            ativo=:ativo, atualizado_em=NOW() WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "aplicacao": _aplicacao(payload.aplicacao), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_naturezas_operacao", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/naturezas-operacao/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_natureza_operacao(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_naturezas_operacao", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/tipos-gasto")
def listar_tipos_gasto(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_tipos_gasto", empresa_do(usuario), db)


@router.post("/tipos-gasto", status_code=status.HTTP_201_CREATED)
def criar_tipo_gasto(payload: TipoGastoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    row = db.execute(text("""
        INSERT INTO public.financeiro_tipos_gasto
            (empresa_id, codigo, nome, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :ativo, NOW(), NOW()) RETURNING *
    """), {
        "empresa_id": empresa_id, "codigo": norm_str(payload.codigo),
        "nome": _nome_obrigatorio(payload.nome), "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_tipos_gasto", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/tipos-gasto/{item_id}")
def atualizar_tipo_gasto(item_id: int, payload: TipoGastoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_tipos_gasto WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Tipo de gasto não encontrado.")
    row = db.execute(text("""
        UPDATE public.financeiro_tipos_gasto
           SET codigo=:codigo, nome=:nome, ativo=:ativo, atualizado_em=NOW()
         WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {
        "empresa_id": empresa_id, "id": item_id, "codigo": norm_str(payload.codigo),
        "nome": _nome_obrigatorio(payload.nome), "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_tipos_gasto", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/tipos-gasto/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_tipo_gasto(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_tipos_gasto", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/centros-custo")
def listar_centros_custo(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    rows = db.execute(text("""
        SELECT cc.*, pai.nome AS centro_pai_nome
        FROM public.financeiro_centros_custo cc
        LEFT JOIN public.financeiro_centros_custo pai ON pai.id=cc.centro_pai_id AND pai.empresa_id=cc.empresa_id
        WHERE cc.empresa_id=:empresa_id ORDER BY cc.ativo DESC, cc.codigo NULLS LAST, cc.nome, cc.id
    """), {"empresa_id": empresa_do(usuario)}).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/centros-custo", status_code=status.HTTP_201_CREATED)
def criar_centro_custo(payload: CentroCustoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    validar_id_empresa(db, table_name="financeiro_centros_custo", item_id=payload.centro_pai_id, empresa_id=empresa_id, label="Centro de custo pai")
    row = db.execute(text("""
        INSERT INTO public.financeiro_centros_custo
            (empresa_id, codigo, nome, centro_pai_id, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :pai, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "pai": payload.centro_pai_id, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_centros_custo", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/centros-custo/{item_id}")
def atualizar_centro_custo(item_id: int, payload: CentroCustoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    if payload.centro_pai_id == item_id:
        raise HTTPException(status_code=422, detail="Um centro de custo não pode ser pai de si mesmo.")
    validar_id_empresa(db, table_name="financeiro_centros_custo", item_id=payload.centro_pai_id, empresa_id=empresa_id, label="Centro de custo pai")
    _validar_hierarquia_sem_ciclo(
        db, table_name="financeiro_centros_custo", parent_column="centro_pai_id",
        item_id=item_id, parent_id=payload.centro_pai_id, empresa_id=empresa_id,
        label="O centro de custo pai selecionado",
    )
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_centros_custo WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado.")
    row = db.execute(text("""
        UPDATE public.financeiro_centros_custo SET codigo=:codigo, nome=:nome, centro_pai_id=:pai,
            ativo=:ativo, atualizado_em=NOW() WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "pai": payload.centro_pai_id, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_centros_custo", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/centros-custo/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_centro_custo(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_centros_custo", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/unidades-consumo")
def listar_unidades_consumo(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    rows = db.execute(text("""
        SELECT u.*, pai.codigo AS unidade_pai_codigo, pai.nome AS unidade_pai_nome
        FROM public.financeiro_unidades_consumo u
        LEFT JOIN public.financeiro_unidades_consumo pai
               ON pai.id=u.unidade_pai_id AND pai.empresa_id=u.empresa_id
        WHERE u.empresa_id=:empresa_id
        ORDER BY u.ativo DESC, COALESCE(pai.nome, u.nome), u.unidade_pai_id NULLS FIRST, u.nome, u.id
    """), {"empresa_id": empresa_do(usuario)}).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/unidades-consumo", status_code=status.HTTP_201_CREATED)
def criar_unidade_consumo(payload: UnidadeConsumoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    validar_id_empresa(db, table_name="financeiro_unidades_consumo", item_id=payload.unidade_pai_id, empresa_id=empresa_id, label="Unidade de consumo pai")
    tipo_ref = (payload.tipo_referencia or "outro").strip().lower()
    if tipo_ref not in {"departamento", "colaborador", "veiculo", "patrimonio", "projeto", "contrato", "cargo", "outro"}:
        raise HTTPException(status_code=422, detail="Tipo de referência da unidade de consumo inválido.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_unidades_consumo
            (empresa_id, codigo, nome, tipo_referencia, unidade_pai_id, departamento_referencia, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :tipo_ref, :pai, :departamento, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "tipo_ref": tipo_ref, "pai": payload.unidade_pai_id, "departamento": norm_str(payload.departamento_referencia), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_unidades_consumo", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/unidades-consumo/{item_id}")
def atualizar_unidade_consumo(item_id: int, payload: UnidadeConsumoIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    if payload.unidade_pai_id == item_id:
        raise HTTPException(status_code=422, detail="Uma unidade de consumo não pode ser pai de si mesma.")
    validar_id_empresa(db, table_name="financeiro_unidades_consumo", item_id=payload.unidade_pai_id, empresa_id=empresa_id, label="Unidade de consumo pai")
    _validar_hierarquia_sem_ciclo(
        db, table_name="financeiro_unidades_consumo", parent_column="unidade_pai_id",
        item_id=item_id, parent_id=payload.unidade_pai_id, empresa_id=empresa_id,
        label="A unidade de consumo pai selecionada",
    )
    tipo_ref = (payload.tipo_referencia or "outro").strip().lower()
    if tipo_ref not in {"departamento", "colaborador", "veiculo", "patrimonio", "projeto", "contrato", "cargo", "outro"}:
        raise HTTPException(status_code=422, detail="Tipo de referência da unidade de consumo inválido.")
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_unidades_consumo WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Unidade de consumo não encontrada.")
    row = db.execute(text("""
        UPDATE public.financeiro_unidades_consumo SET codigo=:codigo, nome=:nome,
            tipo_referencia=:tipo_ref, unidade_pai_id=:pai,
            departamento_referencia=:departamento, ativo=:ativo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "codigo": norm_str(payload.codigo), "nome": _nome_obrigatorio(payload.nome), "tipo_ref": tipo_ref, "pai": payload.unidade_pai_id, "departamento": norm_str(payload.departamento_referencia), "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_unidades_consumo", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/unidades-consumo/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_unidade_consumo(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_unidades_consumo", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/contas-contabeis")
def listar_contas_contabeis(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    rows = db.execute(text("""
        SELECT cc.*, pai.codigo AS conta_pai_codigo, pai.nome AS conta_pai_nome
        FROM public.financeiro_contas_contabeis cc
        LEFT JOIN public.financeiro_contas_contabeis pai ON pai.id=cc.conta_pai_id AND pai.empresa_id=cc.empresa_id
        WHERE cc.empresa_id=:empresa_id ORDER BY cc.ativo DESC, cc.codigo, cc.nome, cc.id
    """), {"empresa_id": empresa_do(usuario)}).fetchall()
    return [row_to_dict(r) for r in rows]


@router.post("/contas-contabeis", status_code=status.HTTP_201_CREATED)
def criar_conta_contabil(payload: ContaContabilIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    validar_id_empresa(db, table_name="financeiro_contas_contabeis", item_id=payload.conta_pai_id, empresa_id=empresa_id, label="Conta contábil pai")
    tipo = (payload.tipo or "outros").strip().lower()
    if tipo not in {"ativo", "passivo", "receita", "despesa", "patrimonio", "outros"}:
        raise HTTPException(status_code=422, detail="Tipo de conta contábil inválido.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_contas_contabeis
            (empresa_id, codigo, nome, tipo, conta_pai_id, aceita_lancamento, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :codigo, :nome, :tipo, :pai, :aceita, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "codigo": _nome_obrigatorio(payload.codigo, "Código"), "nome": _nome_obrigatorio(payload.nome), "tipo": tipo, "pai": payload.conta_pai_id, "aceita": payload.aceita_lancamento, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_contas_contabeis", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/contas-contabeis/{item_id}")
def atualizar_conta_contabil(item_id: int, payload: ContaContabilIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    if payload.conta_pai_id == item_id:
        raise HTTPException(status_code=422, detail="Uma conta contábil não pode ser pai de si mesma.")
    validar_id_empresa(db, table_name="financeiro_contas_contabeis", item_id=payload.conta_pai_id, empresa_id=empresa_id, label="Conta contábil pai")
    _validar_hierarquia_sem_ciclo(
        db, table_name="financeiro_contas_contabeis", parent_column="conta_pai_id",
        item_id=item_id, parent_id=payload.conta_pai_id, empresa_id=empresa_id,
        label="A conta contábil pai selecionada",
    )
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_contas_contabeis WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Conta contábil não encontrada.")
    tipo = (payload.tipo or "outros").strip().lower()
    if tipo not in {"ativo", "passivo", "receita", "despesa", "patrimonio", "outros"}:
        raise HTTPException(status_code=422, detail="Tipo de conta contábil inválido.")
    row = db.execute(text("""
        UPDATE public.financeiro_contas_contabeis SET codigo=:codigo, nome=:nome, tipo=:tipo,
            conta_pai_id=:pai, aceita_lancamento=:aceita, ativo=:ativo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "codigo": _nome_obrigatorio(payload.codigo, "Código"), "nome": _nome_obrigatorio(payload.nome), "tipo": tipo, "pai": payload.conta_pai_id, "aceita": payload.aceita_lancamento, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_contas_contabeis", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/contas-contabeis/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_conta_contabil(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_contas_contabeis", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/formas-cobranca")
def listar_formas_cobranca(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_formas_cobranca", empresa_do(usuario), db)


@router.post("/formas-cobranca", status_code=status.HTTP_201_CREATED)
def criar_forma_cobranca(payload: FormaCobrancaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    tipo = (payload.tipo or "outro").strip().lower()
    permitidos = {"carteira", "pix", "promissoria", "boleto", "cartao_credito", "debito_conta", "deposito", "outro"}
    if tipo not in permitidos:
        raise HTTPException(status_code=422, detail="Tipo de forma de cobrança inválido.")
    row = db.execute(text("""
        INSERT INTO public.financeiro_formas_cobranca (empresa_id, nome, tipo, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :tipo, :ativo, NOW(), NOW()) RETURNING *
    """), {"empresa_id": empresa_id, "nome": _nome_obrigatorio(payload.nome), "tipo": tipo, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_formas_cobranca", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/formas-cobranca/{item_id}")
def atualizar_forma_cobranca(item_id: int, payload: FormaCobrancaIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_formas_cobranca WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Forma de cobrança não encontrada.")
    tipo = (payload.tipo or "outro").strip().lower()
    permitidos = {"carteira", "pix", "promissoria", "boleto", "cartao_credito", "debito_conta", "deposito", "outro"}
    if tipo not in permitidos:
        raise HTTPException(status_code=422, detail="Tipo de forma de cobrança inválido.")
    row = db.execute(text("""
        UPDATE public.financeiro_formas_cobranca SET nome=:nome, tipo=:tipo, ativo=:ativo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {"empresa_id": empresa_id, "id": item_id, "nome": _nome_obrigatorio(payload.nome), "tipo": tipo, "ativo": payload.ativo}).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_formas_cobranca", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/formas-cobranca/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_forma_cobranca(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_formas_cobranca", item_id, empresa_do(usuario), db, int(usuario.id))


@router.get("/regras-encargos")
def listar_regras_encargos(db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return listar_auxiliar("financeiro_regras_encargos", empresa_do(usuario), db)


@router.post("/regras-encargos", status_code=status.HTTP_201_CREATED)
def criar_regra_encargos(payload: RegraEncargosIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    if payload.padrao:
        db.execute(text("UPDATE public.financeiro_regras_encargos SET padrao=FALSE, atualizado_em=NOW() WHERE empresa_id=:empresa_id AND aplicacao=:aplicacao"), {"empresa_id": empresa_id, "aplicacao": _aplicacao(payload.aplicacao)})
    row = db.execute(text("""
        INSERT INTO public.financeiro_regras_encargos
            (empresa_id, nome, aplicacao, possui_multa, indice_multa_percent,
             possui_mora_diaria, indice_mora_diaria_percent, padrao, ativo, criado_em, atualizado_em)
        VALUES (:empresa_id, :nome, :aplicacao, :multa, :indice_multa, :mora, :indice_mora, :padrao, :ativo, NOW(), NOW()) RETURNING *
    """), {
        "empresa_id": empresa_id, "nome": _nome_obrigatorio(payload.nome), "aplicacao": _aplicacao(payload.aplicacao),
        "multa": payload.possui_multa, "indice_multa": _percentual(payload.indice_multa_percent, "Índice de multa") if payload.possui_multa else Decimal("0"),
        "mora": payload.possui_mora_diaria, "indice_mora": _percentual(payload.indice_mora_diaria_percent, "Índice de mora diária") if payload.possui_mora_diaria else Decimal("0"),
        "padrao": payload.padrao, "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_regras_encargos", int(novo["id"]), None, novo)
    db.commit()
    return novo


@router.put("/regras-encargos/{item_id}")
def atualizar_regra_encargos(item_id: int, payload: RegraEncargosIn, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    empresa_id = empresa_do(usuario)
    anterior_row = db.execute(text("SELECT * FROM public.financeiro_regras_encargos WHERE empresa_id=:empresa_id AND id=:id"), {"empresa_id": empresa_id, "id": item_id}).first()
    if not anterior_row:
        raise HTTPException(status_code=404, detail="Regra de multa e mora não encontrada.")
    aplicacao = _aplicacao(payload.aplicacao)
    if payload.padrao:
        db.execute(text("UPDATE public.financeiro_regras_encargos SET padrao=FALSE, atualizado_em=NOW() WHERE empresa_id=:empresa_id AND aplicacao=:aplicacao AND id<>:id"), {"empresa_id": empresa_id, "aplicacao": aplicacao, "id": item_id})
    row = db.execute(text("""
        UPDATE public.financeiro_regras_encargos SET nome=:nome, aplicacao=:aplicacao,
            possui_multa=:multa, indice_multa_percent=:indice_multa,
            possui_mora_diaria=:mora, indice_mora_diaria_percent=:indice_mora,
            padrao=:padrao, ativo=:ativo, atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:id RETURNING *
    """), {
        "empresa_id": empresa_id, "id": item_id, "nome": _nome_obrigatorio(payload.nome), "aplicacao": aplicacao,
        "multa": payload.possui_multa, "indice_multa": _percentual(payload.indice_multa_percent, "Índice de multa") if payload.possui_multa else Decimal("0"),
        "mora": payload.possui_mora_diaria, "indice_mora": _percentual(payload.indice_mora_diaria_percent, "Índice de mora diária") if payload.possui_mora_diaria else Decimal("0"),
        "padrao": payload.padrao, "ativo": payload.ativo,
    }).first()
    novo = row_to_dict(row)
    _auditar_salvar_auxiliar(db, usuario, "financeiro_regras_encargos", item_id, row_to_dict(anterior_row), novo)
    db.commit()
    return novo


@router.delete("/regras-encargos/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_regra_encargos(item_id: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(get_current_user)):
    return excluir_auxiliar("financeiro_regras_encargos", item_id, empresa_do(usuario), db, int(usuario.id))

# =========================================================
# Contratos recorrentes
# =========================================================

STATUS_RECORRENCIA_LABELS = {
    "nao_configurado": "Não configurado",
    "configurado": "Configurado",
    "ativo": "Ativo",
    "suspenso": "Suspenso",
    "cancelado": "Cancelado",
}

FREQUENCIA_LABELS = {
    "mensal": "Mensal",
    "bimestral": "Bimestral",
    "trimestral": "Trimestral",
    "semestral": "Semestral",
    "anual": "Anual",
}


def garantir_estrutura_recorrencia(db: Session) -> None:
    if not estrutura_recorrencia_disponivel(db):
        raise HTTPException(
            status_code=500,
            detail="Estrutura de contratos recorrentes ausente. Execute sql/financeiro/006_contratos_recorrentes.sql.",
        )


def _usuario_nome_financeiro(usuario: models.Usuario) -> str:
    return str(
        getattr(usuario, "nome", None)
        or getattr(usuario, "email", None)
        or f"Usuário #{getattr(usuario, 'id', '')}"
    )


def registrar_historico_recorrencia(
    db: Session,
    *,
    contrato: Dict[str, Any],
    usuario: models.Usuario,
    descricao: str,
    campo: Optional[str] = None,
    anterior: Optional[str] = None,
    novo: Optional[str] = None,
) -> None:
    db.execute(text("""
        INSERT INTO public.contratos_historico_alteracoes (
            empresa_id, contrato_id, cliente_id, usuario_id, usuario_nome,
            tipo, campo, valor_anterior, valor_novo, descricao, criado_em
        ) VALUES (
            :empresa_id, :contrato_id, :cliente_id, :usuario_id, :usuario_nome,
            'financeiro_recorrencia', :campo, :anterior, :novo, :descricao, NOW()
        )
    """), {
        "empresa_id": int(contrato["empresa_id"]),
        "contrato_id": int(contrato["id"]),
        "cliente_id": int(contrato["cliente_id"]),
        "usuario_id": int(usuario.id),
        "usuario_nome": _usuario_nome_financeiro(usuario),
        "campo": campo,
        "anterior": anterior,
        "novo": novo,
        "descricao": descricao,
    })


def buscar_contrato_recorrencia(
    db: Session,
    *,
    empresa_id: int,
    contrato_id: int,
    lock: bool = False,
) -> Dict[str, Any]:
    garantir_estrutura_recorrencia(db)
    lock_sql = " FOR UPDATE OF c" if lock else ""
    row = db.execute(text("""
        SELECT
            c.*,
            cl.nome AS cliente_nome,
            fc.nome AS financeiro_forma_cobranca_nome,
            fp.nome AS financeiro_forma_pagamento_nome,
            cb.nome AS financeiro_conta_banco_nome,
            cat.nome AS financeiro_categoria_nome,
            cc.codigo AS financeiro_conta_contabil_codigo,
            cc.nome AS financeiro_conta_contabil_nome,
            td.nome AS financeiro_tipo_documento_nome,
            no.nome AS financeiro_natureza_operacao_nome,
            ccp.nome AS financeiro_centro_custo_principal_nome,
            ccs.nome AS financeiro_centro_custo_secundario_nome,
            ucp.nome AS financeiro_unidade_consumo_principal_nome,
            ucs.nome AS financeiro_unidade_consumo_secundaria_nome,
            re.nome AS financeiro_regra_encargos_nome,
            ee.nome AS financeiro_entidade_emissora_nome
        FROM public.contratos c
        JOIN public.clientes cl ON cl.id=c.cliente_id AND cl.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_formas_cobranca fc ON fc.id=c.financeiro_forma_cobranca_id AND fc.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_formas_pagamento fp ON fp.id=c.financeiro_forma_pagamento_id AND fp.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_contas_bancos cb ON cb.id=c.financeiro_conta_banco_id AND cb.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_categorias cat ON cat.id=c.financeiro_categoria_id AND cat.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_contas_contabeis cc ON cc.id=c.financeiro_conta_contabil_id AND cc.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_tipos_documento td ON td.id=c.financeiro_tipo_documento_id AND td.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_naturezas_operacao no ON no.id=c.financeiro_natureza_operacao_id AND no.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_centros_custo ccp ON ccp.id=c.financeiro_centro_custo_principal_id AND ccp.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_centros_custo ccs ON ccs.id=c.financeiro_centro_custo_secundario_id AND ccs.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_unidades_consumo ucp ON ucp.id=c.financeiro_unidade_consumo_principal_id AND ucp.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_unidades_consumo ucs ON ucs.id=c.financeiro_unidade_consumo_secundaria_id AND ucs.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_regras_encargos re ON re.id=c.financeiro_regra_encargos_id AND re.empresa_id=c.empresa_id
        LEFT JOIN public.financeiro_contas_bancos ee ON ee.id=c.financeiro_entidade_emissora_id AND ee.empresa_id=c.empresa_id
        WHERE c.empresa_id=:empresa_id AND c.id=:contrato_id
    """ + lock_sql), {"empresa_id": empresa_id, "contrato_id": contrato_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contrato não encontrado.")
    return dict(row)


def configuracao_recorrencia_completa(contrato: Dict[str, Any]) -> bool:
    campos = (
        "financeiro_frequencia",
        "financeiro_intervalo_meses",
        "financeiro_primeiro_vencimento",
        "financeiro_dia_vencimento",
        "financeiro_forma_cobranca_id",
        "financeiro_conta_banco_id",
        "financeiro_categoria_id",
        "financeiro_conta_contabil_id",
    )
    return Decimal(str(contrato.get("valor_mensal") or 0)) > 0 and all(
        contrato.get(campo) not in (None, "") for campo in campos
    )


def recorrencia_to_out(db: Session, contrato: Dict[str, Any]) -> Dict[str, Any]:
    empresa_id = int(contrato["empresa_id"])
    contrato_id = int(contrato["id"])
    resumo = row_to_dict(db.execute(text(f"""
        SELECT
            COUNT(*) AS total_titulos,
            COUNT(*) FILTER (WHERE ({status_efetivo_sql('l')}) <> 'cancelado') AS titulos_ativos,
            COUNT(*) FILTER (WHERE ({status_efetivo_sql('l')}) IN ('aberto', 'vencido', 'parcial')) AS titulos_em_aberto,
            COALESCE(SUM(GREATEST(l.valor_total - l.valor_pago, 0))
                FILTER (WHERE ({status_efetivo_sql('l')}) <> 'cancelado'), 0) AS saldo_em_aberto,
            COALESCE(SUM(l.valor_pago)
                FILTER (WHERE ({status_efetivo_sql('l')}) <> 'cancelado'), 0) AS total_recebido,
            MIN(l.data_vencimento)
                FILTER (WHERE ({status_efetivo_sql('l')}) IN ('aberto', 'vencido', 'parcial')) AS proximo_titulo_vencimento
        FROM public.financeiro_lancamentos l
        WHERE l.empresa_id=:empresa_id AND l.contrato_id=:contrato_id
    """), {"empresa_id": empresa_id, "contrato_id": contrato_id}).first())
    titulos = [row_to_dict(row) for row in db.execute(text(LANCAMENTO_SELECT + """
        WHERE l.empresa_id=:empresa_id AND l.contrato_id=:contrato_id
        ORDER BY l.competencia DESC NULLS LAST, l.data_vencimento DESC, l.id DESC
        LIMIT 18
    """), {"empresa_id": empresa_id, "contrato_id": contrato_id}).fetchall()]
    data = {k: to_json_value(v) for k, v in contrato.items()}
    status_fin = str(contrato.get("financeiro_status") or "nao_configurado")
    data.update({
        "financeiro_status_label": STATUS_RECORRENCIA_LABELS.get(status_fin, status_fin),
        "financeiro_frequencia_label": FREQUENCIA_LABELS.get(str(contrato.get("financeiro_frequencia") or ""), None),
        "configuracao_completa": configuracao_recorrencia_completa(contrato),
        "pode_ativar": str(contrato.get("status") or "") == "assinado" and status_fin in {"configurado", "suspenso"},
        "resumo_financeiro": resumo,
        "titulos": titulos,
        "frequencias": [{"value": k, "label": FREQUENCIA_LABELS[k], "intervalo_meses": v} for k, v in FREQUENCIAS_INTERVALO.items()],
    })
    return data


@router.get("/contratos-recorrentes/{contrato_id}")
def obter_recorrencia_contrato(
    contrato_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    contrato = buscar_contrato_recorrencia(
        db, empresa_id=empresa_do(usuario), contrato_id=contrato_id
    )
    return recorrencia_to_out(db, contrato)


@router.put("/contratos-recorrentes/{contrato_id}/configuracao")
def salvar_configuracao_recorrencia(
    contrato_id: int,
    payload: ContratoRecorrenciaConfigIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    contrato = buscar_contrato_recorrencia(
        db, empresa_id=empresa_id, contrato_id=contrato_id, lock=True
    )
    if str(contrato.get("financeiro_status") or "") == "cancelado":
        raise HTTPException(status_code=409, detail="A recorrência deste contrato foi cancelada e não pode ser reativada.")

    frequencia = str(payload.frequencia or "").strip().lower()
    if frequencia not in FREQUENCIAS_INTERVALO:
        raise HTTPException(status_code=422, detail="Frequência de cobrança inválida.")
    dia_vencimento = int(payload.dia_vencimento or payload.primeiro_vencimento.day)
    if dia_vencimento < 1 or dia_vencimento > 31:
        raise HTTPException(status_code=422, detail="O dia de vencimento deve ficar entre 1 e 31.")
    if payload.meses_antecipacao < 0 or payload.meses_antecipacao > 12:
        raise HTTPException(status_code=422, detail="A antecipação deve ficar entre 0 e 12 meses.")
    if Decimal(str(contrato.get("valor_mensal") or 0)) <= 0:
        raise HTTPException(status_code=422, detail="Informe o valor mensal do contrato antes de configurar a cobrança.")

    data_inicio = contrato.get("data_inicio")
    data_fim = contrato.get("data_fim")
    if data_inicio and payload.primeiro_vencimento < data_inicio:
        raise HTTPException(status_code=422, detail="O primeiro vencimento não pode ser anterior ao início do contrato.")
    if data_fim and payload.primeiro_vencimento > data_fim:
        raise HTTPException(status_code=422, detail="O primeiro vencimento não pode ser posterior ao término do contrato.")

    validar_referencias_lancamento(
        db,
        empresa_id=empresa_id,
        tipo="receber",
        cliente_id=int(contrato["cliente_id"]),
        fornecedor_id=None,
        categoria_id=payload.categoria_id,
        forma_pagamento_id=payload.forma_pagamento_id,
        conta_banco_id=payload.conta_banco_id,
        tipo_documento_id=payload.tipo_documento_id,
        natureza_operacao_id=payload.natureza_operacao_id,
        centro_custo_principal_id=payload.centro_custo_principal_id,
        centro_custo_secundario_id=payload.centro_custo_secundario_id,
        unidade_consumo_principal_id=payload.unidade_consumo_principal_id,
        unidade_consumo_secundaria_id=payload.unidade_consumo_secundaria_id,
        conta_contabil_id=payload.conta_contabil_id,
        forma_cobranca_id=payload.forma_cobranca_id,
        regra_encargos_id=payload.regra_encargos_id,
        entidade_emissora_id=payload.entidade_emissora_id,
    )

    anterior = json_safe({
        "frequencia": contrato.get("financeiro_frequencia"),
        "primeiro_vencimento": contrato.get("financeiro_primeiro_vencimento"),
        "dia_vencimento": contrato.get("financeiro_dia_vencimento"),
        "meses_antecipacao": contrato.get("financeiro_meses_antecipacao"),
    })
    novo_status = str(contrato.get("financeiro_status") or "nao_configurado")
    if novo_status == "nao_configurado":
        novo_status = "configurado"

    db.execute(text("""
        UPDATE public.contratos SET
            financeiro_status=:status_financeiro,
            financeiro_frequencia=:frequencia,
            financeiro_intervalo_meses=:intervalo,
            financeiro_primeiro_vencimento=:primeiro_vencimento,
            financeiro_dia_vencimento=:dia_vencimento,
            financeiro_meses_antecipacao=:meses_antecipacao,
            financeiro_forma_cobranca_id=:forma_cobranca_id,
            financeiro_forma_pagamento_id=:forma_pagamento_id,
            financeiro_conta_banco_id=:conta_banco_id,
            financeiro_categoria_id=:categoria_id,
            financeiro_conta_contabil_id=:conta_contabil_id,
            financeiro_tipo_documento_id=:tipo_documento_id,
            financeiro_natureza_operacao_id=:natureza_operacao_id,
            financeiro_centro_custo_principal_id=:centro_custo_principal_id,
            financeiro_centro_custo_secundario_id=:centro_custo_secundario_id,
            financeiro_unidade_consumo_principal_id=:unidade_consumo_principal_id,
            financeiro_unidade_consumo_secundaria_id=:unidade_consumo_secundaria_id,
            financeiro_regra_encargos_id=:regra_encargos_id,
            financeiro_entidade_emissora_id=:entidade_emissora_id,
            financeiro_observacoes=:observacoes,
            financeiro_ultimo_erro=NULL,
            financeiro_ultimo_erro_em=NULL,
            atualizado_em=NOW()
        WHERE empresa_id=:empresa_id AND id=:contrato_id
    """), {
        "status_financeiro": novo_status,
        "frequencia": frequencia,
        "intervalo": FREQUENCIAS_INTERVALO[frequencia],
        "primeiro_vencimento": payload.primeiro_vencimento,
        "dia_vencimento": dia_vencimento,
        "meses_antecipacao": payload.meses_antecipacao,
        "forma_cobranca_id": payload.forma_cobranca_id,
        "forma_pagamento_id": payload.forma_pagamento_id,
        "conta_banco_id": payload.conta_banco_id,
        "categoria_id": payload.categoria_id,
        "conta_contabil_id": payload.conta_contabil_id,
        "tipo_documento_id": payload.tipo_documento_id,
        "natureza_operacao_id": payload.natureza_operacao_id,
        "centro_custo_principal_id": payload.centro_custo_principal_id,
        "centro_custo_secundario_id": payload.centro_custo_secundario_id,
        "unidade_consumo_principal_id": payload.unidade_consumo_principal_id,
        "unidade_consumo_secundaria_id": payload.unidade_consumo_secundaria_id,
        "regra_encargos_id": payload.regra_encargos_id,
        "entidade_emissora_id": payload.entidade_emissora_id,
        "observacoes": norm_str(payload.observacoes),
        "empresa_id": empresa_id,
        "contrato_id": contrato_id,
    })
    novo = json_safe({
        "frequencia": frequencia,
        "primeiro_vencimento": payload.primeiro_vencimento,
        "dia_vencimento": dia_vencimento,
        "meses_antecipacao": payload.meses_antecipacao,
    })
    registrar_historico_recorrencia(
        db,
        contrato=contrato,
        usuario=usuario,
        descricao="Configuração de cobrança recorrente atualizada. Alterações valem apenas para títulos ainda não gerados.",
        campo="configuracao_financeira",
        anterior=anterior,
        novo=novo,
    )
    db.commit()
    return recorrencia_to_out(db, buscar_contrato_recorrencia(db, empresa_id=empresa_id, contrato_id=contrato_id))


def _alterar_status_recorrencia(
    *,
    contrato_id: int,
    novo_status: str,
    motivo: Optional[str],
    gerar: bool,
    db: Session,
    usuario: models.Usuario,
):
    empresa_id = empresa_do(usuario)
    contrato = buscar_contrato_recorrencia(db, empresa_id=empresa_id, contrato_id=contrato_id, lock=True)
    status_anterior = str(contrato.get("financeiro_status") or "nao_configurado")
    if status_anterior == "cancelado" and novo_status != "cancelado":
        raise HTTPException(status_code=409, detail="A recorrência cancelada não pode ser reativada.")
    if novo_status == "ativo":
        if str(contrato.get("status") or "") != "assinado":
            raise HTTPException(status_code=422, detail="Marque o contrato como Assinado antes de ativar a cobrança recorrente.")
        if not configuracao_recorrencia_completa(contrato):
            raise HTTPException(status_code=422, detail="Complete a configuração financeira antes de ativar a recorrência.")
    if novo_status == "suspenso" and status_anterior != "ativo":
        raise HTTPException(status_code=409, detail="Somente uma recorrência ativa pode ser suspensa.")

    campos_extra = ""
    if novo_status == "ativo":
        campos_extra = ", financeiro_ativado_em=COALESCE(financeiro_ativado_em, NOW()), financeiro_ativado_por_usuario_id=:usuario_id, financeiro_suspenso_em=NULL"
    elif novo_status == "suspenso":
        campos_extra = ", financeiro_suspenso_em=NOW()"
    elif novo_status == "cancelado":
        campos_extra = ", financeiro_cancelado_em=NOW()"

    db.execute(text(f"""
        UPDATE public.contratos
        SET financeiro_status=:novo_status, atualizado_em=NOW() {campos_extra}
        WHERE empresa_id=:empresa_id AND id=:contrato_id
    """), {
        "novo_status": novo_status,
        "usuario_id": int(usuario.id),
        "empresa_id": empresa_id,
        "contrato_id": contrato_id,
    })
    registrar_historico_recorrencia(
        db,
        contrato=contrato,
        usuario=usuario,
        descricao=norm_str(motivo) or f"Recorrência financeira alterada de {STATUS_RECORRENCIA_LABELS.get(status_anterior, status_anterior)} para {STATUS_RECORRENCIA_LABELS.get(novo_status, novo_status)}.",
        campo="financeiro_status",
        anterior=status_anterior,
        novo=novo_status,
    )

    geracao = None
    if gerar:
        try:
            geracao = gerar_cobrancas_contrato(
                db,
                empresa_id=empresa_id,
                contrato_id=contrato_id,
                usuario_id=int(usuario.id),
                garantir_primeira=True,
                origem_execucao="ativação" if status_anterior != "suspenso" else "retomada",
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    retorno = recorrencia_to_out(db, buscar_contrato_recorrencia(db, empresa_id=empresa_id, contrato_id=contrato_id))
    retorno["geracao"] = geracao
    return retorno


@router.post("/contratos-recorrentes/{contrato_id}/ativar")
def ativar_recorrencia_contrato(
    contrato_id: int,
    payload: AcaoRecorrenciaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _alterar_status_recorrencia(
        contrato_id=contrato_id, novo_status="ativo", motivo=payload.motivo,
        gerar=True, db=db, usuario=usuario,
    )


@router.post("/contratos-recorrentes/{contrato_id}/suspender")
def suspender_recorrencia_contrato(
    contrato_id: int,
    payload: AcaoRecorrenciaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    return _alterar_status_recorrencia(
        contrato_id=contrato_id, novo_status="suspenso", motivo=payload.motivo,
        gerar=False, db=db, usuario=usuario,
    )


@router.post("/contratos-recorrentes/{contrato_id}/retomar")
def retomar_recorrencia_contrato(
    contrato_id: int,
    payload: AcaoRecorrenciaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    contrato = buscar_contrato_recorrencia(db, empresa_id=empresa_do(usuario), contrato_id=contrato_id)
    if str(contrato.get("financeiro_status") or "") != "suspenso":
        raise HTTPException(status_code=409, detail="Somente uma recorrência suspensa pode ser retomada.")
    return _alterar_status_recorrencia(
        contrato_id=contrato_id, novo_status="ativo", motivo=payload.motivo,
        gerar=True, db=db, usuario=usuario,
    )


@router.post("/contratos-recorrentes/{contrato_id}/cancelar")
def cancelar_recorrencia_contrato(
    contrato_id: int,
    payload: AcaoRecorrenciaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    if not norm_str(payload.motivo):
        raise HTTPException(status_code=422, detail="Informe o motivo do cancelamento da recorrência.")
    return _alterar_status_recorrencia(
        contrato_id=contrato_id, novo_status="cancelado", motivo=payload.motivo,
        gerar=False, db=db, usuario=usuario,
    )


@router.post("/contratos-recorrentes/{contrato_id}/gerar")
def gerar_recorrencia_contrato_agora(
    contrato_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(get_current_user),
):
    empresa_id = empresa_do(usuario)
    try:
        resultado = gerar_cobrancas_contrato(
            db,
            empresa_id=empresa_id,
            contrato_id=contrato_id,
            usuario_id=int(usuario.id),
            origem_execucao="manual",
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    retorno = recorrencia_to_out(db, buscar_contrato_recorrencia(db, empresa_id=empresa_id, contrato_id=contrato_id))
    retorno["geracao"] = resultado
    return retorno


@router.post("/contratos-recorrentes/gerar-pendentes")
def gerar_todas_recorrencias_pendentes(
    usuario: models.Usuario = Depends(get_current_user),
):
    return processar_recorrencias_pendentes(
        empresa_id=empresa_do(usuario), usuario_id=int(usuario.id)
    )
