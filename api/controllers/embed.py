import os
from typing_extensions import Annotated
from langchain_community.document_loaders import PyPDFLoader
from ..models import EmbedModel
from ..config import Settings, get_settings
from ..utils import create_embedding, embed_slide, combine_embedding, retrieve_reference
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import SessionLocal
from .. import schema
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import UUID
import time

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def embedController(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    init_time = time.time()
    # Step 1: Create the embedding for the input question
    q_vector = create_embedding(embedModel.question, settings)
    
    # Step 2: Query the `page` table to get documents with matching slide_ids
    docs = db.query(schema.Page).filter(cast(schema.Page.slide_id, UUID).in_(embedModel.slideIds)).all()

    # Step 3: Extract content and other relevant fields from the queried documents
    contents = []
    for doc in docs:
        if embedModel.preferredInfoType is "vision" and doc.image_text:
            contents.append(doc.image_text)
        elif doc.text:
            contents.append(doc.text)
        else:
            contents.append("")
    if not contents:
        raise HTTPException(status_code=400, detail="No content found for the provided slide IDs.")
    # Step 4: Get embeddings for the text contents
    content_vectors = embed_slide(contents, settings)
    # Step 5: Retrieve the most relevant reference based on cosine similarity
    top_matches = retrieve_reference(q_vector, content_vectors, docs)
    # Step 6: For each top match, find the corresponding slide_google_id and slide_title from the slide table
    enriched_matches = []
    for match in top_matches:
        # Query the slide table for slide_google_id and slide_title based on the slide_id
        slide = db.query(schema.Slide).filter(schema.Slide.id == match["slide_id"]).first()
        
        if slide:
            # Add slide_google_id and slide_title to the match result
            match["slide_google_id"] = slide.slide_google_id
            match["slide_title"] = slide.slide_title
            enriched_matches.append(match)

    # print(enriched_matches)
    print("embed")
    print(time.time() - init_time)
    # Step 7: Return the enriched results with slide_google_id and slide_title
    return {
        "result": enriched_matches
    }