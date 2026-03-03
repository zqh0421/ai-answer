from typing_extensions import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..controllers import embedController
from ..dependencies import get_db
from ..models import EmbedModel
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.LEGACY_QA])


@router.post("/embed")
async def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    # Legacy question-table cache has been removed; always compute from current slide/page data.
    return embedController(embedModel, settings, db)
