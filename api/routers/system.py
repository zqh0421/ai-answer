from fastapi import APIRouter

from ..dependencies import stop_tunnel
from ..tags import Tags

router = APIRouter(prefix="/api")


@router.on_event("shutdown")
async def shutdown_event():
    stop_tunnel()


@router.get("/test", tags=[Tags.SYSTEM_HEALTH])
def test():
    return {"message": "Backend Connected!"}
