import time

from fastapi import Depends, HTTPException
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from ..config import Settings, get_settings
from .. import schema
from ..dependencies import get_db
from ..models import EmbedModel
from ..utils import create_embedding, embed_slide, retrieve_reference


def embedController(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    init_time = time.time()
    q_vector = create_embedding(embedModel.question, settings)

    docs = db.query(schema.Page).filter(
        cast(schema.Page.slide_id, UUID).in_(embedModel.slideIds)
    ).all()

    contents = []
    for doc in docs:
        if embedModel.preferredInfoType == "vision" and doc.image_text:
            contents.append(doc.image_text)
        elif doc.text:
            contents.append(doc.text)
        else:
            contents.append("")
    if not contents:
        raise HTTPException(
            status_code=400, detail="No content found for the provided slide IDs.")

    content_vectors = embed_slide(contents, settings)
    top_matches = retrieve_reference(q_vector, content_vectors, docs)

    enriched_matches = []
    for match in top_matches:
        slide = db.query(schema.Slide).filter(
            schema.Slide.id == match["slide_id"]).first()

        if slide:
            match["slide_google_id"] = slide.slide_google_id
            match["slide_title"] = slide.slide_title
            enriched_matches.append(match)

    print("embed")
    print(time.time() - init_time)
    return {
        "result": enriched_matches
    }
