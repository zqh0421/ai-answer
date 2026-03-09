from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import re
import secrets
from threading import Lock
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..dependencies import get_db
from .feedback_links import _get_agent as _get_feedback_agent, _insert_feedback_link
from ..services.feedback_link_generation_jobs import (
    generate_static_feedback_for_feedback_link,
    generate_static_feedback_with_version_snapshot_for_feedback_link,
    resolve_feedback_prompt_for_feedback_link,
)
from ..services.feedback_generation_flow import run_feedback_generation_flow
from ..services.feedback_link_job_status import (
    get_feedback_link_generation_status,
    get_rq_job_status,
    set_feedback_link_generation_job_id,
)
from ..services.feedback_composition_expr import CompositionExprError, compile_condition_expression
from ..services.ids import generate_short_id
from ..services.readers import _get_presentation_slide_object_ids, get_semantic_question_version_detail
from ..services.slide_batch_jobs import slide_batch_job_manager
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_QUESTIONS])
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_OPTION_MATCH_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")
_STATIC_FEEDBACK_SCHEMA_GUARD = Lock()
_STATIC_FEEDBACK_SCHEMA_READY = False
_STATIC_FEEDBACK_SCHEMA_LOCK_KEY = 7712401


QuestionType = Literal["single_choice", "multi_choice", "dropdown", "true_false", "free_text", "essay"]
InteractionType = QuestionType
AccessScope = Literal["private", "public"]
ScoreInputFormat = Literal["fraction", "ratio", "absolute"]
ScoreRoundingMode = Literal["none", "floor", "ceil", "round"]
BlockType = Literal["text", "image", "latex", "html", "instruction"]


class ScoringPolicyIn(BaseModel):
    score_maximum: float = Field(gt=0)
    score_input_format: ScoreInputFormat = "fraction"
    score_normalize_to_maximum: bool = True
    score_rounding_mode: ScoreRoundingMode = "none"
    score_rounding_step: Optional[float] = Field(default=1, gt=0)


class ContentBlockIn(BaseModel):
    block_type: BlockType
    text_content: Optional[str] = None
    media_url: Optional[str] = None
    alt_text: Optional[str] = None


class InteractionOptionIn(BaseModel):
    option_order: int = Field(ge=1)
    option_value: str = Field(min_length=1, max_length=2000)
    option_label: str = Field(min_length=0)
    is_correct: bool = False


class InteractionIn(BaseModel):
    interaction_type: InteractionType
    interaction_order: int = Field(ge=1)
    prompt_text: Optional[str] = None
    is_required: bool = True
    max_score: Optional[float] = Field(default=None, ge=0)
    reference_answer_text: Optional[str] = None
    reference_answer_meta: Optional[dict[str, Any]] = None
    options: list[InteractionOptionIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_options(self):
        option_required_types = {"single_choice", "multi_choice", "dropdown", "true_false"}
        if self.interaction_type in option_required_types and len(self.options) == 0:
            raise ValueError(f"interaction_type '{self.interaction_type}' requires options")
        if self.interaction_type in {"free_text", "essay"} and self.options:
            raise ValueError(f"interaction_type '{self.interaction_type}' cannot have options")
        if self.interaction_type == "true_false" and len(self.options) != 2:
            raise ValueError("true_false interaction requires exactly 2 options")
        if self.interaction_type == "single_choice":
            if sum(1 for x in self.options if x.is_correct) > 1:
                raise ValueError("single_choice supports at most one correct option")
        normalized_reference_answer_text = (
            self.reference_answer_text.strip() if isinstance(self.reference_answer_text, str) else None
        )
        if not normalized_reference_answer_text:
            normalized_reference_answer_text = None
        normalized_reference_answer_meta = (
            self.reference_answer_meta if isinstance(self.reference_answer_meta, dict) and self.reference_answer_meta else None
        )
        if self.interaction_type in option_required_types and (
            normalized_reference_answer_text is not None or normalized_reference_answer_meta is not None
        ):
            raise ValueError(
                f"interaction_type '{self.interaction_type}' cannot have reference_answer_text/reference_answer_meta"
            )
        self.reference_answer_text = normalized_reference_answer_text
        self.reference_answer_meta = normalized_reference_answer_meta
        return self


class SlideScopeIn(BaseModel):
    slide_id: str
    page_start: Optional[int] = Field(default=None, ge=1)
    page_end: Optional[int] = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_range(self):
        if (self.page_start is None) != (self.page_end is None):
            raise ValueError("page_start and page_end must both be set or both be null")
        if self.page_start is not None and self.page_end is not None and self.page_end < self.page_start:
            raise ValueError("page_end must be >= page_start")
        return self


class QuestionCreateRequest(BaseModel):
    question_type: QuestionType
    title: Optional[str] = None
    access_scope: AccessScope = "private"
    content_blocks: list[ContentBlockIn] = Field(default_factory=list)
    interactions: list[InteractionIn] = Field(min_length=1)
    randomize_option_order: bool = True
    slide_scope: list[SlideScopeIn] = Field(default_factory=list)
    scoring_policy: ScoringPolicyIn
    created_by: str = Field(min_length=16, max_length=16)

    @model_validator(mode="after")
    def validate_question(self):
        if len(self.interactions) != 1:
            raise ValueError("current implementation supports exactly 1 interaction per question")
        if self.interactions[0].interaction_type != self.question_type:
            raise ValueError("question_type must match the first interaction_type")
        return self


class QuestionVersionCreateRequest(BaseModel):
    question_type: QuestionType
    title: Optional[str] = None
    content_blocks: list[ContentBlockIn] = Field(default_factory=list)
    interactions: list[InteractionIn] = Field(min_length=1)
    randomize_option_order: bool = True
    slide_scope: list[SlideScopeIn] = Field(default_factory=list)
    scoring_policy: ScoringPolicyIn
    created_by: str = Field(min_length=16, max_length=16)
    change_note: Optional[str] = None
    copy_feedback_links_from_previous: bool = False

    @model_validator(mode="after")
    def validate_question(self):
        if len(self.interactions) != 1:
            raise ValueError("current implementation supports exactly 1 interaction per question")
        if self.interactions[0].interaction_type != self.question_type:
            raise ValueError("question_type must match the first interaction_type")
        return self


class QuestionContentPatchRequest(QuestionVersionCreateRequest):
    # Batch update should preserve agent bindings by default, but avoid stale static cache.
    copy_feedback_links_from_previous: bool = True
    copy_ai_static_feedback: bool = False
    copy_human_static_feedback: bool = False


class ScopePatchRequest(BaseModel):
    access_scope: AccessScope
    updated_by: str = Field(min_length=16, max_length=16)


class VisibilityPatchRequest(BaseModel):
    is_visible: bool
    updated_by: str = Field(min_length=16, max_length=16)


class BatchQuestionIdsRequest(BaseModel):
    question_ids: list[str] = Field(min_length=1)
    updated_by: str = Field(min_length=16, max_length=16)


class BatchAttachFeedbackAgentRequest(BaseModel):
    question_ids: list[str] = Field(min_length=1)
    agent_id: str = Field(min_length=16, max_length=16)
    updated_by: str = Field(min_length=16, max_length=16)
    priority: int = 100
    static_feedback_text: Optional[str] = None


class BatchJobIdsRequest(BaseModel):
    job_ids: list[str] = Field(min_length=1)


class BatchResolveQuestionVersionsRequest(BaseModel):
    question_ids: list[str] = Field(min_length=1)


class SingleAttachAgentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    agent_id: str = Field(min_length=16, max_length=16, alias="agentId")
    updated_by: str = Field(min_length=16, max_length=16, alias="updatedBy")


class StaticFeedbackOptionFeedbackItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    interaction_option_id: str = Field(min_length=16, max_length=16, alias="interactionOptionId")
    feedback_text: str = Field(min_length=1, alias="feedbackText")


class StaticFeedbackUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    updated_by: str = Field(min_length=16, max_length=16, alias="updatedBy")
    # Backward compatible aliases:
    # - staticFeedbackText: legacy question-level only payload
    # - questionFeedbackText: preferred question-level field
    static_feedback_text: Optional[str] = Field(default=None, alias="staticFeedbackText")
    question_feedback_text: Optional[str] = Field(default=None, alias="questionFeedbackText")
    option_feedback: list[StaticFeedbackOptionFeedbackItem] = Field(default_factory=list, alias="optionFeedback")
    expected_option_count: Optional[int] = Field(default=None, ge=0, alias="expectedOptionCount")
    if_match_version_id: Optional[str] = Field(default=None, min_length=16, max_length=16, alias="ifMatchVersionId")


class StaticFeedbackRestoreRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    updated_by: str = Field(min_length=16, max_length=16, alias="updatedBy")
    if_match_version_id: Optional[str] = Field(default=None, min_length=16, max_length=16, alias="ifMatchVersionId")


class AttachedAgentFeedbackRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    updated_by: Optional[str] = Field(default=None, min_length=16, max_length=16, alias="updatedBy")
    dry_run: bool = Field(default=True, alias="dryRun")
    input_values: Optional[dict[str, Any]] = Field(default=None, alias="inputValues")


# Backward compatibility for older references.
AttachedAgentDryRunRequest = AttachedAgentFeedbackRequest


class UnifiedQuestionFeedbackRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    mode: Literal["composition", "agent"] = "composition"
    dry_run: bool = Field(default=True, alias="dryRun")
    updated_by: Optional[str] = Field(default=None, min_length=16, max_length=16, alias="updatedBy")
    composition_id: Optional[str] = Field(default=None, max_length=64, alias="compositionId")
    agent_id: Optional[str] = Field(default=None, min_length=16, max_length=16, alias="agentId")
    learner_id: Optional[str] = Field(default=None, max_length=128, alias="learnerId")
    launch_id: Optional[str] = Field(default=None, alias="launchId")
    lti_launch_id: Optional[str] = Field(default=None, alias="ltiLaunchId")
    selected_option_index: Optional[int] = Field(default=None, ge=0, alias="selectedOptionIndex")
    answer_text: Optional[str] = Field(default=None, alias="answerText")
    input_values: Optional[dict[str, Any]] = Field(default=None, alias="inputValues")


def _raise_feedback_api_error(
    *,
    status_code: int,
    code: str,
    message: str,
    mode: str | None,
    question_id: str,
    agent_id: str | None = None,
    agent_name: str | None = None,
    composition_id: str | None = None,
    reason: str | None = None,
) -> None:
    detail: dict[str, Any] = {
        "ok": False,
        "code": code,
        "message": message,
        "mode": mode,
        "question_id": question_id,
    }
    if agent_id:
        detail["agent_id"] = agent_id
    if agent_name:
        detail["agent_name"] = agent_name
    if composition_id:
        detail["composition_id"] = composition_id
    if reason:
        detail["reason"] = reason
    raise HTTPException(status_code=status_code, detail=detail)


def _normalize_feedback_error(
    exc: HTTPException,
    *,
    fallback_code: str,
    mode: str | None,
    question_id: str,
    agent_id: str | None = None,
    agent_name: str | None = None,
    composition_id: str | None = None,
) -> HTTPException:
    if isinstance(exc.detail, dict):
        detail = dict(exc.detail)
        detail["ok"] = False
        detail.setdefault("code", fallback_code)
        if not detail.get("message"):
            detail["message"] = str(detail.get("detail") or "Request failed")
        detail.setdefault("mode", mode)
        detail.setdefault("question_id", question_id)
        if agent_id and not detail.get("agent_id"):
            detail["agent_id"] = agent_id
        if agent_name and not detail.get("agent_name"):
            detail["agent_name"] = agent_name
        if composition_id and not detail.get("composition_id"):
            detail["composition_id"] = composition_id
        return HTTPException(status_code=exc.status_code, detail=detail)

    return HTTPException(
        status_code=exc.status_code,
        detail={
            "ok": False,
            "code": fallback_code,
            "message": str(exc.detail) if exc.detail is not None else "Request failed",
            "mode": mode,
            "question_id": question_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "composition_id": composition_id,
        },
    )


def _compose_feedback_text_for_client(result: dict[str, Any]) -> str | None:
    structured = result.get("structured_feedback_text")
    if isinstance(structured, str) and structured.strip():
        return structured.strip()
    static_text = result.get("static_feedback_text")
    if isinstance(static_text, str) and static_text.strip():
        extracted = _extract_structured_feedback_from_generated_feedback(static_text)
        if isinstance(extracted, str) and extracted.strip():
            return extracted.strip()
        return static_text.strip()
    return None


def _compose_reference_from_retrieved_pages(
    *,
    db: Session,
    question_id: str,
    retrieved_pages: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not retrieved_pages:
        return None
    first_page = retrieved_pages[0] if isinstance(retrieved_pages[0], dict) else {}
    if not isinstance(first_page, dict):
        return None

    slide_scope_item: dict[str, Any] = {}
    question = _question_row(db, question_id)
    current_version_id = str(question.get("current_version_id") or "") if question else ""
    if current_version_id:
        detail = get_semantic_question_version_detail(db, current_version_id)
        scopes = (detail or {}).get("slide_scope") if isinstance(detail, dict) else None
        if isinstance(scopes, list):
            target_title = str(first_page.get("slide_title") or "").strip()
            for item in scopes:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("slide_title") or "").strip()
                if target_title and title and title == target_title:
                    slide_scope_item = item
                    break
            if not slide_scope_item and scopes and isinstance(scopes[0], dict):
                slide_scope_item = scopes[0]

    page_number_int: int | None = None
    try:
        raw_page_number = first_page.get("page_number")
        page_number_int = int(raw_page_number) if raw_page_number is not None else None
    except Exception:
        page_number_int = None

    content = str(first_page.get("content") or "").strip()
    embed_url = slide_scope_item.get("most_relevant_slide_embed_url")
    slide_google_id = str(first_page.get("slide_google_id") or slide_scope_item.get("slide_google_id") or "").strip()
    slide_id = first_page.get("slide_id") or slide_scope_item.get("slide_id")
    computed_slide_embed_url: str | None = None
    computed_slide_open_url: str | None = None
    computed_slide_object_id: str | None = None
    computed_slide_url_error: str | None = None
    slide_page_object_ids: list[str] | None = None
    if slide_google_id and page_number_int is not None and page_number_int >= 1:
        object_ids, object_id_error = _get_presentation_slide_object_ids(slide_google_id)
        if object_ids:
            slide_page_object_ids = list(object_ids)
            if page_number_int <= len(object_ids):
                object_id_raw = object_ids[page_number_int - 1]
                anchor = object_id_raw if str(object_id_raw).startswith("id.") else f"id.{object_id_raw}"
                computed_slide_object_id = anchor
                computed_slide_embed_url = (
                    f"https://docs.google.com/presentation/d/{slide_google_id}/embed"
                    f"?slide={anchor}#slide={anchor}"
                )
                computed_slide_open_url = (
                    f"https://docs.google.com/presentation/d/{slide_google_id}/edit"
                    f"#slide={anchor}"
                )
            else:
                computed_slide_url_error = "page_out_of_bounds"
        else:
            computed_slide_url_error = object_id_error or "missing_slide_page_object_ids"

    resolved_embed_url = computed_slide_embed_url or embed_url
    return {
        "text": content,
        "image_text": "",
        "display": content,
        "page_number": (page_number_int if page_number_int is not None else -1),
        "most_relevant_page_number": page_number_int,
        "slide_total_pages": slide_scope_item.get("slide_total_pages"),
        "slide_id": slide_id,
        "slide_google_id": slide_google_id or slide_scope_item.get("slide_google_id"),
        "most_relevant_slide_embed_url": resolved_embed_url,
        "slide_embed_url": resolved_embed_url,
        "most_relevant_slide_embed_url_error": (
            computed_slide_url_error or slide_scope_item.get("most_relevant_slide_embed_url_error")
        ),
        "slide_title": str(first_page.get("slide_title") or slide_scope_item.get("slide_title") or ""),
        "slide_page_object_ids": slide_page_object_ids,
        "computed_slide_object_id": computed_slide_object_id,
        "computed_slide_embed_url": computed_slide_embed_url,
        "computed_slide_open_url": computed_slide_open_url,
        "computed_slide_url_error": computed_slide_url_error,
    }


def _fallback_retrieved_pages_from_question_scope(
    *,
    db: Session,
    question_id: str,
) -> list[dict[str, Any]]:
    question = _question_row(db, question_id)
    current_version_id = str(question.get("current_version_id") or "") if question else ""
    if not current_version_id:
        return []
    detail = get_semantic_question_version_detail(db, current_version_id)
    scopes = (detail or {}).get("slide_scope") if isinstance(detail, dict) else None
    if not isinstance(scopes, list):
        return []
    for item in scopes:
        if not isinstance(item, dict):
            continue
        page_no = item.get("most_relevant_page_number")
        try:
            page_no_int = int(page_no) if page_no is not None else None
        except Exception:
            page_no_int = None
        if page_no_int is None or page_no_int < 1:
            continue
        return [
            {
                "slide_id": item.get("slide_id"),
                "slide_google_id": item.get("slide_google_id"),
                "slide_title": item.get("slide_title"),
                "page_number": page_no_int,
                "content": "",
            }
        ]
    return []


def _empty_reference_payload() -> dict[str, Any]:
    return {
        "text": "",
        "image_text": "",
        "display": "",
        "page_number": -1,
        "most_relevant_page_number": None,
        "slide_total_pages": None,
        "slide_id": None,
        "slide_google_id": None,
        "most_relevant_slide_embed_url": None,
        "slide_embed_url": None,
        "most_relevant_slide_embed_url_error": None,
        "slide_title": "",
    }


def _user_exists(db: Session, user_id: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM users WHERE user_id = :user_id LIMIT 1"), {"user_id": user_id}).scalar())


def _user_role(db: Session, user_id: str) -> str | None:
    role = db.execute(text("SELECT role::text FROM users WHERE user_id = :user_id LIMIT 1"), {"user_id": user_id}).scalar()
    return str(role) if role is not None else None


def _require_admin_user(db: Session, user_id: str) -> None:
    role_value = _user_role(db, user_id)
    if role_value is None:
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    if role_value != "admin":
        raise HTTPException(status_code=403, detail="admin permission required")


def _batch_result(question_ids: list[str], success_ids: list[str], failed: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "ok": True,
        "requested_count": len(question_ids),
        "success_count": len(success_ids),
        "failed_count": len(failed),
        "success_ids": success_ids,
        "failed": failed,
    }


def _question_rows_map(db: Session, question_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not question_ids:
        return {}
    rows = db.execute(
        text(
            """
            SELECT question_id, current_version_id, access_scope, is_visible, created_by, created_at
            FROM content_question
            WHERE question_id = ANY(CAST(:question_ids AS TEXT[]))
            """
        ),
        {"question_ids": question_ids},
    ).mappings().all()
    return {str(r["question_id"]): dict(r) for r in rows}


def _find_visible_question_version_link(db: Session, *, question_version_id: str, agent_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT feedback_link_id
            FROM feedback_link
            WHERE question_version_id = :qv_id
              AND agent_id = :agent_id
              AND target_entity_type = 'question_version'
              AND target_entity_id = :qv_id
              AND is_visible = TRUE
            ORDER BY created_at ASC
            LIMIT 1
            """
        ),
        {"qv_id": question_version_id, "agent_id": agent_id},
    ).scalar()
    return str(row) if row else None


def _find_any_visible_question_link(db: Session, *, question_version_id: str, agent_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT feedback_link_id
            FROM feedback_link
            WHERE question_version_id = :qv_id
              AND agent_id = :agent_id
              AND is_visible = TRUE
            ORDER BY
              CASE WHEN target_entity_type = 'question_version' THEN 0 ELSE 1 END ASC,
              created_at ASC
            LIMIT 1
            """
        ),
        {"qv_id": question_version_id, "agent_id": agent_id},
    ).scalar()
    return str(row) if row else None


def _find_visible_feedback_link_by_target(
    db: Session,
    *,
    question_version_id: str,
    agent_id: str,
    target_entity_type: str,
    target_entity_id: str,
) -> str | None:
    row = db.execute(
        text(
            """
            SELECT feedback_link_id
            FROM feedback_link
            WHERE question_version_id = :qv_id
              AND agent_id = :agent_id
              AND target_entity_type = :target_entity_type
              AND target_entity_id = :target_entity_id
              AND is_visible = TRUE
            ORDER BY created_at ASC
            LIMIT 1
            """
        ),
        {
            "qv_id": question_version_id,
            "agent_id": agent_id,
            "target_entity_type": target_entity_type,
            "target_entity_id": target_entity_id,
        },
    ).scalar()
    return str(row) if row else None


def _feedback_agent_has_if_score_column(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'feedback_agent'
                  AND column_name = 'if_score'
                LIMIT 1
                """
            )
        ).scalar()
    )


def _feedback_agent_has_score_ai_agent_id_column(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'feedback_agent'
                  AND column_name = 'score_ai_agent_id'
                LIMIT 1
                """
            )
        ).scalar()
    )


def _feedback_agent_runtime_profile(db: Session, agent_id: str) -> dict[str, Any] | None:
    if_score_expr = "if_score" if _feedback_agent_has_if_score_column(db) else "FALSE AS if_score"
    score_ai_expr = (
        "score_ai_agent_id"
        if _feedback_agent_has_score_ai_agent_id_column(db)
        else "NULL::text AS score_ai_agent_id"
    )
    row = db.execute(
        text(
            f"""
            SELECT agent_id, role, {if_score_expr}, {score_ai_expr}
            FROM feedback_agent
            WHERE agent_id = :agent_id
            LIMIT 1
            """
        ),
        {"agent_id": agent_id},
    ).mappings().first()
    if not row:
        return None
    profile = dict(row)
    profile["if_score"] = bool(profile.get("if_score"))
    profile["score_ai_agent_id"] = (
        str(profile["score_ai_agent_id"]) if profile.get("score_ai_agent_id") is not None else None
    )
    return profile


def _runtime_feedback_link_id_for_agent(
    db: Session,
    *,
    question_version_id: str,
    agent_id: str,
    selected_option_id: str | None,
) -> str | None:
    if selected_option_id:
        option_link = _find_visible_feedback_link_by_target(
            db,
            question_version_id=question_version_id,
            agent_id=agent_id,
            target_entity_type="interaction_option",
            target_entity_id=selected_option_id,
        )
        if option_link:
            return option_link
    return _find_visible_question_version_link(
        db, question_version_id=question_version_id, agent_id=agent_id
    ) or _find_any_visible_question_link(
        db, question_version_id=question_version_id, agent_id=agent_id
    )


def _runtime_selected_option_id_from_payload(
    db: Session,
    *,
    question_version_id: str,
    selected_option_index: int | None,
    input_values: dict[str, Any] | None,
) -> str | None:
    values = input_values or {}
    explicit_id = values.get("selected_option_id") or values.get("selectedOptionId")
    if explicit_id:
        return str(explicit_id)
    # Index-based matching is intentionally disabled to avoid 0/1-based mismatch bugs.
    _ = selected_option_index

    answer_text_raw = values.get("answer_text") or values.get("answerText")
    answer_text = str(answer_text_raw or "").strip()
    if not answer_text:
        return None

    rows = db.execute(
        text(
            """
            SELECT
              o.interaction_option_id,
              o.option_order,
              o.option_label,
              o.option_value
            FROM content_question_interaction i
            JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
            WHERE i.question_version_id = :question_version_id
            ORDER BY i.interaction_order ASC, o.option_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    if not rows:
        return None

    if answer_text.isdigit():
        idx = int(answer_text)
        if 0 <= idx < len(rows):
            return str(rows[idx]["interaction_option_id"])
        if 1 <= idx <= len(rows):
            return str(rows[idx - 1]["interaction_option_id"])

    normalized = answer_text.casefold()
    normalized_compact = _OPTION_MATCH_NORMALIZE_RE.sub("", normalized)
    for row in rows:
        label = str(row.get("option_label") or "").strip()
        value = str(row.get("option_value") or "").strip()
        if label and label.casefold() == normalized:
            return str(row["interaction_option_id"])
        if value and value.casefold() == normalized:
            return str(row["interaction_option_id"])
        label_norm = label.casefold()
        value_norm = value.casefold()
        if label_norm and (label_norm in normalized or normalized in label_norm):
            return str(row["interaction_option_id"])
        if value_norm and (value_norm in normalized or normalized in value_norm):
            return str(row["interaction_option_id"])
        label_compact = _OPTION_MATCH_NORMALIZE_RE.sub("", label_norm)
        value_compact = _OPTION_MATCH_NORMALIZE_RE.sub("", value_norm)
        if label_compact and normalized_compact and (
            label_compact in normalized_compact or normalized_compact in label_compact
        ):
            return str(row["interaction_option_id"])
        if value_compact and normalized_compact and (
            value_compact in normalized_compact or normalized_compact in value_compact
        ):
            return str(row["interaction_option_id"])

    return None


def _read_latest_static_feedback_for_agent(
    db: Session,
    *,
    question_version_id: str,
    agent_id: str,
    selected_option_id: str | None,
) -> dict[str, Any]:
    if selected_option_id:
        row = db.execute(
            text(
                """
                SELECT feedback_link_id, static_feedback_text, structured_feedback_text
                FROM feedback_link
                WHERE question_version_id = :question_version_id
                  AND agent_id = :agent_id
                  AND target_entity_type = 'interaction_option'
                  AND target_entity_id = :selected_option_id
                  AND is_visible = TRUE
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {
                "question_version_id": question_version_id,
                "agent_id": agent_id,
                "selected_option_id": selected_option_id,
            },
        ).mappings().first()
        if row:
            return dict(row)

    row = db.execute(
        text(
            """
            SELECT feedback_link_id, static_feedback_text, structured_feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'question_version'
              AND target_entity_id = :question_version_id
              AND is_visible = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().first()
    if row:
        return dict(row)

    row = db.execute(
        text(
            """
            SELECT feedback_link_id, static_feedback_text, structured_feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND is_visible = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().first()
    return dict(row) if row else {}


def _read_latest_versioned_feedback_for_agent(
    db: Session,
    *,
    question_id: str,
    question_version_id: str,
    agent_id: str,
    selected_option_id: str | None,
) -> dict[str, Any]:
    latest = _get_latest_static_feedback_version(db, question_id=question_id, agent_id=agent_id)
    if not latest:
        return {}
    version_id = str(latest["version_id"])
    revision_no = int(latest["revision_no"])
    version_question_text = (
        str(latest.get("question_feedback_text"))
        if latest.get("question_feedback_text") is not None
        else None
    )
    if selected_option_id:
        opt_row = db.execute(
            text(
                """
                SELECT feedback_text
                FROM feedback_static_feedback_version_option
                WHERE version_id = :version_id
                  AND interaction_option_id = :interaction_option_id
                LIMIT 1
                """
            ),
            {"version_id": version_id, "interaction_option_id": selected_option_id},
        ).mappings().first()
        if opt_row and opt_row.get("feedback_text") is not None:
            return {
                "feedback_link_id": None,
                "static_feedback_text": str(opt_row.get("feedback_text")),
                "structured_feedback_text": None,
                "version_id": version_id,
                "revision_no": revision_no,
                "question_version_id": str(latest.get("question_version_id") or question_version_id),
                "source": "feedback_static_feedback_version_option",
            }
    if version_question_text:
        return {
            "feedback_link_id": None,
            "static_feedback_text": version_question_text,
            "structured_feedback_text": None,
            "version_id": version_id,
            "revision_no": revision_no,
            "question_version_id": str(latest.get("question_version_id") or question_version_id),
            "source": "feedback_static_feedback_version",
        }
    return {}


def _ensure_feedback_runtime_prompt_cache_schema(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS feedback_runtime_prompt_cache (
                participant_id VARCHAR(255) NOT NULL,
                question_id VARCHAR(64) NOT NULL,
                answer_text TEXT NULL,
                llm_system_prompt TEXT NULL,
                llm_user_prompt TEXT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (participant_id, question_id)
            )
            """
        )
    )


def _cache_runtime_prompt(
    db: Session,
    *,
    participant_id: str,
    question_id: str,
    answer_text: str | None,
    llm_system_prompt: str | None,
    llm_user_prompt: str | None,
) -> None:
    if not llm_system_prompt and not llm_user_prompt:
        return
    _ensure_feedback_runtime_prompt_cache_schema(db)
    db.execute(
        text(
            """
            INSERT INTO feedback_runtime_prompt_cache (
                participant_id, question_id, answer_text, llm_system_prompt, llm_user_prompt, updated_at
            )
            VALUES (
                :participant_id, :question_id, :answer_text, :llm_system_prompt, :llm_user_prompt, NOW()
            )
            ON CONFLICT (participant_id, question_id)
            DO UPDATE SET
                answer_text = EXCLUDED.answer_text,
                llm_system_prompt = EXCLUDED.llm_system_prompt,
                llm_user_prompt = EXCLUDED.llm_user_prompt,
                updated_at = NOW()
            """
        ),
        {
            "participant_id": participant_id,
            "question_id": question_id,
            "answer_text": answer_text,
            "llm_system_prompt": llm_system_prompt,
            "llm_user_prompt": llm_user_prompt,
        },
    )


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _extract_score_from_generated_feedback(raw_feedback: Any) -> dict[str, Any]:
    text_value = str(raw_feedback or "").strip()
    if not text_value:
        return {"score": None, "max_score": None}

    parsed_obj: dict[str, Any] | None = None
    try:
        loaded = json.loads(text_value)
        if isinstance(loaded, dict):
            parsed_obj = loaded
    except Exception:
        m = _JSON_FENCE_RE.search(text_value)
        if m:
            try:
                loaded = json.loads(m.group(1))
                if isinstance(loaded, dict):
                    parsed_obj = loaded
            except Exception:
                parsed_obj = None

    if not parsed_obj:
        return {"score": None, "max_score": None}
    return {
        "score": _safe_float(parsed_obj.get("score")),
        "max_score": _safe_float(parsed_obj.get("max_score")),
    }


def _extract_structured_feedback_from_generated_feedback(raw_feedback: Any) -> str | None:
    text_value = str(raw_feedback or "").strip()
    if not text_value:
        return None
    parsed_obj: dict[str, Any] | None = None
    try:
        loaded = json.loads(text_value)
        if isinstance(loaded, dict):
            parsed_obj = loaded
    except Exception:
        m = _JSON_FENCE_RE.search(text_value)
        if m:
            try:
                loaded = json.loads(m.group(1))
                if isinstance(loaded, dict):
                    parsed_obj = loaded
            except Exception:
                parsed_obj = None
    if not parsed_obj:
        return None
    structured = parsed_obj.get("structured_feedback")
    if structured is None:
        structured = parsed_obj.get("text_feedback")
    return str(structured) if structured is not None else None


def _resolve_human_agent_ai_score_result(
    db: Session,
    *,
    question_version_id: str,
    human_agent_id: str,
    selected_option_id: str | None,
    runtime_inputs: dict[str, Any],
) -> dict[str, Any] | None:
    profile = _feedback_agent_runtime_profile(db, human_agent_id)
    if not profile:
        return None
    if str(profile.get("role") or "") != "human":
        return None
    if not bool(profile.get("if_score")):
        return None

    ai_agent_id = str(profile.get("score_ai_agent_id") or "").strip()
    if not ai_agent_id:
        return {
            "enabled": True,
            "has_score": False,
            "reason": "missing_score_ai_agent_id",
        }

    ai_feedback_link_id = _runtime_feedback_link_id_for_agent(
        db,
        question_version_id=question_version_id,
        agent_id=ai_agent_id,
        selected_option_id=selected_option_id,
    )
    if not ai_feedback_link_id:
        return {
            "enabled": True,
            "has_score": False,
            "ai_agent_id": ai_agent_id,
            "reason": "ai_feedback_link_not_found",
        }

    generated = generate_static_feedback_for_feedback_link(
        str(ai_feedback_link_id),
        persist=False,
        enforce_ai_role=True,
        input_values=runtime_inputs,
        include_debug=True,
    )
    if not generated.get("ok"):
        return {
            "enabled": True,
            "has_score": False,
            "ai_agent_id": ai_agent_id,
            "feedback_link_id": ai_feedback_link_id,
            "reason": str(generated.get("reason") or "ai_generation_failed"),
        }

    extracted = _extract_score_from_generated_feedback(generated.get("static_feedback_text"))
    return {
        "enabled": True,
        "has_score": extracted.get("score") is not None,
        "ai_agent_id": ai_agent_id,
        "feedback_link_id": ai_feedback_link_id,
        "score": extracted.get("score"),
        "max_score": extracted.get("max_score"),
        "rendered_prompt": {
            "system_prompt": generated.get("resolved_system_prompt"),
            "user_text": generated.get("resolved_user_text"),
        },
    }


def _question_version_belongs_to_question(db: Session, *, question_id: str, question_version_id: str) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM content_question_version
                WHERE question_id = :question_id
                  AND question_version_id = :question_version_id
                LIMIT 1
                """
            ),
            {"question_id": question_id, "question_version_id": question_version_id},
        ).scalar()
    )


def _interaction_options_for_question_version(db: Session, question_version_id: str) -> dict[str, dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              o.interaction_option_id,
              o.interaction_id,
              o.option_order,
              o.option_label,
              i.question_version_id
            FROM content_question_interaction_option o
            JOIN content_question_interaction i ON i.interaction_id = o.interaction_id
            WHERE i.question_version_id = :question_version_id
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    return {str(r["interaction_option_id"]): dict(r) for r in rows}


def _question_version_type(db: Session, question_version_id: str) -> str | None:
    value = db.execute(
        text(
            """
            SELECT question_type::text
            FROM content_question_version
            WHERE question_version_id = :question_version_id
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).scalar()
    return str(value) if value is not None else None


def _single_choice_options_for_question_version(db: Session, question_version_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              o.interaction_option_id,
              o.option_order,
              o.option_label,
              o.option_value
            FROM content_question_interaction i
            JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
            WHERE i.question_version_id = :question_version_id
              AND i.interaction_order = 1
            ORDER BY o.option_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    return [
        {
            "interaction_option_id": str(row["interaction_option_id"]),
            "option_order": int(row["option_order"]),
            "answer_text": str(row.get("option_label") or row.get("option_value") or "").strip(),
        }
        for row in rows
        if row.get("interaction_option_id")
    ]


def _canonical_generation_status(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"finished", "completed", "success"}:
        return "completed"
    if raw in {"failed", "stopped", "cancelled", "canceled"}:
        return "failed"
    if raw in {"started", "processing", "busy"}:
        return "processing"
    if raw in {"queued", "scheduled", "deferred"}:
        return "queued"
    return raw or "unknown"


def _aggregate_generation_payload(payloads: list[dict[str, Any]]) -> dict[str, Any] | None:
    valid = [p for p in payloads if isinstance(p, dict)]
    if not valid:
        return None
    status_priority = {"processing": 0, "queued": 1, "failed": 2, "completed": 3, "unknown": 4}

    def _rank(p: dict[str, Any]) -> int:
        return status_priority.get(_canonical_generation_status(p.get("status")), 9)

    selected = sorted(valid, key=_rank)[0]
    merged = dict(selected)
    merged["status"] = _canonical_generation_status(selected.get("status"))
    return merged


def _enqueue_feedback_generation_job_for_link(
    *,
    feedback_link_id: str,
    created_by: str,
    enqueue_reason: str | None,
) -> dict[str, Any]:
    try:
        rq_job_id = slide_batch_job_manager.enqueue_callable(
            generate_static_feedback_with_version_snapshot_for_feedback_link,
            str(feedback_link_id),
            created_by=created_by,
        )
        set_feedback_link_generation_job_id(str(feedback_link_id), str(rq_job_id))
        return {
            "ok": True,
            "queued": True,
            "job_id": str(rq_job_id),
            "feedback_link_id": str(feedback_link_id),
            "generation_mode": "async",
            "generation_enqueue_reason": enqueue_reason,
            "enqueue_error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "queued": False,
            "job_id": None,
            "feedback_link_id": str(feedback_link_id),
            "generation_mode": "inline_fallback",
            "generation_enqueue_reason": enqueue_reason,
            "enqueue_error": str(exc),
        }


def _ensure_static_feedback_version_schema(db: Session) -> None:
    global _STATIC_FEEDBACK_SCHEMA_READY
    if _STATIC_FEEDBACK_SCHEMA_READY:
        return
    with _STATIC_FEEDBACK_SCHEMA_GUARD:
        if _STATIC_FEEDBACK_SCHEMA_READY:
            return
        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _STATIC_FEEDBACK_SCHEMA_LOCK_KEY})
        db.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS feedback_static_feedback_version (
                    version_id VARCHAR(16) PRIMARY KEY,
                    question_id VARCHAR(16) NOT NULL,
                    question_version_id VARCHAR(16) NOT NULL,
                    agent_id VARCHAR(16) NOT NULL,
                    revision_no INT NOT NULL,
                    question_feedback_text TEXT NULL,
                    parent_version_id VARCHAR(16) NULL,
                    restored_from_version_id VARCHAR(16) NULL,
                    created_by VARCHAR(16) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
        )
        db.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_feedback_static_feedback_version_question_agent_created_at
                ON feedback_static_feedback_version (question_id, agent_id, created_at DESC);
                """
            )
        )
        db.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS feedback_static_feedback_version_option (
                    version_option_id VARCHAR(16) PRIMARY KEY,
                    version_id VARCHAR(16) NOT NULL REFERENCES feedback_static_feedback_version(version_id) ON DELETE CASCADE,
                    interaction_option_id VARCHAR(16) NOT NULL,
                    feedback_text TEXT NOT NULL,
                    created_by VARCHAR(16) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_feedback_static_feedback_version_option UNIQUE (version_id, interaction_option_id)
                );
                """
            )
        )
        # Backward-compat migration for existing deployments created before TZ support.
        db.execute(
            text(
                """
                ALTER TABLE feedback_static_feedback_version
                ALTER COLUMN created_at TYPE TIMESTAMPTZ
                USING created_at AT TIME ZONE 'UTC';
                """
            )
        )
        db.execute(
            text(
                """
                ALTER TABLE feedback_static_feedback_version_option
                ALTER COLUMN created_at TYPE TIMESTAMPTZ
                USING created_at AT TIME ZONE 'UTC';
                """
            )
        )
        db.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_feedback_static_feedback_version_option_version_id
                ON feedback_static_feedback_version_option (version_id);
                """
            )
        )
        db.commit()
        _STATIC_FEEDBACK_SCHEMA_READY = True


def _get_latest_static_feedback_version(db: Session, *, question_id: str, agent_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              version_id, question_id, question_version_id, agent_id, revision_no,
              question_feedback_text, parent_version_id, restored_from_version_id,
              created_by, created_at
            FROM feedback_static_feedback_version
            WHERE question_id = :question_id AND agent_id = :agent_id
            ORDER BY revision_no DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"question_id": question_id, "agent_id": agent_id},
    ).mappings().first()
    return dict(row) if row else None


def _get_static_feedback_version_by_id(db: Session, *, version_id: str, question_id: str, agent_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              version_id, question_id, question_version_id, agent_id, revision_no,
              question_feedback_text, parent_version_id, restored_from_version_id,
              created_by, created_at
            FROM feedback_static_feedback_version
            WHERE version_id = :version_id
              AND question_id = :question_id
              AND agent_id = :agent_id
            LIMIT 1
            """
        ),
        {"version_id": version_id, "question_id": question_id, "agent_id": agent_id},
    ).mappings().first()
    return dict(row) if row else None


def _get_static_feedback_version_option_feedback(db: Session, version_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT interaction_option_id, feedback_text
            FROM feedback_static_feedback_version_option
            WHERE version_id = :version_id
            ORDER BY interaction_option_id ASC
            """
        ),
        {"version_id": version_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def _to_utc_iso_z(value: Any) -> str | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _read_current_feedback_link_state(
    db: Session, *, question_version_id: str, agent_id: str
) -> tuple[Optional[str], list[dict[str, Any]]]:
    q_row = db.execute(
        text(
            """
            SELECT static_feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'question_version'
              AND target_entity_id = :question_version_id
              AND is_visible = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().first()
    question_feedback_text = str(q_row["static_feedback_text"]) if q_row and q_row.get("static_feedback_text") is not None else None

    opt_rows = db.execute(
        text(
            """
            SELECT target_entity_id AS interaction_option_id, static_feedback_text AS feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'interaction_option'
              AND is_visible = TRUE
            ORDER BY target_entity_id ASC
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().all()
    option_feedback = []
    for row in opt_rows:
        text_value = (row.get("feedback_text") or "").strip()
        if text_value:
            option_feedback.append(
                {
                    "interaction_option_id": str(row["interaction_option_id"]),
                    "feedback_text": text_value,
                }
            )
    return question_feedback_text, option_feedback


def _create_static_feedback_version_snapshot(
    db: Session,
    *,
    question_id: str,
    question_version_id: str,
    agent_id: str,
    created_by: str,
    question_feedback_text: Optional[str],
    option_feedback: list[dict[str, Any]],
    parent_version_id: Optional[str],
    restored_from_version_id: Optional[str] = None,
) -> dict[str, Any]:
    latest = _get_latest_static_feedback_version(db, question_id=question_id, agent_id=agent_id)
    revision_no = int(latest["revision_no"]) + 1 if latest else 1
    version_id = _generate_unique_id(db, "feedback_static_feedback_version", "version_id", "fv")
    db.execute(
        text(
            """
            INSERT INTO feedback_static_feedback_version (
              version_id, question_id, question_version_id, agent_id, revision_no,
              question_feedback_text, parent_version_id, restored_from_version_id, created_by, created_at
            ) VALUES (
              :version_id, :question_id, :question_version_id, :agent_id, :revision_no,
              :question_feedback_text, :parent_version_id, :restored_from_version_id, :created_by, NOW()
            )
            """
        ),
        {
            "version_id": version_id,
            "question_id": question_id,
            "question_version_id": question_version_id,
            "agent_id": agent_id,
            "revision_no": revision_no,
            "question_feedback_text": question_feedback_text,
            "parent_version_id": parent_version_id,
            "restored_from_version_id": restored_from_version_id,
            "created_by": created_by,
        },
    )

    for item in option_feedback:
        db.execute(
            text(
                """
                INSERT INTO feedback_static_feedback_version_option (
                  version_option_id, version_id, interaction_option_id, feedback_text, created_by, created_at
                ) VALUES (
                  :version_option_id, :version_id, :interaction_option_id, :feedback_text, :created_by, NOW()
                )
                """
            ),
            {
                "version_option_id": _generate_unique_id(
                    db, "feedback_static_feedback_version_option", "version_option_id", "fo"
                ),
                "version_id": version_id,
                "interaction_option_id": item["interaction_option_id"],
                "feedback_text": item["feedback_text"],
                "created_by": created_by,
            },
        )

    created = _get_static_feedback_version_by_id(db, version_id=version_id, question_id=question_id, agent_id=agent_id)
    if created is None:
        raise HTTPException(status_code=500, detail="failed to load created static feedback version")
    created["option_feedback"] = option_feedback
    return created


def _generate_unique_id(db: Session, table: str, col: str, prefix: str) -> str:
    sql = text(f"SELECT 1 FROM {table} WHERE {col} = :v LIMIT 1")
    for _ in range(50):
        cand = generate_short_id(prefix)
        if not db.execute(sql, {"v": cand}).scalar():
            return cand
    raise HTTPException(status_code=500, detail=f"Unable to generate unique id for {table}.{col}")


def _question_exists(db: Session, question_id: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM content_question WHERE question_id = :qid LIMIT 1"), {"qid": question_id}).scalar())


def _question_version_has_randomize_option_order_column(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'content_question_version'
                  AND column_name = 'randomize_option_order'
                LIMIT 1
                """
            )
        ).scalar()
    )


def _question_interaction_has_column(db: Session, column_name: str) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'content_question_interaction'
                  AND column_name = :column_name
                LIMIT 1
                """
            ),
            {"column_name": column_name},
        ).scalar()
    )


def _question_interaction_has_reference_answer_text_column(db: Session) -> bool:
    return _question_interaction_has_column(db, "reference_answer_text")


def _question_interaction_has_reference_answer_meta_column(db: Session) -> bool:
    return _question_interaction_has_column(db, "reference_answer_meta")


def _question_row(db: Session, question_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT question_id, current_version_id, access_scope, is_visible, created_by, created_at
            FROM content_question
            WHERE question_id = :qid
            LIMIT 1
            """
        ),
        {"qid": question_id},
    ).mappings().first()
    return dict(row) if row else None


def _question_version_exists(db: Session, question_version_id: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM content_question_version WHERE question_version_id = :qv LIMIT 1"), {"qv": question_version_id}).scalar())


def _question_version_type(db: Session, question_version_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT question_type
            FROM content_question_version
            WHERE question_version_id = :qv
            LIMIT 1
            """
        ),
        {"qv": question_version_id},
    ).scalar()
    return str(row) if row is not None else None


def _coerce_runtime_learner_id(value: str | None) -> str:
    if value and value.strip():
        return value.strip()
    return f"test_learner_{secrets.token_hex(4)}"


def _resolve_runtime_attempt_stats(
    db: Session,
    *,
    learner_id: str,
    question_id: str,
    composition_id: str | None = None,
) -> dict[str, Any]:
    try:
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
                  ), 0)::INT AS correct_count,
                  MAX(score_given) AS best_score,
                  MAX(score_maximum) AS best_score_max
                FROM feedback_record_result
                WHERE question_id = :question_id
                  AND participant_id = :learner_id
                  AND composition_id IS NOT DISTINCT FROM :composition_id
                """
            ),
            {"question_id": question_id, "learner_id": learner_id, "composition_id": composition_id},
        ).mappings().first()
    except Exception as exc:
        if "composition_id" not in str(exc):
            raise
        db.rollback()
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
                  ), 0)::INT AS correct_count,
                  MAX(score_given) AS best_score,
                  MAX(score_maximum) AS best_score_max
                FROM feedback_record_result
                WHERE question_id = :question_id
                  AND participant_id = :learner_id
                """
            ),
            {"question_id": question_id, "learner_id": learner_id},
        ).mappings().first()
    attempted = int(row["attempted_count"] or 0) if row else 0
    correct = int(row["correct_count"] or 0) if row else 0
    best_score = _safe_float((row or {}).get("best_score"))
    best_score_max = _safe_float((row or {}).get("best_score_max"))

    question_score_maximum = None
    if question_id.startswith("qn_"):
        question_row = db.execute(
            text(
                """
                SELECT qv.score_maximum, qv.question_type
                FROM content_question q
                JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
                WHERE q.question_id = :question_id
                LIMIT 1
                """
            ),
            {"question_id": question_id},
        ).mappings().first()
        if question_row:
            question_score_maximum = _safe_float(question_row.get("score_maximum"))
            if question_score_maximum is None:
                qtype = str(question_row.get("question_type") or "").strip().lower()
                if qtype == "single_choice":
                    question_score_maximum = 1.0
                elif qtype in {"free_text", "essay"}:
                    question_score_maximum = 2.0

    has_scoring = bool(composition_id) and ("scoring" in str(composition_id).lower())
    is_unlimited = not has_scoring
    max_attempts: int | None = 3 if has_scoring else None
    attempt_time_limit_seconds: int | None = None

    remaining_attempts = None
    if max_attempts is not None:
        remaining_attempts = max(max_attempts - attempted, 0)

    resolved_max_score = question_score_maximum
    return {
        "attempted_count": attempted,
        "attempt_count": attempted,
        "correct_count": correct,
        "wrong_count": max(attempted - correct, 0),
        "best_score": best_score,
        "best_score_max": best_score_max,
        "max_score": resolved_max_score,
        "maxScore": resolved_max_score,
        "score_maximum": resolved_max_score,
        "max_attempts": max_attempts,
        "remaining_attempts": remaining_attempts,
        "is_unlimited": is_unlimited,
        "attempt_time_limit_seconds": attempt_time_limit_seconds,
        "attempt_time_limit": attempt_time_limit_seconds,
        "attemptTimeLimit": attempt_time_limit_seconds,
    }


def _resolve_composition_match(
    db: Session,
    *,
    composition_id: str,
    question_id: str,
    learner_id: str,
) -> tuple[dict[str, Any] | None, dict[str, int] | None]:
    comp = db.execute(
        text(
            """
            SELECT composition_id, question_id, question_type, is_visible
            FROM feedback_compositions
            WHERE composition_id = :composition_id
            LIMIT 1
            """
        ),
        {"composition_id": composition_id},
    ).mappings().first()
    if not comp or not bool(comp["is_visible"]):
        return None, None
    bound_qid = comp["question_id"]
    if bound_qid and str(bound_qid) != question_id:
        return None, None

    context = _resolve_runtime_attempt_stats(
        db,
        learner_id=learner_id,
        question_id=question_id,
        composition_id=composition_id,
    )
    rows = db.execute(
        text(
            """
            SELECT
              rule_id, rule_order, condition_expression, feedback_mode, feedback_agent_id, slide_mode, is_enabled
            FROM feedback_composition_rules
            WHERE composition_id = :composition_id
            ORDER BY rule_order ASC, rule_id ASC
            """
        ),
        {"composition_id": composition_id},
    ).mappings().all()

    for row in rows:
        if not bool(row["is_enabled"]):
            continue
        try:
            if compile_condition_expression(str(row["condition_expression"])).evaluate(context):
                return dict(row), context
        except CompositionExprError:
            continue
    return None, context


def _runtime_option_ids_for_version(db: Session, question_version_id: str) -> list[str]:
    rows = db.execute(
        text(
            """
            SELECT o.interaction_option_id
            FROM content_question_interaction i
            JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
            WHERE i.question_version_id = :qv
            ORDER BY i.interaction_order ASC, o.option_order ASC
            """
        ),
        {"qv": question_version_id},
    ).mappings().all()
    return [str(r["interaction_option_id"]) for r in rows]


def _build_question_list_content_blocks(db: Session, version_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not version_ids:
        return {}

    rows = db.execute(
        text(
            """
            SELECT question_version_id, block_order, block_type, text_content, media_url, alt_text
            FROM content_question_content_block
            WHERE question_version_id = ANY(CAST(:version_ids AS TEXT[]))
            ORDER BY question_version_id ASC, block_order ASC
            """
        ),
        {"version_ids": version_ids},
    ).mappings().all()

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        # Compatibility fields for frontends that still render legacy node shape.
        item["type"] = item.get("block_type")
        item["content"] = item.get("text_content") or item.get("media_url")
        if item.get("block_type") == "image":
            item["image_url"] = item.get("media_url")
            item["src"] = item.get("media_url")
        grouped.setdefault(str(row["question_version_id"]), []).append(item)
    return grouped


def _build_question_list_slide_scope(db: Session, version_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not version_ids:
        return {}

    def _to_float_vector(value: Any) -> list[float] | None:
        if value is None:
            return None
        if isinstance(value, list):
            seq = value
        elif isinstance(value, tuple):
            seq = list(value)
        else:
            try:
                seq = list(value)
            except Exception:
                return None
        if not seq:
            return None
        out: list[float] = []
        try:
            for item in seq:
                out.append(float(item))
        except Exception:
            return None
        return out

    def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        if len(vec_a) != len(vec_b):
            return -1.0
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        if norm_a == 0.0 or norm_b == 0.0:
            return -1.0
        return dot / (norm_a * norm_b)

    rows = db.execute(
        text(
            """
            SELECT
              s.question_version_id,
              s.slide_scope_id,
              s.slide_id::text AS slide_id,
              s.page_start,
              s.page_end,
              s.created_by,
              s.created_at,
              sl.slide_title,
              sl.slide_google_id,
              sl.module_id::text AS module_id,
              m.module_title,
              m.course_id::text AS course_id,
              c.course_title,
              COALESCE(pc.total_pages, 0) AS slide_total_pages,
              NULL::int AS most_relevant_page_number
            FROM content_question_slide_scope s
            JOIN slide sl ON sl.id = s.slide_id
            JOIN module m ON m.module_id = sl.module_id
            JOIN course c ON c.course_id = m.course_id
            LEFT JOIN (
              SELECT slide_id, COUNT(*)::int AS total_pages
              FROM page
              GROUP BY slide_id
            ) pc ON pc.slide_id = s.slide_id
            WHERE s.question_version_id = ANY(CAST(:version_ids AS TEXT[]))
            ORDER BY s.question_version_id ASC, s.created_at ASC, s.slide_scope_id ASC
            """
        ),
        {"version_ids": version_ids},
    ).mappings().all()

    vector_rows = db.execute(
        text(
            """
            SELECT
              question_version_id::text AS question_version_id,
              question_vector,
              question_answer_vector
            FROM content_question_version
            WHERE question_version_id = ANY(CAST(:version_ids AS TEXT[]))
            """
        ),
        {"version_ids": version_ids},
    ).mappings().all()
    retrieval_vector_by_version: dict[str, list[float]] = {}
    for row in vector_rows:
        qv_id = str(row.get("question_version_id") or "")
        if not qv_id:
            continue
        vec = _to_float_vector(row.get("question_answer_vector")) or _to_float_vector(row.get("question_vector"))
        if vec:
            retrieval_vector_by_version[qv_id] = vec

    slide_ids = list({str(r.get("slide_id")) for r in rows if r.get("slide_id")})
    page_rows: list[dict[str, Any]] = []
    if slide_ids:
        page_rows = db.execute(
            text(
                """
                SELECT slide_id::text AS slide_id, page_number, vector
                FROM page
                WHERE slide_id = ANY(CAST(:slide_ids AS UUID[]))
                  AND vector IS NOT NULL
                ORDER BY slide_id ASC, page_number ASC
                """
            ),
            {"slide_ids": slide_ids},
        ).mappings().all()
    pages_by_slide: dict[str, list[dict[str, Any]]] = {}
    for row in page_rows:
        pages_by_slide.setdefault(str(row.get("slide_id")), []).append(dict(row))

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        qv_id = str(item.get("question_version_id") or "")
        retrieval_vector = retrieval_vector_by_version.get(qv_id)
        most_relevant_page_number: int | None = None
        if retrieval_vector:
            sid = str(item.get("slide_id") or "")
            page_start = item.get("page_start")
            page_end = item.get("page_end")
            best_similarity = -1.0
            for page in pages_by_slide.get(sid, []):
                raw_page_number = int(page.get("page_number") or 0)
                if raw_page_number < 0:
                    continue
                # `page.page_number` is stored 0-based; expose/compare as 1-based.
                page_number = raw_page_number + 1
                if page_start is not None and page_number < int(page_start):
                    continue
                if page_end is not None and page_number > int(page_end):
                    continue
                page_vector = _to_float_vector(page.get("vector"))
                if not page_vector:
                    continue
                similarity = _cosine_similarity(retrieval_vector, page_vector)
                if similarity > best_similarity:
                    best_similarity = similarity
                    most_relevant_page_number = page_number
        item["most_relevant_page_number"] = most_relevant_page_number
        item["slide"] = {
            "slide_id": item.get("slide_id"),
            "slide_google_id": item.get("slide_google_id"),
            "slide_title": item.get("slide_title"),
            "module_id": item.get("module_id"),
            "module_title": item.get("module_title"),
            "course_id": item.get("course_id"),
            "course_title": item.get("course_title"),
        }
        grouped.setdefault(str(row["question_version_id"]), []).append(item)
    return grouped


def _build_question_list_interactions(db: Session, version_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not version_ids:
        return {}

    interaction_rows = db.execute(
        text(
            """
            SELECT
              i.interaction_id,
              i.question_version_id,
              i.interaction_order,
              i.interaction_type,
              i.prompt_text,
              i.is_required,
              i.max_score,
              (to_jsonb(i)->>'reference_answer_text') AS reference_answer_text,
              (to_jsonb(i)->'reference_answer_meta') AS reference_answer_meta
            FROM content_question_interaction i
            WHERE i.question_version_id = ANY(CAST(:version_ids AS TEXT[]))
            ORDER BY i.question_version_id ASC, i.interaction_order ASC
            """
        ),
        {"version_ids": version_ids},
    ).mappings().all()

    interaction_ids = [str(r["interaction_id"]) for r in interaction_rows]
    options_by_interaction: dict[str, list[dict[str, Any]]] = {}
    if interaction_ids:
        option_rows = db.execute(
            text(
                """
                SELECT
                  interaction_option_id,
                  interaction_id,
                  option_order,
                  option_value,
                  option_label,
                  is_correct
                FROM content_question_interaction_option
                WHERE interaction_id = ANY(CAST(:interaction_ids AS TEXT[]))
                ORDER BY interaction_id ASC, option_order ASC
                """
            ),
            {"interaction_ids": interaction_ids},
        ).mappings().all()
        for row in option_rows:
            item = dict(row)
            # Frontend compatibility aliases
            item["option_text"] = item.get("option_label")
            item["text"] = item.get("option_label") or item.get("option_value")
            item["label"] = item.get("option_label")
            item["correct"] = item.get("is_correct")
            options_by_interaction.setdefault(str(row["interaction_id"]), []).append(item)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in interaction_rows:
        item = dict(row)
        opts = options_by_interaction.get(str(row["interaction_id"]), [])
        item["options"] = opts
        # Additional alias for frontend parsers that expect a different key.
        item["interaction_options"] = opts
        grouped.setdefault(str(row["question_version_id"]), []).append(item)
    return grouped


def _shuffle_options(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    shuffled = list(options)
    if len(shuffled) > 1:
        secrets.SystemRandom().shuffle(shuffled)
    return shuffled


def _apply_option_order_policy(
    interactions: list[dict[str, Any]],
    *,
    randomize_option_order: bool,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for interaction in interactions:
        item = dict(interaction)
        options = [dict(x) for x in (item.get("options") or [])]
        if randomize_option_order:
            options = _shuffle_options(options)
            for idx, opt in enumerate(options, start=1):
                opt["option_order"] = idx
        item["options"] = options
        item["interaction_options"] = options
        normalized.append(item)
    return normalized


def _parse_slide_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid slide_id UUID: {value}") from e


def _validate_slide_scope(db: Session, scopes: list[SlideScopeIn]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for scope in scopes:
        slide_uuid = _parse_slide_uuid(scope.slide_id)
        exists = db.execute(text("SELECT 1 FROM slide WHERE id = :sid LIMIT 1"), {"sid": slide_uuid}).scalar()
        if not exists:
            raise HTTPException(status_code=400, detail=f"slide_id not found: {scope.slide_id}")
        normalized.append(
            {
                "slide_id": slide_uuid,
                "page_start": scope.page_start,
                "page_end": scope.page_end,
            }
        )
    return normalized


def _ensure_question_embedding_columns(db: Session) -> None:
    db.execute(
        text(
            """
            ALTER TABLE content_question_version
            ADD COLUMN IF NOT EXISTS question_vector DOUBLE PRECISION[],
            ADD COLUMN IF NOT EXISTS question_answer_vector DOUBLE PRECISION[];
            """
        )
    )


def _build_question_embedding_text(payload: QuestionCreateRequest | QuestionVersionCreateRequest) -> str:
    lines: list[str] = []
    for block in payload.content_blocks:
        if block.block_type == "image":
            content = (block.alt_text or block.media_url or "").strip()
        else:
            content = (block.text_content or block.media_url or "").strip()
        if content:
            lines.append(content)
    for interaction in sorted(payload.interactions, key=lambda x: x.interaction_order):
        prompt = (interaction.prompt_text or "").strip()
        if prompt:
            lines.append(prompt)
        if interaction.options:
            for idx, opt in enumerate(interaction.options, start=1):
                value = (opt.option_label or opt.option_value or "").strip()
                if value:
                    lines.append(f"Option {idx}: {value}")
    return "\n".join(lines).strip()


def _build_correct_answer_text(payload: QuestionCreateRequest | QuestionVersionCreateRequest) -> str:
    answers: list[str] = []
    for interaction in payload.interactions:
        correct = [
            (opt.option_label or opt.option_value or "").strip()
            for opt in interaction.options
            if opt.is_correct and (opt.option_label or opt.option_value)
        ]
        if correct:
            answers.append("; ".join(correct))
    return "\n".join(answers).strip()


def _create_question_vectors(
    payload: QuestionCreateRequest | QuestionVersionCreateRequest,
) -> tuple[list[float] | None, list[float] | None]:
    question_text = _build_question_embedding_text(payload)
    if not question_text:
        raise HTTPException(status_code=400, detail="question content is empty; cannot create vectors")
    correct_answer_text = _build_correct_answer_text(payload)
    question_with_answer_text = (
        f"{question_text}\n\nCorrect answer:\n{correct_answer_text}" if correct_answer_text else question_text
    )

    # Retrieval vectors are type-specific:
    # - free_text/essay: use question vector only
    # - single_choice: use question + correct answer vector only
    # - fallback for other types: question vector only
    inputs: list[str] = []
    use_question_vector = False
    use_question_answer_vector = False
    if payload.question_type in {"free_text", "essay"}:
        inputs = [question_text]
        use_question_vector = True
    elif payload.question_type == "single_choice":
        inputs = [question_with_answer_text]
        use_question_answer_vector = True
    else:
        inputs = [question_text]
        use_question_vector = True

    settings = get_settings()
    client = OpenAI(
        api_key=settings.openai_api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj,
    )
    try:
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=inputs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to create question vectors: {e}") from e

    vectors = [list(item.embedding) for item in response.data]
    if not vectors:
        raise HTTPException(status_code=500, detail="failed to create question vectors: incomplete embedding response")
    question_vector: list[float] | None = vectors[0] if use_question_vector else None
    question_answer_vector: list[float] | None = vectors[0] if use_question_answer_vector else None
    return question_vector, question_answer_vector


def _insert_question_version_bundle(
    db: Session,
    *,
    question_id: str,
    version_no: int,
    payload: QuestionCreateRequest | QuestionVersionCreateRequest,
    change_note: str | None,
    set_as_current: bool = True,
) -> dict[str, str]:
    qv_id = _generate_unique_id(db, "content_question_version", "question_version_id", "qv")
    scoring = payload.scoring_policy
    _ensure_question_embedding_columns(db)
    question_vector, question_answer_vector = _create_question_vectors(payload)
    has_reference_answer_text_column = _question_interaction_has_reference_answer_text_column(db)
    has_reference_answer_meta_column = _question_interaction_has_reference_answer_meta_column(db)

    insert_params = {
        "question_version_id": qv_id,
        "question_id": question_id,
        "version_no": version_no,
        "question_type": payload.question_type,
        "title": payload.title,
        "change_note": change_note,
        "score_maximum": scoring.score_maximum,
        "score_input_format": scoring.score_input_format,
        "score_normalize_to_maximum": scoring.score_normalize_to_maximum,
        "score_rounding_mode": scoring.score_rounding_mode,
        "score_rounding_step": scoring.score_rounding_step,
        "question_vector": question_vector,
        "question_answer_vector": question_answer_vector,
        "created_by": payload.created_by,
    }
    if _question_version_has_randomize_option_order_column(db):
        db.execute(
            text(
                """
                INSERT INTO content_question_version (
                  question_version_id, question_id, version_no, question_type, title, change_note,
                  score_maximum, score_input_format, score_normalize_to_maximum, score_rounding_mode, score_rounding_step,
                  randomize_option_order,
                  question_vector, question_answer_vector, created_by, created_at
                ) VALUES (
                  :question_version_id, :question_id, :version_no, :question_type, :title, :change_note,
                  :score_maximum, :score_input_format, :score_normalize_to_maximum, :score_rounding_mode, :score_rounding_step,
                  :randomize_option_order,
                  :question_vector, :question_answer_vector, :created_by, NOW()
                )
                """
            ),
            {**insert_params, "randomize_option_order": payload.randomize_option_order},
        )
    else:
        db.execute(
            text(
                """
                INSERT INTO content_question_version (
                  question_version_id, question_id, version_no, question_type, title, change_note,
                  score_maximum, score_input_format, score_normalize_to_maximum, score_rounding_mode, score_rounding_step,
                  question_vector, question_answer_vector, created_by, created_at
                ) VALUES (
                  :question_version_id, :question_id, :version_no, :question_type, :title, :change_note,
                  :score_maximum, :score_input_format, :score_normalize_to_maximum, :score_rounding_mode, :score_rounding_step,
                  :question_vector, :question_answer_vector, :created_by, NOW()
                )
                """
            ),
            insert_params,
        )

    for idx, block in enumerate(payload.content_blocks, start=1):
        db.execute(
            text(
                """
                INSERT INTO content_question_content_block (
                  content_block_id, question_version_id, block_order, block_type, text_content, media_url, alt_text, created_by, created_at
                ) VALUES (
                  :content_block_id, :question_version_id, :block_order, :block_type, :text_content, :media_url, :alt_text, :created_by, NOW()
                )
                """
            ),
            {
                "content_block_id": _generate_unique_id(db, "content_question_content_block", "content_block_id", "qb"),
                "question_version_id": qv_id,
                "block_order": idx,
                "block_type": block.block_type,
                "text_content": block.text_content,
                "media_url": block.media_url,
                "alt_text": block.alt_text,
                "created_by": payload.created_by,
            },
        )

    interaction_id_map: dict[int, str] = {}
    for interaction in sorted(payload.interactions, key=lambda x: x.interaction_order):
        interaction_id = _generate_unique_id(db, "content_question_interaction", "interaction_id", "qi")
        interaction_id_map[interaction.interaction_order] = interaction_id
        db.execute(
            text(
                (
                    """
                    INSERT INTO content_question_interaction (
                      interaction_id, question_version_id, interaction_order, interaction_type, prompt_text, is_required, max_score,
                      reference_answer_text, reference_answer_meta, created_by, created_at
                    ) VALUES (
                      :interaction_id, :question_version_id, :interaction_order, :interaction_type, :prompt_text, :is_required, :max_score,
                      :reference_answer_text, CAST(:reference_answer_meta AS JSONB), :created_by, NOW()
                    )
                    """
                    if has_reference_answer_text_column and has_reference_answer_meta_column
                    else """
                    INSERT INTO content_question_interaction (
                      interaction_id, question_version_id, interaction_order, interaction_type, prompt_text, is_required, max_score,
                      reference_answer_text, created_by, created_at
                    ) VALUES (
                      :interaction_id, :question_version_id, :interaction_order, :interaction_type, :prompt_text, :is_required, :max_score,
                      :reference_answer_text, :created_by, NOW()
                    )
                    """
                    if has_reference_answer_text_column
                    else """
                    INSERT INTO content_question_interaction (
                      interaction_id, question_version_id, interaction_order, interaction_type, prompt_text, is_required, max_score,
                      reference_answer_meta, created_by, created_at
                    ) VALUES (
                      :interaction_id, :question_version_id, :interaction_order, :interaction_type, :prompt_text, :is_required, :max_score,
                      CAST(:reference_answer_meta AS JSONB), :created_by, NOW()
                    )
                    """
                    if has_reference_answer_meta_column
                    else """
                    INSERT INTO content_question_interaction (
                      interaction_id, question_version_id, interaction_order, interaction_type, prompt_text, is_required, max_score, created_by, created_at
                    ) VALUES (
                      :interaction_id, :question_version_id, :interaction_order, :interaction_type, :prompt_text, :is_required, :max_score, :created_by, NOW()
                    )
                    """
                )
            ),
            {
                "interaction_id": interaction_id,
                "question_version_id": qv_id,
                "interaction_order": interaction.interaction_order,
                "interaction_type": interaction.interaction_type,
                "prompt_text": interaction.prompt_text,
                "is_required": interaction.is_required,
                "max_score": interaction.max_score,
                "reference_answer_text": interaction.reference_answer_text,
                "reference_answer_meta": (
                    json.dumps(interaction.reference_answer_meta) if interaction.reference_answer_meta is not None else None
                ),
                "created_by": payload.created_by,
            },
        )

        for opt in sorted(interaction.options, key=lambda x: x.option_order):
            db.execute(
                text(
                    """
                    INSERT INTO content_question_interaction_option (
                      interaction_option_id, interaction_id, option_order, option_value, option_label, is_correct, created_by, created_at
                    ) VALUES (
                      :interaction_option_id, :interaction_id, :option_order, :option_value, :option_label, :is_correct, :created_by, NOW()
                    )
                    """
                ),
                {
                    "interaction_option_id": _generate_unique_id(db, "content_question_interaction_option", "interaction_option_id", "qo"),
                    "interaction_id": interaction_id,
                    "option_order": int(opt.option_order),
                    "option_value": opt.option_value,
                    "option_label": opt.option_label,
                    "is_correct": opt.is_correct,
                    "created_by": payload.created_by,
                },
            )

    slide_scopes = _validate_slide_scope(db, payload.slide_scope)
    for scope in slide_scopes:
        db.execute(
            text(
                """
                INSERT INTO content_question_slide_scope (
                  slide_scope_id, question_version_id, slide_id, page_start, page_end, created_by, created_at
                ) VALUES (
                  :slide_scope_id, :question_version_id, :slide_id, :page_start, :page_end, :created_by, NOW()
                )
                """
            ),
            {
                "slide_scope_id": _generate_unique_id(db, "content_question_slide_scope", "slide_scope_id", "qs"),
                "question_version_id": qv_id,
                "slide_id": scope["slide_id"],
                "page_start": scope["page_start"],
                "page_end": scope["page_end"],
                "created_by": payload.created_by,
            },
        )

    if set_as_current:
        db.execute(
            text("UPDATE content_question SET current_version_id = :qv WHERE question_id = :qid"),
            {"qv": qv_id, "qid": question_id},
        )

    return {"question_version_id": qv_id, "interaction_id": interaction_id_map.get(1)}


def _copy_feedback_links_from_previous(
    db: Session,
    *,
    source_qv_id: str,
    target_qv_id: str,
    created_by: str,
    copy_ai_static_feedback: bool = True,
    copy_human_static_feedback: bool = True,
) -> int:
    # Copying target references safely across versions requires entity remapping. For now only clone question_version-level links.
    rows = db.execute(
        text(
            """
            SELECT
              fl.agent_id,
              fl.target_entity_type,
              fl.target_entity_id,
              fl.priority,
              fl.static_feedback_text,
              fl.structured_feedback_text,
              fl.is_visible,
              COALESCE(fa.role::text, '') AS agent_role
            FROM feedback_link fl
            LEFT JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :source_qv_id
              AND fl.is_visible = TRUE
              AND fl.target_entity_type = 'question_version'
            """
        ),
        {"source_qv_id": source_qv_id},
    ).mappings().all()
    count = 0
    for row in rows:
        role = str(row.get("agent_role") or "").strip().lower()
        include_static = (
            (role == "ai" and copy_ai_static_feedback)
            or (role == "human" and copy_human_static_feedback)
        )
        _insert_feedback_link(
            db,
            question_version_id=target_qv_id,
            agent_id=row["agent_id"],
            target_entity_type="question_version",
            target_entity_id=target_qv_id,
            priority=row["priority"],
            static_feedback_text=(row["static_feedback_text"] if include_static else None),
            structured_feedback_text=(row["structured_feedback_text"] if include_static else None),
            created_by=created_by,
        )
        count += 1
    return count


@router.post("/questions")
def create_semantic_question(payload: QuestionCreateRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")

    try:
        question_id = _generate_unique_id(db, "content_question", "question_id", "qn")
        db.execute(
            text(
                """
                INSERT INTO content_question (question_id, current_version_id, access_scope, is_visible, created_by, created_at)
                VALUES (:question_id, NULL, :access_scope, TRUE, :created_by, NOW())
                """
            ),
            {"question_id": question_id, "access_scope": payload.access_scope, "created_by": payload.created_by},
        )
        version_bundle = _insert_question_version_bundle(
            db,
            question_id=question_id,
            version_no=1,
            payload=payload,
            change_note="Initial version",
            set_as_current=True,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    detail = get_semantic_question_version_detail(db, version_bundle["question_version_id"])
    if detail is not None:
        detail["interactions"] = _apply_option_order_policy(
            detail.get("interactions") or [],
            randomize_option_order=bool(detail["question_version"].get("randomize_option_order", True)),
        )
    return {
        "ok": True,
        "question_id": question_id,
        "current_version_id": version_bundle["question_version_id"],
        "version_no": 1,
        "item": detail,
    }


@router.get("/questions")
def list_user_semantic_questions(
    user_id: str = Query(..., min_length=16, max_length=16),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    question_type: Optional[QuestionType] = Query(default=None),
    db: Session = Depends(get_db),
):
    where = ["q.created_by = :user_id", "q.is_visible = TRUE"]
    params: dict[str, Any] = {"user_id": user_id, "limit": limit, "offset": offset}
    if question_type:
        where.append("qv.question_type = :question_type")
        params["question_type"] = question_type
    where_sql = " AND ".join(where)

    rows = db.execute(
        text(
            f"""
            SELECT q.question_id, q.current_version_id, q.access_scope, q.is_visible, q.created_by, q.created_at,
                   qv.question_type, qv.version_no, qv.title,
                   qv.score_maximum, qv.score_rounding_mode, qv.score_rounding_step,
                   COALESCE((to_jsonb(qv)->>'randomize_option_order')::boolean, TRUE) AS randomize_option_order
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            WHERE {where_sql}
            ORDER BY q.created_at DESC, q.question_id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total_params = {k: v for k, v in params.items() if k in {"user_id", "question_type"}}
    total = db.execute(
        text(
            f"""
            SELECT COUNT(*)::int
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            WHERE {where_sql}
            """
        ),
        total_params,
    ).scalar() or 0

    items = [dict(r) for r in rows]
    content_block_map = _build_question_list_content_blocks(
        db,
        [str(item.get("current_version_id")) for item in items if item.get("current_version_id")],
    )
    version_ids = [str(item.get("current_version_id")) for item in items if item.get("current_version_id")]
    slide_scope_map = _build_question_list_slide_scope(db, version_ids)
    interactions_map = _build_question_list_interactions(db, version_ids)
    for item in items:
        blocks = content_block_map.get(str(item.get("current_version_id")), [])
        slide_scope = slide_scope_map.get(str(item.get("current_version_id")), [])
        interactions = _apply_option_order_policy(
            interactions_map.get(str(item.get("current_version_id")), []),
            randomize_option_order=bool(item.get("randomize_option_order", True)),
        )
        item.update(
            {
                "content_blocks": blocks,
                "content_block_count": len(blocks),
                "slide_scope": slide_scope,
                "slide_ids": [str(s.get("slide_id")) for s in slide_scope if s.get("slide_id")],
                "interactions": interactions,
                "interaction_options": interactions[0].get("options", []) if interactions else [],
            }
        )

    return {
        "ok": True,
        "user_id": user_id,
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "items": items,
    }


@router.get("/questions/public")
def list_public_semantic_questions(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    question_type: Optional[QuestionType] = Query(default=None),
    db: Session = Depends(get_db),
):
    where = ["q.access_scope = 'public'", "q.is_visible = TRUE"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if question_type:
        where.append("qv.question_type = :question_type")
        params["question_type"] = question_type
    where_sql = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT q.question_id, q.current_version_id, q.access_scope, q.is_visible, q.created_by, q.created_at,
                   qv.question_type, qv.version_no, qv.title,
                   qv.score_maximum, qv.score_rounding_mode, qv.score_rounding_step,
                   COALESCE((to_jsonb(qv)->>'randomize_option_order')::boolean, TRUE) AS randomize_option_order
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            WHERE {where_sql}
            ORDER BY q.created_at DESC, q.question_id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    total_params = {k: v for k, v in params.items() if k == "question_type"}
    total = db.execute(
        text(
            f"""
            SELECT COUNT(*)::int
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            WHERE {where_sql}
            """
        ),
        total_params,
    ).scalar() or 0
    items = [dict(r) for r in rows]
    content_block_map = _build_question_list_content_blocks(
        db,
        [str(item.get("current_version_id")) for item in items if item.get("current_version_id")],
    )
    version_ids = [str(item.get("current_version_id")) for item in items if item.get("current_version_id")]
    slide_scope_map = _build_question_list_slide_scope(db, version_ids)
    interactions_map = _build_question_list_interactions(db, version_ids)
    for item in items:
        blocks = content_block_map.get(str(item.get("current_version_id")), [])
        slide_scope = slide_scope_map.get(str(item.get("current_version_id")), [])
        interactions = _apply_option_order_policy(
            interactions_map.get(str(item.get("current_version_id")), []),
            randomize_option_order=bool(item.get("randomize_option_order", True)),
        )
        item.update(
            {
                "content_blocks": blocks,
                "content_block_count": len(blocks),
                "slide_scope": slide_scope,
                "slide_ids": [str(s.get("slide_id")) for s in slide_scope if s.get("slide_id")],
                "interactions": interactions,
                "interaction_options": interactions[0].get("options", []) if interactions else [],
            }
        )

    return {"ok": True, "total": int(total), "limit": limit, "offset": offset, "items": items}


@router.post("/questions/batch/publish")
def batch_publish_semantic_questions(payload: BatchQuestionIdsRequest, db: Session = Depends(get_db)):
    _require_admin_user(db, payload.updated_by)
    requested_ids = list(dict.fromkeys(payload.question_ids))
    question_map = _question_rows_map(db, requested_ids)
    success_ids: list[str] = []
    failed: list[dict[str, str]] = []

    for question_id in requested_ids:
        if question_id not in question_map:
            failed.append({"question_id": question_id, "code": "NOT_FOUND", "message": "question not found"})
            continue
        try:
            db.execute(
                text(
                    """
                    UPDATE content_question
                    SET access_scope = 'public'
                    WHERE question_id = :question_id
                    """
                ),
                {"question_id": question_id},
            )
            db.commit()
            success_ids.append(question_id)
        except Exception as e:
            db.rollback()
            failed.append({"question_id": question_id, "code": "CONFLICT", "message": str(e)})

    return _batch_result(requested_ids, success_ids, failed)


@router.post("/questions/batch/unpublish")
def batch_unpublish_semantic_questions(payload: BatchQuestionIdsRequest, db: Session = Depends(get_db)):
    _require_admin_user(db, payload.updated_by)
    requested_ids = list(dict.fromkeys(payload.question_ids))
    question_map = _question_rows_map(db, requested_ids)
    success_ids: list[str] = []
    failed: list[dict[str, str]] = []

    for question_id in requested_ids:
        if question_id not in question_map:
            failed.append({"question_id": question_id, "code": "NOT_FOUND", "message": "question not found"})
            continue
        try:
            db.execute(
                text(
                    """
                    UPDATE content_question
                    SET access_scope = 'private'
                    WHERE question_id = :question_id
                    """
                ),
                {"question_id": question_id},
            )
            db.commit()
            success_ids.append(question_id)
        except Exception as e:
            db.rollback()
            failed.append({"question_id": question_id, "code": "CONFLICT", "message": str(e)})

    return _batch_result(requested_ids, success_ids, failed)


@router.post("/questions/batch/delete")
def batch_delete_semantic_questions(payload: BatchQuestionIdsRequest, db: Session = Depends(get_db)):
    _require_admin_user(db, payload.updated_by)
    requested_ids = list(dict.fromkeys(payload.question_ids))
    question_map = _question_rows_map(db, requested_ids)
    success_ids: list[str] = []
    failed: list[dict[str, str]] = []

    for question_id in requested_ids:
        if question_id not in question_map:
            failed.append({"question_id": question_id, "code": "NOT_FOUND", "message": "question not found"})
            continue
        try:
            db.execute(
                text(
                    """
                    UPDATE content_question
                    SET is_visible = FALSE
                    WHERE question_id = :question_id
                    """
                ),
                {"question_id": question_id},
            )
            db.commit()
            success_ids.append(question_id)
        except Exception as e:
            db.rollback()
            failed.append({"question_id": question_id, "code": "CONFLICT", "message": str(e)})

    return _batch_result(requested_ids, success_ids, failed)


@router.post("/questions/batch/attach-feedback-agent")
def batch_attach_feedback_agent_to_questions(payload: BatchAttachFeedbackAgentRequest, db: Session = Depends(get_db)):
    _require_admin_user(db, payload.updated_by)
    requested_ids = list(dict.fromkeys(payload.question_ids))
    question_map = _question_rows_map(db, requested_ids)
    success_ids: list[str] = []
    failed: list[dict[str, str]] = []
    queued_feedback_generation: list[dict[str, Any]] = []
    queued_feedback_generation_job_ids: list[str] = []
    enqueue_failed: list[dict[str, str]] = []

    agent = _get_feedback_agent(db, payload.agent_id)
    if not agent or not agent.get("is_visible", True):
        return _batch_result(
            requested_ids,
            [],
            [{"question_id": qid, "code": "NOT_FOUND", "message": "feedback agent not found"} for qid in requested_ids],
        )

    agent_role = str(agent.get("role") or "").strip().lower()
    static_feedback_text = (payload.static_feedback_text or "").strip() or None

    for question_id in requested_ids:
        question = question_map.get(question_id)
        if not question:
            failed.append({"question_id": question_id, "code": "NOT_FOUND", "message": "question not found"})
            continue

        current_version_id = str(question.get("current_version_id") or "")
        if not current_version_id:
            failed.append({"question_id": question_id, "code": "CONFLICT", "message": "question has no current version"})
            continue

        try:
            attached_link_id: str | None = None
            existing_link_id = _find_visible_question_version_link(
                db, question_version_id=current_version_id, agent_id=payload.agent_id
            )
            was_existing_link = bool(existing_link_id)
            if existing_link_id:
                # Idempotent attach: reuse existing link and optionally update static text/priority.
                update_params = {
                    "feedback_link_id": existing_link_id,
                    "priority": payload.priority,
                    "static_feedback_text": static_feedback_text,
                }
                db.execute(
                    text(
                        """
                        UPDATE feedback_link
                        SET priority = :priority,
                            static_feedback_text = CASE
                                WHEN :static_feedback_text IS NOT NULL THEN :static_feedback_text
                                ELSE static_feedback_text
                            END
                        WHERE feedback_link_id = :feedback_link_id
                        """
                    ),
                    update_params,
                )
                attached_link_id = existing_link_id
            else:
                attached_link_id = _insert_feedback_link(
                    db,
                    question_version_id=current_version_id,
                    agent_id=payload.agent_id,
                    target_entity_type="question_version",
                    target_entity_id=current_version_id,
                    priority=payload.priority,
                    static_feedback_text=static_feedback_text,
                    structured_feedback_text=None,
                    created_by=payload.updated_by,
                )
            db.commit()
            success_ids.append(question_id)
            if agent_role == "ai":
                question_type = (_question_version_type(db, current_version_id) or "").strip().lower()
                if question_type == "single_choice":
                    option_items = _single_choice_options_for_question_version(db, current_version_id)
                    option_link_ids: dict[str, str] = {}
                    for opt in option_items:
                        option_link_id = _find_visible_feedback_link_by_target(
                            db,
                            question_version_id=current_version_id,
                            agent_id=payload.agent_id,
                            target_entity_type="interaction_option",
                            target_entity_id=str(opt["interaction_option_id"]),
                        )
                        if option_link_id:
                            option_link_ids[str(opt["interaction_option_id"])] = str(option_link_id)
                            continue
                        created_link_id = _insert_feedback_link(
                            db,
                            question_version_id=current_version_id,
                            agent_id=payload.agent_id,
                            target_entity_type="interaction_option",
                            target_entity_id=str(opt["interaction_option_id"]),
                            priority=payload.priority,
                            static_feedback_text=None,
                            structured_feedback_text=None,
                            created_by=payload.updated_by,
                        )
                        option_link_ids[str(opt["interaction_option_id"])] = str(created_link_id)
                    db.commit()
                    for opt in option_items:
                        answer_text = (str(opt.get("answer_text") or "").strip() or str(opt.get("option_order") or ""))
                        option_id = str(opt["interaction_option_id"])
                        feedback_link_id = option_link_ids.get(option_id)
                        if not feedback_link_id:
                            continue
                        flow = _enqueue_feedback_generation_job_for_link(
                            feedback_link_id=str(feedback_link_id),
                            created_by=payload.updated_by,
                            enqueue_reason=(
                                "attach_existing_refresh_single_choice_option"
                                if was_existing_link
                                else "attach_new_single_choice_option"
                            ),
                        )
                        if flow.get("ok"):
                            if flow.get("job_id"):
                                queued_feedback_generation_job_ids.append(str(flow.get("job_id")))
                            queued_feedback_generation.append(
                                {
                                    "question_id": question_id,
                                    "feedback_link_id": str(feedback_link_id),
                                    "job_id": flow.get("job_id"),
                                    "generation_mode": flow.get("generation_mode"),
                                    "version_id": flow.get("version_id"),
                                    "revision_no": flow.get("revision_no"),
                                    "skipped": bool(flow.get("skipped")),
                                    "generation_enqueue_reason": flow.get("generation_enqueue_reason"),
                                    "enqueue_error": flow.get("enqueue_error"),
                                    "target_entity_type": "interaction_option",
                                    "target_entity_id": option_id,
                                    "answer_text": answer_text,
                                }
                            )
                        elif flow.get("enqueue_error"):
                            enqueue_failed.append(
                                {
                                    "question_id": question_id,
                                    "code": "JOB_ENQUEUE_FAILED",
                                    "message": str(flow.get("enqueue_error")),
                                }
                            )
                else:
                    flow = _enqueue_feedback_generation_job_for_link(
                        feedback_link_id=str(attached_link_id),
                        created_by=payload.updated_by,
                        enqueue_reason=("attach_existing_refresh" if was_existing_link else "attach_new"),
                    )
                    if flow.get("ok"):
                        if flow.get("job_id"):
                            queued_feedback_generation_job_ids.append(str(flow.get("job_id")))
                        queued_feedback_generation.append(
                            {
                                "question_id": question_id,
                                "feedback_link_id": str(attached_link_id),
                                "job_id": flow.get("job_id"),
                                "generation_mode": flow.get("generation_mode"),
                                "version_id": flow.get("version_id"),
                                "revision_no": flow.get("revision_no"),
                                "skipped": bool(flow.get("skipped")),
                                "generation_enqueue_reason": flow.get("generation_enqueue_reason"),
                                "enqueue_error": flow.get("enqueue_error"),
                            }
                        )
                    elif flow.get("enqueue_error"):
                        enqueue_failed.append(
                            {
                                "question_id": question_id,
                                "code": "JOB_ENQUEUE_FAILED",
                                "message": str(flow.get("enqueue_error")),
                            }
                        )
        except Exception as e:
            db.rollback()
            failed.append({"question_id": question_id, "code": "CONFLICT", "message": str(e)})

    result = _batch_result(requested_ids, success_ids, failed)
    if queued_feedback_generation:
        result["queued_feedback_generation"] = queued_feedback_generation
    if queued_feedback_generation_job_ids:
        result["queued_feedback_generation_job_ids"] = list(dict.fromkeys(queued_feedback_generation_job_ids))
    if enqueue_failed:
        result["enqueue_failed"] = enqueue_failed
    return result


@router.get("/questions/{question_id}/attached-agents")
def list_attached_agents_for_question(question_id: str, db: Session = Depends(get_db)):
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    rows = db.execute(
        text(
            """
            SELECT
              fl.feedback_link_id,
              fl.agent_id,
              fl.target_entity_type,
              fl.target_entity_id,
              fl.static_feedback_text,
              fl.priority,
              fl.created_at,
              fa.title AS agent_title,
              fa.role AS agent_role,
              fa.is_structured
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :question_version_id
              AND fl.is_visible = TRUE
              AND fa.is_visible = TRUE
            ORDER BY fl.created_at ASC
            """
        ),
        {"question_version_id": current_version_id},
    ).mappings().all()

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        agent_id = str(row["agent_id"])
        item = grouped.get(agent_id)
        if item is None:
            item = {
                "agent_id": agent_id,
                "title": row["agent_title"],
                "role": row["agent_role"],
                "is_structured": row["is_structured"],
                "question_feedback_link_id": None,
                "question_feedback_text": None,
                "option_feedback_link_ids": [],
                "option_feedback_count": 0,
                "link_count": 0,
            }
            grouped[agent_id] = item
        item["link_count"] += 1
        if row["target_entity_type"] == "question_version":
            item["question_feedback_link_id"] = row["feedback_link_id"]
            item["question_feedback_text"] = row["static_feedback_text"]
        elif row["target_entity_type"] == "interaction_option":
            item["option_feedback_count"] += 1
            item["option_feedback_link_ids"].append(str(row["feedback_link_id"]))

    items = list(grouped.values())
    for item in items:
        if item.get("role") != "ai":
            item.pop("option_feedback_link_ids", None)
            continue
        generation_candidates: list[dict[str, Any]] = []
        option_link_ids = [str(x) for x in (item.get("option_feedback_link_ids") or []) if x]
        for option_link_id in option_link_ids:
            generation = get_feedback_link_generation_status(option_link_id)
            if generation:
                generation_candidates.append(generation)
        question_feedback_link_id = item.get("question_feedback_link_id")
        if question_feedback_link_id:
            q_generation = get_feedback_link_generation_status(str(question_feedback_link_id))
            if q_generation and not generation_candidates:
                generation_candidates.append(q_generation)
        merged_generation = _aggregate_generation_payload(generation_candidates)
        if merged_generation:
            item["generation"] = merged_generation
            item["generation_status"] = merged_generation.get("status")
            if merged_generation.get("error"):
                item["generation_error"] = merged_generation.get("error")
        item.pop("option_feedback_link_ids", None)

    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": current_version_id,
        "count": len(items),
        "items": items,
    }


@router.post("/questions/{question_id}/attached-agents")
def attach_agent_to_single_question(question_id: str, payload: SingleAttachAgentRequest, db: Session = Depends(get_db)):
    _require_admin_user(db, payload.updated_by)
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    agent = _get_feedback_agent(db, payload.agent_id)
    if not agent or not agent.get("is_visible", True):
        raise HTTPException(status_code=404, detail="feedback agent not found")

    existing_link_id = _find_visible_question_version_link(
        db, question_version_id=current_version_id, agent_id=payload.agent_id
    )
    was_existing_link = bool(existing_link_id)
    attached_link_id = existing_link_id
    if not existing_link_id:
        attached_link_id = _insert_feedback_link(
            db,
            question_version_id=current_version_id,
            agent_id=payload.agent_id,
            target_entity_type="question_version",
            target_entity_id=current_version_id,
            priority=100,
            static_feedback_text=None,
            structured_feedback_text=None,
            created_by=payload.updated_by,
        )
        db.commit()

    queued_job = None
    queued_option_jobs: list[dict[str, Any]] = []
    if str(agent.get("role") or "").strip().lower() == "ai":
        question_type = (_question_version_type(db, current_version_id) or "").strip().lower()
        if question_type == "single_choice":
            option_items = _single_choice_options_for_question_version(db, current_version_id)
            for opt in option_items:
                option_link_id = _find_visible_feedback_link_by_target(
                    db,
                    question_version_id=current_version_id,
                    agent_id=payload.agent_id,
                    target_entity_type="interaction_option",
                    target_entity_id=str(opt["interaction_option_id"]),
                )
                if option_link_id:
                    continue
                _insert_feedback_link(
                    db,
                    question_version_id=current_version_id,
                    agent_id=payload.agent_id,
                    target_entity_type="interaction_option",
                    target_entity_id=str(opt["interaction_option_id"]),
                    priority=100,
                    static_feedback_text=None,
                    structured_feedback_text=None,
                    created_by=payload.updated_by,
                )
            db.commit()
            for opt in option_items:
                answer_text = (str(opt.get("answer_text") or "").strip() or str(opt.get("option_order") or ""))
                flow = run_feedback_generation_flow(
                    db,
                    question_id=question_id,
                    agent_id=payload.agent_id,
                    dry_run=False,
                    updated_by=payload.updated_by,
                    input_values={
                        "selected_option_id": str(opt["interaction_option_id"]),
                        "answer_text": answer_text,
                    },
                    require_updated_by_for_persist=False,
                    include_debug=False,
                    snapshot_on_persist=True,
                    execution_mode="async",
                    enqueue_reason=(
                        "attach_existing_refresh_single_choice_option"
                        if was_existing_link
                        else "attach_new_single_choice_option"
                    ),
                )
                queued_option_jobs.append(
                    {
                        "feedback_link_id": str(flow.get("feedback_link_id") or ""),
                        "job_id": flow.get("job_id"),
                        "generation_mode": flow.get("generation_mode"),
                        "version_id": flow.get("version_id"),
                        "revision_no": flow.get("revision_no"),
                        "skipped": bool(flow.get("skipped")),
                        "generation_enqueue_reason": flow.get("generation_enqueue_reason"),
                        "enqueue_error": flow.get("enqueue_error"),
                        "target_entity_type": "interaction_option",
                        "target_entity_id": str(opt["interaction_option_id"]),
                        "answer_text": answer_text,
                    }
                )
        else:
            queued_job = run_feedback_generation_flow(
                db,
                question_id=question_id,
                agent_id=payload.agent_id,
                dry_run=False,
                updated_by=payload.updated_by,
                input_values=None,
                require_updated_by_for_persist=False,
                include_debug=False,
                snapshot_on_persist=True,
                execution_mode="async",
                enqueue_reason=("attach_existing_refresh" if was_existing_link else "attach_new"),
            )

    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": current_version_id,
        "agent_id": payload.agent_id,
        "feedback_link_id": str(attached_link_id),
        "already_attached": bool(existing_link_id),
        "queued_feedback_generation": queued_job,
        "queued_option_feedback_generation": queued_option_jobs,
    }


def _run_attached_agent_feedback(
    question_id: str,
    agent_id: str,
    payload: Optional[AttachedAgentFeedbackRequest],
    db: Session,
    *,
    require_updated_by_for_persist: bool = True,
    include_debug: bool = True,
) -> dict[str, Any]:
    return run_feedback_generation_flow(
        db,
        question_id=question_id,
        agent_id=agent_id,
        dry_run=(True if payload is None else bool(payload.dry_run)),
        updated_by=((payload.updated_by if payload else None) or None),
        input_values=dict((payload.input_values if payload else None) or {}),
        require_updated_by_for_persist=require_updated_by_for_persist,
        include_debug=include_debug,
        snapshot_on_persist=True,
        execution_mode="sync",
    )


@router.post("/questions/{question_id}/attached-agents/{agent_id}/feedback")
def get_attached_agent_feedback(
    question_id: str,
    agent_id: str,
    payload: Optional[AttachedAgentFeedbackRequest] = None,
    db: Session = Depends(get_db),
):
    return _run_attached_agent_feedback(question_id=question_id, agent_id=agent_id, payload=payload, db=db)


@router.post("/questions/{question_id}/feedback")
def get_question_feedback(
    question_id: str,
    payload: UnifiedQuestionFeedbackRequest,
    db: Session = Depends(get_db),
):
    if payload.mode == "agent":
        if not payload.agent_id:
            _raise_feedback_api_error(
                status_code=400,
                code="AGENT_ID_REQUIRED",
                message="agentId is required when mode is 'agent'",
                mode=payload.mode,
                question_id=question_id,
            )
        agent_profile = _get_feedback_agent(db, str(payload.agent_id))
        agent_name = str(agent_profile.get("title") or "").strip() if agent_profile else None
        agent_name = agent_name or None
        try:
            agent_payload = AttachedAgentFeedbackRequest.model_validate(
                {
                    "updatedBy": payload.updated_by,
                    "dryRun": payload.dry_run,
                    "inputValues": payload.input_values,
                }
            )
            return _run_attached_agent_feedback(
                question_id=question_id,
                agent_id=str(payload.agent_id),
                payload=agent_payload,
                db=db,
            )
        except HTTPException as exc:
            raise _normalize_feedback_error(
                exc,
                fallback_code="AGENT_FEEDBACK_FAILED",
                mode=payload.mode,
                question_id=question_id,
                agent_id=str(payload.agent_id),
                agent_name=agent_name,
            )

    if payload.mode == "composition":
        if not payload.composition_id:
            _raise_feedback_api_error(
                status_code=400,
                code="COMPOSITION_ID_REQUIRED",
                message="compositionId is required when mode is 'composition'",
                mode=payload.mode,
                question_id=question_id,
            )
        try:
            question = _question_row(db, question_id)
            if not question:
                _raise_feedback_api_error(
                    status_code=404,
                    code="QUESTION_NOT_FOUND",
                    message="question not found",
                    mode=payload.mode,
                    question_id=question_id,
                    composition_id=str(payload.composition_id),
                )

            learner_id = _coerce_runtime_learner_id(payload.learner_id)
            matched_rule, variables = _resolve_composition_match(
                db,
                composition_id=str(payload.composition_id),
                question_id=question_id,
                learner_id=learner_id,
            )
            if not matched_rule:
                _raise_feedback_api_error(
                    status_code=404,
                    code="COMPOSITION_RULE_NOT_MATCHED",
                    message="No enabled composition rule matched current runtime context",
                    mode=payload.mode,
                    question_id=question_id,
                    composition_id=str(payload.composition_id),
                )

            matched_rule_id = str(matched_rule["rule_id"])
            feedback_mode = str(matched_rule["feedback_mode"])
            slide_mode = str(matched_rule["slide_mode"])
            resolved_agent_id = str(matched_rule.get("feedback_agent_id") or "")
            if not resolved_agent_id:
                _raise_feedback_api_error(
                    status_code=409,
                    code="COMPOSITION_AGENT_NOT_CONFIGURED",
                    message="Matched composition rule has no feedback agent configured",
                    mode=payload.mode,
                    question_id=question_id,
                    composition_id=str(payload.composition_id),
                )

            agent_profile = _get_feedback_agent(db, resolved_agent_id)
            agent_name = str(agent_profile.get("title") or "").strip() if agent_profile else None
            agent_name = agent_name or None

            composed_input_values = dict(payload.input_values or {})
            composed_input_values["learner_id"] = learner_id
            composed_input_values["question_id"] = question_id
            composed_input_values.pop("selected_option_index", None)
            composed_input_values.pop("selectedOptionIndex", None)
            if payload.answer_text is not None:
                composed_input_values["answer_text"] = payload.answer_text

            if feedback_mode == "use_latest_version":
                current_version_id = str(question.get("current_version_id") or "")
                selected_option_id = _runtime_selected_option_id_from_payload(
                    db,
                    question_version_id=current_version_id,
                    selected_option_index=payload.selected_option_index,
                    input_values=composed_input_values,
                )
                latest_feedback = _read_latest_versioned_feedback_for_agent(
                    db,
                    question_id=question_id,
                    question_version_id=current_version_id,
                    agent_id=resolved_agent_id,
                    selected_option_id=selected_option_id,
                )
                if not latest_feedback:
                    latest_feedback = _read_latest_static_feedback_for_agent(
                        db,
                        question_version_id=current_version_id,
                        agent_id=resolved_agent_id,
                        selected_option_id=selected_option_id,
                    )
                latest_source = str(latest_feedback.get("source") or "").strip()
                latest_version_id = (
                    str(latest_feedback.get("version_id"))
                    if latest_feedback.get("version_id") is not None
                    else None
                )
                latest_revision_no = (
                    int(latest_feedback.get("revision_no"))
                    if latest_feedback.get("revision_no") is not None
                    else None
                )
                latest_static = (
                    str(latest_feedback.get("static_feedback_text"))
                    if latest_feedback.get("static_feedback_text") is not None
                    else None
                )
                latest_structured = (
                    str(latest_feedback.get("structured_feedback_text"))
                    if latest_feedback.get("structured_feedback_text") is not None
                    else None
                )
                latest_score = _extract_score_from_generated_feedback(latest_static or latest_structured)
                if latest_static or latest_structured:
                    retrieved_pages: list[dict[str, Any]] = []
                    latest_feedback_link_id = (
                        str(latest_feedback.get("feedback_link_id"))
                        if latest_feedback.get("feedback_link_id") is not None
                        else None
                    )
                    if slide_mode == "most_relevant_slide_page" and not latest_feedback_link_id:
                        latest_feedback_link_id = _runtime_feedback_link_id_for_agent(
                            db,
                            question_version_id=current_version_id,
                            agent_id=resolved_agent_id,
                            selected_option_id=selected_option_id,
                        )
                    if slide_mode == "most_relevant_slide_page" and latest_feedback_link_id:
                        resolved_prompt = resolve_feedback_prompt_for_feedback_link(
                            latest_feedback_link_id,
                            input_values=composed_input_values,
                        )
                        if resolved_prompt.get("ok"):
                            resolved_input_values = resolved_prompt.get("resolved_input_values")
                            if isinstance(resolved_input_values, dict):
                                raw_pages = resolved_input_values.get("retrieved_slide_pages")
                                if isinstance(raw_pages, list):
                                    retrieved_pages = [item for item in raw_pages if isinstance(item, dict)]
                    quick_result = {
                        "ok": True,
                        "feedback_link_id": latest_feedback_link_id,
                        "question_id": question_id,
                        "question_version_id": current_version_id,
                        "agent_id": resolved_agent_id,
                        "agent_name": agent_name,
                        "dry_run": payload.dry_run,
                        "queued": False,
                        "generation_enqueue_reason": None,
                        "persisted": False,
                        "static_feedback_text": latest_static or latest_structured,
                        "structured_feedback_text": latest_structured,
                        "ai_score_result": None,
                        "mode": "composition",
                        "composition_id": str(payload.composition_id),
                        "matched_rule_id": matched_rule_id,
                        "feedback_mode": feedback_mode,
                        "slide_mode": slide_mode,
                        "feedback_agent_id": resolved_agent_id,
                        "feedback_agent_name": agent_name,
                        "variables": variables
                        or _resolve_runtime_attempt_stats(
                            db,
                            learner_id=learner_id,
                            question_id=question_id,
                            composition_id=str(payload.composition_id),
                        ),
                        "learner_id": learner_id,
                        "launch_id": payload.launch_id or payload.lti_launch_id,
                        "lti_launch_id": payload.lti_launch_id or payload.launch_id,
                        "feedback": latest_structured or latest_static,
                        "has_feedback": bool(latest_static or latest_structured),
                        "score": latest_score.get("score"),
                        "max_score": latest_score.get("max_score"),
                        "maxScore": latest_score.get("max_score"),
                        "feedback_source": "latest_version_static",
                        "resolved_selected_option_id": selected_option_id,
                        "selected_option_index_payload": payload.selected_option_index,
                        "selected_option_index_input_values": (
                            composed_input_values.get("selected_option_index")
                            if composed_input_values.get("selected_option_index") is not None
                            else composed_input_values.get("selectedOptionIndex")
                        ),
                        "latest_feedback_source_table": (latest_source or "feedback_link"),
                        "latest_feedback_version_id": latest_version_id,
                        "latest_feedback_revision_no": latest_revision_no,
                    }
                    if slide_mode == "most_relevant_slide_page":
                        if not retrieved_pages:
                            retrieved_pages = _fallback_retrieved_pages_from_question_scope(
                                db=db,
                                question_id=question_id,
                            )
                        quick_result["most_relevant_slide_pages"] = retrieved_pages
                        reference = _compose_reference_from_retrieved_pages(
                            db=db,
                            question_id=question_id,
                            retrieved_pages=retrieved_pages,
                        )
                        quick_result["reference"] = reference if reference is not None else _empty_reference_payload()
                    return quick_result

            agent_payload = AttachedAgentFeedbackRequest.model_validate(
                {
                    "updatedBy": payload.updated_by,
                    "dryRun": payload.dry_run,
                    "inputValues": composed_input_values,
                }
            )
            result = _run_attached_agent_feedback(
                question_id=question_id,
                agent_id=resolved_agent_id,
                payload=agent_payload,
                db=db,
                require_updated_by_for_persist=False,
                include_debug=True,
            )
            _cache_runtime_prompt(
                db,
                participant_id=learner_id,
                question_id=question_id,
                answer_text=payload.answer_text,
                llm_system_prompt=(
                    str(result.get("resolved_system_prompt"))
                    if result.get("resolved_system_prompt") is not None
                    else None
                ),
                llm_user_prompt=(
                    str(result.get("resolved_user_text"))
                    if result.get("resolved_user_text") is not None
                    else None
                ),
            )
            db.commit()
            feedback_text = _compose_feedback_text_for_client(result)
            extracted_score = _extract_score_from_generated_feedback(
                result.get("static_feedback_text") or feedback_text
            )
            result.update(
                {
                    "mode": "composition",
                    "composition_id": str(payload.composition_id),
                    "matched_rule_id": matched_rule_id,
                    "feedback_mode": feedback_mode,
                    "slide_mode": slide_mode,
                    "feedback_agent_id": resolved_agent_id,
                    "feedback_agent_name": agent_name,
                    "variables": variables
                    or _resolve_runtime_attempt_stats(
                        db,
                        learner_id=learner_id,
                        question_id=question_id,
                        composition_id=str(payload.composition_id),
                    ),
                    "learner_id": learner_id,
                    "launch_id": payload.launch_id or payload.lti_launch_id,
                    "lti_launch_id": payload.lti_launch_id or payload.launch_id,
                    "feedback": feedback_text,
                    "has_feedback": bool(feedback_text),
                    "score": extracted_score.get("score"),
                    "max_score": extracted_score.get("max_score"),
                    "maxScore": extracted_score.get("max_score"),
                    "feedback_source": "runtime_generate",
                }
            )
            if slide_mode == "most_relevant_slide_page":
                resolved_input_values = result.get("resolved_input_values")
                retrieved_pages: list[dict[str, Any]] = []
                if isinstance(resolved_input_values, dict):
                    raw_pages = resolved_input_values.get("retrieved_slide_pages")
                    if isinstance(raw_pages, list):
                        retrieved_pages = [item for item in raw_pages if isinstance(item, dict)]
                if not retrieved_pages:
                    retrieved_pages = _fallback_retrieved_pages_from_question_scope(
                        db=db,
                        question_id=question_id,
                    )
                result["most_relevant_slide_pages"] = retrieved_pages
                reference = _compose_reference_from_retrieved_pages(
                    db=db,
                    question_id=question_id,
                    retrieved_pages=retrieved_pages,
                )
                result["reference"] = reference if reference is not None else _empty_reference_payload()
            result.pop("resolved_input_values", None)
            result.pop("resolved_system_prompt", None)
            result.pop("resolved_user_text", None)
            result.pop("rendered_prompt", None)
            return result
        except HTTPException as exc:
            raise _normalize_feedback_error(
                exc,
                fallback_code="COMPOSITION_FEEDBACK_FAILED",
                mode=payload.mode,
                question_id=question_id,
                composition_id=str(payload.composition_id),
            )

    _raise_feedback_api_error(
        status_code=400,
        code="UNSUPPORTED_MODE",
        message=f"unsupported mode: {payload.mode}",
        mode=payload.mode,
        question_id=question_id,
    )


@router.post("/questions/{question_id}/attached-agents/{agent_id}/dry-run")
def dry_run_attached_agent_feedback(
    question_id: str,
    agent_id: str,
    payload: Optional[AttachedAgentFeedbackRequest] = None,
    db: Session = Depends(get_db),
):
    return _run_attached_agent_feedback(question_id=question_id, agent_id=agent_id, payload=payload, db=db)


@router.delete("/questions/{question_id}/attached-agents/{agent_id}")
def detach_agent_from_single_question(
    question_id: str,
    agent_id: str,
    updated_by: str = Query(..., min_length=16, max_length=16),
    db: Session = Depends(get_db),
):
    _require_admin_user(db, updated_by)
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    db.execute(
        text(
            """
            UPDATE feedback_link
            SET is_visible = FALSE
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND is_visible = TRUE
            """
        ),
        {"question_version_id": current_version_id, "agent_id": agent_id},
    )
    db.commit()
    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": current_version_id,
        "agent_id": agent_id,
        "detached": True,
    }


@router.patch("/questions/{question_id}/attached-agents/{agent_id}/static-feedback")
def update_single_question_static_feedback(
    question_id: str,
    agent_id: str,
    payload: StaticFeedbackUpdateRequest,
    db: Session = Depends(get_db),
):
    _require_admin_user(db, payload.updated_by)
    _ensure_static_feedback_version_schema(db)
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    agent = _get_feedback_agent(db, agent_id)
    if not agent or not agent.get("is_visible", True):
        raise HTTPException(status_code=404, detail="feedback agent not found")
    latest_before_update = _get_latest_static_feedback_version(db, question_id=question_id, agent_id=agent_id)
    latest_version_id = str(latest_before_update["version_id"]) if latest_before_update else None
    if payload.if_match_version_id and payload.if_match_version_id != latest_version_id:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "VERSION_CONFLICT",
                "message": "if_match_version_id does not match latest version",
                "latest_version_id": latest_version_id,
                "latest_revision_no": int(latest_before_update["revision_no"]) if latest_before_update else None,
                "latest_created_at": _to_utc_iso_z(latest_before_update.get("created_at")) if latest_before_update else None,
            },
        )

    question_feedback_text = (
        (payload.question_feedback_text or "").strip() or (payload.static_feedback_text or "").strip() or ""
    )
    option_feedback = payload.option_feedback or []
    option_map = _interaction_options_for_question_version(db, current_version_id)
    actual_option_count = len(option_map)
    has_options = actual_option_count > 0

    if payload.expected_option_count is not None and int(payload.expected_option_count) != int(actual_option_count):
        raise HTTPException(
            status_code=400,
            detail=(
                f"option_count_mismatch: expected_option_count={payload.expected_option_count}, "
                f"actual_option_count={actual_option_count}"
            ),
        )

    if not question_feedback_text and not option_feedback:
        raise HTTPException(status_code=400, detail="question_feedback_text or option_feedback is required")
    if not has_options and option_feedback:
        raise HTTPException(status_code=400, detail="option_feedback is not allowed for questions without options")
    if not has_options and not question_feedback_text:
        raise HTTPException(status_code=400, detail="question_feedback_text is required when question has no options")
    if has_options and len(option_feedback) != actual_option_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"option_feedback_count_mismatch: expected={actual_option_count}, "
                f"received={len(option_feedback)}"
            ),
        )

    option_ids_seen: set[str] = set()
    invalid_option_ids: list[str] = []
    duplicate_option_ids: list[str] = []
    for opt in option_feedback:
        oid = str(opt.interaction_option_id)
        if oid in option_ids_seen:
            duplicate_option_ids.append(oid)
            continue
        option_ids_seen.add(oid)
        if oid not in option_map:
            invalid_option_ids.append(oid)
    if invalid_option_ids:
        raise HTTPException(status_code=400, detail=f"invalid interaction_option_id(s): {', '.join(invalid_option_ids)}")
    if duplicate_option_ids:
        raise HTTPException(status_code=400, detail=f"duplicate interaction_option_id(s): {', '.join(duplicate_option_ids)}")
    if has_options:
        missing_option_ids = sorted(set(option_map.keys()) - option_ids_seen)
        if missing_option_ids:
            raise HTTPException(
                status_code=400,
                detail=f"missing interaction_option_id(s): {', '.join(missing_option_ids)}",
            )

    feedback_link_id = None
    if question_feedback_text:
        existing_link_id = _find_visible_feedback_link_by_target(
            db,
            question_version_id=current_version_id,
            agent_id=agent_id,
            target_entity_type="question_version",
            target_entity_id=current_version_id,
        )
        if existing_link_id:
            db.execute(
                text(
                    """
                    UPDATE feedback_link
                    SET static_feedback_text = :static_feedback_text
                    WHERE feedback_link_id = :feedback_link_id
                    """
                ),
                {"feedback_link_id": existing_link_id, "static_feedback_text": question_feedback_text},
            )
            feedback_link_id = existing_link_id
        else:
            feedback_link_id = _insert_feedback_link(
                db,
                question_version_id=current_version_id,
                agent_id=agent_id,
                target_entity_type="question_version",
                target_entity_id=current_version_id,
                priority=100,
                static_feedback_text=question_feedback_text,
                structured_feedback_text=None,
                created_by=payload.updated_by,
            )

    updated_option_feedback_count = 0
    for opt in option_feedback:
        feedback_text = (opt.feedback_text or "").strip()
        if not feedback_text:
            raise HTTPException(status_code=400, detail="option feedback_text is required")
        existing_opt_link = _find_visible_feedback_link_by_target(
            db,
            question_version_id=current_version_id,
            agent_id=agent_id,
            target_entity_type="interaction_option",
            target_entity_id=opt.interaction_option_id,
        )
        if existing_opt_link:
            db.execute(
                text(
                    """
                    UPDATE feedback_link
                    SET static_feedback_text = :static_feedback_text
                    WHERE feedback_link_id = :feedback_link_id
                    """
                ),
                {"feedback_link_id": existing_opt_link, "static_feedback_text": feedback_text},
            )
        else:
            _insert_feedback_link(
                db,
                question_version_id=current_version_id,
                agent_id=agent_id,
                target_entity_type="interaction_option",
                target_entity_id=opt.interaction_option_id,
                priority=100,
                static_feedback_text=feedback_text,
                structured_feedback_text=None,
                created_by=payload.updated_by,
            )
        updated_option_feedback_count += 1

    db.commit()
    current_q_text, current_option_feedback = _read_current_feedback_link_state(
        db, question_version_id=current_version_id, agent_id=agent_id
    )
    version = _create_static_feedback_version_snapshot(
        db,
        question_id=question_id,
        question_version_id=current_version_id,
        agent_id=agent_id,
        created_by=payload.updated_by,
        question_feedback_text=current_q_text,
        option_feedback=current_option_feedback,
        parent_version_id=latest_version_id,
        restored_from_version_id=None,
    )
    db.commit()
    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": current_version_id,
        "agent_id": agent_id,
        "feedback_link_id": str(feedback_link_id) if feedback_link_id else None,
        "question_feedback_text": question_feedback_text or None,
        "updated_option_feedback_count": updated_option_feedback_count,
        "actual_option_count": actual_option_count,
        "version_id": version["version_id"],
        "revision_no": int(version["revision_no"]),
        "created_at": _to_utc_iso_z(version.get("created_at")),
    }


@router.get("/questions/{question_id}/attached-agents/{agent_id}/static-feedback/versions")
def list_static_feedback_versions(question_id: str, agent_id: str, db: Session = Depends(get_db)):
    _ensure_static_feedback_version_schema(db)
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")

    rows = db.execute(
        text(
            """
            SELECT
              version_id, question_id, question_version_id, agent_id, revision_no,
              question_feedback_text, parent_version_id, restored_from_version_id,
              created_by, created_at
            FROM feedback_static_feedback_version
            WHERE question_id = :question_id
              AND agent_id = :agent_id
            ORDER BY revision_no DESC, created_at DESC
            """
        ),
        {"question_id": question_id, "agent_id": agent_id},
    ).mappings().all()

    items = []
    for row in rows:
        item = dict(row)
        option_feedback = _get_static_feedback_version_option_feedback(db, str(row["version_id"]))
        item["option_feedback"] = option_feedback
        item["created_at"] = _to_utc_iso_z(item.get("created_at"))
        items.append(item)

    return {"ok": True, "question_id": question_id, "agent_id": agent_id, "count": len(items), "items": items}


@router.post("/questions/{question_id}/attached-agents/{agent_id}/static-feedback/versions/{version_id}/restore")
def restore_static_feedback_version(
    question_id: str,
    agent_id: str,
    version_id: str,
    payload: StaticFeedbackRestoreRequest,
    db: Session = Depends(get_db),
):
    _require_admin_user(db, payload.updated_by)
    _ensure_static_feedback_version_schema(db)
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    target_version = _get_static_feedback_version_by_id(
        db, version_id=version_id, question_id=question_id, agent_id=agent_id
    )
    if not target_version:
        raise HTTPException(status_code=404, detail="static feedback version not found")

    latest_before_restore = _get_latest_static_feedback_version(db, question_id=question_id, agent_id=agent_id)
    latest_version_id = str(latest_before_restore["version_id"]) if latest_before_restore else None
    if payload.if_match_version_id and payload.if_match_version_id != latest_version_id:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "VERSION_CONFLICT",
                "message": "if_match_version_id does not match latest version",
                "latest_version_id": latest_version_id,
                "latest_revision_no": int(latest_before_restore["revision_no"]) if latest_before_restore else None,
                "latest_created_at": _to_utc_iso_z(latest_before_restore.get("created_at")) if latest_before_restore else None,
            },
        )

    question_feedback_text = (target_version.get("question_feedback_text") or "").strip()
    option_feedback = _get_static_feedback_version_option_feedback(db, version_id)

    # Restore question-level text.
    existing_q_link = _find_visible_feedback_link_by_target(
        db,
        question_version_id=current_version_id,
        agent_id=agent_id,
        target_entity_type="question_version",
        target_entity_id=current_version_id,
    )
    if question_feedback_text:
        if existing_q_link:
            db.execute(
                text(
                    """
                    UPDATE feedback_link
                    SET static_feedback_text = :static_feedback_text
                    WHERE feedback_link_id = :feedback_link_id
                    """
                ),
                {"feedback_link_id": existing_q_link, "static_feedback_text": question_feedback_text},
            )
        else:
            _insert_feedback_link(
                db,
                question_version_id=current_version_id,
                agent_id=agent_id,
                target_entity_type="question_version",
                target_entity_id=current_version_id,
                priority=100,
                static_feedback_text=question_feedback_text,
                structured_feedback_text=None,
                created_by=payload.updated_by,
            )
    elif existing_q_link:
        db.execute(
            text("UPDATE feedback_link SET is_visible = FALSE WHERE feedback_link_id = :feedback_link_id"),
            {"feedback_link_id": existing_q_link},
        )

    # Restore option-level text.
    target_option_ids = {str(x["interaction_option_id"]) for x in option_feedback}
    existing_option_rows = db.execute(
        text(
            """
            SELECT feedback_link_id, target_entity_id
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'interaction_option'
              AND is_visible = TRUE
            """
        ),
        {"question_version_id": current_version_id, "agent_id": agent_id},
    ).mappings().all()
    existing_option_link_by_target = {str(r["target_entity_id"]): str(r["feedback_link_id"]) for r in existing_option_rows}

    for item in option_feedback:
        option_id = str(item["interaction_option_id"])
        feedback_text = (item["feedback_text"] or "").strip()
        if not feedback_text:
            continue
        existing_link_id = existing_option_link_by_target.get(option_id)
        if existing_link_id:
            db.execute(
                text(
                    """
                    UPDATE feedback_link
                    SET static_feedback_text = :static_feedback_text
                    WHERE feedback_link_id = :feedback_link_id
                    """
                ),
                {"feedback_link_id": existing_link_id, "static_feedback_text": feedback_text},
            )
        else:
            _insert_feedback_link(
                db,
                question_version_id=current_version_id,
                agent_id=agent_id,
                target_entity_type="interaction_option",
                target_entity_id=option_id,
                priority=100,
                static_feedback_text=feedback_text,
                structured_feedback_text=None,
                created_by=payload.updated_by,
            )

    obsolete_option_ids = set(existing_option_link_by_target.keys()) - target_option_ids
    if obsolete_option_ids:
        db.execute(
            text(
                """
                UPDATE feedback_link
                SET is_visible = FALSE
                WHERE question_version_id = :question_version_id
                  AND agent_id = :agent_id
                  AND target_entity_type = 'interaction_option'
                  AND target_entity_id = ANY(CAST(:target_option_ids AS TEXT[]))
                  AND is_visible = TRUE
                """
            ),
            {
                "question_version_id": current_version_id,
                "agent_id": agent_id,
                "target_option_ids": list(obsolete_option_ids),
            },
        )

    db.commit()

    current_q_text, current_option_feedback = _read_current_feedback_link_state(
        db, question_version_id=current_version_id, agent_id=agent_id
    )
    restored_version = _create_static_feedback_version_snapshot(
        db,
        question_id=question_id,
        question_version_id=current_version_id,
        agent_id=agent_id,
        created_by=payload.updated_by,
        question_feedback_text=current_q_text,
        option_feedback=current_option_feedback,
        parent_version_id=latest_version_id,
        restored_from_version_id=version_id,
    )
    db.commit()

    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": current_version_id,
        "agent_id": agent_id,
        "restored_from_version_id": version_id,
        "version_id": restored_version["version_id"],
        "revision_no": int(restored_version["revision_no"]),
        "created_at": _to_utc_iso_z(restored_version.get("created_at")),
        "question_feedback_text": current_q_text,
        "option_feedback": current_option_feedback,
    }


@router.get("/questions/feedback-generation-jobs/{job_id}")
def get_question_feedback_generation_job_status(job_id: str, db: Session = Depends(get_db)):
    # `db` dependency keeps route auth/session behavior consistent with other routes, even if unused.
    _ = db
    payload = get_rq_job_status(job_id)
    return {"ok": payload.get("status") not in {"not_found", "unavailable"}, "job": payload}


@router.post("/questions/feedback-generation-jobs/batch-status")
def batch_get_question_feedback_generation_job_status(payload: BatchJobIdsRequest, db: Session = Depends(get_db)):
    _ = db
    requested_ids = list(dict.fromkeys(payload.job_ids))
    items = [get_rq_job_status(job_id) for job_id in requested_ids]
    return {
        "ok": True,
        "requested_count": len(requested_ids),
        "items": items,
    }


@router.post("/questions/batch/resolve-current-versions")
def batch_resolve_question_current_versions(payload: BatchResolveQuestionVersionsRequest, db: Session = Depends(get_db)):
    requested_ids = list(dict.fromkeys(payload.question_ids))
    rows = db.execute(
        text(
            """
            SELECT
              q.question_id,
              q.current_version_id AS question_version_id,
              q.is_visible,
              q.access_scope,
              qv.question_type,
              qv.title,
              qv.version_no
            FROM content_question q
            LEFT JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            WHERE q.question_id = ANY(CAST(:question_ids AS TEXT[]))
            """
        ),
        {"question_ids": requested_ids},
    ).mappings().all()
    by_id = {str(r["question_id"]): dict(r) for r in rows}

    items: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for qid in requested_ids:
        row = by_id.get(qid)
        if not row:
            failed.append({"question_id": qid, "code": "NOT_FOUND", "message": "question not found"})
            continue
        if not row.get("question_version_id"):
            failed.append({"question_id": qid, "code": "CONFLICT", "message": "question has no current version"})
            continue
        items.append(row)

    return {
        "ok": True,
        "requested_count": len(requested_ids),
        "resolved_count": len(items),
        "failed_count": len(failed),
        "items": items,
        "failed": failed,
    }


@router.get("/questions/{question_id}")
def get_semantic_question(
    question_id: str,
    include: Optional[str] = Query(default=None, description="Comma-separated: current_version,content_blocks,interactions,options,slide_scope,feedback_links"),
    db: Session = Depends(get_db),
):
    q = _question_row(db, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="question not found")

    detail = get_semantic_question_version_detail(db, q["current_version_id"])
    if detail is None:
        raise HTTPException(status_code=500, detail="current version not found")
    detail["interactions"] = _apply_option_order_policy(
        detail.get("interactions") or [],
        randomize_option_order=bool(detail["question_version"].get("randomize_option_order", True)),
    )

    # Stable default payload for question runtime pages:
    # always expose question_type/content_blocks/interactions(+options) without include flags.
    first_interaction = detail["interactions"][0] if detail["interactions"] else None
    top_level_options = list(first_interaction.get("options") or []) if isinstance(first_interaction, dict) else []
    payload = {
        "ok": True,
        "question": q,
        "question_id": q["question_id"],
        "question_type": detail["question_version"]["question_type"],
        "randomize_option_order": bool(detail["question_version"].get("randomize_option_order", True)),
        "content_blocks": detail["content_blocks"],
        "interactions": detail["interactions"],
        "options": top_level_options,
        # Question-level scope is part of the canonical question payload.
        "slide_scope": detail["slide_scope"],
    }

    includes = {x.strip() for x in (include or "").split(",") if x.strip()}
    if "current_version" in includes:
        payload["question_version"] = detail["question_version"]
    if "feedback_links" in includes:
        payload["feedback_links"] = detail["feedback_links"]
    return payload


@router.patch("/questions/{question_id}/scope")
def patch_semantic_question_scope(question_id: str, payload: ScopePatchRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    row = db.execute(
        text(
            "UPDATE content_question SET access_scope = :access_scope WHERE question_id = :question_id RETURNING question_id"
        ),
        {"access_scope": payload.access_scope, "question_id": question_id},
    ).first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="question not found")
    db.commit()
    return {"ok": True, "question": _question_row(db, question_id)}


@router.patch("/questions/{question_id}")
def patch_semantic_question_content(
    question_id: str,
    payload: QuestionContentPatchRequest,
    db: Session = Depends(get_db),
):
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")

    source_qv_id = str(question.get("current_version_id") or "")
    if not source_qv_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    try:
        max_version = db.execute(
            text("SELECT COALESCE(MAX(version_no), 0) FROM content_question_version WHERE question_id = :qid"),
            {"qid": question_id},
        ).scalar() or 0
        bundle = _insert_question_version_bundle(
            db,
            question_id=question_id,
            version_no=int(max_version) + 1,
            payload=payload,
            change_note=(payload.change_note or "Patch content update"),
            set_as_current=True,
        )
        copied_feedback_links = 0
        if payload.copy_feedback_links_from_previous:
            copied_feedback_links = _copy_feedback_links_from_previous(
                db,
                source_qv_id=source_qv_id,
                target_qv_id=bundle["question_version_id"],
                created_by=payload.created_by,
                copy_ai_static_feedback=bool(payload.copy_ai_static_feedback),
                copy_human_static_feedback=bool(payload.copy_human_static_feedback),
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    detail = get_semantic_question_version_detail(db, bundle["question_version_id"])
    if detail is not None:
        detail["interactions"] = _apply_option_order_policy(
            detail.get("interactions") or [],
            randomize_option_order=bool(detail["question_version"].get("randomize_option_order", True)),
        )
    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": bundle["question_version_id"],
        "copied_feedback_links": copied_feedback_links,
        "copied_ai_static_feedback": bool(payload.copy_ai_static_feedback),
        "copied_human_static_feedback": bool(payload.copy_human_static_feedback),
        "item": detail,
    }


@router.patch("/questions/{question_id}/visibility")
def patch_semantic_question_visibility(question_id: str, payload: VisibilityPatchRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    row = db.execute(
        text(
            "UPDATE content_question SET is_visible = :is_visible WHERE question_id = :question_id RETURNING question_id"
        ),
        {"is_visible": payload.is_visible, "question_id": question_id},
    ).first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="question not found")
    db.commit()
    return {"ok": True, "question": _question_row(db, question_id)}


@router.delete("/questions/{question_id}")
def delete_semantic_question(
    question_id: str,
    updated_by: str = Query(..., min_length=16, max_length=16),
    db: Session = Depends(get_db),
):
    if not _user_exists(db, updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    row = db.execute(
        text(
            "UPDATE content_question SET is_visible = FALSE WHERE question_id = :question_id RETURNING question_id"
        ),
        {"question_id": question_id},
    ).first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="question not found")
    db.commit()
    return {"ok": True, "question_id": question_id, "is_visible": False}


@router.post("/questions/{question_id}/versions")
def create_semantic_question_version(question_id: str, payload: QuestionVersionCreateRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")
    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")

    try:
        max_version = db.execute(
            text("SELECT COALESCE(MAX(version_no), 0) FROM content_question_version WHERE question_id = :qid"),
            {"qid": question_id},
        ).scalar() or 0
        bundle = _insert_question_version_bundle(
            db,
            question_id=question_id,
            version_no=int(max_version) + 1,
            payload=payload,
            change_note=payload.change_note,
            set_as_current=True,
        )
        copied_feedback_links = 0
        if payload.copy_feedback_links_from_previous and question.get("current_version_id"):
            copied_feedback_links = _copy_feedback_links_from_previous(
                db,
                source_qv_id=question["current_version_id"],
                target_qv_id=bundle["question_version_id"],
                created_by=payload.created_by,
            )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    detail = get_semantic_question_version_detail(db, bundle["question_version_id"])
    if detail is not None:
        detail["interactions"] = _apply_option_order_policy(
            detail.get("interactions") or [],
            randomize_option_order=bool(detail["question_version"].get("randomize_option_order", True)),
        )
    return {
        "ok": True,
        "question_id": question_id,
        "question_version_id": bundle["question_version_id"],
        "copied_feedback_links": copied_feedback_links,
        "item": detail,
    }
