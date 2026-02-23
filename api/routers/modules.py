import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from .. import models, schema
from ..config import Settings, get_settings
from ..dependencies import get_db
from ..services.slide_batch_jobs import slide_batch_job_manager
from ..services.slide_page_import_jobs import create_page_import_batch_job, process_slide_page_import_job_item
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_MODULES])
logger = logging.getLogger(__name__)


@router.get("/courses/by_id/{course_id}/modules")
def get_modules_by_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    modules = db.query(schema.Module).filter(schema.Module.course_id == course_id).order_by(schema.Module.module_order.asc()).all()
    return {"modules": modules}


@router.post("/courses/by_id/{course_id}/modules", status_code=201)
def create_module(course_id: str, module: models.ModuleCreate, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    db_module = schema.Module(course_id=course_id, module_title=module.title)
    db.add(db_module)
    db.commit()
    db.refresh(db_module)
    return db_module


@router.post("/modules/{module_id}/slides/batch", status_code=status.HTTP_201_CREATED, tags=["Content / Slides"])
def create_slides_batch(
    module_id: UUID,
    slides: models.SlidesCreate,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Deduplicate by google id in a single request to avoid "ON CONFLICT ... cannot affect row a second time".
    deduped_by_google_id = {}
    for slide_data in slides.slides:
        deduped_by_google_id[slide_data.slide_google_id] = {
            "module_id": module_id,
            "slide_google_id": slide_data.slide_google_id,
            "slide_title": slide_data.slide_title,
            "slide_google_url": slide_data.slide_url,
            "slide_cover": slide_data.slide_cover,
        }

    slide_values = list(deduped_by_google_id.values())
    if not slide_values:
        return {"message": "No slides to upload"}

    stmt = insert(schema.Slide).values(slide_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[schema.Slide.slide_google_id],
        set_={
            "module_id": stmt.excluded.module_id,
            "slide_title": stmt.excluded.slide_title,
            "slide_google_url": stmt.excluded.slide_google_url,
            "slide_cover": stmt.excluded.slide_cover,
        },
    )

    try:
        db.execute(stmt)
        db.commit()
        uploaded_google_ids = list(deduped_by_google_id.keys())
        uploaded_slides = (
            db.query(schema.Slide)
            .filter(schema.Slide.module_id == module_id, schema.Slide.slide_google_id.in_(uploaded_google_ids))
            .all()
        )
        page_import_jobs_queued = 0
        page_import_job_id = None
        if uploaded_slides:
            page_import_job = create_page_import_batch_job(
                db,
                slide_ids=[str(s.id) for s in uploaded_slides],
                requested_by=request.headers.get("X-User-Id"),
            )
            page_import_job_id = str(page_import_job.job_id)
            for item in page_import_job.items:
                slide_batch_job_manager.enqueue_callable(process_slide_page_import_job_item, str(item.id))
                page_import_jobs_queued += 1
    except SQLAlchemyError:
        db.rollback()
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        logger.exception(
            "Failed to upload slides in batch",
            extra={
                "request_id": request_id,
                "module_id": str(module_id),
                "slides_count": len(slides.slides),
            },
        )
        raise HTTPException(
            status_code=500,
            detail={"message": "Failed to upload slides", "request_id": request_id},
        )
    except Exception:
        db.rollback()
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        logger.exception(
            "Failed to queue slide page imports during batch upload",
            extra={
                "request_id": request_id,
                "module_id": str(module_id),
                "slides_count": len(slides.slides),
            },
        )
        raise HTTPException(
            status_code=500,
            detail={"message": "Slides uploaded but page import queueing failed", "request_id": request_id},
        )

    duplicates_in_payload = len(slides.slides) - len(slide_values)
    return {
        "message": f"{len(slide_values)} slides upserted successfully!",
        "duplicates_in_payload": duplicates_in_payload,
        "page_import_jobs_queued": page_import_jobs_queued,
        "page_import_job_id": page_import_job_id,
    }


@router.delete("/modules/by_id/{module_id}")
def delete_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    db.query(schema.Slide).filter(schema.Slide.module_id == module_id).delete()
    db.delete(module)
    db.commit()

    return {"detail": "Module and its slides deleted successfully"}
