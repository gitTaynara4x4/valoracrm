#!/bin/sh
set -eu

python /app/scripts/migrate.py

# O Valora é síncrono no acesso ao PostgreSQL. Dois workers já permitem que
# uma consulta pesada não bloqueie todas as demais requisições. Em máquinas
# com apenas 1 CPU, mantém 1 worker. UVICORN_WORKERS sobrescreve a escolha.
if [ "${1:-}" = "uvicorn" ]; then
  has_workers=0
  for arg in "$@"; do
    [ "$arg" = "--workers" ] && has_workers=1
  done

  if [ "$has_workers" -eq 0 ]; then
    if [ -n "${UVICORN_WORKERS:-}" ]; then
      workers="$UVICORN_WORKERS"
    else
      cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
      if [ "$cpus" -ge 2 ] 2>/dev/null; then workers=2; else workers=1; fi
    fi
    set -- "$@" --workers "$workers"
  fi
fi

exec "$@"
