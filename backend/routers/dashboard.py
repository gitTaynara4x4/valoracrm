from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter


router = APIRouter(
    prefix="/api/dashboard",
    tags=["Dashboard"],
)


@router.get("/resumo")
def dashboard_resumo():
    """
    Endpoint inicial do dashboard.
    Está em modo demo, mas já pronto para o front consumir.
    Depois você pode trocar os números fixos por consultas reais no banco.
    """
    return {
        "status": "ok",
        "sistema_online": True,
        "modo_demo": True,
        "empresa": {
            "id": 1,
            "nome": "Valora CRM",
            "plano": "Profissional",
        },
        "stats": {
            "clientes_total": 124,
            "propostas_mes": 32,
            "taxa_aprovacao": 68,
            "faturamento_estimado": 45200.00,
        },
        "updated_at": datetime.now().isoformat()
    }