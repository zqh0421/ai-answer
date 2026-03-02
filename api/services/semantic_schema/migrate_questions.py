from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ids import generate_short_id


@dataclass(frozen=True)
class IdTarget:
    table: str
    column: str
    prefix: str


_ID_TARGETS = {
    "question": IdTarget("content_question", "question_id", "qn"),
    "question_version": IdTarget("content_question_version", "question_version_id", "qv"),
    "content_block": IdTarget("content_question_content_block", "content_block_id", "qb"),
    "interaction": IdTarget("content_question_interaction", "interaction_id", "qi"),
    "interaction_option": IdTarget("content_question_interaction_option", "interaction_option_id", "qo"),
    "slide_scope": IdTarget("content_question_slide_scope", "slide_scope_id", "qs"),
}


def _ensure_migration_tables(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS semantic_migration_question_map (
                legacy_question_id_text TEXT PRIMARY KEY,
                question_id VARCHAR(16) NOT NULL,
                question_version_id VARCHAR(16) NOT NULL,
                interaction_id VARCHAR(16) NULL,
                migrated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                note TEXT NULL
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS semantic_migration_question_option_map (
                legacy_question_id_text TEXT NOT NULL,
                legacy_option_index INT NOT NULL,
                interaction_option_id VARCHAR(16) NOT NULL,
                migrated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (legacy_question_id_text, legacy_option_index)
            )
            """
        )
    )
    db.commit()


def _generate_unique_id(db: Session, target_key: str) -> str:
    target = _ID_TARGETS[target_key]
    sql = text(f"SELECT 1 FROM {target.table} WHERE {target.column} = :value LIMIT 1")
    for _ in range(50):
        candidate = generate_short_id(target.prefix)
        if not db.execute(sql, {"value": candidate}).scalar():
            return candidate
    raise RuntimeError(f"Unable to generate unique ID for {target_key}")


def _lookup_user_id_by_email(db: Session, email: str | None) -> str | None:
    if not email:
        return None
    return db.execute(text("SELECT user_id FROM users WHERE email = :email LIMIT 1"), {"email": email}).scalar()


def _legacy_question_type_to_new(legacy_type: str | None) -> tuple[str, str]:
    t = (legacy_type or "").strip().lower()
    if t in {"mcq", "multiple choice", "multiple_choice", "single_choice"}:
        return "single_choice", "single_choice"
    if t in {"oeq", "open ended", "open_ended", "free_text"}:
        return "free_text", "free_text"
    return "free_text", "free_text"


def _normalize_content_blocks(content: Any) -> list[dict[str, Any]]:
    if not content:
        return []
    blocks: list[dict[str, Any]] = []
    if isinstance(content, list):
        for idx, item in enumerate(content, start=1):
            if isinstance(item, dict):
                blocks.append(
                    {
                        "block_order": idx,
                        "block_type": str(item.get("type") or "text"),
                        "text_content": item.get("content") if item.get("content") is not None else None,
                    }
                )
            else:
                blocks.append({"block_order": idx, "block_type": "text", "text_content": str(item)})
    else:
        blocks.append({"block_order": 1, "block_type": "text", "text_content": str(content)})
    return blocks


def _normalize_options(options: Any) -> list[dict[str, Any]]:
    if not options:
        return []
    normalized: list[dict[str, Any]] = []
    if isinstance(options, list):
        for idx, item in enumerate(options, start=1):
            if isinstance(item, dict):
                label = item.get("text")
                if label is None:
                    label = item.get("label")
                if label is None:
                    label = item.get("value")
                normalized.append(
                    {
                        "option_order": idx,
                        "option_value": _option_value_for_index(idx),
                        "option_label": "" if label is None else str(label),
                        "is_correct": bool(item.get("isCorrect", item.get("is_correct", False))),
                    }
                )
            else:
                normalized.append(
                    {
                        "option_order": idx,
                        "option_value": _option_value_for_index(idx),
                        "option_label": str(item),
                        "is_correct": False,
                    }
                )
    return normalized


def _option_value_for_index(index_1_based: int) -> str:
    # A..Z, then OPT_27, OPT_28 ...
    if 1 <= index_1_based <= 26:
        return chr(ord("A") + index_1_based - 1)
    return f"OPT_{index_1_based}"


def migrate_legacy_questions_to_semantic(
    db: Session,
    *,
    dry_run: bool = True,
    limit: int = 10,
) -> dict[str, Any]:
    _ensure_migration_tables(db)

    rows = db.execute(
        text(
            """
            SELECT
              q.question_id::text AS legacy_question_id_text,
              q.type AS legacy_type,
              q.content AS legacy_content,
              q.options AS legacy_options,
              q.slide_ids AS legacy_slide_ids,
              q.creater_email AS legacy_creator_email,
              q.created_at AS legacy_created_at
            FROM question q
            LEFT JOIN semantic_migration_question_map m
              ON m.legacy_question_id_text = q.question_id::text
            WHERE m.legacy_question_id_text IS NULL
            ORDER BY q.created_at NULLS LAST, q.question_id
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings().all()

    migrated = 0
    skipped_missing_user = 0
    preview: list[dict[str, Any]] = []

    for row in rows:
        created_by = _lookup_user_id_by_email(db, row.get("legacy_creator_email"))
        if not created_by:
            skipped_missing_user += 1
            if len(preview) < 10:
                preview.append(
                    {
                        "legacy_question_id": row["legacy_question_id_text"],
                        "status": "skipped_missing_user",
                        "legacy_creator_email": row.get("legacy_creator_email"),
                    }
                )
            continue

        question_type, interaction_type = _legacy_question_type_to_new(row.get("legacy_type"))
        question_id = _generate_unique_id(db, "question")
        question_version_id = _generate_unique_id(db, "question_version")
        interaction_id = _generate_unique_id(db, "interaction")

        created_at = row.get("legacy_created_at")

        db.execute(
            text(
                """
                INSERT INTO content_question (question_id, current_version_id, access_scope, is_visible, created_by, created_at)
                VALUES (:question_id, NULL, 'private', TRUE, :created_by, COALESCE(:created_at, NOW()))
                """
            ),
            {
                "question_id": question_id,
                "created_by": created_by,
                "created_at": created_at,
            },
        )

        db.execute(
            text(
                """
                INSERT INTO content_question_version (
                  question_version_id, question_id, version_no, question_type, title, change_note,
                  score_maximum, score_input_format, score_normalize_to_maximum, score_rounding_mode, score_rounding_step,
                  created_by, created_at
                ) VALUES (
                  :question_version_id, :question_id, 1, :question_type, NULL, 'Imported from legacy question',
                  1, 'fraction', TRUE, 'none', 1,
                  :created_by, COALESCE(:created_at, NOW())
                )
                """
            ),
            {
                "question_version_id": question_version_id,
                "question_id": question_id,
                "question_type": question_type,
                "created_by": created_by,
                "created_at": created_at,
            },
        )

        db.execute(
            text(
                """
                UPDATE content_question
                SET current_version_id = :question_version_id
                WHERE question_id = :question_id
                """
            ),
            {
                "question_id": question_id,
                "question_version_id": question_version_id,
            },
        )

        for block in _normalize_content_blocks(row.get("legacy_content")):
            db.execute(
                text(
                    """
                    INSERT INTO content_question_content_block (
                      content_block_id, question_version_id, block_order, block_type, text_content, media_url, alt_text, created_by, created_at
                    ) VALUES (
                      :content_block_id, :question_version_id, :block_order, :block_type, :text_content, NULL, NULL, :created_by, COALESCE(:created_at, NOW())
                    )
                    """
                ),
                {
                    "content_block_id": _generate_unique_id(db, "content_block"),
                    "question_version_id": question_version_id,
                    "block_order": block["block_order"],
                    "block_type": block["block_type"],
                    "text_content": block["text_content"],
                    "created_by": created_by,
                    "created_at": created_at,
                },
            )

        db.execute(
            text(
                """
                INSERT INTO content_question_interaction (
                  interaction_id, question_version_id, interaction_order, interaction_type, prompt_text,
                  is_required, max_score, created_by, created_at
                ) VALUES (
                  :interaction_id, :question_version_id, 1, :interaction_type, NULL,
                  TRUE, NULL, :created_by, COALESCE(:created_at, NOW())
                )
                """
            ),
            {
                "interaction_id": interaction_id,
                "question_version_id": question_version_id,
                "interaction_type": interaction_type,
                "created_by": created_by,
                "created_at": created_at,
            },
        )

        normalized_options = _normalize_options(row.get("legacy_options"))
        for idx0, opt in enumerate(normalized_options):
            option_id = _generate_unique_id(db, "interaction_option")
            db.execute(
                text(
                    """
                    INSERT INTO content_question_interaction_option (
                      interaction_option_id, interaction_id, option_order, option_value, option_label, is_correct, created_by, created_at
                    ) VALUES (
                      :interaction_option_id, :interaction_id, :option_order, :option_value, :option_label, :is_correct, :created_by, COALESCE(:created_at, NOW())
                    )
                    """
                ),
                {
                    "interaction_option_id": option_id,
                    "interaction_id": interaction_id,
                    "option_order": opt["option_order"],
                    "option_value": opt["option_value"],
                    "option_label": opt["option_label"],
                    "is_correct": opt["is_correct"],
                    "created_by": created_by,
                    "created_at": created_at,
                },
            )
            db.execute(
                text(
                    """
                    INSERT INTO semantic_migration_question_option_map (legacy_question_id_text, legacy_option_index, interaction_option_id)
                    VALUES (:legacy_question_id_text, :legacy_option_index, :interaction_option_id)
                    ON CONFLICT (legacy_question_id_text, legacy_option_index) DO NOTHING
                    """
                ),
                {
                    "legacy_question_id_text": row["legacy_question_id_text"],
                    "legacy_option_index": idx0,
                    "interaction_option_id": option_id,
                },
            )

        legacy_slide_ids = row.get("legacy_slide_ids") or []
        for slide_uuid in legacy_slide_ids:
            db.execute(
                text(
                    """
                    INSERT INTO content_question_slide_scope (
                      slide_scope_id, question_version_id, slide_id, page_start, page_end, created_by, created_at
                    ) VALUES (
                      :slide_scope_id, :question_version_id, :slide_id, NULL, NULL, :created_by, COALESCE(:created_at, NOW())
                    )
                    """
                ),
                {
                    "slide_scope_id": _generate_unique_id(db, "slide_scope"),
                    "question_version_id": question_version_id,
                    "slide_id": slide_uuid,
                    "created_by": created_by,
                    "created_at": created_at,
                },
            )

        db.execute(
            text(
                """
                INSERT INTO semantic_migration_question_map (
                  legacy_question_id_text, question_id, question_version_id, interaction_id, note
                ) VALUES (
                  :legacy_question_id_text, :question_id, :question_version_id, :interaction_id, :note
                )
                ON CONFLICT (legacy_question_id_text) DO NOTHING
                """
            ),
            {
                "legacy_question_id_text": row["legacy_question_id_text"],
                "question_id": question_id,
                "question_version_id": question_version_id,
                "interaction_id": interaction_id,
                "note": "Imported from legacy question table",
            },
        )

        migrated += 1
        if len(preview) < 10:
            preview.append(
                {
                    "legacy_question_id": row["legacy_question_id_text"],
                    "question_id": question_id,
                    "question_version_id": question_version_id,
                    "interaction_id": interaction_id,
                    "question_type": question_type,
                    "interaction_type": interaction_type,
                    "legacy_creator_email": row.get("legacy_creator_email"),
                    "created_by": created_by,
                    "content_blocks": len(_normalize_content_blocks(row.get("legacy_content"))),
                    "options": len(normalized_options),
                    "slide_scope_rows": len(legacy_slide_ids),
                    "status": "migrated",
                }
            )

    if dry_run:
        db.rollback()
    else:
        db.commit()

    counts = db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*)::int FROM question) AS legacy_question_count,
              (SELECT COUNT(*)::int FROM semantic_migration_question_map) AS mapped_legacy_question_count,
              (SELECT COUNT(*)::int FROM content_question) AS semantic_question_count,
              (SELECT COUNT(*)::int FROM content_question_version) AS semantic_question_version_count
            """
        )
    ).mappings().one()

    return {
        "ok": True,
        "dry_run": dry_run,
        "requested_limit": limit,
        "selected_rows": len(rows),
        "migrated_count": migrated,
        "skipped_missing_user_count": skipped_missing_user,
        "preview": preview,
        "counts": dict(counts),
    }
