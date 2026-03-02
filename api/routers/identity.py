from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schema
from ..dependencies import get_db
from ..models import AuthModel
from ..tags import Tags

router = APIRouter(prefix="/api")


@router.post("/admin_auth", tags=[Tags.IDENTITY_AUTH])
def verify_user(auth: AuthModel, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(schema.User.email == auth.email).first()
    if user:
        role_value = getattr(user.role, "value", user.role)
        resolved_user_id = (getattr(user, "user_id", None) or user.id or "").strip()
        return {
            "user_id": resolved_user_id,
            "name": user.name,
            "email": user.email,
            "image": user.image,
            "role": role_value,
            "permitted": role_value == "admin",
        }
    return {"user_id": "", "name": "", "email": "", "image": "", "role": "", "permitted": False}
