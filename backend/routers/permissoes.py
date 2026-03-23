from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend import models
from backend.security.permissions import (
    MODULOS_VALIDOS,
    assert_valid_role,
    build_effective_permissions,
    can_assign_role,
    can_manage_target,
    get_current_user,
    get_db,
    is_owner,
    prevent_last_owner_change,
    require_permission,
    require_owner,
)


router = APIRouter(tags=["Permissões"])


class PermissaoModuloIn(BaseModel):
    modulo: str
    pode_ver: bool = False
    pode_criar: bool = False
    pode_editar: bool = False
    pode_excluir: bool = False


class SalvarPermissoesIn(BaseModel):
    papel: str | None = None
    permissoes: List[PermissaoModuloIn] = []


class TransferirOwnerIn(BaseModel):
    novo_owner_id: int
    antigo_owner_vira_admin: bool = True


def serialize_user(db: Session, user: models.Usuario) -> dict:
    return {
        "id": int(user.id),
        "empresa_id": int(user.empresa_id),
        "nome": getattr(user, "nome", None),
        "email": getattr(user, "email", None),
        "papel": getattr(user, "papel", None),
        "ativo": bool(getattr(user, "ativo", True)),
        "permissoes": build_effective_permissions(db, user),
    }


@router.get("/api/permissoes/me")
def minhas_permissoes(
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serialize_user(db, current_user)


@router.get("/api/permissoes/usuarios/{usuario_id}")
def obter_permissoes_usuario(
    usuario_id: int,
    current_user: models.Usuario = Depends(require_permission("usuarios", "ver")),
    db: Session = Depends(get_db),
):
    target = (
        db.query(models.Usuario)
        .filter(
            models.Usuario.id == usuario_id,
            models.Usuario.empresa_id == current_user.empresa_id,
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if not can_manage_target(current_user, target) and int(current_user.id) != int(target.id):
        raise HTTPException(status_code=403, detail="Você não pode gerenciar este usuário.")

    return serialize_user(db, target)


@router.put("/api/permissoes/usuarios/{usuario_id}")
def salvar_permissoes_usuario(
    usuario_id: int,
    payload: SalvarPermissoesIn,
    current_user: models.Usuario = Depends(require_permission("usuarios", "editar")),
    db: Session = Depends(get_db),
):
    target = (
        db.query(models.Usuario)
        .filter(
            models.Usuario.id == usuario_id,
            models.Usuario.empresa_id == current_user.empresa_id,
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    if not can_manage_target(current_user, target):
        raise HTTPException(status_code=403, detail="Você não pode gerenciar este usuário.")

    if payload.papel is not None:
        novo_papel = assert_valid_role(payload.papel)

        if not can_assign_role(current_user, novo_papel):
            raise HTTPException(status_code=403, detail="Você não pode atribuir este papel.")

        prevent_last_owner_change(db, target, new_role=novo_papel)
        target.papel = novo_papel

    modulos_repetidos = set()
    for item in payload.permissoes:
        modulo = str(item.modulo or "").strip().lower()
        if modulo not in MODULOS_VALIDOS:
            raise HTTPException(status_code=400, detail=f"Módulo inválido: {modulo}")
        if modulo in modulos_repetidos:
            raise HTTPException(status_code=400, detail=f"Módulo repetido: {modulo}")
        modulos_repetidos.add(modulo)

    (
        db.query(models.UsuarioPermissao)
        .filter(models.UsuarioPermissao.usuario_id == int(target.id))
        .delete()
    )

    for item in payload.permissoes:
        modulo = str(item.modulo).strip().lower()

        row = models.UsuarioPermissao(
            empresa_id=int(target.empresa_id),
            usuario_id=int(target.id),
            modulo=modulo,
            pode_ver=bool(item.pode_ver),
            pode_criar=bool(item.pode_criar),
            pode_editar=bool(item.pode_editar),
            pode_excluir=bool(item.pode_excluir),
        )
        db.add(row)

    db.commit()
    db.refresh(target)

    return serialize_user(db, target)


@router.post("/api/permissoes/transferir-owner")
def transferir_owner(
    payload: TransferirOwnerIn,
    current_user: models.Usuario = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    target = (
        db.query(models.Usuario)
        .filter(
            models.Usuario.id == payload.novo_owner_id,
            models.Usuario.empresa_id == current_user.empresa_id,
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Usuário alvo não encontrado.")

    if int(target.id) == int(current_user.id):
        raise HTTPException(status_code=400, detail="Escolha outro usuário para transferir o ownership.")

    target.papel = "owner"
    current_user.papel = "admin" if payload.antigo_owner_vira_admin else "colaborador"

    db.commit()
    db.refresh(target)
    db.refresh(current_user)

    return {
        "ok": True,
        "message": "Ownership transferido com sucesso.",
        "owner_atual": {
            "id": int(target.id),
            "nome": target.nome,
            "email": target.email,
            "papel": target.papel,
        },
        "owner_antigo": {
            "id": int(current_user.id),
            "nome": current_user.nome,
            "email": current_user.email,
            "papel": current_user.papel,
        },
    }