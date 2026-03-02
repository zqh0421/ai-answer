from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ids import generate_short_id


def _ensure_migration_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS semantic_migration_feedback_link_map (
                migration_row_id BIGSERIAL PRIMARY KEY,
                legacy_question_id_text TEXT NOT NULL,
                legacy_feedback_kind VARCHAR(30) NOT NULL,
                legacy_option_index INT NULL,
                feedback_link_id VARCHAR(16) NOT NULL,
                migrated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
            """
        )
    )
    # Legacy first draft may have created this table with a composite PK, which makes
    # legacy_option_index implicitly NOT NULL. If that happened and the table is empty,
    # recreate it in the nullable-friendly shape.
    has_rows = db.execute(
        text("SELECT EXISTS (SELECT 1 FROM semantic_migration_feedback_link_map LIMIT 1)")
    ).scalar()
    if not has_rows:
        db.execute(text("DROP TABLE IF EXISTS semantic_migration_feedback_link_map"))
        db.execute(
            text(
                """
                CREATE TABLE semantic_migration_feedback_link_map (
                    migration_row_id BIGSERIAL PRIMARY KEY,
                    legacy_question_id_text TEXT NOT NULL,
                    legacy_feedback_kind VARCHAR(30) NOT NULL,
                    legacy_option_index INT NULL,
                    feedback_link_id VARCHAR(16) NOT NULL,
                    migrated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
        )
    db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_semantic_migration_feedback_link_map_kind
            ON semantic_migration_feedback_link_map (legacy_question_id_text, legacy_feedback_kind, COALESCE(legacy_option_index, -1))
            """
        )
    )
    db.commit()


def _generate_unique_feedback_link_id(db: Session) -> str:
    exists_sql = text("SELECT 1 FROM feedback_link WHERE feedback_link_id = :v LIMIT 1")
    for _ in range(50):
        cand = generate_short_id("fl")
        if not db.execute(exists_sql, {"v": cand}).scalar():
            return cand
    raise RuntimeError("Unable to generate unique feedback_link_id")


def _find_seed_agent_ids(db: Session) -> dict[str, str]:
    rows = db.execute(
        text(
            """
            SELECT title, agent_id
            FROM feedback_agent
            WHERE title IN ('Seed Human Static (Free Text)', 'Seed Human Static (Option)')
            """
        )
    ).mappings().all()
    by_title = {row["title"]: row["agent_id"] for row in rows}
    missing = [
        t
        for t in ("Seed Human Static (Free Text)", "Seed Human Static (Option)")
        if t not in by_title
    ]
    if missing:
        raise ValueError(f"Missing seed agents: {missing}. Run seed-test-agents first.")
    return {
        "free_text": by_title["Seed Human Static (Free Text)"],
        "option": by_title["Seed Human Static (Option)"],
    }


def _is_nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def migrate_legacy_static_feedback_links(
    db: Session,
    *,
    dry_run: bool = True,
    limit: int = 20,
) -> dict[str, Any]:
    _ensure_migration_table(db)
    agent_ids = _find_seed_agent_ids(db)

    rows = db.execute(
        text(
            """
            SELECT
              q.question_id::text AS legacy_question_id_text,
              q.human_feedback,
              q.mcq_human_feedback,
              qm.question_version_id,
              qm.interaction_id
            FROM question q
            JOIN semantic_migration_question_map qm
              ON qm.legacy_question_id_text = q.question_id::text
            WHERE (
                (q.human_feedback IS NOT NULL AND btrim(q.human_feedback) <> '')
                OR q.mcq_human_feedback IS NOT NULL
            )
            ORDER BY q.created_at NULLS LAST, q.question_id
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings().all()

    created = 0
    skipped_already_migrated = 0
    skipped_missing_option_map = 0
    preview: list[dict[str, Any]] = []

    for row in rows:
        legacy_qid = row["legacy_question_id_text"]
        qv_id = row["question_version_id"]
        interaction_id = row["interaction_id"]

        human_feedback = row.get("human_feedback")
        if _is_nonempty_text(human_feedback):
            already = db.execute(
                text(
                    """
                    SELECT 1 FROM semantic_migration_feedback_link_map
                    WHERE legacy_question_id_text = :legacy_qid
                      AND legacy_feedback_kind = 'oeq_human'
                      AND legacy_option_index IS NULL
                    LIMIT 1
                    """
                ),
                {"legacy_qid": legacy_qid},
            ).scalar()
            if already:
                skipped_already_migrated += 1
            else:
                feedback_link_id = _generate_unique_feedback_link_id(db)
                db.execute(
                    text(
                        """
                        INSERT INTO feedback_link (
                          feedback_link_id, question_version_id, agent_id,
                          target_entity_type, target_entity_id,
                          priority, static_feedback_text, structured_feedback_text,
                          is_visible, created_by, created_at
                        )
                        SELECT
                          :feedback_link_id, :question_version_id, :agent_id,
                          'interaction', :target_entity_id,
                          100, :static_feedback_text, NULL,
                          TRUE, fa.created_by, NOW()
                        FROM feedback_agent fa
                        WHERE fa.agent_id = :agent_id
                        """
                    ),
                    {
                        "feedback_link_id": feedback_link_id,
                        "question_version_id": qv_id,
                        "agent_id": agent_ids["free_text"],
                        "target_entity_id": interaction_id,
                        "static_feedback_text": human_feedback,
                    },
                )
                db.execute(
                    text(
                        """
                        INSERT INTO semantic_migration_feedback_link_map
                          (legacy_question_id_text, legacy_feedback_kind, legacy_option_index, feedback_link_id)
                        VALUES (:legacy_qid, 'oeq_human', NULL, :feedback_link_id)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"legacy_qid": legacy_qid, "feedback_link_id": feedback_link_id},
                )
                created += 1
                if len(preview) < 10:
                    preview.append(
                        {
                            "legacy_question_id": legacy_qid,
                            "kind": "oeq_human",
                            "feedback_link_id": feedback_link_id,
                            "target_entity_type": "interaction",
                            "target_entity_id": interaction_id,
                            "status": "migrated",
                        }
                    )

        mcq_feedback = row.get("mcq_human_feedback")
        if isinstance(mcq_feedback, list):
            for idx0, item in enumerate(mcq_feedback):
                if not _is_nonempty_text(item):
                    continue
                already = db.execute(
                    text(
                        """
                        SELECT 1 FROM semantic_migration_feedback_link_map
                        WHERE legacy_question_id_text = :legacy_qid
                          AND legacy_feedback_kind = 'mcq_human_option'
                          AND legacy_option_index = :idx
                        LIMIT 1
                        """
                    ),
                    {"legacy_qid": legacy_qid, "idx": idx0},
                ).scalar()
                if already:
                    skipped_already_migrated += 1
                    continue

                option_id = db.execute(
                    text(
                        """
                        SELECT interaction_option_id
                        FROM semantic_migration_question_option_map
                        WHERE legacy_question_id_text = :legacy_qid
                          AND legacy_option_index = :idx
                        LIMIT 1
                        """
                    ),
                    {"legacy_qid": legacy_qid, "idx": idx0},
                ).scalar()
                if not option_id:
                    skipped_missing_option_map += 1
                    if len(preview) < 10:
                        preview.append(
                            {
                                "legacy_question_id": legacy_qid,
                                "kind": "mcq_human_option",
                                "legacy_option_index": idx0,
                                "status": "skipped_missing_option_map",
                            }
                        )
                    continue

                feedback_link_id = _generate_unique_feedback_link_id(db)
                db.execute(
                    text(
                        """
                        INSERT INTO feedback_link (
                          feedback_link_id, question_version_id, agent_id,
                          target_entity_type, target_entity_id,
                          priority, static_feedback_text, structured_feedback_text,
                          is_visible, created_by, created_at
                        )
                        SELECT
                          :feedback_link_id, :question_version_id, :agent_id,
                          'interaction_option', :target_entity_id,
                          100, :static_feedback_text, NULL,
                          TRUE, fa.created_by, NOW()
                        FROM feedback_agent fa
                        WHERE fa.agent_id = :agent_id
                        """
                    ),
                    {
                        "feedback_link_id": feedback_link_id,
                        "question_version_id": qv_id,
                        "agent_id": agent_ids["option"],
                        "target_entity_id": option_id,
                        "static_feedback_text": item,
                    },
                )
                db.execute(
                    text(
                        """
                        INSERT INTO semantic_migration_feedback_link_map
                          (legacy_question_id_text, legacy_feedback_kind, legacy_option_index, feedback_link_id)
                        VALUES (:legacy_qid, 'mcq_human_option', :idx, :feedback_link_id)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"legacy_qid": legacy_qid, "idx": idx0, "feedback_link_id": feedback_link_id},
                )
                created += 1
                if len(preview) < 10:
                    preview.append(
                        {
                            "legacy_question_id": legacy_qid,
                            "kind": "mcq_human_option",
                            "legacy_option_index": idx0,
                            "feedback_link_id": feedback_link_id,
                            "target_entity_type": "interaction_option",
                            "target_entity_id": option_id,
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
              (SELECT COUNT(*)::int FROM feedback_link) AS feedback_link_count,
              (SELECT COUNT(*)::int FROM semantic_migration_feedback_link_map) AS feedback_link_map_count
            """
        )
    ).mappings().one()

    return {
        "ok": True,
        "dry_run": dry_run,
        "requested_limit": limit,
        "selected_question_rows": len(rows),
        "created_count": created,
        "skipped_already_migrated_count": skipped_already_migrated,
        "skipped_missing_option_map_count": skipped_missing_option_map,
        "preview": preview,
        "counts": dict(counts),
    }
