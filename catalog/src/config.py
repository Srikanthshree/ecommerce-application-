# =============================================================================
# catalog/src/config.py
# Reads all config from environment variables (12-factor app).
# DB credentials are fetched from AWS Secrets Manager at startup — never
# stored in env vars or config files.
# =============================================================================
import json
import os
import boto3
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Product Catalog API"
    port: int = 8000
    aws_region: str = "us-east-1"
    db_secret_arn: str  # set via K8s ConfigMap → envFrom
    allowed_origins: str = ""
    log_level: str = "info"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()


def fetch_db_credentials() -> dict:
    """Fetch DB credentials from AWS Secrets Manager using IRSA role."""
    client = boto3.client("secretsmanager", region_name=settings.aws_region)
    response = client.get_secret_value(SecretId=settings.db_secret_arn)
    return json.loads(response["SecretString"])
