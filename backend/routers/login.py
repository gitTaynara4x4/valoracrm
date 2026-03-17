# backend/routers/login.py
from fastapi import APIRouter
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(tags=["Login Page"])

BASE_DIR = Path(__file__).resolve().parents[2]

@router.get("/login")
def login_page():
    return FileResponse(BASE_DIR / "frontend" / "login.html")