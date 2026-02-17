from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    openai_api_key: str
    openai_api_proj: str
    openai_api_org: str
    auth_google_id: str
    auth_google_secret: str
    auth_secret: str
    env: str
    nextauth_url: str
    database_host: str
    database_port: int
    database_name: str
    database_username: str
    database_password: str
    database_tunnel_host: str
    database_tunnel_username: str
    database_tunnel_private_key_path: str
    next_public_google_drive_api_key: str
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_region_name: str
    s3_bucket_name: str
    production_frontend_url: str
    development_frontend_url: str
    production_backend_url: str
    development_backend_url: str
    backend_env: str
    frontend_env: str
    model_config = SettingsConfigDict(
        # `.env.local` takes priority over `.env`
        env_file=('.env', '.env.local')
    )
    public_base_url: str
    lti_tool_issuer: Optional[str] = None
    lti_private_key_pem: str
    lti_private_key_path: str
    lti_jwk_kid: str
    lti_tool_key_id: str = "tool-key-1"
    lti_state_ttl_seconds: int = 300
    lti_clock_skew_seconds: int = 300
    lti_platforms_json: str = "{}"
    lti_platforms_path: str



def get_settings():
    return Settings()
