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
        return {
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "image": user.image,
            "permitted": user.role != "admin",
        }
    return {"user_id": "", "name": "", "email": "", "image": "", "permitted": False}
