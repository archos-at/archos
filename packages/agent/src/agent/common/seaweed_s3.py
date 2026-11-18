from __future__ import annotations

import os

ENDPOINT_ENV = "SEAWEED_ENDPOINT"
ACCESS_KEY_ENV = "SEAWEED_ACCESS_KEY"
SECRET_KEY_ENV = "SEAWEED_SECRET_KEY"  # pragma: allowlist secret (env-var name constant, not a credential)
BUCKET_ENV = "SEAWEED_BUCKET"
DEFAULT_BUCKET = "grid-documents"


def default_bucket() -> str:
    return os.environ.get(BUCKET_ENV, DEFAULT_BUCKET).strip() or DEFAULT_BUCKET


def s3_client():
    endpoint = os.environ.get(ENDPOINT_ENV, "").strip()
    access_key = os.environ.get(ACCESS_KEY_ENV, "").strip()
    secret_key = os.environ.get(SECRET_KEY_ENV, "").strip()
    if not endpoint or not access_key or not secret_key:
        return None

    import boto3
    from botocore.config import Config as _BotoConfig

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name="us-east-1",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=_BotoConfig(s3={"addressing_style": "path"}),
    )
