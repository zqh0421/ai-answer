from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    openai_api_key: str
    openai_api_proj: str
    openai_api_org: str
    auth_google_id: str
    auth_google_secret: str
    auth_secret: str
    google_service_account_email: Optional[str] = None
    google_service_account_private_key: Optional[str] = None
    google_service_account_private_key_file: Optional[str] = None
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
    slide_batch_redis_url: str
    slide_batch_rq_result_ttl: int = 3600
    openai_max_concurrency: int = 16
    slide_batch_max_retries: int = 4
    slide_batch_retry_base_seconds: float = 1.0
    slide_batch_queue_name: str = "slide_batch_processing"
    slide_batch_job_timeout: int = 1800
    slide_batch_worker_mode: str = ""
    slide_batch_estimated_worker_parallelism: int = 1
    vision_task_max_workers: int = 2
    vision_page_max_workers: int = 4
    openai_vision_global_max_inflight: int = 8
    openai_vision_budget_acquire_timeout_seconds: float = 600.0
    openai_vision_budget_poll_seconds: float = 0.2
    openai_vision_budget_redis_key: str = "openai_vision_global_inflight"



def get_settings():
    return Settings()
