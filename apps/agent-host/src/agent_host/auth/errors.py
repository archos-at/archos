from agent.auth.errors import AuthError

__all__ = ["AuthError", "TokenExpiredError", "TokenInvalidError"]


class TokenExpiredError(AuthError):
    error_code = "token_expired"


class TokenInvalidError(AuthError):
    error_code = "token_invalid"
