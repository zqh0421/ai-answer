import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.exc import OperationalError

from .. import schema
from ..database import SessionLocal, reset_database_connection
from .slide_pages import import_slide_pages

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.utcnow()


def _job_status_from_counts(queued: int, processing: int, processed: int, skipped: int, failed: int, cancelled: int, cancel_requested: bool) -> str:
    if cancel_requested and queued == 0 and processing == 0:
        return "cancelled"
    if processing > 0:
        return "processing"
    if queued > 0:
        return "queued"
    if failed > 0:
        return "failed"
    return "completed"


def ensure_slide_page_import_job_schema(db) -> None:
    schema.SlidePageImportJob.__table__.create(bind=db.bind, checkfirst=True)
    schema.SlidePageImportJobItem.__table__.create(bind=db.bind, checkfirst=True)
    db.execute(text("ALTER TABLE slide_page_import_job_items ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 1"))
    db.execute(text("ALTER TABLE slide_page_import_job_items ADD COLUMN IF NOT EXISTS completed_steps INTEGER NOT NULL DEFAULT 0"))
    db.execute(text("ALTER TABLE slide_page_import_job_items ADD COLUMN IF NOT EXISTS current_step_label VARCHAR NULL"))
    db.commit()


def recompute_page_import_job_aggregate(db, job: schema.SlidePageImportJob) -> None:
    counts = dict(
        db.query(schema.SlidePageImportJobItem.status, func.count(schema.SlidePageImportJobItem.id))
        .filter(schema.SlidePageImportJobItem.job_id == job.job_id)
        .group_by(schema.SlidePageImportJobItem.status)
        .all()
    )
    queued = counts.get("queued", 0)
    processing = counts.get("processing", 0)
    processed = counts.get("processed", 0)
    skipped = counts.get("skipped", 0)
    failed = counts.get("failed", 0)
    cancelled = counts.get("cancelled", 0)
    job.total_count = sum(counts.values())
    job.processed_count = processed
    job.skipped_count = skipped
    job.failed_count = failed
    job.status = _job_status_from_counts(queued, processing, processed, skipped, failed, cancelled, job.cancel_requested)
    job.updated_at = _now()


def serialize_page_import_job(job: schema.SlidePageImportJob) -> dict:
    status_counts = {}
    for item in job.items:
        status_counts[item.status] = status_counts.get(item.status, 0) + 1
    return {
        "job_id": str(job.job_id),
        "status": job.status,
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
        "items": [
            {
                "item_id": str(item.id),
                "slide_id": str(item.slide_id),
                "status": item.status,
                "retry_count": item.retry_count,
                "total_steps": item.total_steps,
                "completed_steps": item.completed_steps,
                "current_step_label": item.current_step_label,
                "error": item.error,
                "started_at": item.started_at.isoformat() if item.started_at else None,
                "finished_at": item.finished_at.isoformat() if item.finished_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item in job.items
        ],
    }


def create_page_import_batch_job(db, *, slide_ids: list[str], requested_by: str | None = None) -> schema.SlidePageImportJob:
    ensure_slide_page_import_job_schema(db)
    job = schema.SlidePageImportJob(status="queued", total_count=len(slide_ids), requested_by=requested_by)
    db.add(job)
    db.flush()
    for slide_id in slide_ids:
        db.add(
            schema.SlidePageImportJobItem(
                job_id=job.job_id,
                slide_id=slide_id,
                status="queued",
                total_steps=1,
                completed_steps=0,
                current_step_label="queued",
            )
        )
    recompute_page_import_job_aggregate(db, job)
    db.commit()
    db.refresh(job)
    return job


def _enqueue_waiting_process_items_for_slide(slide_id: str) -> None:
    try:
        from .slide_batch_jobs import slide_batch_job_manager
    except Exception:
        return
    db = SessionLocal()
    try:
        waiting_items = (
            db.query(schema.SlideProcessJobItem.id)
            .join(schema.SlideProcessJob, schema.SlideProcessJobItem.job_id == schema.SlideProcessJob.job_id)
            .filter(
                schema.SlideProcessJobItem.slide_id == slide_id,
                schema.SlideProcessJobItem.status == "queued",
                schema.SlideProcessJob.cancel_requested.is_(False),
            )
            .all()
        )
        for (item_id,) in waiting_items:
            slide_batch_job_manager.enqueue_callable(_process_slide_batch_item_wrapper, str(item_id))
    finally:
        db.close()


def _process_slide_batch_item_wrapper(item_id: str) -> None:
    from .slide_batch_jobs import process_slide_batch_item

    process_slide_batch_item(item_id)


def process_slide_page_import_job_item(item_id: str) -> None:
    for attempt in range(2):
        db = SessionLocal()
        try:
            item = db.query(schema.SlidePageImportJobItem).filter(schema.SlidePageImportJobItem.id == item_id).first()
            if not item:
                return
            job = db.query(schema.SlidePageImportJob).filter(schema.SlidePageImportJob.job_id == item.job_id).first()
            if not job or item.status != "queued":
                return

            if job.cancel_requested:
                item.status = "cancelled"
                item.current_step_label = "cancelled"
                item.finished_at = _now()
                recompute_page_import_job_aggregate(db, job)
                db.commit()
                return

            item.status = "processing"
            item.current_step_label = "fetching_pdf"
            item.started_at = _now()
            recompute_page_import_job_aggregate(db, job)
            db.commit()

            slide = db.query(schema.Slide).filter(schema.Slide.id == item.slide_id).first()
            if not slide:
                item.status = "failed"
                item.error = "Slide not found"
                item.current_step_label = "failed"
                item.finished_at = _now()
                recompute_page_import_job_aggregate(db, job)
                db.commit()
                return

            pages = db.query(schema.Page).filter(schema.Page.slide_id == item.slide_id).count()
            if pages > 0:
                item.status = "skipped"
                item.completed_steps = item.total_steps
                item.current_step_label = "already_imported"
                item.finished_at = _now()
                recompute_page_import_job_aggregate(db, job)
                db.commit()
                _enqueue_waiting_process_items_for_slide(str(item.slide_id))
                return

            try:
                from ..config import get_settings

                import_slide_pages(
                    db,
                    slide_id=str(item.slide_id),
                    slide_google_id=slide.slide_google_id,
                    settings=get_settings(),
                    replace_existing=False,
                )
                item.status = "processed"
                item.completed_steps = item.total_steps
                item.current_step_label = "done"
                item.finished_at = _now()
                recompute_page_import_job_aggregate(db, job)
                db.commit()
            except Exception as exc:
                logger.exception(
                    "slide_page_import_item_failed",
                    extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "error": str(exc)},
                )
                item.status = "failed"
                item.error = str(exc)
                item.current_step_label = "failed"
                item.finished_at = _now()
                recompute_page_import_job_aggregate(db, job)
                db.commit()
            finally:
                _enqueue_waiting_process_items_for_slide(str(item.slide_id))
            return
        except OperationalError:
            if attempt == 0:
                logger.warning("slide_page_import_db_connection_lost_retrying", extra={"item_id": item_id})
                try:
                    reset_database_connection()
                except Exception:
                    logger.exception("slide_page_import_db_reset_failed")
                continue
            raise
        finally:
            db.close()
