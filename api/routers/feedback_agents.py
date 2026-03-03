from __future__ import annotations

from collections import defaultdict
import json
import re
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..services.semantic_schema import generate_short_id
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.FEEDBACK_AGENTS])

_PROMPT_VAR_RE = re.compile(r"\{\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\}")
_ALLOWED_TEMPLATE_KEYS = {
    "question_content_blocks",
    "answer_text",
    "retrieved_slide_pages",
}
_ALLOWED_TEMPLATE_KEYS_ORDERED = [
    "question_content_blocks",
    "answer_text",
    "retrieved_slide_pages",
]


class RetrievalRuleIn(BaseModel):
    preferred_info_type: Literal["text", "vision", "mixed"] = "vision"
    selection_mode: Literal["top_k", "all", "threshold", "threshold_then_top_k"]
    max_pages: Optional[int] = Field(default=None, ge=1)
    similarity_threshold: Optional[float] = Field(default=None, ge=0, le=1)
    include_similarity: bool = True


class AgentInputIn(BaseModel):
    input_key: str = Field(min_length=1, max_length=50)
    is_required: bool = True
    sort_order: int = 100
    retrieval_rule: Optional[RetrievalRuleIn] = None

    @model_validator(mode="after")
    def validate_retrieval_rule(self):
        if self.retrieval_rule and self.input_key != "retrieved_slide_pages":
            raise ValueError("retrieval_rule is only allowed for input_key='retrieved_slide_pages'")
        return self


class AgentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    role: Literal["human", "ai"]
    is_structured: bool = False
    provider: Optional[str] = Field(default=None, max_length=50)
    model: Optional[str] = Field(default=None, max_length=100)
    prompt_text: Optional[str] = None
    llm_params: Optional[dict[str, Any]] = None
    # Question type scope for this agent.
    apply_question_type: Literal[
        "single_choice",
        "multi_choice",
        "dropdown",
        "true_false",
        "free_text",
        "essay",
        "all",
    ] = "all"
    if_score: bool = False
    score_ai_agent_id: Optional[str] = Field(default=None, min_length=16, max_length=16)
    access_scope: Literal["private", "public"] = "private"
    created_by: str = Field(min_length=16, max_length=16)
    inputs: list[AgentInputIn] = Field(default_factory=list)


class ScopePatchRequest(BaseModel):
    access_scope: Literal["private", "public"]
    updated_by: str = Field(min_length=16, max_length=16)


def _validate_create_payload(payload: AgentCreateRequest) -> None:
    if payload.role == "human":
        if payload.prompt_text not in (None, ""):
            raise HTTPException(status_code=400, detail="human agents cannot set prompt_text")
        if payload.is_structured:
            raise HTTPException(status_code=400, detail="human agents cannot set is_structured=true")
        if payload.if_score and not payload.score_ai_agent_id:
            raise HTTPException(status_code=400, detail="score_ai_agent_id is required when if_score=true")
        if not payload.if_score and payload.score_ai_agent_id:
            raise HTTPException(status_code=400, detail="score_ai_agent_id must be null when if_score=false")
    else:
        if payload.if_score:
            raise HTTPException(status_code=400, detail="if_score is only supported for human agents")
        if payload.score_ai_agent_id:
            raise HTTPException(status_code=400, detail="score_ai_agent_id is only supported for human agents")
    if payload.llm_params is not None and payload.role != "ai":
        raise HTTPException(status_code=400, detail="llm_params is only supported for ai agents")


def _extract_prompt_template_keys(prompt_text: str | None) -> list[str]:
    if not prompt_text:
        return []
    keys: list[str] = []
    seen: set[str] = set()
    for match in _PROMPT_VAR_RE.finditer(prompt_text):
        key = match.group(1)
        if key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def _synthesize_inputs_from_prompt_template(payload: AgentCreateRequest) -> list[AgentInputIn]:
    keys = _extract_prompt_template_keys(payload.prompt_text)
    if not keys:
        return payload.inputs
    invalid = [k for k in keys if k not in _ALLOWED_TEMPLATE_KEYS]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_PROMPT_TEMPLATE_KEYS",
                "message": "prompt_text contains unsupported template variables",
                "invalid_keys": invalid,
                "allowed_keys": _ALLOWED_TEMPLATE_KEYS_ORDERED,
            },
        )
    if payload.inputs:
        return payload.inputs

    synthesized: list[AgentInputIn] = []
    for idx, key in enumerate(keys, start=1):
        synthesized.append(
            AgentInputIn(
                input_key=key,
                is_required=True,
                sort_order=idx * 10,
            )
        )
    return synthesized


def _user_exists(db: Session, user_id: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM users WHERE user_id = :user_id LIMIT 1"), {"user_id": user_id}).scalar())


def _feedback_agent_has_llm_params_column(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'feedback_agent'
                  AND column_name = 'llm_params_text'
                LIMIT 1
                """
            )
        ).scalar()
    )


def _feedback_agent_has_apply_question_type_column(db: Session) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'feedback_agent'
                  AND column_name = 'apply_question_type'
                LIMIT 1
                """
            )
        ).scalar()
    )


def _feedback_agent_llm_params_column_type(db: Session) -> str | None:
    row = db.execute(
        text(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'feedback_agent'
              AND column_name = 'llm_params_text'
            LIMIT 1
            """
        )
    ).scalar()
    return str(row) if row is not None else None


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


def _validate_score_ai_agent_id(db: Session, score_ai_agent_id: str) -> None:
    row = db.execute(
        text(
            """
            SELECT role, is_visible
            FROM feedback_agent
            WHERE agent_id = :agent_id
            LIMIT 1
            """
        ),
        {"agent_id": score_ai_agent_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="score_ai_agent_id not found")
    if str(row.get("role") or "") != "ai":
        raise HTTPException(status_code=400, detail="score_ai_agent_id must reference an ai agent")
    if not bool(row.get("is_visible")):
        raise HTTPException(status_code=400, detail="score_ai_agent_id must reference a visible ai agent")


def _normalize_apply_question_type(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in {
        "single_choice",
        "multi_choice",
        "dropdown",
        "true_false",
        "free_text",
        "essay",
        "all",
    }:
        return v
    # Backward compatibility for previously stored non-question-type values.
    if v in {"one", "multiple", "single_selection", "multiple_selection"}:
        return "all"
    return "all"


def _generate_unique_id(db: Session, *, table: str, column: str, prefix: str) -> str:
    sql = text(f"SELECT 1 FROM {table} WHERE {column} = :v LIMIT 1")
    for _ in range(50):
        candidate = generate_short_id(prefix)
        if not db.execute(sql, {"v": candidate}).scalar():
            return candidate
    raise HTTPException(status_code=500, detail=f"Unable to generate unique id for {table}.{column}")


def _fetch_agent_rows(db: Session, agent_ids: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    if not agent_ids:
        return {}, {}
    llm_col_type = _feedback_agent_llm_params_column_type(db)
    llm_col_expr = "llm_params_text" if llm_col_type else "NULL::text AS llm_params_text"
    if_score_expr = "if_score" if _feedback_agent_has_if_score_column(db) else "FALSE AS if_score"
    score_ai_agent_id_expr = (
        "score_ai_agent_id" if _feedback_agent_has_score_ai_agent_id_column(db) else "NULL::text AS score_ai_agent_id"
    )
    apply_q_type_expr = (
        "apply_question_type"
        if _feedback_agent_has_apply_question_type_column(db)
        else "'all'::text AS apply_question_type"
    )
    agents = db.execute(
        text(
            """
            SELECT agent_id, source_agent_id, title, description, role, is_structured,
                   provider, model, prompt_text, {llm_col_expr}, {apply_q_type_expr},
                   {if_score_expr}, {score_ai_agent_id_expr},
                   access_scope, is_visible, created_by, created_at
            FROM feedback_agent
            WHERE agent_id = ANY(:agent_ids)
            ORDER BY created_at DESC, agent_id ASC
            """.format(
                llm_col_expr=llm_col_expr,
                apply_q_type_expr=apply_q_type_expr,
                if_score_expr=if_score_expr,
                score_ai_agent_id_expr=score_ai_agent_id_expr,
            )
        ),
        {"agent_ids": agent_ids},
    ).mappings().all()
    by_id = {row["agent_id"]: dict(row) for row in agents}
    for agent in by_id.values():
        raw = agent.pop("llm_params_text", None)
        agent["apply_question_type"] = _normalize_apply_question_type(agent.get("apply_question_type"))
        agent["if_score"] = bool(agent.get("if_score"))
        agent["score_ai_agent_id"] = str(agent["score_ai_agent_id"]) if agent.get("score_ai_agent_id") is not None else None
        if raw:
            if isinstance(raw, dict):
                agent["llm_params"] = raw
            else:
                try:
                    agent["llm_params"] = json.loads(raw)
                except Exception:
                    agent["llm_params"] = raw
        else:
            agent["llm_params"] = None

    input_rows = db.execute(
        text(
            """
            SELECT
              fai.agent_input_id,
              fai.agent_id,
              fai.input_key,
              fai.is_required,
              fai.sort_order,
              fair.preferred_info_type,
              fair.selection_mode,
              fair.max_pages,
              fair.similarity_threshold,
              fair.include_similarity
            FROM feedback_agent_input fai
            LEFT JOIN feedback_agent_input_retrieval_rule fair
              ON fair.agent_input_id = fai.agent_input_id
            WHERE fai.agent_id = ANY(:agent_ids)
            ORDER BY fai.agent_id ASC, fai.sort_order ASC, fai.input_key ASC
            """
        ),
        {"agent_ids": agent_ids},
    ).mappings().all()

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in input_rows:
        item = {
            "agent_input_id": row["agent_input_id"],
            "input_key": row["input_key"],
            "is_required": row["is_required"],
            "sort_order": row["sort_order"],
        }
        if row["selection_mode"] is not None:
            item["retrieval_rule"] = {
                "preferred_info_type": row["preferred_info_type"],
                "selection_mode": row["selection_mode"],
                "max_pages": row["max_pages"],
                "similarity_threshold": float(row["similarity_threshold"]) if row["similarity_threshold"] is not None else None,
                "include_similarity": row["include_similarity"],
            }
        grouped[row["agent_id"]].append(item)
    return by_id, grouped


def _fetch_agent_detail(db: Session, agent_id: str) -> dict[str, Any] | None:
    agents, inputs = _fetch_agent_rows(db, [agent_id])
    agent = agents.get(agent_id)
    if not agent:
        return None
    agent["inputs"] = inputs.get(agent_id, [])
    return agent


def _insert_agent_inputs(db: Session, *, agent_id: str, created_by: str, inputs: list[AgentInputIn]) -> None:
    seen_keys: set[str] = set()
    for item in sorted(inputs, key=lambda x: (x.sort_order, x.input_key)):
        if item.input_key in seen_keys:
            raise HTTPException(status_code=400, detail=f"Duplicate input_key: {item.input_key}")
        seen_keys.add(item.input_key)

        agent_input_id = _generate_unique_id(db, table="feedback_agent_input", column="agent_input_id", prefix="ai")
        db.execute(
            text(
                """
                INSERT INTO feedback_agent_input (
                  agent_input_id, agent_id, input_key, is_required, sort_order, created_by, created_at
                ) VALUES (
                  :agent_input_id, :agent_id, :input_key, :is_required, :sort_order, :created_by, NOW()
                )
                """
            ),
            {
                "agent_input_id": agent_input_id,
                "agent_id": agent_id,
                "input_key": item.input_key,
                "is_required": item.is_required,
                "sort_order": item.sort_order,
                "created_by": created_by,
            },
        )

        if item.retrieval_rule:
            rr = item.retrieval_rule
            db.execute(
                text(
                    """
                    INSERT INTO feedback_agent_input_retrieval_rule (
                      agent_input_id, preferred_info_type, selection_mode, max_pages, similarity_threshold,
                      include_similarity, created_by, created_at
                    ) VALUES (
                      :agent_input_id, :preferred_info_type, :selection_mode, :max_pages, :similarity_threshold,
                      :include_similarity, :created_by, NOW()
                    )
                    """
                ),
                {
                    "agent_input_id": agent_input_id,
                    "preferred_info_type": rr.preferred_info_type,
                    "selection_mode": rr.selection_mode,
                    "max_pages": rr.max_pages,
                    "similarity_threshold": rr.similarity_threshold,
                    "include_similarity": rr.include_similarity,
                    "created_by": created_by,
                },
            )


@router.get("/feedback-agents")
def list_feedback_agents(
    user_id: Optional[str] = Query(default=None, min_length=16, max_length=16),
    role: Optional[Literal["human", "ai"]] = None,
    include_inputs: bool = Query(default=False),
    mine_only: bool = Query(default=False),
    public_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    has_llm_params_col = _feedback_agent_has_llm_params_column(db)
    has_apply_q_type_col = _feedback_agent_has_apply_question_type_column(db)
    has_if_score_col = _feedback_agent_has_if_score_column(db)
    has_score_ai_agent_id_col = _feedback_agent_has_score_ai_agent_id_column(db)
    where_parts = ["fa.is_visible = TRUE"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}

    if mine_only and public_only:
        raise HTTPException(status_code=400, detail="mine_only and public_only cannot both be true")

    if mine_only:
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required when mine_only=true")
        where_parts.append("fa.created_by = :user_id")
        params["user_id"] = user_id
    elif public_only:
        where_parts.append("fa.access_scope = 'public'")
    else:
        if user_id:
            where_parts.append("(fa.created_by = :user_id OR fa.access_scope = 'public')")
            params["user_id"] = user_id
        else:
            where_parts.append("fa.access_scope = 'public'")

    if role:
        where_parts.append("fa.role = :role")
        params["role"] = role

    where_sql = " AND ".join(where_parts)
    rows = db.execute(
        text(
            f"""
            SELECT fa.agent_id, fa.source_agent_id, fa.title, fa.description, fa.role,
                   fa.is_structured, fa.provider, fa.model, fa.prompt_text,
                   {"fa.llm_params_text" if has_llm_params_col else "NULL::text AS llm_params_text"},
                   {"fa.apply_question_type" if has_apply_q_type_col else "'all'::text AS apply_question_type"},
                   {"fa.if_score" if has_if_score_col else "FALSE AS if_score"},
                   {"fa.score_ai_agent_id" if has_score_ai_agent_id_col else "NULL::text AS score_ai_agent_id"},
                   fa.access_scope,
                   fa.is_visible, fa.created_by, fa.created_at,
                   u.name AS creator_name, u.email AS creator_email
            FROM feedback_agent fa
            LEFT JOIN users u ON u.user_id = fa.created_by
            WHERE {where_sql}
            ORDER BY fa.created_at DESC, fa.agent_id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    count_params = {k: v for k, v in params.items() if k not in {"limit", "offset"}}
    total = db.execute(
        text(f"SELECT COUNT(*)::int FROM feedback_agent fa WHERE {where_sql}"),
        count_params,
    ).scalar() or 0

    items = [dict(r) for r in rows]
    for item in items:
        raw = item.pop("llm_params_text", None)
        item["apply_question_type"] = _normalize_apply_question_type(item.get("apply_question_type"))
        item["if_score"] = bool(item.get("if_score"))
        item["score_ai_agent_id"] = str(item["score_ai_agent_id"]) if item.get("score_ai_agent_id") is not None else None
        if raw:
            if isinstance(raw, dict):
                item["llm_params"] = raw
            else:
                try:
                    item["llm_params"] = json.loads(raw)
                except Exception:
                    item["llm_params"] = raw
        else:
            item["llm_params"] = None
    if include_inputs and items:
        _, input_map = _fetch_agent_rows(db, [item["agent_id"] for item in items])
        for item in items:
            item["inputs"] = input_map.get(item["agent_id"], [])

    return {"ok": True, "total": int(total), "limit": limit, "offset": offset, "items": items}


@router.get("/feedback-agents/input-options")
def get_feedback_agent_input_options():
    return {
        "ok": True,
        "template_variable_syntax": "{{{key}}}",
        "human_score_options": {
            "if_score": {"type": "boolean", "default": False},
            "score_ai_agent_id": {
                "type": "string",
                "nullable": True,
                "description": "Required when if_score=true; must reference an ai agent_id.",
            },
        },
        "prompt_blocks": [
            {
                "field": "llm_params.feedback_generation_block",
                "description": "Task 1 content. Main teaching/feedback generation rules.",
                "required": False,
            },
            {
                "field": "llm_params.additional_formatting_instructions_block",
                "description": "Additional Task 2 formatting rules appended after base instructions.",
                "required": False,
            },
        ],
        "supported_inputs": [
            {"input_key": "question_content_blocks", "supports_retrieval_rule": False},
            {"input_key": "answer_text", "supports_retrieval_rule": False},
            {
                "input_key": "retrieved_slide_pages",
                "supports_retrieval_rule": True,
                "retrieval_rule_schema": {
                    "preferred_info_type": ["text", "vision", "mixed"],
                    "selection_mode": ["top_k", "all", "threshold", "threshold_then_top_k"],
                    "max_pages": {"type": "integer", "min": 1, "nullable": True},
                    "similarity_threshold": {"type": "number", "min": 0, "max": 1, "nullable": True},
                    "include_similarity": {"type": "boolean"},
                },
            },
        ],
    }


@router.post("/feedback-agents")
def create_feedback_agent(payload: AgentCreateRequest, db: Session = Depends(get_db)):
    _validate_create_payload(payload)
    if not _user_exists(db, payload.created_by):
        raise HTTPException(status_code=400, detail="created_by user_id not found")
    if payload.role == "human" and payload.if_score and payload.score_ai_agent_id:
        _validate_score_ai_agent_id(db, payload.score_ai_agent_id)

    try:
        agent_id = _generate_unique_id(db, table="feedback_agent", column="agent_id", prefix="ag")
        inputs_to_insert = _synthesize_inputs_from_prompt_template(payload)
        llm_col_type = _feedback_agent_llm_params_column_type(db)
        has_apply_q_type_col = _feedback_agent_has_apply_question_type_column(db)
        has_if_score_col = _feedback_agent_has_if_score_column(db)
        has_score_ai_agent_id_col = _feedback_agent_has_score_ai_agent_id_column(db)
        if payload.if_score and (not has_if_score_col or not has_score_ai_agent_id_col):
            raise HTTPException(
                status_code=409,
                detail="feedback_agent.if_score columns are missing; run semantic schema init first",
            )
        insert_params = {
            "agent_id": agent_id,
            "title": payload.title,
            "description": payload.description,
            "role": payload.role,
            "is_structured": payload.is_structured,
            "provider": payload.provider,
            "model": payload.model,
            "prompt_text": payload.prompt_text,
            "llm_params_text": json.dumps(payload.llm_params) if payload.llm_params is not None else None,
            "apply_question_type": _normalize_apply_question_type(payload.apply_question_type),
            "if_score": bool(payload.if_score),
            "score_ai_agent_id": payload.score_ai_agent_id,
            "access_scope": payload.access_scope,
            "created_by": payload.created_by,
        }
        columns = [
            "agent_id",
            "source_agent_id",
            "title",
            "description",
            "role",
            "is_structured",
            "provider",
            "model",
            "prompt_text",
        ]
        values = [
            ":agent_id",
            "NULL",
            ":title",
            ":description",
            ":role",
            ":is_structured",
            ":provider",
            ":model",
            ":prompt_text",
        ]
        if llm_col_type == "jsonb":
            columns.append("llm_params_text")
            values.append("CAST(:llm_params_text AS JSONB)")
        elif llm_col_type:
            columns.append("llm_params_text")
            values.append(":llm_params_text")
        if has_apply_q_type_col:
            columns.append("apply_question_type")
            values.append(":apply_question_type")
        if has_if_score_col:
            columns.append("if_score")
            values.append(":if_score")
        if has_score_ai_agent_id_col:
            columns.append("score_ai_agent_id")
            values.append(":score_ai_agent_id")
        columns.extend(["access_scope", "is_visible", "created_by", "created_at"])
        values.extend([":access_scope", "TRUE", ":created_by", "NOW()"])

        db.execute(
            text(
                f"""
                INSERT INTO feedback_agent (
                  {", ".join(columns)}
                ) VALUES (
                  {", ".join(values)}
                )
                """
            ),
            insert_params,
        )
        _insert_agent_inputs(db, agent_id=agent_id, created_by=payload.created_by, inputs=inputs_to_insert)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {"ok": True, "agent_id": agent_id, "item": _fetch_agent_detail(db, agent_id)}


@router.patch("/feedback-agents/{agent_id}/scope")
def patch_feedback_agent_scope(agent_id: str, payload: ScopePatchRequest, db: Session = Depends(get_db)):
    if not _user_exists(db, payload.updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    row = db.execute(
        text("UPDATE feedback_agent SET access_scope = :access_scope WHERE agent_id = :agent_id RETURNING agent_id"),
        {"access_scope": payload.access_scope, "agent_id": agent_id},
    ).first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="feedback agent not found")
    db.commit()
    return {"ok": True, "item": _fetch_agent_detail(db, agent_id)}


@router.delete("/feedback-agents/{agent_id}")
def delete_feedback_agent(agent_id: str, updated_by: str = Query(..., min_length=16, max_length=16), db: Session = Depends(get_db)):
    if not _user_exists(db, updated_by):
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    row = db.execute(
        text("UPDATE feedback_agent SET is_visible = FALSE WHERE agent_id = :agent_id RETURNING agent_id"),
        {"agent_id": agent_id},
    ).first()
    if not row:
        db.rollback()
        raise HTTPException(status_code=404, detail="feedback agent not found")
    db.commit()
    return {"ok": True, "agent_id": agent_id, "is_visible": False}
