from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..routers.feedback_links import _get_agent as _get_feedback_agent
from .feedback_link_generation_jobs import (
    generate_static_feedback_for_feedback_link,
    generate_static_feedback_with_version_snapshot_for_feedback_link,
    generate_feedback_text_for_agent_without_link,
)
from .feedback_link_job_status import set_feedback_link_generation_job_id
from .ids import generate_short_id
from .slide_batch_jobs import slide_batch_job_manager

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _user_role(db: Session, user_id: str) -> str | None:
    role = db.execute(text("SELECT role::text FROM users WHERE user_id = :user_id LIMIT 1"), {"user_id": user_id}).scalar()
    return str(role) if role is not None else None


def _require_admin_user(db: Session, user_id: str) -> None:
    role_value = _user_role(db, user_id)
    if role_value is None:
        raise HTTPException(status_code=400, detail="updated_by user_id not found")
    if role_value != "admin":
        raise HTTPException(status_code=403, detail="admin permission required")


def _question_row(db: Session, question_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT question_id, current_version_id
            FROM content_question
            WHERE question_id = :question_id
            LIMIT 1
            """
        ),
        {"question_id": question_id},
    ).mappings().first()
    return dict(row) if row else None


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


def _runtime_selected_option_id_from_inputs(
    db: Session,
    *,
    question_version_id: str,
    runtime_inputs: dict[str, Any],
) -> str | None:
    if runtime_inputs.get("selected_option_id"):
        return str(runtime_inputs.get("selected_option_id"))

    if isinstance(runtime_inputs.get("selected_option_index"), int):
        option_ids = _runtime_option_ids_for_version(db, question_version_id)
        idx = int(runtime_inputs["selected_option_index"])
        if 0 <= idx < len(option_ids):
            return option_ids[idx]
        return None

    answer_text_raw = runtime_inputs.get("answer_text")
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
            WHERE i.question_version_id = :qv
            ORDER BY i.interaction_order ASC, o.option_order ASC
            """
        ),
        {"qv": question_version_id},
    ).mappings().all()
    if not rows:
        return None

    if answer_text.isdigit():
        idx = int(answer_text)
        # Keep compatibility with selected_option_index (0-based),
        # and also allow 1-based human-entered ordinal as fallback.
        if 0 <= idx < len(rows):
            return str(rows[idx]["interaction_option_id"])
        if 1 <= idx <= len(rows):
            return str(rows[idx - 1]["interaction_option_id"])

    normalized = answer_text.casefold()
    for row in rows:
        label = str(row.get("option_label") or "").strip()
        value = str(row.get("option_value") or "").strip()
        if label and label.casefold() == normalized:
            return str(row["interaction_option_id"])
        if value and value.casefold() == normalized:
            return str(row["interaction_option_id"])
    return None


def _default_question_content_blocks_text(db: Session, question_version_id: str) -> str | None:
    block_rows = db.execute(
        text(
            """
            SELECT block_order, block_type, text_content, media_url, alt_text
            FROM content_question_content_block
            WHERE question_version_id = :question_version_id
            ORDER BY block_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    interaction_rows = db.execute(
        text(
            """
            SELECT
              i.interaction_id,
              i.interaction_order,
              i.interaction_type,
              i.prompt_text,
              (to_jsonb(i)->>'reference_answer_text') AS reference_answer_text
            FROM content_question_interaction i
            WHERE i.question_version_id = :question_version_id
            ORDER BY i.interaction_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    interaction_ids = [str(row["interaction_id"]) for row in interaction_rows if row.get("interaction_id")]
    options_by_interaction: dict[str, list[dict[str, Any]]] = {}
    if interaction_ids:
        option_rows = db.execute(
            text(
                """
                SELECT
                  o.interaction_id,
                  o.option_order,
                  o.option_label,
                  o.option_value,
                  o.is_correct
                FROM content_question_interaction_option o
                WHERE o.interaction_id = ANY(CAST(:interaction_ids AS TEXT[]))
                ORDER BY o.interaction_id ASC, o.option_order ASC
                """
            ),
            {"interaction_ids": interaction_ids},
        ).mappings().all()
        for row in option_rows:
            options_by_interaction.setdefault(str(row["interaction_id"]), []).append(dict(row))

    lines: list[str] = []
    pending_correct_answers: list[str] = []
    for row in interaction_rows:
        interaction_type = str(row.get("interaction_type") or "").strip().lower()
        prompt_text = str(row.get("prompt_text") or "").strip()
        if prompt_text:
            lines.append(prompt_text)
        options = options_by_interaction.get(str(row.get("interaction_id")), [])
        correct_options: list[str] = []
        for idx, opt in enumerate(options, start=1):
            label = str(opt.get("option_label") or opt.get("option_value") or "").strip()
            if not label:
                continue
            lines.append(f"Option {idx}: {label}")
            if bool(opt.get("is_correct")):
                correct_options.append(label)
        if correct_options:
            pending_correct_answers.append(f"Correct Answer: {'; '.join(correct_options)}")
        reference_answer_text = str(row.get("reference_answer_text") or "").strip()
        if interaction_type in {"free_text", "essay"} and reference_answer_text:
            pending_correct_answers.append(f"Correct Answer: {reference_answer_text}")
    for row in block_rows:
        block_type = str(row.get("block_type") or "text")
        if block_type == "image":
            content = str(row.get("alt_text") or row.get("media_url") or "").strip()
        else:
            content = str(row.get("text_content") or row.get("media_url") or "").strip()
        if content:
            lines.append(f"- [{block_type}] {content}")
    lines.extend(pending_correct_answers)
    if not lines:
        return None
    return "\n".join(lines)


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
            "code": "AI_SCORE_AGENT_NOT_CONFIGURED",
            "reason": "missing_score_ai_agent_id",
            "message": "Human scoring agent is enabled, but score_ai_agent_id is not configured.",
        }

    ai_feedback_link_id = _runtime_feedback_link_id_for_agent(
        db,
        question_version_id=question_version_id,
        agent_id=ai_agent_id,
        selected_option_id=selected_option_id,
    )
    if ai_feedback_link_id:
        generated = generate_static_feedback_for_feedback_link(
            str(ai_feedback_link_id),
            persist=False,
            enforce_ai_role=True,
            input_values=runtime_inputs,
            include_debug=True,
        )
    else:
        try:
            generated_text, debug_payload = generate_feedback_text_for_agent_without_link(
                db,
                question_version_id=question_version_id,
                agent_id=ai_agent_id,
                input_values=runtime_inputs,
            )
            generated = {
                "ok": True,
                "static_feedback_text": generated_text,
                "resolved_system_prompt": debug_payload.get("resolved_system_prompt"),
                "resolved_user_text": debug_payload.get("resolved_user_text"),
                "resolved_input_values": debug_payload.get("resolved_input_values"),
                "without_feedback_link": True,
            }
        except Exception as exc:
            return {
                "enabled": True,
                "has_score": False,
                "code": "AI_SCORE_LINK_MISSING",
                "ai_agent_id": ai_agent_id,
                "reason": "ai_feedback_link_not_found",
                "message": (
                    "No visible feedback_link found for score_ai_agent on the current question version, "
                    "and linkless generation fallback failed."
                ),
                "question_version_id": question_version_id,
                "selected_option_id": selected_option_id,
                "fallback_error": str(exc),
            }
    if not generated.get("ok"):
        return {
            "enabled": True,
            "has_score": False,
            "code": "AI_SCORE_GENERATION_FAILED",
            "ai_agent_id": ai_agent_id,
            "feedback_link_id": ai_feedback_link_id,
            "reason": str(generated.get("reason") or "ai_generation_failed"),
            "message": "Score AI generation failed.",
        }

    extracted = _extract_score_from_generated_feedback(generated.get("static_feedback_text"))
    structured_feedback = _extract_structured_feedback_from_generated_feedback(generated.get("static_feedback_text"))
    return {
        "enabled": True,
        "has_score": extracted.get("score") is not None,
        "ai_agent_id": ai_agent_id,
        "feedback_link_id": ai_feedback_link_id,
        "without_feedback_link": bool(generated.get("without_feedback_link")),
        "score": extracted.get("score"),
        "max_score": extracted.get("max_score"),
        "structured_feedback": structured_feedback,
        "scoring_only": True,
        "hide_structured_feedback_in_ui": True,
        "rendered_prompt": {
            "system_prompt": generated.get("resolved_system_prompt"),
            "user_text": generated.get("resolved_user_text"),
        },
    }


def _ensure_static_feedback_version_schema(db: Session) -> None:
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


def _read_current_feedback_link_state(
    db: Session, *, question_version_id: str, agent_id: str
) -> tuple[str | None, list[dict[str, Any]]]:
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


def _generate_unique_id(db: Session, table: str, col: str, prefix: str) -> str:
    sql = text(f"SELECT 1 FROM {table} WHERE {col} = :v LIMIT 1")
    for _ in range(50):
        candidate = generate_short_id(prefix)
        if not db.execute(sql, {"v": candidate}).scalar():
            return candidate
    raise ValueError(f"Unable to generate unique id for {table}.{col}")


def _create_static_feedback_version_snapshot(
    db: Session,
    *,
    question_id: str,
    question_version_id: str,
    agent_id: str,
    created_by: str,
    question_feedback_text: str | None,
    option_feedback: list[dict[str, Any]],
    parent_version_id: str | None,
    restored_from_version_id: str | None = None,
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

    created_at = db.execute(
        text(
            """
            SELECT created_at
            FROM feedback_static_feedback_version
            WHERE version_id = :version_id
            LIMIT 1
            """
        ),
        {"version_id": version_id},
    ).scalar()
    return {
        "version_id": version_id,
        "revision_no": revision_no,
        "created_at": created_at,
    }


def _to_utc_iso_z(value: Any) -> str | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def run_feedback_generation_flow(
    db: Session,
    *,
    question_id: str,
    agent_id: str,
    dry_run: bool = True,
    updated_by: str | None = None,
    input_values: dict[str, Any] | None = None,
    require_updated_by_for_persist: bool = True,
    include_debug: bool = True,
    snapshot_on_persist: bool = True,
    execution_mode: Literal["sync", "async"] = "sync",
    enqueue_reason: str | None = None,
) -> dict[str, Any]:
    if updated_by:
        _require_admin_user(db, updated_by)
    if not dry_run and not updated_by and require_updated_by_for_persist:
        raise HTTPException(status_code=403, detail="updatedBy is required when dryRun is false")

    question = _question_row(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="question not found")
    current_version_id = str(question.get("current_version_id") or "")
    if not current_version_id:
        raise HTTPException(status_code=409, detail="question has no current version")

    agent = _get_feedback_agent(db, agent_id)
    if not agent or not agent.get("is_visible", True):
        raise HTTPException(status_code=404, detail="feedback agent not found")
    agent_name = str(agent.get("title") or "").strip() or None
    agent_role = str(agent.get("role") or "")
    if agent_role not in {"ai", "human"}:
        raise HTTPException(status_code=400, detail="dry-run generation is only supported for ai or human agents")

    feedback_link_id = _find_visible_question_version_link(
        db, question_version_id=current_version_id, agent_id=agent_id
    ) or _find_any_visible_question_link(
        db, question_version_id=current_version_id, agent_id=agent_id
    )
    if not feedback_link_id:
        raise HTTPException(status_code=404, detail="agent is not attached to this question")

    runtime_inputs = dict(input_values or {})
    default_q_blocks = _default_question_content_blocks_text(db, current_version_id)
    if default_q_blocks:
        # Keep this backend-generated value authoritative so question content
        # always includes any reference answer for free_text/essay.
        runtime_inputs["question_content_blocks"] = default_q_blocks

    selected_option_id = _runtime_selected_option_id_from_inputs(
        db,
        question_version_id=current_version_id,
        runtime_inputs=runtime_inputs,
    )

    if execution_mode == "async":
        if dry_run:
            raise HTTPException(status_code=400, detail="dry-run cannot use async execution mode")
        if agent_role != "ai":
            raise HTTPException(status_code=400, detail="async generation is only supported for ai agents")
        try:
            if snapshot_on_persist:
                rq_job_id = slide_batch_job_manager.enqueue_callable(
                    generate_static_feedback_with_version_snapshot_for_feedback_link,
                    str(feedback_link_id),
                    created_by=updated_by,
                )
            else:
                rq_job_id = slide_batch_job_manager.enqueue_callable(
                    generate_static_feedback_for_feedback_link,
                    str(feedback_link_id),
                    persist=True,
                    enforce_ai_role=True,
                    input_values=runtime_inputs or None,
                    include_debug=False,
                )
            set_feedback_link_generation_job_id(str(feedback_link_id), str(rq_job_id))
            return {
                "ok": True,
                "queued": True,
                "job_id": str(rq_job_id),
                "feedback_link_id": str(feedback_link_id),
                "question_id": question_id,
                "question_version_id": current_version_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "dry_run": dry_run,
                "snapshot_on_persist": snapshot_on_persist,
                "generation_enqueue_reason": enqueue_reason,
            }
        except Exception as enqueue_err:
            inline = run_feedback_generation_flow(
                db,
                question_id=question_id,
                agent_id=agent_id,
                dry_run=dry_run,
                updated_by=updated_by,
                input_values=runtime_inputs,
                require_updated_by_for_persist=False,
                include_debug=include_debug,
                snapshot_on_persist=snapshot_on_persist,
                execution_mode="sync",
                enqueue_reason=enqueue_reason,
            )
            inline["generation_mode"] = "inline_fallback"
            inline["enqueue_error"] = str(enqueue_err)
            inline["queued"] = False
            inline["generation_enqueue_reason"] = enqueue_reason
            return inline

    if agent_role == "human":
        if not dry_run:
            # Human agents do not run LLM generation/persistence at runtime.
            # Gracefully downgrade to read-only dry-run semantics.
            dry_run = True
        runtime_feedback_link_id = _runtime_feedback_link_id_for_agent(
            db,
            question_version_id=current_version_id,
            agent_id=agent_id,
            selected_option_id=selected_option_id,
        )
        if runtime_feedback_link_id:
            feedback_link_id = runtime_feedback_link_id

        static_feedback_text = None
        structured_feedback_text = None

        if selected_option_id:
            selected_row = db.execute(
                text(
                    """
                    SELECT static_feedback_text, structured_feedback_text
                    FROM feedback_link
                    WHERE question_version_id = :question_version_id
                      AND agent_id = :agent_id
                      AND target_entity_type = 'interaction_option'
                      AND target_entity_id = :selected_option_id
                      AND is_visible = TRUE
                      AND (
                        static_feedback_text IS NOT NULL
                        OR structured_feedback_text IS NOT NULL
                      )
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                ),
                {
                    "question_version_id": current_version_id,
                    "agent_id": agent_id,
                    "selected_option_id": selected_option_id,
                },
            ).mappings().first()
            if selected_row:
                static_feedback_text = (
                    str(selected_row.get("static_feedback_text"))
                    if selected_row.get("static_feedback_text") is not None
                    else None
                )
                structured_feedback_text = (
                    str(selected_row.get("structured_feedback_text"))
                    if selected_row.get("structured_feedback_text") is not None
                    else None
                )

        if not static_feedback_text and not structured_feedback_text:
            question_row = db.execute(
                text(
                    """
                    SELECT static_feedback_text, structured_feedback_text
                    FROM feedback_link
                    WHERE question_version_id = :question_version_id
                      AND agent_id = :agent_id
                      AND target_entity_type = 'question_version'
                      AND target_entity_id = :question_version_id
                      AND is_visible = TRUE
                      AND (
                        static_feedback_text IS NOT NULL
                        OR structured_feedback_text IS NOT NULL
                      )
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                ),
                {"question_version_id": current_version_id, "agent_id": agent_id},
            ).mappings().first()
            if question_row:
                static_feedback_text = (
                    str(question_row.get("static_feedback_text"))
                    if question_row.get("static_feedback_text") is not None
                    else None
                )
                structured_feedback_text = (
                    str(question_row.get("structured_feedback_text"))
                    if question_row.get("structured_feedback_text") is not None
                    else None
                )

        if not static_feedback_text and not structured_feedback_text:
            fallback_row = db.execute(
                text(
                    """
                    SELECT static_feedback_text, structured_feedback_text
                    FROM feedback_link
                    WHERE question_version_id = :question_version_id
                      AND agent_id = :agent_id
                      AND is_visible = TRUE
                      AND (
                        static_feedback_text IS NOT NULL
                        OR structured_feedback_text IS NOT NULL
                      )
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                ),
                {"question_version_id": current_version_id, "agent_id": agent_id},
            ).mappings().first()
            if fallback_row:
                static_feedback_text = (
                    str(fallback_row.get("static_feedback_text"))
                    if fallback_row.get("static_feedback_text") is not None
                    else None
                )
                structured_feedback_text = (
                    str(fallback_row.get("structured_feedback_text"))
                    if fallback_row.get("structured_feedback_text") is not None
                    else None
                )
        display_feedback_text = static_feedback_text or structured_feedback_text
        result = {
            "ok": True,
            "feedback_link_id": str(feedback_link_id),
            "persisted": False,
            "static_feedback_text": display_feedback_text,
            "structured_feedback_text": structured_feedback_text,
            "has_feedback": bool(display_feedback_text),
            "ai_score_result": _resolve_human_agent_ai_score_result(
                db,
                question_version_id=current_version_id,
                human_agent_id=agent_id,
                selected_option_id=selected_option_id,
                runtime_inputs=runtime_inputs,
            ),
            "rendered_prompt": None,
        }
        if isinstance(result.get("ai_score_result"), dict):
            rp = result["ai_score_result"].get("rendered_prompt")
            if isinstance(rp, dict):
                result["rendered_prompt"] = rp
    else:
        result = generate_static_feedback_for_feedback_link(
            str(feedback_link_id),
            persist=not dry_run,
            enforce_ai_role=True,
            input_values=runtime_inputs or None,
            include_debug=include_debug,
        )
        result["ai_score_result"] = None
        result["structured_feedback_text"] = _extract_structured_feedback_from_generated_feedback(
            result.get("static_feedback_text")
        )
        result["rendered_prompt"] = {
            "system_prompt": result.get("resolved_system_prompt"),
            "user_text": result.get("resolved_user_text"),
        }

    created_version: dict[str, Any] | None = None
    if snapshot_on_persist and agent_role == "ai" and not dry_run and bool(updated_by) and result.get("ok") and not result.get("skipped"):
        _ensure_static_feedback_version_schema(db)
        latest_before_update = _get_latest_static_feedback_version(db, question_id=question_id, agent_id=agent_id)
        latest_version_id = str(latest_before_update["version_id"]) if latest_before_update else None
        current_q_text, current_option_feedback = _read_current_feedback_link_state(
            db, question_version_id=current_version_id, agent_id=agent_id
        )
        created_version = _create_static_feedback_version_snapshot(
            db,
            question_id=question_id,
            question_version_id=current_version_id,
            agent_id=agent_id,
            created_by=str(updated_by),
            question_feedback_text=current_q_text,
            option_feedback=current_option_feedback,
            parent_version_id=latest_version_id,
            restored_from_version_id=None,
        )
        db.commit()

    result.update(
        {
            "question_id": question_id,
            "question_version_id": current_version_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "dry_run": dry_run,
            "queued": False,
            "generation_enqueue_reason": enqueue_reason,
        }
    )
    if created_version:
        result["version_id"] = created_version["version_id"]
        result["revision_no"] = int(created_version["revision_no"])
        result["version_created_at"] = _to_utc_iso_z(created_version.get("created_at"))
    return result
