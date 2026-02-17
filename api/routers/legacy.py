import json
from uuid import UUID
from typing_extensions import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schema
from ..config import Settings, get_settings
from ..controllers import askController, embedController
from ..dependencies import get_db
from ..models import AskModel, EmbedModel
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.LEGACY_QA])


def _serialize_with_uuid(obj):
    if isinstance(obj, UUID):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


@router.post("/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = askController(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}


@router.post("/embed")
async def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    result = None

    if embedModel.question_id:
        question = db.query(schema.Question).filter(
            schema.Question.question_id == embedModel.question_id,
            schema.Question.embed_result.isnot(None),
        ).first()

        if question and question.embed_result is not None:
            result = json.loads(question.embed_result)
            return result

    result = embedController(embedModel, settings, db)

    if embedModel.question_id:
        question_to_update = db.query(schema.Question).filter(
            schema.Question.question_id == embedModel.question_id
        ).first()

        if question_to_update:
            escaped_json = json.dumps(result, default=_serialize_with_uuid)
            question_to_update.embed_result = escaped_json
            db.add(question_to_update)
            db.commit()

    return result
