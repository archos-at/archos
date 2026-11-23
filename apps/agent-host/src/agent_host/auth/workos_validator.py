import os

from .jwt_validator import JWTValidator


def create_workos_validator() -> JWTValidator:
    client_id = os.environ["WORKOS_CLIENT_ID"]
    return JWTValidator(
        issuer_url=f"https://api.workos.com/user_management/{client_id}",
        jwks_uri=f"https://api.workos.com/sso/jwks/{client_id}",
        audience=None,
        algorithms=["RS256"],
        verify_iss=True,
    )


def get_validators() -> list:
    client_id = os.environ.get("WORKOS_CLIENT_ID")
    if not client_id:
        return []
    return [create_workos_validator()]
