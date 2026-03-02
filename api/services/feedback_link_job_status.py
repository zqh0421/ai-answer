from __future__ import annotations

from datetime import datetime
from typing import Any

from ..config import get_settings

_KEY_PREFIX = "feedback_link_generation_job"


def _redis_client():
    try:
        from redis import Redis
    except Exception:
        return None
    return Redis.from_url(get_settings().slide_batch_redis_url)


def _mapping_key(feedback_link_id: str) -> str:
    return f"{_KEY_PREFIX}:{feedback_link_id}"


def set_feedback_link_generation_job_id(feedback_link_id: str, job_id: str) -> None:
    client = _redis_client()
    if client is None:
        return
    client.set(_mapping_key(feedback_link_id), job_id)


def get_feedback_link_generation_job_id(feedback_link_id: str) -> str | None:
    client = _redis_client()
    if client is None:
        return None
    raw = client.get(_mapping_key(feedback_link_id))
    if raw is None:
        return None
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="ignore")
    return str(raw)


def _iso(dt: Any) -> str | None:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return None


def get_rq_job_status(job_id: str) -> dict[str, Any]:
    try:
        from redis import Redis
        from rq.job import Job
    except Exception as exc:
        return {"job_id": job_id, "status": "unavailable", "error": f"rq_dependencies_missing: {exc}"}

    conn = Redis.from_url(get_settings().slide_batch_redis_url)
    try:
        job = Job.fetch(job_id, connection=conn)
    except Exception as exc:
        return {"job_id": job_id, "status": "not_found", "error": str(exc)}

    try:
        status = job.get_status(refresh=True)
    except Exception:
        status = getattr(job, "status", None) or "unknown"

    payload: dict[str, Any] = {
        "job_id": job_id,
        "status": str(status),
        "enqueued_at": _iso(getattr(job, "enqueued_at", None)),
        "started_at": _iso(getattr(job, "started_at", None)),
        "ended_at": _iso(getattr(job, "ended_at", None)),
    }

    if getattr(job, "exc_info", None):
        payload["error"] = str(job.exc_info)[-4000:]

    result = getattr(job, "result", None)
    if isinstance(result, dict):
        payload["result"] = result
    elif result is not None:
        payload["result"] = str(result)

    return payload


def get_feedback_link_generation_status(feedback_link_id: str) -> dict[str, Any] | None:
    job_id = get_feedback_link_generation_job_id(feedback_link_id)
    if not job_id:
        return None
    payload = get_rq_job_status(job_id)
    payload["feedback_link_id"] = feedback_link_id
    return payload
