from __future__ import annotations

from typing import Dict, Optional

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models


PAPEIS_VALIDOS = {"owner", "admin", "colaborador", "visualizador"}

MODULOS_VALIDOS = (
    "dashboard",
    "clientes",
    "fornecedores",
    "produtos",
    "propostas",
    "usuarios",
    "empresa",
    "configuracoes",
)

ACOES_VALIDAS = {"ver", "criar", "editar", "excluir"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> models.Usuario:
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(str(user_id).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    usuario = db.query(models.Usuario).filter(models.Usuario.id == user_id_int).first()
    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if not bool(getattr(usuario, "ativo", True)):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return usuario


def get_current_empresa_id(
    current_user: models.Usuario = Depends(get_current_user),
) -> int:
    return int(current_user.empresa_id)


def is_owner(user: models.Usuario) -> bool:
    return str(getattr(user, "papel", "") or "").strip().lower() == "owner"


def is_admin(user: models.Usuario) -> bool:
    return str(getattr(user, "papel", "") or "").strip().lower() == "admin"


def assert_valid_role(papel: str) -> str:
    papel_norm = str(papel or "").strip().lower()
    if papel_norm not in PAPEIS_VALIDOS:
        raise HTTPException(status_code=400, detail=f"Papel inválido: {papel}")
    return papel_norm


def count_owner_users(db: Session, empresa_id: int) -> int:
    return (
        db.query(models.Usuario)
        .filter(
            models.Usuario.empresa_id == empresa_id,
            models.Usuario.papel == "owner",
            models.Usuario.ativo == True,
        )
        .count()
    )


def get_user_permissions_rows(
    db: Session,
    usuario_id: int,
) -> Dict[str, models.UsuarioPermissao]:
    rows = (
        db.query(models.UsuarioPermissao)
        .filter(models.UsuarioPermissao.usuario_id == usuario_id)
        .all()
    )
    return {str(r.modulo): r for r in rows}


def build_effective_permissions(
    db: Session,
    user: models.Usuario,
) -> Dict[str, dict]:
    base = {
        modulo: {
            "pode_ver": False,
            "pode_criar": False,
            "pode_editar": False,
            "pode_excluir": False,
        }
        for modulo in MODULOS_VALIDOS
    }

    if is_owner(user) or is_admin(user):
        for modulo in MODULOS_VALIDOS:
            base[modulo] = {
                "pode_ver": True,
                "pode_criar": True,
                "pode_editar": True,
                "pode_excluir": True,
            }
        return base

    rows_map = get_user_permissions_rows(db, int(user.id))
    for modulo, row in rows_map.items():
        if modulo not in base:
            continue

        base[modulo] = {
            "pode_ver": bool(row.pode_ver),
            "pode_criar": bool(row.pode_criar),
            "pode_editar": bool(row.pode_editar),
            "pode_excluir": bool(row.pode_excluir),
        }

    return base


def user_has_permission(
    db: Session,
    user: models.Usuario,
    modulo: str,
    acao: str,
) -> bool:
    modulo = str(modulo).strip().lower()
    acao = str(acao).strip().lower()

    if modulo not in MODULOS_VALIDOS:
        return False

    if acao not in ACOES_VALIDAS:
        return False

    perms = build_effective_permissions(db, user)
    return bool(perms.get(modulo, {}).get(f"pode_{acao}", False))


def require_owner():
    def dependency(
        current_user: models.Usuario = Depends(get_current_user),
    ) -> models.Usuario:
        if not is_owner(current_user):
            raise HTTPException(status_code=403, detail="Apenas o owner pode executar esta ação.")
        return current_user

    return dependency


def require_permission(modulo: str, acao: str):
    modulo = str(modulo).strip().lower()
    acao = str(acao).strip().lower()

    if modulo not in MODULOS_VALIDOS:
        raise ValueError(f"Módulo inválido em require_permission: {modulo}")

    if acao not in ACOES_VALIDAS:
        raise ValueError(f"Ação inválida em require_permission: {acao}")

    def dependency(
        current_user: models.Usuario = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.Usuario:
        if not user_has_permission(db, current_user, modulo, acao):
            raise HTTPException(
                status_code=403,
                detail=f"Sem permissão para {acao} em {modulo}."
            )
        return current_user

    return dependency


def can_manage_target(
    current_user: models.Usuario,
    target_user: models.Usuario,
) -> bool:
    if int(current_user.empresa_id) != int(target_user.empresa_id):
        return False

    if is_owner(current_user):
        return True

    if is_admin(current_user):
        return str(target_user.papel) in {"colaborador", "visualizador"}

    return False


def can_assign_role(
    current_user: models.Usuario,
    papel_destino: str,
) -> bool:
    papel_destino = assert_valid_role(papel_destino)

    if is_owner(current_user):
        return True

    if is_admin(current_user):
        return papel_destino in {"colaborador", "visualizador"}

    return False


def prevent_last_owner_change(
    db: Session,
    target_user: models.Usuario,
    new_role: Optional[str] = None,
    deleting: bool = False,
) -> None:
    papel_atual = str(getattr(target_user, "papel", "") or "").strip().lower()

    if papel_atual != "owner":
        return

    if deleting:
        if count_owner_users(db, int(target_user.empresa_id)) <= 1:
            raise HTTPException(status_code=400, detail="Não é possível excluir o último owner da empresa.")
        return

    if new_role is None:
        return

    new_role_norm = assert_valid_role(new_role)
    if new_role_norm != "owner":
        if count_owner_users(db, int(target_user.empresa_id)) <= 1:
            raise HTTPException(status_code=400, detail="Não é possível rebaixar o último owner da empresa.")