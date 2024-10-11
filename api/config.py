from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    openai_api_key: str
    auth_google_id: str
    auth_google_secret: str
    auth_secret: str
    # domain: str
    nextauth_url: str
    database_url: str
    model_config = SettingsConfigDict(
        # `.env.local` takes priority over `.env`
        env_file=('.env', '.env.local')
    )


def get_settings():
    return Settings() 