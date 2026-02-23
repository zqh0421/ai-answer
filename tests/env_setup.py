import os


def apply_test_env() -> None:
    defaults = {
        "openai_api_key": "test-key",
        "openai_api_proj": "test-proj",
        "openai_api_org": "test-org",
        "auth_google_id": "x",
        "auth_google_secret": "x",
        "auth_secret": "x",
        "env": "production",
        "nextauth_url": "http://localhost",
        "database_host": "localhost",
        "database_port": "5432",
        "database_name": "testdb",
        "database_username": "test",
        "database_password": "test",
        "database_tunnel_host": "localhost",
        "database_tunnel_username": "test",
        "database_tunnel_private_key_path": "/tmp/fake.pem",
        "next_public_google_drive_api_key": "x",
        "s3_access_key_id": "x",
        "s3_secret_access_key": "x",
        "s3_region_name": "x",
        "s3_bucket_name": "x",
        "production_frontend_url": "http://localhost",
        "development_frontend_url": "http://localhost",
        "production_backend_url": "http://localhost",
        "development_backend_url": "http://localhost",
        "backend_env": "test",
        "frontend_env": "test",
        "public_base_url": "http://localhost",
        "lti_private_key_pem": "x",
        "lti_private_key_path": "/tmp/fake.pem",
        "lti_jwk_kid": "x",
        "lti_platforms_path": "lti_platforms.json",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)
