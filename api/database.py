from __future__ import annotations

from threading import Lock
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sshtunnel import SSHTunnelForwarder

from .config import get_settings

settings = get_settings()

_lock = Lock()
_tunnel: Optional[SSHTunnelForwarder] = None
_engine = None
_session_factory = None


def _build_database_url_and_tunnel() -> tuple[str, Optional[SSHTunnelForwarder]]:
    if settings.env != "development":
        database_url = (
            f"postgresql://{settings.database_username}:{settings.database_password}"
            f"@{settings.database_host}:{settings.database_port}/{settings.database_name}"
        )
        return database_url, None

    tunnel = SSHTunnelForwarder(
        (settings.database_tunnel_host, 22),
        ssh_username=settings.database_tunnel_username,
        ssh_private_key=settings.database_tunnel_private_key_path,
        remote_bind_address=(settings.database_host, settings.database_port),
        # Use an ephemeral local port to avoid collisions with stale/local DB listeners.
        local_bind_address=("127.0.0.1", 0),
    )
    tunnel.start()
    print(f"SSH Tunnel started successfully on 127.0.0.1:{tunnel.local_bind_port}")
    database_url = (
        f"postgresql://{settings.database_username}:{settings.database_password}"
        f"@127.0.0.1:{tunnel.local_bind_port}/{settings.database_name}"
    )
    return database_url, tunnel


def _dispose_current() -> None:
    global _engine, _session_factory, _tunnel
    if _engine is not None:
        try:
            _engine.dispose()
        except Exception:
            pass
    _engine = None
    _session_factory = None
    if _tunnel is not None:
        try:
            _tunnel.stop()
        except Exception:
            pass
    _tunnel = None


def _ensure_initialized() -> None:
    global _engine, _session_factory, _tunnel
    with _lock:
        if _session_factory is not None:
            return
        database_url, tunnel = _build_database_url_and_tunnel()
        engine = create_engine(
            database_url,
            pool_size=20,          # Maximum number of connections in the pool
            max_overflow=30,       # Additional connections beyond pool_size
            pool_timeout=30,       # Wait time for a connection before throwing an error
            pool_recycle=1800,     # Recycle connections after 30 minutes
            pool_pre_ping=True,    # Check connection liveness before using
        )
        _tunnel = tunnel
        _engine = engine
        _session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def reset_database_connection() -> None:
    """
    Force re-create engine/session/tunnel.
    Useful when a local SSH tunnel port has become stale.
    """
    with _lock:
        _dispose_current()
    _ensure_initialized()


def SessionLocal():
    _ensure_initialized()
    return _session_factory()


def get_tunnel() -> Optional[SSHTunnelForwarder]:
    _ensure_initialized()
    return _tunnel


# Initialize eagerly so startup failures are visible early.
_ensure_initialized()
