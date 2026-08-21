VALORA — IMPORTAÇÃO JCC / ETAPA 1: CLIENTES
=============================================

Objetivo desta etapa
--------------------
Antes de importar os títulos de Contas a Receber do JCC, este processo localiza
cada cliente no Valora para evitar duplicações.

A base normalizada contém 221 títulos do relatório JCC de agosto/2020 e fecha em:
- Total dos títulos: R$ 31.272,60
- Valor pago histórico: R$ 30.870,60
- Saldo a receber: R$ 402,00
- 210 títulos QUITADOS
- 11 títulos A RECEBER

1) PRÉVIA — NÃO ALTERA O BANCO
------------------------------
Com a .venv ativa, na raiz do ValoraCrm:

python scripts/conciliar_clientes_jcc.py --empresa-id 2

O script gera em imports/saida/:
- jcc_clientes_conciliacao_empresa_2_*.csv
- jcc_clientes_conciliacao_empresa_2_*.json

A prévia separa clientes em situações como:
- VINCULADO_CPF_CNPJ_NOME
- VINCULADO_CPF_CNPJ
- VINCULADO_NOME
- NOVO
- NOVO_SEM_DOCUMENTO_VALIDO
- REVISAR_...

NÃO rode --aplicar antes de conferir o CSV da prévia.

2) CRIAR SOMENTE OS NOVOS SEGUROS
---------------------------------
Depois da revisão:

python scripts/conciliar_clientes_jcc.py --empresa-id 2 --aplicar

Isso cria apenas clientes classificados como NOVO.
Os casos REVISAR_* nunca são criados automaticamente.

3) CLIENTES DO JCC COM CPF/CNPJ ZERADO
---------------------------------------
Existem registros no relatório com 00.000.000/0000-00 ou 000.000.000-00.
Eles não são usados como CPF/CNPJ real.

Se, depois de revisar, também quiser criar esses clientes sem CPF/CNPJ:

python scripts/conciliar_clientes_jcc.py --empresa-id 2 --aplicar --criar-sem-documento

O valor zerado do JCC fica apenas registrado na observação do cliente.

IMPORTANTE
----------
Esta etapa NÃO importa Contas a Receber e NÃO movimenta Caixa/Banco.
Ela serve somente para fechar o vínculo JCC -> Cliente Valora.
Depois que o relatório de clientes estiver correto, fazemos a Etapa 2: títulos.
