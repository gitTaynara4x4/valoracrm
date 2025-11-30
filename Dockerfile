FROM python:3.12-slim

# Não gerar .pyc e logar sem buffer
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Diretório de trabalho
WORKDIR /app

# Instalar dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código do projeto
COPY . .

# Expor porta interna do container
EXPOSE 2002

# Subir o FastAPI com uvicorn na porta 2002
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "2002"]
