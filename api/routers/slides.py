import base64
import os
import tempfile
import traceback
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_bytes
from typing_extensions import Annotated
from sqlalchemy.orm import Session

from .. import schema
from ..config import Settings, get_settings
from ..controllers.vision import setVision
from ..dependencies import get_db
from ..utils import fetch_pdf_from_drive
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_SLIDES])


@router.get("/modules/{module_id}/slides")
def get_slides_by_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    slides = db.query(schema.Slide).filter(schema.Slide.module_id == module_id).order_by(schema.Slide.slide_title.asc()).all()

    result = [
        {
            "id": slide.id,
            "slide_google_id": slide.slide_google_id,
            "slide_title": slide.slide_title,
            "slide_cover": slide.slide_cover,
            "published": slide.published,
            "gotVision": slide.vision_summary is not None,
            "module_id": slide.module_id,
            "slide_google_url": slide.slide_google_url,
        }
        for slide in slides
    ]

    return {"slides": result}


@router.delete("/modules/{module_id}/slides/{slide_id}")
def delete_slide(module_id: str, slide_id: str, db: Session = Depends(get_db)):
    slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id, schema.Slide.module_id == module_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    db.delete(slide)
    db.commit()

    return {"detail": "Slide deleted successfully"}


@router.post("/slides/{slide_id}/{slide_google_id}/publish")
async def publish_slide(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    pdfstream = fetch_pdf_from_drive(slide_google_id, settings)
    if pdfstream is None:
        raise HTTPException(status_code=404, detail="Failed to fetch PDF from drive")

    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf_file:
            temp_pdf_file.write(pdfstream.getvalue())
            temp_pdf_path = temp_pdf_file.name

            images = convert_from_bytes(pdfstream.getvalue())
            if not images:
                raise HTTPException(status_code=404, detail="No pages found in PDF")

            loader = PyPDFLoader(temp_pdf_path)
            pages = loader.load()

            if len(images) != len(pages):
                raise HTTPException(status_code=500, detail="Mismatch between the number of images and pages")

            for img, page in zip(images, pages):
                img_byte_arr = BytesIO()
                img.save(img_byte_arr, format="PNG")
                img_byte_arr.seek(0)
                img_base64 = base64.b64encode(img_byte_arr.read()).decode("utf-8")

                new_page = schema.Page(
                    slide_id=slide_id,
                    page_number=page.metadata["page"],
                    text=page.page_content,
                    img_base64=img_base64,
                )
                db.add(new_page)

            slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id).first()
            if slide:
                slide.published = True
            else:
                raise HTTPException(status_code=404, detail="Slide not found")

            db.commit()

        return {"message": "Slide published successfully"}
    except Exception as e:
        db.rollback()
        error_message = f"Error publishing slide: {str(e)}"
        raise HTTPException(status_code=500, detail=error_message)
    finally:
        if 'temp_pdf_path' in locals():
            try:
                os.remove(temp_pdf_path)
            except Exception:
                pass


@router.post("/slides/{slide_id}/{slide_google_id}/set-vision")
async def set_vision(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id, schema.Slide.slide_google_id == slide_google_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    pages = db.query(schema.Page).filter(schema.Page.slide_id == slide_id).all()
    if not pages:
        raise HTTPException(status_code=404, detail="No pages found for this slide")

    for page in pages:
        if page.img_base64 is not None:
            vision_info = setVision([page.img_base64], settings=settings)
            page.image_text = vision_info

    if pages:
        img_base64_list = [page.img_base64 for page in pages if page.img_base64 is not None]
        if img_base64_list:
            sum_vision_info = setVision(img_base64_list, settings=settings)
            slide.vision_summary = sum_vision_info

    try:
        image_texts = []
        pages_with_image_text = []
        for page in pages:
            if page.image_text:
                image_texts.append(page.image_text)
                pages_with_image_text.append(page)

        if image_texts:
            from ..utils import embed_slide

            vectors = embed_slide(image_texts, settings)
            for i, page in enumerate(pages_with_image_text):
                if i < len(vectors):
                    page.vector = vectors[i]
    except Exception:
        pass

    db.commit()
    return {"message": "Vision set successfully"}


@router.post("/slides/{slide_id}/{slide_google_id}/update-vision")
async def update_vision(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id, schema.Slide.slide_google_id == slide_google_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    pages = db.query(schema.Page).filter(schema.Page.slide_id == slide_id).all()
    if not pages:
        raise HTTPException(status_code=404, detail="No pages found for this slide")

    for page in pages:
        if page.img_base64 is not None:
            vision_info = setVision([page.img_base64], settings=settings)
            page.image_text = vision_info

    if pages:
        img_base64_list = [page.img_base64 for page in pages if page.img_base64 is not None]
        if img_base64_list:
            sum_vision_info = setVision(img_base64_list, settings=settings)
            slide.vision_summary = sum_vision_info

    try:
        image_texts = []
        pages_with_image_text = []
        for page in pages:
            if page.image_text:
                image_texts.append(page.image_text)
                pages_with_image_text.append(page)

        if image_texts:
            from ..utils import embed_slide

            vectors = embed_slide(image_texts, settings)
            for i, page in enumerate(pages_with_image_text):
                if i < len(vectors):
                    page.vector = vectors[i]
    except Exception:
        pass

    db.commit()
    return {"message": "Vision info updated successfully"}


@router.post("/slides/{slide_id}/update-vectors")
async def update_slide_vectors(slide_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    pages = db.query(schema.Page).filter(schema.Page.slide_id == slide_id).all()
    if not pages:
        raise HTTPException(status_code=404, detail="No pages found for this slide")

    image_texts = []
    pages_with_image_text = []
    for page in pages:
        if page.image_text:
            image_texts.append(page.image_text)
            pages_with_image_text.append(page)

    if not image_texts:
        raise HTTPException(status_code=400, detail="No image_text content found for vector generation")

    try:
        from ..utils import embed_slide

        vectors = embed_slide(image_texts, settings)
        for i, page in enumerate(pages_with_image_text):
            if i < len(vectors):
                page.vector = vectors[i]

        db.commit()
        return {"message": f"Vectors updated successfully for {len(pages_with_image_text)} pages"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating vectors: {str(e)}")
