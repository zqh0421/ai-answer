from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.feedback_link_job_status import get_feedback_link_generation_status
from ..services.ids import generate_short_id
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.FEEDBACK_LINKS])


class FeedbackLinkCreateRequest(BaseModel):
    agent_id: str = Field(min_length=16, max_length=16)
    target_entity_type: Literal["question_version", "interaction", "interaction_option"]
    target_entity_id: str = Field(min_length=16, max_length=16)
    priority: int = 100
    static_feedback_text: Optional[str] = None
    structured_feedback_text: Optional[str] = None
    created_by: str = Field(min_length=16, max_length=16)


class FeedbackLinkBulkCreateRequest(BaseModel):
    agent_id: str = Field(min_length=16, max_length=16)
    interaction_id: str = Field(min_length=16, max_length=16)
    apply_to: Literal["all_options", "correct_options", "incorrect_options", "explicit_option_ids"]
    explicit_option_ids: list[str] = Field(default_factory=list)
    priority: int = 100
    static_feedback_text: Optional[str] = None
    structured_feedback_text: Optional[str] = None
    created_by: str = Field(min_length=16, max_length=16)

    @model_validator(mode="after")
    def validate_explicit_option_ids(self):
        if self.apply_to == "explicit_option_ids" and not self.explicit_option_ids:
            raise ValueError("explicit_option_ids is required when apply_to='explicit_option_ids'")
        return self


def _user_exists(db: Session, user_id: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM users WHERE user_id = :user_id LIMIT 1"), {"user_id": user_id}).scalar())


def _generate_link_id(db: Session) -> str:
    sql = text("SELECT 1 FROM feedback_link WHERE feedback_link_id = :v LIMIT 1")
    for _ in range(50):
        candidate = generate_short_id("fl")
        if not db.execute(sql, {"v": candidate}).scalar():
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate unique feedback_link_id")


def _get_agent(db: Session, agent_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT agent_id, title, role, is_structured, is_visible, created_by
            FROM feedback_agent
            WHERE agent_id = :agent_id
            LIMIT 1
            """
        ),
        {"agent_id": agent_id},
    ).mappings().first()
    return dict(row) if row else None


def _question_version_exists(db: Session, question_version_id: str) -> bool:
    return bool(
        db.execute(
            text("SELECT 1 FROM content_question_version WHERE question_version_id = :qv LIMIT 1"),
            {"qv": question_version_id},
        ).scalar()
    )


def _target_belongs_to_question_version(db: Session, question_version_id: str, target_entity_type: str, target_entity_id: str) -> bool:
    if target_entity_type == "question_version":
        return target_entity_id == question_version_id and _question_version_exists(db, question_version_id)
    if target_entity_type == "interaction":
        return bool(
            db.execute(
                text(
                    """
                    SELECT 1
                    FROM content_question_interaction
                    WHERE interaction_id = :target_entity_id AND question_version_id = :question_version_id
                    LIMIT 1
                    """
                ),
                {"target_entity_id": target_entity_id, "question_version_id": question_version_id},
            ).scalar()
        )
    if target_entity_type == "interaction_option":
        return bool(
            db.execute(
                text(
                    """
                    SELECT 1
                    FROM content_question_interaction_option o
                    JOIN content_question_interaction i ON i.interaction_id = o.interaction_id
                    WHERE o.interaction_option_id = :target_entity_id
                      AND i.question_version_id = :question_version_id
                    LIMIT 1
                    """
                ),
                {"target_entity_id": target_entity_id, "question_version_id": question_version_id},
            ).scalar()
        )
    return False


def _validate_link_payload(db: Session, question_version_id: str, payload: FeedbackLinkCreateRequest) -> dict[str, Any]:
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")
    if not _question_version_exists(db, question_version_id):
        raise HTTPException(status_code=404, detail="question_version not found")

    agent = _get_agent(db, payload.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="feedback agent not found")

    if not _target_belongs_to_question_version(db, question_version_id, payload.target_entity_type, payload.target_entity_id):
        raise HTTPException(status_code=400, detail="target entity does not belong to the provided question_version")

    return agent


def _insert_feedback_link(
    db: Session,
    *,
    question_version_id: str,
    agent_id: str,
    target_entity_type: str,
    target_entity_id: str,
    priority: int,
    static_feedback_text: str | None,
    structured_feedback_text: str | None,
    created_by: str,
) -> str:
    feedback_link_id = _generate_link_id(db)
    db.execute(
        text(
            """
            INSERT INTO feedback_link (
              feedback_link_id, question_version_id, agent_id, target_entity_type, target_entity_id,
              priority, static_feedback_text, structured_feedback_text, is_visible, created_by, created_at
            ) VALUES (
              :feedback_link_id, :question_version_id, :agent_id, :target_entity_type, :target_entity_id,
              :priority, :static_feedback_text, :structured_feedback_text, TRUE, :created_by, NOW()
            )
            """
        ),
        {
            "feedback_link_id": feedback_link_id,
            "question_version_id": question_version_id,
            "agent_id": agent_id,
            "target_entity_type": target_entity_type,
            "target_entity_id": target_entity_id,
            "priority": priority,
            "static_feedback_text": static_feedback_text,
            "structured_feedback_text": structured_feedback_text,
            "created_by": created_by,
        },
    )
    return feedback_link_id


def _fetch_links_for_question_version(db: Session, question_version_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              fl.feedback_link_id,
              fl.question_version_id,
              fl.agent_id,
              fa.title AS agent_title,
              fa.role AS agent_role,
              fa.is_structured AS agent_is_structured,
              fl.target_entity_type,
              fl.target_entity_id,
              fl.priority,
              fl.static_feedback_text,
              fl.structured_feedback_text,
              fl.is_visible,
              fl.created_by,
              fl.created_at
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :question_version_id
            ORDER BY fl.is_visible DESC, fl.priority ASC, fl.created_at ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    items = [dict(r) for r in rows]
    for item in items:
        if str(item.get("agent_role") or "") != "ai":
            continue
        generation = get_feedback_link_generation_status(str(item["feedback_link_id"]))
        if generation:
            item["generation"] = generation
            item["generation_status"] = generation.get("status")
            if generation.get("error"):
                item["generation_error"] = generation.get("error")
    return items


@router.get("/question-versions/{question_version_id}/feedback-links")
def list_feedback_links(
    question_version_id: str,
    visible_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    if not _question_version_exists(db, question_version_id):
        raise HTTPException(status_code=404, detail="question_version not found")
    items = _fetch_links_for_question_version(db, question_version_id)
    if visible_only:
        items = [x for x in items if x["is_visible"]]
    return {"ok": True, "question_version_id": question_version_id, "count": len(items), "items": items}


@router.post("/question-versions/{question_version_id}/feedback-links")
def create_feedback_link(question_version_id: str, payload: FeedbackLinkCreateRequest, db: Session = Depends(get_db)):
    _validate_link_payload(db, question_version_id, payload)
    try:
        link_id = _insert_feedback_link(
            db,
            question_version_id=question_version_id,
            agent_id=payload.agent_id,
            target_entity_type=payload.target_entity_type,
            target_entity_id=payload.target_entity_id,
            priority=payload.priority,
            static_feedback_text=payload.static_feedback_text,
            structured_feedback_text=payload.structured_feedback_text,
            created_by=payload.created_by,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    items = _fetch_links_for_question_version(db, question_version_id)
    created = next((x for x in items if x["feedback_link_id"] == link_id), None)
    return {"ok": True, "feedback_link_id": link_id, "item": created}


@router.post("/question-versions/{question_version_id}/feedback-links/bulk-create")
def bulk_create_feedback_links(question_version_id: str, payload: FeedbackLinkBulkCreateRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")
    if not _question_version_exists(db, question_version_id):
        raise HTTPException(status_code=404, detail="question_version not found")

    agent = _get_agent(db, payload.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="feedback agent not found")

    interaction = db.execute(
        text(
            """
            SELECT interaction_id, interaction_type
            FROM content_question_interaction
            WHERE interaction_id = :interaction_id AND question_version_id = :question_version_id
            LIMIT 1
            """
        ),
        {"interaction_id": payload.interaction_id, "question_version_id": question_version_id},
    ).mappings().first()
    if not interaction:
        raise HTTPException(status_code=400, detail="interaction does not belong to the provided question_version")

    option_rows = db.execute(
        text(
            """
            SELECT interaction_option_id, is_correct
            FROM content_question_interaction_option
            WHERE interaction_id = :interaction_id
            ORDER BY option_order ASC
            """
        ),
        {"interaction_id": payload.interaction_id},
    ).mappings().all()
    if not option_rows:
        raise HTTPException(status_code=400, detail="interaction has no options for bulk-create")

    if payload.apply_to == "all_options":
        target_option_ids = [r["interaction_option_id"] for r in option_rows]
    elif payload.apply_to == "correct_options":
        target_option_ids = [r["interaction_option_id"] for r in option_rows if r["is_correct"]]
    elif payload.apply_to == "incorrect_options":
        target_option_ids = [r["interaction_option_id"] for r in option_rows if not r["is_correct"]]
    else:
        valid_ids = {r["interaction_option_id"] for r in option_rows}
        invalid = [x for x in payload.explicit_option_ids if x not in valid_ids]
        if invalid:
            raise HTTPException(status_code=400, detail={"invalid_option_ids": invalid})
        target_option_ids = payload.explicit_option_ids

    if not target_option_ids:
        raise HTTPException(status_code=400, detail="No target options selected")

    created_ids: list[str] = []
    try:
        for option_id in target_option_ids:
            created_ids.append(
                _insert_feedback_link(
                    db,
                    question_version_id=question_version_id,
                    agent_id=payload.agent_id,
                    target_entity_type="interaction_option",
                    target_entity_id=option_id,
                    priority=payload.priority,
                    static_feedback_text=payload.static_feedback_text,
                    structured_feedback_text=payload.structured_feedback_text,
                    created_by=payload.created_by,
                )
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    items = _fetch_links_for_question_version(db, question_version_id)
    created_items = [x for x in items if x["feedback_link_id"] in set(created_ids)]
    return {
        "ok": True,
        "question_version_id": question_version_id,
        "created_count": len(created_ids),
        "feedback_link_ids": created_ids,
        "items": created_items,
    }


@router.delete("/feedback-links/{feedback_link_id}")
def delete_feedback_link(
    feedback_link_id: str,
    updated_by: str = Query(..., min_length=16, max_length=16),
    db: Session = Depends(get_db),
):
    if not _user_exists(db, updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")

    row = db.execute(
        text(
            """
            UPDATE feedback_link
            SET is_visible = FALSE
            WHERE feedback_link_id = :feedback_link_id
            RETURNING feedback_link_id, question_version_id
            """
        ),
        {"feedback_link_id": feedback_link_id},
    ).mappings().first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="feedback link not found")
    db.commit()
    return {
        "ok": True,
        "feedback_link_id": row["feedback_link_id"],
        "question_version_id": row["question_version_id"],
        "is_visible": False,
    }
