import asyncio
from typing import Any, Callable, TypeVar
from .config import get_settings

T = TypeVar("T")


def _read_max_openai_concurrency() -> int:
    value = get_settings().openai_max_concurrency
    return value if value > 0 else 16


_openai_semaphore = asyncio.Semaphore(_read_max_openai_concurrency())


async def run_blocking(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await asyncio.to_thread(func, *args, **kwargs)


async def run_openai_blocking(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    async with _openai_semaphore:
        return await asyncio.to_thread(func, *args, **kwargs)
