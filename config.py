from pydantic_settings import BaseSettings, SettingsConfigDict

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
    model_config = SettingsConfigDict(
        # `.env.local` takes priority over `.env`
        env_file=('.env', '.env.local')
    )

def get_settings():
    return Settings() 