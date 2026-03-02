from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def get_semantic_question_type_distribution(db: Session) -> dict[str, Any]:
    rows = db.execute(
        text(
            """
            SELECT qv.question_type, COUNT(*)::int AS count
            FROM content_question_version qv
            GROUP BY qv.question_type
            ORDER BY count DESC, qv.question_type ASC
            """
        )
    ).mappings().all()
    total = sum(int(r["count"]) for r in rows)
    return {
        "ok": True,
        "total_question_versions": total,
        "items": [dict(r) for r in rows],
    }


def list_semantic_question_samples(
    db: Session,
    *,
    limit: int = 20,
    offset: int = 0,
    question_type: str | None = None,
) -> dict[str, Any]:
    where_sql = ""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if question_type:
        where_sql = "WHERE qv.question_type = :question_type"
        params["question_type"] = question_type

    rows = db.execute(
        text(
            f"""
            SELECT
              q.question_id,
              q.current_version_id,
              q.access_scope,
              q.is_visible,
              q.created_by,
              q.created_at,
              qv.question_type,
              qv.version_no,
              qv.title,
              qv.score_maximum,
              qv.score_rounding_mode,
              qv.score_rounding_step,
              (SELECT COUNT(*)::int FROM content_question_content_block b WHERE b.question_version_id = qv.question_version_id) AS content_block_count,
              (SELECT COUNT(*)::int FROM content_question_interaction i WHERE i.question_version_id = qv.question_version_id) AS interaction_count,
              (SELECT COUNT(*)::int
                 FROM content_question_interaction i
                 JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
                WHERE i.question_version_id = qv.question_version_id) AS option_count,
              (SELECT COUNT(*)::int FROM content_question_slide_scope s WHERE s.question_version_id = qv.question_version_id) AS slide_scope_count,
              (SELECT COUNT(*)::int FROM feedback_link fl WHERE fl.question_version_id = qv.question_version_id AND fl.is_visible = TRUE) AS feedback_link_count
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            {where_sql}
            ORDER BY q.created_at DESC, q.question_id ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total_row = db.execute(
        text(
            f"""
            SELECT COUNT(*)::int AS total
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            {where_sql}
            """
        ),
        {k: v for k, v in params.items() if k == "question_type"},
    ).mappings().one()

    return {
        "ok": True,
        "limit": limit,
        "offset": offset,
        "question_type": question_type,
        "total": int(total_row["total"]),
        "items": [dict(r) for r in rows],
    }


def get_semantic_question_version_detail(db: Session, question_version_id: str) -> dict[str, Any] | None:
    version = db.execute(
        text(
            """
            SELECT
              qv.question_version_id,
              qv.question_id,
              q.current_version_id,
              q.access_scope,
              q.is_visible,
              q.created_by AS question_created_by,
              q.created_at AS question_created_at,
              qv.version_no,
              qv.question_type,
              qv.title,
              qv.change_note,
              qv.score_maximum,
              qv.score_input_format,
              qv.score_normalize_to_maximum,
              qv.score_rounding_mode,
              qv.score_rounding_step,
              qv.created_by AS version_created_by,
              qv.created_at AS version_created_at
            FROM content_question_version qv
            JOIN content_question q ON q.question_id = qv.question_id
            WHERE qv.question_version_id = :question_version_id
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().first()
    if not version:
        return None

    content_blocks = db.execute(
        text(
            """
            SELECT content_block_id, question_version_id, block_order, block_type, text_content, media_url, alt_text, created_by, created_at
            FROM content_question_content_block
            WHERE question_version_id = :question_version_id
            ORDER BY block_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    interactions = db.execute(
        text(
            """
            SELECT interaction_id, question_version_id, interaction_order, interaction_type, prompt_text, is_required, max_score, created_by, created_at
            FROM content_question_interaction
            WHERE question_version_id = :question_version_id
            ORDER BY interaction_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    interaction_ids = [row["interaction_id"] for row in interactions]

    options_by_interaction: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if interaction_ids:
        option_rows = db.execute(
            text(
                """
                SELECT interaction_option_id, interaction_id, option_order, option_value, option_label, is_correct, created_by, created_at
                FROM content_question_interaction_option
                WHERE interaction_id = ANY(:interaction_ids)
                ORDER BY interaction_id ASC, option_order ASC
                """
            ),
            {"interaction_ids": interaction_ids},
        ).mappings().all()
        for row in option_rows:
            options_by_interaction[row["interaction_id"]].append(dict(row))

    slide_scope = db.execute(
        text(
            """
            SELECT slide_scope_id, question_version_id, slide_id::text AS slide_id, page_start, page_end, created_by, created_at
            FROM content_question_slide_scope
            WHERE question_version_id = :question_version_id
            ORDER BY created_at ASC, slide_scope_id ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    feedback_links = db.execute(
        text(
            """
            SELECT
              fl.feedback_link_id,
              fl.question_version_id,
              fl.agent_id,
              fa.title AS agent_title,
              fa.role AS agent_role,
              fa.is_structured,
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
            ORDER BY fl.priority ASC, fl.created_at ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    interaction_items: list[dict[str, Any]] = []
    for interaction in interactions:
        item = dict(interaction)
        item["options"] = options_by_interaction.get(interaction["interaction_id"], [])
        interaction_items.append(item)

    return {
        "ok": True,
        "question": {
            "question_id": version["question_id"],
            "current_version_id": version["current_version_id"],
            "access_scope": version["access_scope"],
            "is_visible": version["is_visible"],
            "created_by": version["question_created_by"],
            "created_at": version["question_created_at"],
        },
        "question_version": {
            "question_version_id": version["question_version_id"],
            "version_no": version["version_no"],
            "question_type": version["question_type"],
            "title": version["title"],
            "change_note": version["change_note"],
            "score_maximum": version["score_maximum"],
            "score_input_format": version["score_input_format"],
            "score_normalize_to_maximum": version["score_normalize_to_maximum"],
            "score_rounding_mode": version["score_rounding_mode"],
            "score_rounding_step": version["score_rounding_step"],
            "created_by": version["version_created_by"],
            "created_at": version["version_created_at"],
        },
        "content_blocks": [dict(r) for r in content_blocks],
        "interactions": interaction_items,
        "slide_scope": [dict(r) for r in slide_scope],
        "feedback_links": [dict(r) for r in feedback_links],
    }
