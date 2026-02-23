from .database import SessionLocal, tunnel


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def stop_tunnel():
    if tunnel:
        tunnel.stop()
