import logging
import time
from contextlib import contextmanager
from ..config import get_settings

logger = logging.getLogger(__name__)


def _max_inflight() -> int:
    value = get_settings().openai_vision_global_max_inflight
    return value if value > 0 else 0


def _acquire_timeout_seconds() -> float:
    value = get_settings().openai_vision_budget_acquire_timeout_seconds
    return value if value > 0 else 600.0


def _poll_interval_seconds() -> float:
    value = get_settings().openai_vision_budget_poll_seconds
    return value if value > 0 else 0.2


def _redis_url() -> str:
    return get_settings().slide_batch_redis_url


def _redis_counter_key() -> str:
    return get_settings().openai_vision_budget_redis_key


def _get_redis_client():
    try:
        from redis import Redis
    except Exception:
        return None
    try:
        return Redis.from_url(_redis_url())
    except Exception:
        return None


@contextmanager
def acquire_openai_vision_budget():
    limit = _max_inflight()
    if limit <= 0:
        yield
        return

    redis_client = _get_redis_client()
    if redis_client is None:
        # Fallback to no limiter when Redis is unavailable; avoid breaking requests.
        yield
        return

    key = _redis_counter_key()
    timeout = _acquire_timeout_seconds()
    poll = _poll_interval_seconds()
    started = time.monotonic()
    acquired = False

    while (time.monotonic() - started) < timeout:
        try:
            current = int(redis_client.incr(key))
            if current <= limit:
                acquired = True
                break
            redis_client.decr(key)
        except Exception:
            logger.exception("openai_vision_budget_acquire_failed")
            break
        time.sleep(poll)

    if not acquired:
        raise TimeoutError("Timed out waiting for global OpenAI vision concurrency budget")

    try:
        yield
    finally:
        try:
            redis_client.decr(key)
        except Exception:
            logger.exception("openai_vision_budget_release_failed")
