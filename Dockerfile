FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código da aplicação e migrations versionadas.
COPY backend ./backend
COPY frontend ./frontend
COPY migrations ./migrations
COPY scripts ./scripts
COPY alembic.ini ./alembic.ini
COPY entrypoint.sh ./entrypoint.sh

RUN mkdir -p /app/uploads \
    && chmod +x /app/entrypoint.sh

EXPOSE 5888

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "5888"]
