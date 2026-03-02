from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from .database import SessionLocal, get_tunnel, reset_database_connection


def _connect_with_single_retry():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return db
    except OperationalError:
        db.close()
        # Most common local failure: stale SSH tunnel/port. Rebuild once and retry.
        reset_database_connection()
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        return db


def get_db():
    db = None
    try:
        db = _connect_with_single_retry()
        yield db
    except OperationalError as exc:
        if db is not None:
            db.close()
        raise HTTPException(status_code=503, detail="Database temporarily unavailable; please retry.") from exc
    finally:
        if db is not None:
            db.close()


def stop_tunnel():
    tunnel = get_tunnel()
    if tunnel:
        tunnel.stop()
