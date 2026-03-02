from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

_TABLES = [
    "feedback_agent",
    "feedback_agent_input",
    "feedback_agent_input_retrieval_rule",
    "content_question",
    "content_question_version",
    "content_question_content_block",
    "content_question_interaction",
    "content_question_interaction_option",
    "content_question_slide_scope",
    "feedback_link",
    "feedback_compositions",
    "feedback_composition_rules",
    "feedback_record_result",
    "feedback_record_result_retrieved_page",
]


def semantic_schema_status(db: Session) -> dict:
    user_counts = db.execute(
        text(
            """
            SELECT
              COUNT(*)::int AS total_users,
              COUNT(user_id)::int AS users_with_user_id,
              COUNT(*) FILTER (WHERE user_id IS NULL OR user_id = '')::int AS users_missing_user_id
            FROM users
            """
        )
    ).mappings().one()

    table_counts: dict[str, int] = {}
    for table_name in _TABLES:
        count = db.execute(text(f"SELECT COUNT(*)::int AS c FROM {table_name}"))
        table_counts[table_name] = int(count.scalar() or 0)

    legacy = db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*)::int FROM question) AS legacy_question_count,
              (SELECT COUNT(*)::int FROM record_result) AS legacy_record_result_count
            """
        )
    ).mappings().one()

    return {
        "ok": True,
        "users": dict(user_counts),
        "semantic_tables": table_counts,
        "legacy": dict(legacy),
    }
