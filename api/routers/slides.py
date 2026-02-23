from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from typing_extensions import Annotated
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schema
from ..config import get_settings
from ..dependencies import get_db
from ..services.slide_batch_jobs import (
    _job_status_from_counts,
    ensure_slide_batch_job_schema,
    recompute_job_aggregate,
    slide_batch_job_manager,
)
from ..services.slide_page_import_jobs import (
    ensure_slide_page_import_job_schema,
    serialize_page_import_job,
)
from ..services.vision_jobs import run_vision_for_slide
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_SLIDES])


@router.get("/modules/{module_id}/slides")
def get_slides_by_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    slides = db.query(schema.Slide).filter(schema.Slide.module_id == module_id).order_by(schema.Slide.slide_title.asc()).all()
    slide_ids = [slide.id for slide in slides]
    page_stats_by_slide_id = {}
    if slide_ids:
        page_stats = (
            db.query(
                schema.Page.slide_id,
                func.count(schema.Page.page_id).label("total_pages"),
                func.count(schema.Page.vector).label("vector_pages"),
            )
            .filter(schema.Page.slide_id.in_(slide_ids))
            .group_by(schema.Page.slide_id)
            .all()
        )
        page_stats_by_slide_id = {
            str(slide_id): {"total_pages": int(total_pages), "vector_pages": int(vector_pages)}
            for slide_id, total_pages, vector_pages in page_stats
        }

    result = [
        {
            "id": slide.id,
            "slide_google_id": slide.slide_google_id,
            "slide_title": slide.slide_title,
            "slide_cover": slide.slide_cover,
            "gotVision": slide.vision_summary is not None,
            "gotVectors": (
                page_stats_by_slide_id.get(str(slide.id), {}).get("total_pages", 0) > 0
                and page_stats_by_slide_id.get(str(slide.id), {}).get("vector_pages", 0)
                == page_stats_by_slide_id.get(str(slide.id), {}).get("total_pages", 0)
            ),
            "pageCount": page_stats_by_slide_id.get(str(slide.id), {}).get("total_pages", 0),
            "module_id": slide.module_id,
            "slide_google_url": slide.slide_google_url,
        }
        for slide in slides
    ]

    return {"slides": result}


def _serialize_batch_job(job: schema.SlideProcessJob):
    status_counts = {}
    for item in job.items:
        status_counts[item.status] = status_counts.get(item.status, 0) + 1

    processed = [str(item.slide_id) for item in job.items if item.status == "processed"]
    skipped = [str(item.slide_id) for item in job.items if item.status == "skipped"]
    failed = [{"slide_id": str(item.slide_id), "error": item.error or ""} for item in job.items if item.status == "failed"]
    processing = [str(item.slide_id) for item in job.items if item.status == "processing"]
    queued = [str(item.slide_id) for item in job.items if item.status == "queued"]
    cancelled = [str(item.slide_id) for item in job.items if item.status == "cancelled"]

    items = [
        {
            "item_id": str(item.id),
            "slide_id": str(item.slide_id),
            "status": item.status,
            "retry_count": item.retry_count,
            "total_steps": getattr(item, "total_steps", 0),
            "completed_steps": getattr(item, "completed_steps", 0),
            "current_step_label": getattr(item, "current_step_label", None),
            "error": item.error,
            "started_at": item.started_at.isoformat() if item.started_at else None,
            "finished_at": item.finished_at.isoformat() if item.finished_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        }
        for item in job.items
    ]
    derived_status = _job_status_from_counts(
        queued=status_counts.get("queued", 0),
        processing=status_counts.get("processing", 0),
        processed=status_counts.get("processed", 0),
        skipped=status_counts.get("skipped", 0),
        failed=status_counts.get("failed", 0),
        cancelled=status_counts.get("cancelled", 0),
        cancel_requested=job.cancel_requested,
    )
    return {
        "job_id": str(job.job_id),
        "status": derived_status,
        "cancel_requested": job.cancel_requested,
        "total_count": job.total_count,
        "queued_count": status_counts.get("queued", 0),
        "processing_count": status_counts.get("processing", 0),
        "processed_count": job.processed_count,
        "skipped_count": job.skipped_count,
        "failed_count": job.failed_count,
        "cancelled_count": status_counts.get("cancelled", 0),
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
        "processing": processing,
        "queued": queued,
        "cancelled": cancelled,
        "items": items,
    }


def _estimate_remaining_seconds_for_process_job(db: Session, job: schema.SlideProcessJob):
    remaining_steps = 0
    for item in job.items:
        if item.status in {"queued", "processing"}:
            total_steps = int(getattr(item, "total_steps", 0) or 0)
            completed_steps = int(getattr(item, "completed_steps", 0) or 0)
            remaining_steps += max(total_steps - completed_steps, 0)

    if remaining_steps <= 0:
        return 0 if job.status in {"completed", "failed", "cancelled"} else None

    recent_processed_items = (
        db.query(schema.SlideProcessJobItem)
        .filter(
            schema.SlideProcessJobItem.status == "processed",
            schema.SlideProcessJobItem.started_at.isnot(None),
            schema.SlideProcessJobItem.finished_at.isnot(None),
        )
        .order_by(schema.SlideProcessJobItem.finished_at.desc())
        .limit(50)
        .all()
    )

    total_duration = 0.0
    total_steps = 0
    for item in recent_processed_items:
        duration = (item.finished_at - item.started_at).total_seconds()
        item_steps = int(getattr(item, "total_steps", 0) or 0)
        if duration > 0 and item_steps > 0:
            total_duration += duration
            total_steps += item_steps

    if total_steps <= 0:
        return None

    avg_seconds_per_step = total_duration / total_steps
    # Remaining steps execute across workers in parallel; normalize by worker count hint.
    worker_parallelism = max(1, int(get_settings().slide_batch_estimated_worker_parallelism))
    return max(1, int((avg_seconds_per_step * remaining_steps) / worker_parallelism))


@router.post("/slides/process-batch", status_code=status.HTTP_202_ACCEPTED)
async def process_slides_batch(payload: models.SlideBatchProcessRequest, request: Request, db: Session = Depends(get_db)):
    ensure_slide_batch_job_schema(db)
    ensure_slide_page_import_job_schema(db)

    unique_ids = list(dict.fromkeys(payload.slide_ids))
    parsed_ids = []
    invalid_ids = []
    for raw_id in unique_ids:
        try:
            parsed_ids.append(UUID(raw_id))
        except ValueError:
            invalid_ids.append(raw_id)

    if not parsed_ids:
        raise HTTPException(status_code=400, detail="No valid slide_ids provided")

    slides = db.query(schema.Slide).filter(schema.Slide.id.in_(parsed_ids)).all()
    slides_by_id = {str(slide.id): slide for slide in slides}
    missing_slide_ids = [slide_id for slide_id in unique_ids if slide_id not in slides_by_id]
    if invalid_ids or missing_slide_ids:
        raise HTTPException(
            status_code=404,
            detail={"invalid_slide_ids": invalid_ids, "missing_slide_ids": missing_slide_ids},
        )

    requested_by = request.headers.get("X-User-Id")
    job = schema.SlideProcessJob(
        status="queued",
        total_count=len(unique_ids),
        requested_by=requested_by,
        force_process_all=payload.force_process_all,
    )
    db.add(job)
    db.flush()

    page_stats_by_slide_id = {}
    if parsed_ids:
        page_stats = (
            db.query(
                schema.Page.slide_id,
                func.count(schema.Page.page_id).label("total_pages"),
                func.count(schema.Page.image_text).label("vision_pages"),
                func.count(schema.Page.vector).label("vector_pages"),
            )
            .filter(schema.Page.slide_id.in_(parsed_ids))
            .group_by(schema.Page.slide_id)
            .all()
        )
        page_stats_by_slide_id = {
            str(slide_id): {
                "total_pages": int(total_pages or 0),
                "vision_pages": int(vision_pages or 0),
                "vector_pages": int(vector_pages or 0),
            }
            for slide_id, total_pages, vision_pages, vector_pages in page_stats
        }

    for slide_id in unique_ids:
        item_status = "queued"
        item_total_steps = 0
        item_completed_steps = 0
        item_step_label = "queued"
        if not payload.force_process_all:
            slide = slides_by_id.get(slide_id)
            stats = page_stats_by_slide_id.get(slide_id, {"total_pages": 0, "vision_pages": 0, "vector_pages": 0})
            total_pages = stats["total_pages"]
            has_summary = bool(slide and slide.vision_summary)
            has_page_vision = total_pages > 0 and stats["vision_pages"] == total_pages
            has_vectors = total_pages > 0 and stats["vector_pages"] == total_pages
            if has_summary and has_page_vision and has_vectors:
                item_status = "skipped"
                item_total_steps = total_pages + 1
                item_completed_steps = item_total_steps
                item_step_label = "skipped_existing"
        db.add(
            schema.SlideProcessJobItem(
                job_id=job.job_id,
                slide_id=UUID(slide_id),
                status=item_status,
                total_steps=item_total_steps,
                completed_steps=item_completed_steps,
                current_step_label=item_step_label,
                finished_at=datetime.utcnow() if item_status == "skipped" else None,
            )
        )

    db.flush()
    recompute_job_aggregate(db, job)
    db.commit()
    slide_batch_job_manager.enqueue_job(str(job.job_id))

    return {"job_id": str(job.job_id), "status": job.status, "total_count": len(unique_ids)}


@router.get("/slides/process-batch/{job_id}")
def get_process_slides_batch_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(schema.SlideProcessJob).filter(schema.SlideProcessJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Batch process job not found")
    payload = _serialize_batch_job(job)
    payload["estimated_remaining_seconds"] = _estimate_remaining_seconds_for_process_job(db, job)
    return payload


@router.get("/slides/page-import-batch/{job_id}")
def get_page_import_batch_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(schema.SlidePageImportJob).filter(schema.SlidePageImportJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Page import batch job not found")
    return serialize_page_import_job(job)


@router.post("/slides/process-batch/{job_id}/cancel")
def cancel_process_slides_batch_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(schema.SlideProcessJob).filter(schema.SlideProcessJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Batch process job not found")

    job.cancel_requested = True
    for item in job.items:
        if item.status == "queued":
            item.status = "cancelled"
            item.current_step_label = "cancelled"
            item.finished_at = item.finished_at or datetime.utcnow()
    recompute_job_aggregate(db, job)
    db.commit()
    db.refresh(job)
    return _serialize_batch_job(job)


@router.post("/slides/process-batch/{job_id}/stop")
def stop_process_slides_batch_job(job_id: str, db: Session = Depends(get_db)):
    return cancel_process_slides_batch_job(job_id=job_id, db=db)


@router.post("/slides/delete-batch")
def delete_slides_batch(payload: models.SlideBatchDeleteRequest, db: Session = Depends(get_db)):
    unique_ids = list(dict.fromkeys(payload.slide_ids))
    parsed_ids = []
    invalid_ids = []
    for raw_id in unique_ids:
        try:
            parsed_ids.append(UUID(raw_id))
        except ValueError:
            invalid_ids.append(raw_id)

    if not parsed_ids:
        raise HTTPException(status_code=400, detail="No valid slide_ids provided")

    slides = db.query(schema.Slide).filter(schema.Slide.id.in_(parsed_ids)).all()
    slides_by_id = {str(slide.id): slide for slide in slides}

    deleted = []
    not_found = []
    for slide_id in unique_ids:
        if slide_id in invalid_ids:
            continue
        slide = slides_by_id.get(slide_id)
        if not slide:
            not_found.append(slide_id)
            continue
        db.delete(slide)
        deleted.append(slide_id)

    db.commit()
    return {
        "requested": len(unique_ids),
        "deleted_count": len(deleted),
        "deleted": deleted,
        "not_found": not_found,
        "invalid_slide_ids": invalid_ids,
    }

