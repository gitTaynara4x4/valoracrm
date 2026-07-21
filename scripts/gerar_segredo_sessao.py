from __future__ import annotations

import secrets


if __name__ == "__main__":
    print("VALORA_SESSION_SECRET=" + secrets.token_urlsafe(64))
