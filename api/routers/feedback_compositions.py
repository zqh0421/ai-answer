from __future__ import annotations

import secrets
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.feedback_composition_expr import CompositionExprError, compile_condition_expression
from ..tags import Tags


router = APIRouter(prefix="/api", tags=[Tags.FEEDBACK_COMPOSITIONS])

FeedbackMode = Literal["use_latest_version", "runtime_generate"]
SlideMode = Literal["most_relevant_slide_page", "slide_file", "no_slide"]
QuestionType = Literal["mcq", "oeq"]
AccessScope = Literal["private", "public"]


class CompositionRuleIn(BaseModel):
    rule_order: int = Field(ge=1)
    condition_expression: str = Field(min_length=1, max_length=2000)
    feedback_mode: FeedbackMode
    feedback_agent_id: str = Field(min_length=1, max_length=64)
    slide_mode: SlideMode
    is_enabled: bool = True


class CompositionCreateRequest(BaseModel):
    composition_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    question_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    question_type: Optional[QuestionType] = None
    access_scope: AccessScope = "private"
    created_by: str = Field(min_length=1, max_length=64)
    updated_by: Optional[str] = Field(default=None, min_length=1, max_length=64)
    rules: list[CompositionRuleIn] = Field(default_factory=list)


class CompositionPatchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    question_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    question_type: Optional[QuestionType] = None
    access_scope: AccessScope = "private"
    updated_by: str = Field(min_length=1, max_length=64)
    rules: list[CompositionRuleIn] = Field(default_factory=list)


class ResolveQuery(BaseModel):
    learner_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    question_id: str = Field(min_length=1, max_length=64)
    launch_id: Optional[str] = None
    lti_launch_id: Optional[str] = None
    question_type: Optional[QuestionType] = None

    @model_validator(mode="after")
    def check_launch_fields(self):
        if self.launch_id and self.lti_launch_id and self.launch_id != self.lti_launch_id:
            raise ValueError("launch_id and lti_launch_id must be equal when both set")
        return self


def _coerce_learner_id(value: str | None) -> str:
    if value and value.strip():
        return value.strip()
    return f"test_learner_{secrets.token_hex(4)}"


def _validate_rules(rules: list[CompositionRuleIn]) -> None:
    seen_orders: set[int] = set()
    for rule in rules:
        if rule.rule_order in seen_orders:
            raise HTTPException(status_code=400, detail=f"duplicate rule_order={rule.rule_order}")
        seen_orders.add(rule.rule_order)
        try:
            compile_condition_expression(rule.condition_expression)
        except CompositionExprError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": exc.code,
                    "message": str(exc),
                    "rule_order": rule.rule_order,
                },
            ) from exc


def _serialize_rules(db: Session, composition_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              rule_id, composition_id, rule_order, condition_expression, feedback_mode,
              feedback_agent_id, slide_mode, is_enabled, created_at, updated_at
            FROM feedback_composition_rules
            WHERE composition_id = :composition_id
            ORDER BY rule_order ASC, rule_id ASC
            """
        ),
        {"composition_id": composition_id},
    ).mappings().all()
    return [
        {
            "rule_id": str(r["rule_id"]),
            "composition_id": str(r["composition_id"]),
            "rule_order": int(r["rule_order"]),
            "condition_expression": str(r["condition_expression"]),
            "feedback_mode": str(r["feedback_mode"]),
            "feedback_agent_id": str(r["feedback_agent_id"]),
            "slide_mode": str(r["slide_mode"]),
            "is_enabled": bool(r["is_enabled"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        }
        for r in rows
    ]


def _get_attempt_stats(db: Session, *, learner_id: str, question_id: str) -> dict[str, int]:
    if question_id.startswith("qn_"):
        row = db.execute(
            text(
                """
                SELECT
                  COUNT(*)::INT AS attempted_count,
                  COALESCE(SUM(
                    CASE
                      WHEN COALESCE(score_maximum, 0) > 0
                       AND COALESCE(score_given, 0) >= COALESCE(score_maximum, 0)
                      THEN 1 ELSE 0 END
                  ), 0)::INT AS correct_count
                FROM feedback_record_result
                WHERE question_id = :question_id AND participant_id = :learner_id
                """
            ),
            {"question_id": question_id, "learner_id": learner_id},
        ).mappings().first()
        attempted = int(row["attempted_count"] or 0) if row else 0
        correct = int(row["correct_count"] or 0) if row else 0
        wrong = max(attempted - correct, 0)
        return {
            "attempted_count": attempted,
            "correct_count": correct,
            "wrong_count": wrong,
        }

    attempted = db.execute(
        text(
            """
            SELECT COUNT(*)::INT
            FROM record_result
            WHERE question_id = :question_id AND learner_id = :learner_id
            """
        ),
        {"question_id": question_id, "learner_id": learner_id},
    ).scalar()
    attempted_count = int(attempted or 0)
    return {
        "attempted_count": attempted_count,
        "correct_count": 0,
        "wrong_count": attempted_count,
    }


@router.get("/feedback-compositions")
def list_feedback_compositions(
    user_id: Optional[str] = Query(default=None),
    question_id: Optional[str] = Query(default=None),
    include_rules: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    params: dict[str, Any] = {}
    where_clauses = ["is_visible = TRUE"]
    if user_id:
        where_clauses.append("(created_by = :user_id OR access_scope = 'public')")
        params["user_id"] = user_id
    else:
        where_clauses.append("access_scope = 'public'")
    if question_id:
        where_clauses.append("question_id = :question_id")
        params["question_id"] = question_id

    rows = db.execute(
        text(
            f"""
            SELECT
              composition_id, title, description, question_id, question_type, access_scope,
              created_by, updated_by, created_at, updated_at, is_visible
            FROM feedback_compositions
            WHERE {' AND '.join(where_clauses)}
            ORDER BY updated_at DESC, composition_id ASC
            """
        ),
        params,
    ).mappings().all()

    items: list[dict[str, Any]] = []
    for row in rows:
        item = {
            "composition_id": str(row["composition_id"]),
            "title": str(row["title"]),
            "description": row["description"],
            "question_id": row["question_id"],
            "question_type": row["question_type"],
            "access_scope": str(row["access_scope"]),
            "created_by": str(row["created_by"]),
            "updated_by": str(row["updated_by"]) if row["updated_by"] else None,
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            "is_visible": bool(row["is_visible"]),
        }
        if include_rules:
            item["rules"] = _serialize_rules(db, str(row["composition_id"]))
        items.append(item)
    return {"ok": True, "count": len(items), "items": items}


@router.post("/feedback-compositions")
def create_feedback_composition(payload: CompositionCreateRequest, db: Session = Depends(get_db)):
    _validate_rules(payload.rules)
    try:
        db.execute(
            text(
                """
                INSERT INTO feedback_compositions (
                  composition_id, title, description, question_id, question_type, access_scope,
                  created_by, updated_by, created_at, updated_at, is_visible
                )
                VALUES (
                  :composition_id, :title, :description, :question_id, :question_type, :access_scope,
                  :created_by, :updated_by, NOW(), NOW(), TRUE
                )
                """
            ),
            {
                "composition_id": payload.composition_id,
                "title": payload.title,
                "description": payload.description,
                "question_id": payload.question_id,
                "question_type": payload.question_type,
                "access_scope": payload.access_scope,
                "created_by": payload.created_by,
                "updated_by": payload.updated_by or payload.created_by,
            },
        )
        for rule in payload.rules:
            db.execute(
                text(
                    """
                    INSERT INTO feedback_composition_rules (
                      rule_id, composition_id, rule_order, condition_expression, feedback_mode,
                      feedback_agent_id, slide_mode, is_enabled, created_at, updated_at
                    )
                    VALUES (
                      :rule_id, :composition_id, :rule_order, :condition_expression, :feedback_mode,
                      :feedback_agent_id, :slide_mode, :is_enabled, NOW(), NOW()
                    )
                    """
                ),
                {
                    "rule_id": f"cr_{secrets.token_hex(6).upper()}",
                    "composition_id": payload.composition_id,
                    "rule_order": rule.rule_order,
                    "condition_expression": rule.condition_expression,
                    "feedback_mode": rule.feedback_mode,
                    "feedback_agent_id": rule.feedback_agent_id,
                    "slide_mode": rule.slide_mode,
                    "is_enabled": rule.is_enabled,
                },
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="composition_id already exists or invalid unique fields") from exc

    return {"ok": True, "composition_id": payload.composition_id, "rules_count": len(payload.rules)}


@router.patch("/feedback-compositions/{composition_id}")
def patch_feedback_composition(composition_id: str, payload: CompositionPatchRequest, db: Session = Depends(get_db)):
    _validate_rules(payload.rules)
    exists = db.execute(
        text(
            """
            SELECT 1 FROM feedback_compositions
            WHERE composition_id = :composition_id AND is_visible = TRUE
            """
        ),
        {"composition_id": composition_id},
    ).scalar()
    if not exists:
        raise HTTPException(status_code=404, detail="composition not found")

    try:
        db.execute(
            text(
                """
                UPDATE feedback_compositions
                SET title = :title,
                    description = :description,
                    question_id = :question_id,
                    question_type = :question_type,
                    access_scope = :access_scope,
                    updated_by = :updated_by,
                    updated_at = NOW()
                WHERE composition_id = :composition_id
                """
            ),
            {
                "composition_id": composition_id,
                "title": payload.title,
                "description": payload.description,
                "question_id": payload.question_id,
                "question_type": payload.question_type,
                "access_scope": payload.access_scope,
                "updated_by": payload.updated_by,
            },
        )
        db.execute(
            text("DELETE FROM feedback_composition_rules WHERE composition_id = :composition_id"),
            {"composition_id": composition_id},
        )
        for rule in payload.rules:
            db.execute(
                text(
                    """
                    INSERT INTO feedback_composition_rules (
                      rule_id, composition_id, rule_order, condition_expression, feedback_mode,
                      feedback_agent_id, slide_mode, is_enabled, created_at, updated_at
                    )
                    VALUES (
                      :rule_id, :composition_id, :rule_order, :condition_expression, :feedback_mode,
                      :feedback_agent_id, :slide_mode, :is_enabled, NOW(), NOW()
                    )
                    """
                ),
                {
                    "rule_id": f"cr_{secrets.token_hex(6).upper()}",
                    "composition_id": composition_id,
                    "rule_order": rule.rule_order,
                    "condition_expression": rule.condition_expression,
                    "feedback_mode": rule.feedback_mode,
                    "feedback_agent_id": rule.feedback_agent_id,
                    "slide_mode": rule.slide_mode,
                    "is_enabled": rule.is_enabled,
                },
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="rule unique conflict or invalid fields") from exc

    return {"ok": True, "composition_id": composition_id, "rules_count": len(payload.rules)}


@router.delete("/feedback-compositions/{composition_id}")
def delete_feedback_composition(
    composition_id: str,
    updated_by: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text(
            """
            UPDATE feedback_compositions
            SET is_visible = FALSE,
                updated_by = COALESCE(:updated_by, updated_by),
                updated_at = NOW()
            WHERE composition_id = :composition_id
              AND is_visible = TRUE
            RETURNING composition_id
            """
        ),
        {"composition_id": composition_id, "updated_by": updated_by},
    ).first()
    db.commit()
    if not row:
        raise HTTPException(status_code=404, detail="composition not found")
    return {"ok": True, "composition_id": composition_id, "is_visible": False}


@router.get("/feedback-compositions/{composition_id}/resolve")
def resolve_feedback_composition(
    composition_id: str,
    learner_id: Optional[str] = Query(default=None),
    question_id: str = Query(..., min_length=1, max_length=64),
    launch_id: Optional[str] = Query(default=None),
    lti_launch_id: Optional[str] = Query(default=None),
    question_type: Optional[QuestionType] = Query(default=None),
    db: Session = Depends(get_db),
):
    query = ResolveQuery(
        learner_id=learner_id,
        question_id=question_id,
        launch_id=launch_id,
        lti_launch_id=lti_launch_id,
        question_type=question_type,
    )
    final_learner_id = _coerce_learner_id(query.learner_id)
    row = db.execute(
        text(
            """
            SELECT
              composition_id, title, question_id, question_type, access_scope, is_visible
            FROM feedback_compositions
            WHERE composition_id = :composition_id
            """
        ),
        {"composition_id": composition_id},
    ).mappings().first()
    if not row or not bool(row["is_visible"]):
        raise HTTPException(status_code=404, detail="composition not found")
    bound_question_id = row["question_id"]
    if bound_question_id and str(bound_question_id) != query.question_id:
        raise HTTPException(status_code=400, detail="composition question_id mismatch")
    bound_question_type = row["question_type"]
    if bound_question_type and query.question_type and str(bound_question_type) != query.question_type:
        raise HTTPException(status_code=400, detail="composition question_type mismatch")

    context = _get_attempt_stats(db, learner_id=final_learner_id, question_id=query.question_id)
    rules = _serialize_rules(db, composition_id)
    matched_rule: dict[str, Any] | None = None
    for rule in rules:
        if not rule["is_enabled"]:
            continue
        try:
            compiled = compile_condition_expression(rule["condition_expression"])
            if compiled.evaluate(context):
                matched_rule = rule
                break
        except CompositionExprError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": exc.code,
                    "message": str(exc),
                    "rule_id": rule["rule_id"],
                },
            ) from exc

    return {
        "ok": True,
        "composition_id": composition_id,
        "learner_id": final_learner_id,
        "question_id": query.question_id,
        "question_type": query.question_type or bound_question_type,
        "launch_id": query.launch_id or query.lti_launch_id,
        "lti_launch_id": query.lti_launch_id or query.launch_id,
        "variables": context,
        "matched_rule_id": matched_rule["rule_id"] if matched_rule else None,
        "feedback_agent_id": matched_rule["feedback_agent_id"] if matched_rule else None,
        "feedback_mode": matched_rule["feedback_mode"] if matched_rule else None,
        "slide_mode": matched_rule["slide_mode"] if matched_rule else None,
        "matched_rule": matched_rule,
    }
