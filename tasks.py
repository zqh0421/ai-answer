import os
import shutil
from pathlib import Path

from invoke import task

ROOT = Path(__file__).resolve().parent
PYTHON = os.environ.get("PYTHON", "python3")
VENV = ROOT / os.environ.get("VENV", "venv")
ACTIVATE = f". {VENV}/bin/activate"
UVICORN_APP = os.environ.get("UVICORN_APP", "api.index:app")
UVICORN_HOST = os.environ.get("UVICORN_HOST", "0.0.0.0")
UVICORN_PORT = os.environ.get("UVICORN_PORT", "8000")


def _venv_ready() -> bool:
    return (VENV / "bin" / "activate").exists()


def _run_in_venv(ctx, command: str) -> None:
    ctx.run(f"{ACTIVATE} && {command}", pty=True)


def _ensure_venv(ctx) -> None:
    if not _venv_ready():
        ctx.run(f"{PYTHON} -m venv {VENV}", pty=True)
        _run_in_venv(ctx, "pip install --upgrade pip")


@task(help={"upgrade": "Force re-install of dependencies"})
def install(ctx, upgrade=False):
    """Create (or refresh) the virtual environment and install deps."""
    if upgrade and VENV.exists():
        shutil.rmtree(VENV)

    _ensure_venv(ctx)
    _run_in_venv(ctx, "pip install -r requirements.txt")


@task
def deps(ctx):
    """Install dependencies after editing requirements.txt."""
    _ensure_venv(ctx)
    _run_in_venv(ctx, "pip install -r requirements.txt")


@task
def dev(ctx):
    """Start uvicorn with auto-reload."""
    _ensure_venv(ctx)
    _run_in_venv(
        ctx,
        f"uvicorn {UVICORN_APP} --reload --host {UVICORN_HOST} --port {UVICORN_PORT}",
    )


@task
def run(ctx):
    """Start uvicorn without reload."""
    _ensure_venv(ctx)
    _run_in_venv(
        ctx, f"uvicorn {UVICORN_APP} --host {UVICORN_HOST} --port {UVICORN_PORT}"
    )


@task
def worker_slide_batch(ctx):
    """Start Redis+RQ worker for slide batch jobs."""
    _ensure_venv(ctx)
    _run_in_venv(ctx, "python -m api.workers.slide_batch_worker")


@task
def shell(ctx):
    """Open an interactive shell inside the virtual environment."""
    _ensure_venv(ctx)
    ctx.run(f"{ACTIVATE} && exec $SHELL", pty=True)


@task
def clean(ctx):
    """Remove Python cache files."""
    for pycache in ROOT.rglob("__pycache__"):
        shutil.rmtree(pycache, ignore_errors=True)
    for extension in ("*.pyc", "*.pyo"):
        for file in ROOT.rglob(extension):
            try:
                file.unlink()
            except FileNotFoundError:
                pass


@task
def clean_venv(ctx):
    """Delete the virtual environment."""
    if VENV.exists():
        shutil.rmtree(VENV)
