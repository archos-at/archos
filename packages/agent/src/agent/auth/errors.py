from __future__ import annotations


class AuthError(Exception):
    error_code: str = "auth_error"
