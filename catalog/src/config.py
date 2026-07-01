# =============================================================================
# catalog/src/config.py
# Reads all config from environment variables (12-factor app).
# DB credentials are fetched from AWS Secrets Manager when db_secret_arn is
# set; otherwise local env vars (DB_HOST, DB_PORT, etc.) are used.
# =============================================================================
import json
import logging
import boto3
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    app_name: str = "Product Catalog API"
    port: int = 8000
    aws_region: str = "us-east-1"
    # AWS Secrets Manager ARN — leave empty to use local env vars below
    db_secret_arn: str = ""
    allowed_origins: str = ""
    log_level: str = "info"
    # Local DB credentials (used when db_secret_arn is empty)
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "ecommerce"
    db_user: str = "postgres"
    db_password: str = "postgres"
    # Set to False for local dev (no TLS); True for RDS in production
    db_ssl: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()


def fetch_db_credentials() -> dict:
    """Return DB credentials from Secrets Manager or local env vars."""
    if not settings.db_secret_arn:
        logger.info("db_secret_arn not set — using local DB env vars.")
        return {
            "host": settings.db_host,
            "port": settings.db_port,
            "dbname": settings.db_name,
            "username": settings.db_user,
            "password": settings.db_password,
        }
    client = boto3.client("secretsmanager", region_name=settings.aws_region)
    response = client.get_secret_value(SecretId=settings.db_secret_arn)
    return json.loads(response["SecretString"])
