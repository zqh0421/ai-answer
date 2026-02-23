import base64
import os
import tempfile
from io import BytesIO

from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_bytes
from sqlalchemy.orm import Session

from .. import schema
from ..config import Settings
from ..database import SessionLocal
from ..utils import fetch_pdf_from_drive


def import_slide_pages(
    db: Session,
    *,
    slide_id: str,
    slide_google_id: str,
    settings: Settings,
    replace_existing: bool = False,
) -> dict:
    existing_pages = db.query(schema.Page).filter(schema.Page.slide_id == slide_id).all()
    if existing_pages and not replace_existing:
        return {"message": "Slide pages already exist", "pages_saved": 0, "skipped": True}

    pdfstream = fetch_pdf_from_drive(slide_google_id, settings)
    if pdfstream is None:
        raise ValueError("Failed to fetch PDF from drive")

    temp_pdf_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf_file:
            temp_pdf_file.write(pdfstream.getvalue())
            temp_pdf_path = temp_pdf_file.name

        images = convert_from_bytes(pdfstream.getvalue())
        if not images:
            raise ValueError("No pages found in PDF")

        loader = PyPDFLoader(temp_pdf_path)
        pages = loader.load()
        if len(images) != len(pages):
            raise ValueError("Mismatch between the number of images and pages")

        if replace_existing and existing_pages:
            db.query(schema.Page).filter(schema.Page.slide_id == slide_id).delete()

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

        db.commit()
        return {"message": "Slide pages imported successfully", "pages_saved": len(pages), "skipped": False}
    except Exception:
        db.rollback()
        raise
    finally:
        if temp_pdf_path:
            try:
                os.remove(temp_pdf_path)
            except Exception:
                pass


def import_slide_pages_task(slide_id: str, slide_google_id: str) -> dict:
    from ..config import get_settings

    db = SessionLocal()
    try:
        result = import_slide_pages(
            db,
            slide_id=slide_id,
            slide_google_id=slide_google_id,
            settings=get_settings(),
            replace_existing=False,
        )
        return result
    finally:
        db.close()
