from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv


SESSION_COOKIE_NAME = "valora_session"
SESSION_PURPOSE = "valora_session"
MIN_SECRET_BYTES = 32

_PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Garante que o segredo seja lido mesmo quando este módulo for importado antes
# de backend.database. Variáveis fornecidas pelo servidor têm prioridade.
load_dotenv(_PROJECT_ROOT / ".env", override=False)
load_dotenv(_PROJECT_ROOT / ".ENV", override=False)

_PRODUCTION_ENVIRONMENTS = {
    "prod",
    "production",
    "staging",
    "homolog",
    "homologacao",
    "homologação",
}


def _configured_secret() -> Tuple[str, str]:
    for variable_name in (
        "VALORA_SESSION_SECRET",
        "SESSION_SECRET",
        "SECRET_KEY",
    ):
        value = str(os.getenv(variable_name) or "").strip()
        if value:
            return value, variable_name
    return "", ""


def _validate_secret(secret: str, source: str) -> bytes:
    raw = secret.encode("utf-8")

    if len(raw) < MIN_SECRET_BYTES:
        raise RuntimeError(
            f"{source} deve possuir pelo menos {MIN_SECRET_BYTES} bytes. "
            "Gere um valor aleatório forte antes de iniciar o Valora."
        )

    normalized = secret.lower().replace("_", "-")
    insecure_markers = (
        "troque-este",
        "troque-aqui",
        "change-me",
        "changeme",
        "secret-here",
        "sua-chave",
        "sua-senha",
    )
    if any(marker in normalized for marker in insecure_markers):
        raise RuntimeError(
            f"{source} ainda contém um valor de exemplo. "
            "Configure um segredo aleatório real antes de iniciar o Valora."
        )

    return raw


def _development_secret_path() -> Path:
    configured_path = str(os.getenv("VALORA_SESSION_SECRET_FILE") or "").strip()
    if configured_path:
        return Path(configured_path).expanduser().resolve()
    return _PROJECT_ROOT / ".valora_session_secret"


def _read_secret_file(path: Path) -> bytes:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return b""
    except OSError as exc:
        raise RuntimeError(
            f"Não foi possível ler o segredo local de sessão em '{path}': {exc}"
        ) from exc

    if not value:
        raise RuntimeError(f"O arquivo de segredo de sessão está vazio: '{path}'.")

    return _validate_secret(value, str(path))


def _load_or_create_development_secret() -> bytes:
    """Cria um segredo local persistente somente fora de produção.

    O uso de criação exclusiva evita que dois workers gerem valores diferentes
    durante a primeira inicialização. Todos passam a ler o mesmo arquivo.
    """
    path = _development_secret_path()
    existing = _read_secret_file(path)
    if existing:
        return existing

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_urlsafe(64)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        file_descriptor = os.open(path, flags, 0o600)
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
                handle.write(generated + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        except Exception:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            raise
    except FileExistsError:
        # Outro worker venceu a criação. Lê exatamente o mesmo segredo.
        pass
    except OSError as exc:
        raise RuntimeError(
            f"Não foi possível criar o segredo local de sessão em '{path}': {exc}"
        ) from exc

    secret = _read_secret_file(path)
    if not secret:
        raise RuntimeError(f"Não foi possível carregar o segredo de sessão em '{path}'.")

    print(
        "[SEGURANÇA] VALORA_SESSION_SECRET não foi configurado. "
        f"Ambiente de desenvolvimento usando segredo persistente em '{path}'."
    )
    return secret


def _load_secret() -> bytes:
    configured, source = _configured_secret()
    if configured:
        if source != "VALORA_SESSION_SECRET":
            print(
                f"[SEGURANÇA] Usando {source} como segredo de sessão por compatibilidade. "
                "Prefira configurar VALORA_SESSION_SECRET."
            )
        return _validate_secret(configured, source)

    environment = str(os.getenv("ENV") or "dev").strip().lower()
    if environment in _PRODUCTION_ENVIRONMENTS:
        raise RuntimeError(
            "VALORA_SESSION_SECRET não configurado. Em produção o Valora não pode "
            "gerar um segredo temporário, pois isso invalida sessões após reinícios "
            "e causa falhas entre múltiplos workers ou servidores. Configure no "
            "EasyPanel uma chave aleatória com pelo menos 32 bytes."
        )

    return _load_or_create_development_secret()


_SECRET = _load_secret()


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def sign_payload(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded = _b64encode(body)
    signature = hmac.new(_SECRET, encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64encode(signature)}"


def unsign_payload(
    token: str,
    *,
    expected_purpose: Optional[str] = None,
    now: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    try:
        encoded, signature_text = str(token or "").split(".", 1)
        received_signature = _b64decode(signature_text)
        expected_signature = hmac.new(
            _SECRET,
            encoded.encode("ascii"),
            hashlib.sha256,
        ).digest()

        if not hmac.compare_digest(received_signature, expected_signature):
            return None

        payload = json.loads(_b64decode(encoded).decode("utf-8"))
        if not isinstance(payload, dict):
            return None

        current_time = int(now if now is not None else time.time())
        expires_at = int(payload.get("exp") or 0)
        if expires_at <= current_time:
            return None

        if expected_purpose and payload.get("purpose") != expected_purpose:
            return None

        return payload
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    except Exception:
        return None


def create_session_token(user_id: int, empresa_id: int, max_age: int) -> str:
    now = int(time.time())
    return sign_payload(
        {
            "purpose": SESSION_PURPOSE,
            "uid": int(user_id),
            "eid": int(empresa_id),
            "iat": now,
            "exp": now + int(max_age),
            "nonce": secrets.token_urlsafe(12),
        }
    )


def decode_session_token(token: str) -> Optional[Dict[str, Any]]:
    payload = unsign_payload(token, expected_purpose=SESSION_PURPOSE)
    if not payload:
        return None

    try:
        payload["uid"] = int(payload["uid"])
        payload["eid"] = int(payload["eid"])
    except (KeyError, TypeError, ValueError):
        return None

    return payload


def create_temporary_token(
    purpose: str,
    *,
    user_id: int,
    empresa_id: int,
    max_age: int,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    now = int(time.time())
    payload: Dict[str, Any] = {
        "purpose": str(purpose),
        "uid": int(user_id),
        "eid": int(empresa_id),
        "iat": now,
        "exp": now + int(max_age),
        "nonce": secrets.token_urlsafe(12),
    }
    if extra:
        payload.update(extra)
    return sign_payload(payload)
