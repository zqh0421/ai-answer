from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..dependencies import stop_tunnel
from ..dependencies import get_db
from ..services.semantic_schema import (
    backfill_user_user_ids,
    ensure_semantic_schema,
    get_semantic_question_type_distribution,
    get_semantic_question_version_detail,
    list_semantic_question_samples,
    migrate_legacy_static_feedback_links,
    migrate_legacy_questions_to_semantic,
    seed_semantic_test_agents,
    semantic_schema_status,
)
from ..tags import Tags

router = APIRouter(prefix="/api")


@router.on_event("shutdown")
async def shutdown_event():
    stop_tunnel()


@router.get("/test", tags=[Tags.SYSTEM_HEALTH])
def test():
    return {"message": "Backend Connected!"}


@router.post("/system/semantic-schema/init", tags=[Tags.SYSTEM_MAINTENANCE])
def init_semantic_schema(db: Session = Depends(get_db)):
    """
    Bootstrap next-generation semantic tables with idempotent DDL.
    Safe to run multiple times.
    """
    return ensure_semantic_schema(db)


@router.post("/system/semantic-schema/backfill-user-ids", tags=[Tags.SYSTEM_MAINTENANCE])
def backfill_semantic_user_ids(
    dry_run: bool = Query(default=True),
    limit: int | None = Query(default=None, ge=0),
    db: Session = Depends(get_db),
):
    """
    Backfill users.user_id with `us_` prefixed short IDs (length=16).
    Safe to run repeatedly; only missing user_id rows are updated.
    """
    return backfill_user_user_ids(db, dry_run=dry_run, limit=limit)


@router.get("/system/semantic-schema/status", tags=[Tags.SYSTEM_MAINTENANCE])
def get_semantic_schema_status(db: Session = Depends(get_db)):
    """Quick row-count/status snapshot for semantic tables and legacy sources."""
    return semantic_schema_status(db)


@router.get("/system/semantic-schema/question-types", tags=[Tags.SYSTEM_MAINTENANCE])
def get_semantic_question_types(db: Session = Depends(get_db)):
    """Distribution of migrated semantic question types (by question_version.question_type)."""
    return get_semantic_question_type_distribution(db)


@router.get("/system/semantic-schema/questions-sample", tags=[Tags.SYSTEM_MAINTENANCE])
def get_semantic_questions_sample(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    question_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """List semantic question samples with summary counts for quick inspection."""
    return list_semantic_question_samples(
        db,
        limit=limit,
        offset=offset,
        question_type=question_type,
    )


@router.get("/system/semantic-schema/question-version/{question_version_id}", tags=[Tags.SYSTEM_MAINTENANCE])
def get_semantic_question_version(question_version_id: str, db: Session = Depends(get_db)):
    """Full semantic question-version detail including blocks/interactions/options/scope/feedback links."""
    payload = get_semantic_question_version_detail(db, question_version_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="question_version not found")
    return payload


@router.post("/system/semantic-schema/migrate-questions", tags=[Tags.SYSTEM_MAINTENANCE])
def migrate_semantic_questions(
    dry_run: bool = Query(default=True),
    limit: int = Query(default=10, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """
    Migrate a limited batch of legacy questions into semantic tables for testing.
    Uses mapping tables to remain idempotent across repeated runs.
    """
    return migrate_legacy_questions_to_semantic(db, dry_run=dry_run, limit=limit)


@router.post("/system/semantic-schema/seed-test-agents", tags=[Tags.SYSTEM_MAINTENANCE])
def seed_semantic_agents(
    dry_run: bool = Query(default=True),
    created_by: str | None = Query(default=None, min_length=16, max_length=16),
    db: Session = Depends(get_db),
):
    """
    Seed a minimal set of semantic feedback agents for integration testing.
    """
    return seed_semantic_test_agents(db, created_by=created_by, dry_run=dry_run)


@router.post("/system/semantic-schema/migrate-feedback-links", tags=[Tags.SYSTEM_MAINTENANCE])
def migrate_semantic_feedback_links(
    dry_run: bool = Query(default=True),
    limit: int = Query(default=20, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """
    Migrate legacy static human feedback (OEQ/MCQ) into feedback_link for already-migrated questions.
    """
    return migrate_legacy_static_feedback_links(db, dry_run=dry_run, limit=limit)
