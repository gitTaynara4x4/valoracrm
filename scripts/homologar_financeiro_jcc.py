"""Homologação técnica, segura e repetível do núcleo financeiro do Valora.

Uso rápido (sem acessar banco):
    python scripts/homologar_financeiro_jcc.py

Auditoria adicional do banco em modo somente leitura:
    python scripts/homologar_financeiro_jcc.py --db

O modo --db executa apenas SELECTs dentro de uma transação READ ONLY.
"""
from __future__ import annotations

import argparse
import ast
import os
import py_compile
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
FINANCEIRO = ROOT / "backend" / "routers" / "financeiro.py"
COBRANCA = ROOT / "backend" / "services" / "cobranca_bancaria.py"
MIGRATIONS = ROOT / "migrations" / "versions"

PYTHON_CRITICOS = [
    FINANCEIRO,
    COBRANCA,
    ROOT / "backend" / "routers" / "asaas_webhook.py",
    ROOT / "backend" / "services" / "asaas_cobranca.py",
    ROOT / "backend" / "routers" / "financeiro_cobranca.py",
    ROOT / "backend" / "financeiro_recorrencia.py",
]

JS_CRITICOS = [
    ROOT / "frontend" / "js" / "pages" / "financeiro.js",
    ROOT / "frontend" / "js" / "pages" / "faturamento.js",
    ROOT / "frontend" / "js" / "pages" / "movimento-bancario.js",
    ROOT / "frontend" / "js" / "pages" / "vendas-financeiro.js",
]

EXPECTED_CHAIN = [f"20260821_{n:04d}" for n in range(24, 33)]


class Resultado:
    def __init__(self) -> None:
        self.falhas: list[str] = []
        self.avisos: list[str] = []

    def ok(self, texto: str) -> None:
        print(f"[OK]   {texto}")

    def fail(self, texto: str) -> None:
        self.falhas.append(texto)
        print(f"[ERRO] {texto}")

    def warn(self, texto: str) -> None:
        self.avisos.append(texto)
        print(f"[AVISO] {texto}")


def _extrair_funcao_pura(path: Path, nome: str) -> Callable:
    arvore = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for no in arvore.body:
        if isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)) and no.name == nome:
            modulo = ast.Module(body=[no], type_ignores=[])
            ast.fix_missing_locations(modulo)
            ns: dict[str, object] = {}
            exec(compile(modulo, str(path), "exec"), ns, ns)
            return ns[nome]  # type: ignore[return-value]
    raise RuntimeError(f"Função {nome} não encontrada em {path}")


def check_sintaxe(resultado: Resultado) -> None:
    for path in PYTHON_CRITICOS:
        try:
            py_compile.compile(str(path), doraise=True)
            resultado.ok(f"Python compila: {path.relative_to(ROOT)}")
        except Exception as exc:
            resultado.fail(f"Python inválido em {path.relative_to(ROOT)}: {exc}")

    node = shutil.which("node")
    if not node:
        resultado.warn("Node.js não encontrado; validação sintática do frontend foi pulada.")
        return
    for path in JS_CRITICOS:
        proc = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
        if proc.returncode == 0:
            resultado.ok(f"JavaScript compila: {path.relative_to(ROOT)}")
        else:
            resultado.fail(f"JavaScript inválido em {path.relative_to(ROOT)}: {(proc.stderr or proc.stdout).strip()}")


def check_fluxo_caixa(resultado: Resultado) -> None:
    try:
        efeito_caixa = _extrair_funcao_pura(FINANCEIRO, "efeito_caixa")
        esperado = {
            ("receber", "baixa"): "credito",
            ("receber", "estorno"): "debito",
            ("pagar", "baixa"): "debito",
            ("pagar", "estorno"): "credito",
        }
        for entrada, saida in esperado.items():
            obtido = efeito_caixa(*entrada)
            if obtido != saida:
                resultado.fail(f"Efeito de caixa {entrada} retornou {obtido!r}; esperado {saida!r}.")
                return
        resultado.ok("Matriz Baixa/Estorno -> Crédito/Débito está consistente.")
    except Exception as exc:
        resultado.fail(f"Não foi possível validar a matriz do Caixa: {exc}")


def check_rotas_e_protecoes(resultado: Resultado) -> None:
    src = FINANCEIRO.read_text(encoding="utf-8")
    cobranca = COBRANCA.read_text(encoding="utf-8")
    obrigatorios = {
        "Faturamento": '@router.post("/faturamento/documentos/{venda_id}/faturar"',
        "Baixa": '@router.patch("/lancamentos/{lancamento_id}/baixar")',
        "Estorno": '@router.patch("/movimentacoes/{movimentacao_id}/estornar")',
        "Transferência": '@router.post("/transferencias"',
        "Cancelamento de transferência": '@router.patch("/transferencias/{transferencia_id}/cancelar")',
    }
    for nome, marcador in obrigatorios.items():
        if marcador in src:
            resultado.ok(f"Rota presente: {nome}")
        else:
            resultado.fail(f"Rota ausente: {nome}")

    protecoes = {
        "Baixa opcional sem erro 500": '(norm_str(payload.modalidade_baixa) or ("total"',
        "Replay seguro de transferência": "_validar_replay_transferencia",
        "Estorno automático de reembolso": "_estornar_baixa_por_reembolso_gateway",
        "Divergência de baixa estornada": "divergencia_baixa_estornada",
        "Reembolso pendente não estorna cedo": "estorno_pendente_gateway",
    }
    combinado = src + "\n" + cobranca
    for nome, marcador in protecoes.items():
        if marcador in combinado:
            resultado.ok(f"Proteção financeira ativa: {nome}")
        else:
            resultado.fail(f"Proteção financeira ausente: {nome}")


def _migration_meta(path: Path) -> tuple[str | None, str | None]:
    src = path.read_text(encoding="utf-8")
    rev = re.search(r'^revision:\s*[^=]+?=\s*["\']([^"\']+)["\']', src, re.MULTILINE)
    down = re.search(r'^down_revision:\s*[^=]+?=\s*["\']([^"\']+)["\']', src, re.MULTILINE)
    return (rev.group(1) if rev else None, down.group(1) if down else None)


def check_migrations(resultado: Resultado) -> None:
    por_rev: dict[str, tuple[Path, str | None]] = {}
    for path in MIGRATIONS.glob("20260821_*.py"):
        rev, down = _migration_meta(path)
        if rev:
            por_rev[rev] = (path, down)

    anterior = "20260820_0023"
    for rev in EXPECTED_CHAIN:
        item = por_rev.get(rev)
        if not item:
            resultado.fail(f"Migration ausente: {rev}")
            anterior = rev
            continue
        path, down = item
        if down != anterior:
            resultado.fail(f"Cadeia Alembic quebrada em {path.name}: down_revision={down!r}, esperado {anterior!r}.")
        else:
            resultado.ok(f"Migration encadeada: {rev}")
        anterior = rev


def check_db(resultado: Resultado) -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
        from sqlalchemy import create_engine, text
    except Exception as exc:
        resultado.fail(f"Dependências do banco indisponíveis: {exc}")
        return

    url = str(os.getenv("DATABASE_URL") or "").strip()
    if not url:
        resultado.fail("DATABASE_URL não configurada; auditoria do banco não executada.")
        return

    engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 8})
    try:
        with engine.connect() as conn:
            trans = conn.begin()
            try:
                conn.execute(text("SET TRANSACTION READ ONLY"))
                versao = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
                if versao == "20260821_0032":
                    resultado.ok("Banco está na migration financeira 0032.")
                else:
                    resultado.fail(f"Banco está na migration {versao!r}; esperado '20260821_0032'.")

                tabelas = {
                    "financeiro_lancamentos",
                    "financeiro_movimentacoes",
                    "financeiro_caixa_movimentos",
                    "financeiro_contas_bancos",
                    "financeiro_transferencias",
                    "financeiro_cobrancas_externas",
                }
                existentes = set(conn.execute(text("""
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema='public' AND table_name = ANY(:nomes)
                """), {"nomes": list(tabelas)}).scalars())
                faltam = sorted(tabelas - existentes)
                if faltam:
                    resultado.fail("Tabelas financeiras ausentes: " + ", ".join(faltam))
                else:
                    resultado.ok("Tabelas do núcleo financeiro presentes.")

                checks = [
                    (
                        "Títulos com valor_pago divergente das baixas/estornos",
                        """
                        WITH calc AS (
                            SELECT l.empresa_id, l.id,
                                   ROUND(COALESCE(l.valor_pago,0)::numeric,2) AS gravado,
                                   ROUND(GREATEST(0, COALESCE(SUM(CASE
                                       WHEN m.tipo_movimentacao='baixa' THEN COALESCE(NULLIF(m.valor_principal,0),m.valor)
                                       WHEN m.tipo_movimentacao='estorno' THEN -COALESCE(NULLIF(m.valor_principal,0),m.valor)
                                       ELSE 0 END),0))::numeric,2) AS calculado
                            FROM financeiro_lancamentos l
                            LEFT JOIN financeiro_movimentacoes m
                              ON m.empresa_id=l.empresa_id AND m.lancamento_id=l.id
                             AND m.tipo_movimentacao IN ('baixa','estorno')
                            GROUP BY l.empresa_id,l.id,l.valor_pago
                        ) SELECT COUNT(*) FROM calc WHERE gravado<>calculado
                        """,
                    ),
                    (
                        "Baixas com mais de um estorno",
                        """
                        SELECT COUNT(*) FROM (
                            SELECT empresa_id,movimentacao_origem_id
                            FROM financeiro_movimentacoes
                            WHERE tipo_movimentacao='estorno' AND movimentacao_origem_id IS NOT NULL
                            GROUP BY empresa_id,movimentacao_origem_id HAVING COUNT(*)>1
                        ) x
                        """,
                    ),
                    (
                        "Transferências com origem igual ao destino",
                        "SELECT COUNT(*) FROM financeiro_transferencias WHERE conta_origem_id=conta_destino_id",
                    ),
                    (
                        "Conciliações marcadas como conciliadas cuja baixa foi estornada",
                        """
                        SELECT COUNT(*)
                        FROM financeiro_cobrancas_externas ce
                        WHERE ce.conciliacao_status='conciliado'
                          AND ce.conciliado_movimentacao_id IS NOT NULL
                          AND EXISTS (
                              SELECT 1 FROM financeiro_movimentacoes e
                              WHERE e.empresa_id=ce.empresa_id
                                AND e.movimentacao_origem_id=ce.conciliado_movimentacao_id
                                AND e.tipo_movimentacao='estorno'
                          )
                        """,
                    ),
                ]
                for nome, sql in checks:
                    qtd = int(conn.execute(text(sql)).scalar() or 0)
                    if qtd:
                        resultado.fail(f"{nome}: {qtd} ocorrência(s).")
                    else:
                        resultado.ok(f"{nome}: nenhuma divergência.")
            finally:
                trans.rollback()
    except Exception as exc:
        resultado.fail(f"Não foi possível auditar o banco em modo somente leitura: {exc}")
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Homologa o núcleo financeiro do Valora sem alterar dados.")
    parser.add_argument("--db", action="store_true", help="Também audita o PostgreSQL em transação READ ONLY.")
    args = parser.parse_args()

    resultado = Resultado()
    print("=== HOMOLOGAÇÃO DO NÚCLEO FINANCEIRO VALORA / JCC ===")
    check_sintaxe(resultado)
    check_fluxo_caixa(resultado)
    check_rotas_e_protecoes(resultado)
    check_migrations(resultado)
    if args.db:
        check_db(resultado)
    else:
        resultado.warn("Banco não auditado nesta execução. Use --db no ambiente do Valora para validar os dados reais.")

    print("\n=== RESULTADO ===")
    print(f"Falhas: {len(resultado.falhas)} | Avisos: {len(resultado.avisos)}")
    if resultado.falhas:
        for falha in resultado.falhas:
            print(f" - {falha}")
        return 1
    print("Núcleo financeiro aprovado nos testes executados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
