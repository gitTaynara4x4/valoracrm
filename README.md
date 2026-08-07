# Valora CRM

## Banco de dados e migrations

O schema é administrado pelo Alembic. A API não cria nem altera tabelas durante
requisições ou no evento de startup.

### Aplicar migrations

```bash
alembic upgrade head
```

No Docker, `/app/entrypoint.sh` executa automaticamente as migrations antes de
iniciar o Uvicorn.

### Criar uma nova revisão

```bash
alembic revision --autogenerate -m "descricao da alteracao"
alembic upgrade head
```

Revise sempre o arquivo gerado antes do deploy. Tabelas de Financeiro,
Orçamentos, Agenda, Push e Auditoria possuem SQL explícito nas revisões porque
não estão integralmente representadas pelos modelos ORM.

### Banco já existente

A baseline usa `CREATE TABLE IF NOT EXISTS`, permitindo que instalações anteriores
sem `alembic_version` sejam adotadas na primeira execução. As revisões seguintes
sincronizam as estruturas legadas e financeiras sem apagar dados existentes.
