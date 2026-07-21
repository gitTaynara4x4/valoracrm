FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia somente os arquivos necessarios para executar o sistema.
# Credenciais devem ser fornecidas pelas variaveis do EasyPanel/Docker.
COPY backend ./backend
COPY frontend ./frontend

# Dados enviados por usuarios devem ficar em volume persistente.
RUN mkdir -p /app/uploads

EXPOSE 5888

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "5888"]
