import logging
import platform
import time
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from .. import schema
from ..config import get_settings
from ..database import SessionLocal, reset_database_connection
from .slide_pages import import_slide_pages
from .vision_jobs import run_vision_for_slide

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.utcnow()


def _max_retries() -> int:
    value = get_settings().slide_batch_max_retries
    return value if value > 0 else 4


def _retry_base_seconds() -> float:
    value = get_settings().slide_batch_retry_base_seconds
    return value if value > 0 else 1.0


def _is_transient_error(exc: Exception) -> bool:
    message = str(exc).lower()
    transient_keywords = (
        "429",
        "rate limit",
        "too many requests",
        "timeout",
        "timed out",
        "connection reset",
        "connection aborted",
        "temporarily unavailable",
        "bad gateway",
        "service unavailable",
        "gateway timeout",
        "500",
        "502",
        "503",
        "504",
    )
    return any(keyword in message for keyword in transient_keywords)


def _job_status_from_counts(
    queued: int,
    processing: int,
    processed: int,
    skipped: int,
    failed: int,
    cancelled: int,
    cancel_requested: bool,
) -> str:
    if cancel_requested and queued == 0 and processing == 0:
        return "cancelled"
    if processing > 0:
        return "processing"
    if queued > 0:
        return "queued"
    if failed > 0:
        return "failed"
    return "completed"


def recompute_job_aggregate(db, job: schema.SlideProcessJob) -> None:
    counts = dict(
        db.query(schema.SlideProcessJobItem.status, func.count(schema.SlideProcessJobItem.id))
        .filter(schema.SlideProcessJobItem.job_id == job.job_id)
        .group_by(schema.SlideProcessJobItem.status)
        .all()
    )

    queued_count = counts.get("queued", 0)
    processing_count = counts.get("processing", 0)
    processed_count = counts.get("processed", 0)
    skipped_count = counts.get("skipped", 0)
    failed_count = counts.get("failed", 0)
    cancelled_count = counts.get("cancelled", 0)

    job.total_count = sum(counts.values())
    job.processed_count = processed_count
    job.skipped_count = skipped_count
    job.failed_count = failed_count
    job.status = _job_status_from_counts(
        queued=queued_count,
        processing=processing_count,
        processed=processed_count,
        skipped=skipped_count,
        failed=failed_count,
        cancelled=cancelled_count,
        cancel_requested=job.cancel_requested,
    )
    job.updated_at = _now()


def ensure_slide_batch_job_schema(db) -> None:
    schema.SlideProcessJob.__table__.create(bind=db.bind, checkfirst=True)
    schema.SlideProcessJobItem.__table__.create(bind=db.bind, checkfirst=True)
    # Backfill newly added columns on existing deployments.
    db.execute(text("ALTER TABLE slide_process_job_items ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 0"))
    db.execute(text("ALTER TABLE slide_process_job_items ADD COLUMN IF NOT EXISTS completed_steps INTEGER NOT NULL DEFAULT 0"))
    db.execute(text("ALTER TABLE slide_process_job_items ADD COLUMN IF NOT EXISTS current_step_label VARCHAR NULL"))
    db.commit()


class SlideBatchJobManager:
    def __init__(self) -> None:
        settings = get_settings()
        self._redis_url = settings.slide_batch_redis_url
        self._queue_name = settings.slide_batch_queue_name
        self._default_timeout = str(settings.slide_batch_job_timeout)
        self._result_ttl = str(settings.slide_batch_rq_result_ttl)
        self._max_retries = settings.slide_batch_max_retries if settings.slide_batch_max_retries > 0 else 4
        self._retry_base_seconds = (
            settings.slide_batch_retry_base_seconds if settings.slide_batch_retry_base_seconds > 0 else 1.0
        )

    def _queue(self):
        try:
            from redis import Redis
            from rq import Queue
        except Exception as exc:
            raise RuntimeError(
                "Redis + RQ dependencies missing. Install 'redis' and 'rq' to enable reliable slide batch jobs."
            ) from exc
        conn = Redis.from_url(self._redis_url)
        return Queue(self._queue_name, connection=conn, default_timeout=self._default_timeout)

    def _rq_retry(self):
        if self._max_retries <= 1:
            return None
        try:
            from rq import Retry
        except Exception:
            return None

        # Exponential backoff intervals, e.g. 1, 2, 4, 8...
        retry_count = max(1, int(self._max_retries))
        intervals = [max(1, int(self._retry_base_seconds * (2 ** i))) for i in range(retry_count - 1)]
        return Retry(max=retry_count, interval=intervals)

    def enqueue_job(self, job_id: str) -> None:
        db = SessionLocal()
        try:
            item_ids = (
                db.query(schema.SlideProcessJobItem.id)
                .filter(
                    schema.SlideProcessJobItem.job_id == job_id,
                    schema.SlideProcessJobItem.status == "queued",
                )
                .all()
            )
        finally:
            db.close()

        queue = self._queue()
        retry = self._rq_retry()
        for (item_id,) in item_ids:
            queue.enqueue(
                process_slide_batch_item,
                str(item_id),
                result_ttl=int(self._result_ttl),
                retry=retry,
            )

    def enqueue_callable(self, func: Any, *args: Any, **kwargs: Any) -> str:
        queue = self._queue()
        rq_target: Any = func
        if callable(func):
            module_name = getattr(func, "__module__", "") or ""
            func_name = getattr(func, "__name__", "") or ""
            if module_name and func_name:
                rq_target = f"{module_name}.{func_name}"
        job = queue.enqueue(
            rq_target,
            *args,
            result_ttl=int(self._result_ttl),
            retry=self._rq_retry(),
            **kwargs,
        )
        return job.id

    def queue_name(self) -> str:
        return self._queue_name

    def redis_url(self) -> str:
        return self._redis_url


def _process_slide_batch_item_once(db, item_id: str) -> None:
    item = db.query(schema.SlideProcessJobItem).filter(schema.SlideProcessJobItem.id == item_id).first()
    if not item:
        return
    job = db.query(schema.SlideProcessJob).filter(schema.SlideProcessJob.job_id == item.job_id).first()
    if not job:
        return

    if item.status != "queued":
        return

    if job.cancel_requested:
        logger.info(
            "slide_batch_item_cancelled_before_start",
            extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "step": "precheck", "status": "cancelled"},
        )
        item.status = "cancelled"
        item.finished_at = _now()
        recompute_job_aggregate(db, job)
        db.commit()
        return

    item.status = "processing"
    item.started_at = _now()
    item.error = None
    item.completed_steps = item.completed_steps or 0
    item.current_step_label = "starting"
    logger.info(
        "slide_batch_item_processing",
        extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "step": "start", "status": "processing"},
    )
    recompute_job_aggregate(db, job)
    db.commit()

    slide = db.query(schema.Slide).filter(schema.Slide.id == item.slide_id).first()
    if not slide:
        logger.warning(
            "slide_batch_item_failed",
            extra={
                "job_id": str(job.job_id),
                "slide_id": str(item.slide_id),
                "step": "load_slide",
                "status": "failed",
                "error": "Slide not found",
            },
        )
        item.status = "failed"
        item.error = "Slide not found"
        item.finished_at = _now()
        recompute_job_aggregate(db, job)
        db.commit()
        return

    # Prerequisite: if a page-import job exists for this slide and is not finished, keep this item queued.
    try:
        latest_page_import_item = (
            db.query(schema.SlidePageImportJobItem)
            .filter(schema.SlidePageImportJobItem.slide_id == item.slide_id)
            .order_by(schema.SlidePageImportJobItem.updated_at.desc())
            .first()
        )
    except SQLAlchemyError:
        # Older jobs / deployments may not have page-import job tables yet.
        db.rollback()
        latest_page_import_item = None
    if latest_page_import_item and latest_page_import_item.status in {"queued", "processing"}:
        item.status = "queued"
        item.current_step_label = "waiting_page_import"
        item.started_at = None
        recompute_job_aggregate(db, job)
        db.commit()
        return

    page_stats = (
        db.query(
            func.count(schema.Page.page_id).label("total_pages"),
            func.count(schema.Page.image_text).label("vision_pages"),
            func.count(schema.Page.vector).label("vector_pages"),
        )
        .filter(schema.Page.slide_id == item.slide_id)
        .one()
    )
    total_pages = int(page_stats.total_pages or 0)
    vision_pages = int(page_stats.vision_pages or 0)
    vector_pages = int(page_stats.vector_pages or 0)

    if total_pages == 0:
        try:
            item.current_step_label = "importing_pages"
            db.commit()
            import_slide_pages(
                db,
                slide_id=str(item.slide_id),
                slide_google_id=slide.slide_google_id,
                settings=get_settings(),
                replace_existing=False,
            )
        except Exception as exc:
            logger.warning(
                "slide_batch_item_failed",
                extra={
                    "job_id": str(job.job_id),
                    "slide_id": str(item.slide_id),
                    "step": "load_pages",
                    "status": "failed",
                    "error": f"No pages found for this slide ({exc})",
                },
            )
            item.status = "failed"
            item.error = "No pages found for this slide"
            item.current_step_label = "failed_no_pages"
            item.finished_at = _now()
            recompute_job_aggregate(db, job)
            db.commit()
            return
        page_stats = (
            db.query(
                func.count(schema.Page.page_id).label("total_pages"),
                func.count(schema.Page.image_text).label("vision_pages"),
                func.count(schema.Page.vector).label("vector_pages"),
            )
            .filter(schema.Page.slide_id == item.slide_id)
            .one()
        )
        total_pages = int(page_stats.total_pages or 0)
        vision_pages = int(page_stats.vision_pages or 0)
        vector_pages = int(page_stats.vector_pages or 0)
        if total_pages == 0:
            logger.warning(
                "slide_batch_item_failed",
                extra={
                    "job_id": str(job.job_id),
                    "slide_id": str(item.slide_id),
                    "step": "load_pages",
                    "status": "failed",
                    "error": "No pages found for this slide",
                },
            )
            item.status = "failed"
            item.error = "No pages found for this slide"
            item.current_step_label = "failed_no_pages"
            item.finished_at = _now()
            recompute_job_aggregate(db, job)
            db.commit()
            return

    has_summary = bool(slide.vision_summary)
    has_page_vision = total_pages > 0 and vision_pages == total_pages
    has_vectors = total_pages > 0 and vector_pages == total_pages
    item.total_steps = total_pages + 1  # page-level vision + slide summary
    should_skip = (not job.force_process_all) and has_summary and has_page_vision and has_vectors
    if should_skip:
        logger.info(
            "slide_batch_item_skipped",
            extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "step": "precheck", "status": "skipped"},
        )
        item.status = "skipped"
        item.completed_steps = item.total_steps
        item.current_step_label = "skipped_existing"
        item.finished_at = _now()
        recompute_job_aggregate(db, job)
        db.commit()
        return

    pages = db.query(schema.Page).filter(schema.Page.slide_id == item.slide_id).all()
    settings = get_settings()
    max_attempts = _max_retries()
    base_wait = _retry_base_seconds()
    attempt = 0

    def _update_progress(completed_steps: int, step_label: str) -> None:
        item.completed_steps = max(0, min(completed_steps, item.total_steps))
        item.current_step_label = step_label
        db.add(item)
        db.commit()
        db.refresh(item)

    while attempt < max_attempts:
        db.refresh(job)
        if job.cancel_requested:
            logger.info(
                "slide_batch_item_cancelled",
                extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "step": "before_run", "status": "cancelled"},
            )
            item.status = "cancelled"
            item.current_step_label = "cancelled"
            item.finished_at = _now()
            recompute_job_aggregate(db, job)
            db.commit()
            return

        try:
            _update_progress(item.completed_steps, "running")
            run_vision_for_slide(
                str(item.slide_id),
                slide.slide_google_id,
                settings,
                force_process_all=job.force_process_all,
                progress_callback=lambda progress: _update_progress(
                    progress.get("completed_steps", item.completed_steps),
                    progress.get("current_step_label", "running"),
                ),
            )
            logger.info(
                "slide_batch_item_processed",
                extra={"job_id": str(job.job_id), "slide_id": str(item.slide_id), "step": "run_vision", "status": "processed"},
            )
            item.status = "processed"
            item.finished_at = _now()
            item.retry_count = attempt
            item.completed_steps = item.total_steps
            item.current_step_label = "done"
            recompute_job_aggregate(db, job)
            db.commit()
            return
        except Exception as exc:
            attempt += 1
            item.retry_count = attempt
            if attempt >= max_attempts or not _is_transient_error(exc):
                logger.exception(
                    "slide_batch_item_failed",
                    extra={
                        "job_id": str(job.job_id),
                        "slide_id": str(item.slide_id),
                        "step": "run_vision",
                        "status": "failed",
                        "error": str(exc),
                    },
                )
                item.status = "failed"
                item.error = str(exc)
                item.current_step_label = "failed"
                item.finished_at = _now()
                recompute_job_aggregate(db, job)
                db.commit()
                return
            logger.warning(
                "slide_batch_item_retry",
                extra={
                    "job_id": str(job.job_id),
                    "slide_id": str(item.slide_id),
                    "step": "run_vision",
                    "status": "retrying",
                    "error": str(exc),
                },
            )
            db.rollback()
            time.sleep(base_wait * (2 ** (attempt - 1)))
            item = db.query(schema.SlideProcessJobItem).filter(schema.SlideProcessJobItem.id == item_id).first()
            if not item:
                return
            job = db.query(schema.SlideProcessJob).filter(schema.SlideProcessJob.job_id == item.job_id).first()
            if not job:
                return
            slide = db.query(schema.Slide).filter(schema.Slide.id == item.slide_id).first()
            if not slide:
                item.status = "failed"
                item.error = "Slide not found after retry"
                item.finished_at = _now()
                recompute_job_aggregate(db, job)
                db.commit()
                return


def process_slide_batch_item(item_id: str) -> None:
    for db_retry in range(2):
        db = SessionLocal()
        try:
            _process_slide_batch_item_once(db, item_id)
            return
        except OperationalError:
            if db_retry == 0:
                logger.warning("slide_batch_db_connection_lost_retrying", extra={"item_id": item_id})
                try:
                    reset_database_connection()
                except Exception:
                    logger.exception("slide_batch_db_reset_failed")
                continue
            raise
        finally:
            db.close()


def run_slide_batch_worker() -> None:
    try:
        from redis import Redis
        from rq import Connection, Worker, SimpleWorker
    except Exception as exc:
        raise RuntimeError(
            "Redis + RQ dependencies missing. Install 'redis' and 'rq' to run the slide batch worker."
        ) from exc

    manager = slide_batch_job_manager
    conn = Redis.from_url(manager.redis_url())
    worker_mode = get_settings().slide_batch_worker_mode.strip().lower()
    # macOS + fork + background threads (e.g. SSH tunnel) can crash with objc fork safety.
    use_simple_worker = worker_mode == "simple" or (worker_mode == "" and platform.system().lower() == "darwin")
    with Connection(conn):
        worker_cls = SimpleWorker if use_simple_worker else Worker
        worker = worker_cls([manager.queue_name()])
        worker.work(with_scheduler=True)


slide_batch_job_manager = SlideBatchJobManager()
