import os
from unittest.mock import patch

import pytest

from agent_host.auth.workos_validator import create_workos_validator


@patch.dict(os.environ, {"WORKOS_CLIENT_ID": "client_123"}, clear=True)
def test_create_workos_validator_configures_workos_jwks():
    validator = create_workos_validator()

    assert validator.issuer_url == "https://api.workos.com/user_management/client_123"
    assert validator._jwks_uri == "https://api.workos.com/sso/jwks/client_123"
    assert validator.audience is None
    assert validator.algorithms == ["RS256"]


def test_create_workos_validator_requires_workos_client_id():
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(KeyError, match="WORKOS_CLIENT_ID"):
            create_workos_validator()
