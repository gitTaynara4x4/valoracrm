# importar_fornecedores_empresa2.py
# Importador de FORNECEDORES para ValoraCRM - empresa_id=2
# Lê fornecedores_valora_limpo.csv e grava em:
# - public.fornecedores
# - public.fornecedores_campos_valores

from __future__ import annotations

import csv
import os
from typing import Dict, Any

import psycopg2
from dotenv import load_dotenv

load_dotenv()

EMPRESA_ID = int(os.getenv("EMPRESA_ID", "2"))
CSV_PATH = os.getenv("CSV_PATH", "fornecedores_valora_limpo.csv")
DRY_RUN = os.getenv("DRY_RUN", "true").strip().lower() in {"1", "true", "sim", "yes", "s"}

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL não encontrado. Rode dentro do projeto com o .env correto.")

# O .env do projeto pode usar SQLAlchemy: postgresql+psycopg2://...
# psycopg2 direto precisa de postgresql://...
DATABASE_URL = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://").replace("postgres+psycopg2://", "postgresql://")


def limpar(v: Any) -> str:
    if v is None:
        return ""
    v = str(v).strip()
    if v.lower() in {"nan", "none", "null"}:
        return ""
    return v


def carregar_csv(path: str):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []

        for i, row in enumerate(reader, start=2):
            row = {k: limpar(v) for k, v in row.items()}

            codigo = limpar(row.get("codigo"))
            nome = limpar(row.get("nome"))

            if not codigo or not nome:
                print(f"[AVISO] linha {i} ignorada: codigo/nome vazio", flush=True)
                continue

            rows.append(row)

        return rows


def custom_fields_da_linha(row: Dict[str, str]) -> Dict[str, str]:
    nome = limpar(row.get("nome"))
    contato = limpar(row.get("contato"))
    email = limpar(row.get("email"))
    fone = limpar(row.get("fone"))

    return {
        # Dados básicos
        "situacao": "Ativo",
        "tipo_fornecedor": "Fornecedor",
        "razao_social": nome,
        "nome_fantasia": "",
        "telefone_principal": fone,
        "site": "",

        # Contatos comercial
        "representante_comercial": contato,
        "telefone_whatssap": "",
        "telefone_ramal": "",
        "e_mail_comercial": email,

        # Dados cadastrais
        "cnpj": "",
        "inscricao_estadual": "",
        "inscricao_municipal": "",
        "cep": "",
        "endereco": "",
        "numero": "",
        "bairro": "",
        "cidade": "",
        "uf": "",
    }


def main():
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV não encontrado: {CSV_PATH}")

    rows = carregar_csv(CSV_PATH)

    print(f"Arquivo: {CSV_PATH}", flush=True)
    print(f"Empresa: {EMPRESA_ID}", flush=True)
    print(f"Fornecedores no CSV: {len(rows)}", flush=True)
    print(f"Modo teste DRY_RUN: {DRY_RUN}", flush=True)

    if not rows:
        print("Nada para importar.", flush=True)
        return

    print("Conectando no banco...", flush=True)
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
    conn.autocommit = False
    print("Conectou no banco.", flush=True)

    inseridos = 0
    atualizados = 0
    valores_custom = 0
    campos_ausentes = set()

    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '60s'")
            cur.execute("SET lock_timeout = '10s'")

            print("Carregando campos personalizados de fornecedores...", flush=True)

            cur.execute(
                """
                SELECT slug, id
                FROM public.campos_fornecedores
                WHERE empresa_id = %s
                """,
                (EMPRESA_ID,),
            )
            campos = dict(cur.fetchall())

            print(f"Campos personalizados encontrados: {len(campos)}", flush=True)

            if not campos:
                raise RuntimeError(
                    "Nenhum campo encontrado em public.campos_fornecedores. "
                    "Crie/sincronize os campos de fornecedores antes de importar."
                )

            print("Iniciando importação de fornecedores...", flush=True)

            for idx, row in enumerate(rows, start=1):
                if idx == 1 or idx % 50 == 0 or idx == len(rows):
                    print(f"Processando fornecedor {idx}/{len(rows)}...", flush=True)

                codigo = limpar(row.get("codigo"))
                nome = limpar(row.get("nome"))
                contato = limpar(row.get("contato"))
                email = limpar(row.get("email"))
                fone = limpar(row.get("fone"))

                cur.execute(
                    """
                    SELECT id
                    FROM public.fornecedores
                    WHERE empresa_id = %s
                      AND codigo = %s
                    ORDER BY id
                    LIMIT 1
                    """,
                    (EMPRESA_ID, codigo),
                )
                existente = cur.fetchone()

                if existente:
                    fornecedor_id = existente[0]

                    cur.execute(
                        """
                        UPDATE public.fornecedores
                           SET nome = %s,
                               tipo_fornecedor = %s,
                               situacao = %s,
                               contato = %s,
                               telefone = %s,
                               email = %s,
                               atualizado_em = NOW()
                         WHERE id = %s
                        """,
                        (
                            nome,
                            "Fornecedor",
                            "ativo",
                            contato,
                            fone,
                            email,
                            fornecedor_id,
                        ),
                    )
                    atualizados += 1

                else:
                    cur.execute(
                        """
                        INSERT INTO public.fornecedores (
                            empresa_id,
                            codigo,
                            nome,
                            tipo_fornecedor,
                            situacao,
                            contato,
                            telefone,
                            email,
                            atualizado_em
                        )
                        VALUES (
                            %s, %s, %s,
                            %s, %s,
                            %s, %s, %s,
                            NOW()
                        )
                        RETURNING id
                        """,
                        (
                            EMPRESA_ID,
                            codigo,
                            nome,
                            "Fornecedor",
                            "ativo",
                            contato,
                            fone,
                            email,
                        ),
                    )
                    fornecedor_id = cur.fetchone()[0]
                    inseridos += 1

                custom = custom_fields_da_linha(row)

                for slug, valor in custom.items():
                    campo_id = campos.get(slug)

                    if not campo_id:
                        campos_ausentes.add(slug)
                        continue

                    cur.execute(
                        """
                        DELETE FROM public.fornecedores_campos_valores
                         WHERE fornecedor_id = %s
                           AND campo_id = %s
                        """,
                        (fornecedor_id, campo_id),
                    )

                    if valor != "":
                        cur.execute(
                            """
                            INSERT INTO public.fornecedores_campos_valores (
                                fornecedor_id,
                                campo_id,
                                valor,
                                criado_em,
                                atualizado_em
                            )
                            VALUES (%s, %s, %s, NOW(), NOW())
                            """,
                            (fornecedor_id, campo_id, valor),
                        )
                        valores_custom += 1

        if DRY_RUN:
            conn.rollback()
            print("\n[TESTE] ROLLBACK executado. Nada foi gravado.", flush=True)
            print("Para importar de verdade, rode com DRY_RUN=false.", flush=True)
        else:
            conn.commit()
            print("\n[OK] COMMIT executado. Fornecedores importados.", flush=True)

        print(f"Fornecedores inseridos: {inseridos}", flush=True)
        print(f"Fornecedores atualizados: {atualizados}", flush=True)
        print(f"Valores personalizados gravados: {valores_custom}", flush=True)

        if campos_ausentes:
            print("\n[AVISO] Estes slugs não existem em public.campos_fornecedores e foram ignorados:", flush=True)
            for slug in sorted(campos_ausentes):
                print(f"- {slug}", flush=True)

    except Exception:
        conn.rollback()
        print("\n[ERRO] Importação cancelada. ROLLBACK executado.", flush=True)
        raise

    finally:
        conn.close()


if __name__ == "__main__":
    main()
