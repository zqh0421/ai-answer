from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sshtunnel import SSHTunnelForwarder
from .config import Settings, get_settings
from fastapi import FastAPI, Depends, HTTPException
from typing_extensions import Annotated
settings: Annotated[Settings, Depends(get_settings)] = get_settings()
# engine = create_engine(settings.database_url)
# SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# postgresql://postgres:mysecretpassword@localhost:5432/mydb
tunnel = None
database_url = None
if settings.env == "development":
    try:
        tunnel = SSHTunnelForwarder(
        (settings.database_tunnel_host, 22),
        ssh_username=settings.database_tunnel_username,
        ssh_private_key=settings.database_tunnel_private_key_path,
        remote_bind_address=(settings.database_host, settings.database_port),
        local_bind_address=('localhost', settings.database_port)
    )   
        tunnel.start()
        print("SSH Tunnel started successfully")
    except Exception as e:
        print(f"Failed to start SSH Tunnel: {e}")
        raise
    database_url = f"postgresql://{settings.database_username}:{settings.database_password}@localhost:{tunnel.local_bind_port}/{settings.database_name}"
else:
    database_url = f"postgresql://{settings.database_username}:{settings.database_password}@{settings.database_host}:{settings.database_port}/{settings.database_name}"

engine = create_engine(
    database_url,
    pool_size=20,          # Maximum number of connections in the pool
    max_overflow=30,       # Additional connections beyond pool_size
    pool_timeout=30,       # Wait time for a connection before throwing an error
    pool_recycle=1800,     # Recycle connections after 30 minutes
    pool_pre_ping=True     # Check connection liveness before using
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
