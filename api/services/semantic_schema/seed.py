from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ids import generate_short_id


def _generate_unique(db: Session, table: str, col: str, prefix: str) -> str:
    sql = text(f"SELECT 1 FROM {table} WHERE {col} = :v LIMIT 1")
    for _ in range(50):
        cand = generate_short_id(prefix)
        if not db.execute(sql, {"v": cand}).scalar():
            return cand
    raise RuntimeError(f"Unable to generate unique id for {table}.{col}")


def _resolve_seed_user(db: Session, created_by: str | None) -> str | None:
    if created_by:
        exists = db.execute(text("SELECT 1 FROM users WHERE user_id = :uid LIMIT 1"), {"uid": created_by}).scalar()
        return created_by if exists else None
    return db.execute(
        text(
            "SELECT user_id FROM users WHERE user_id IS NOT NULL ORDER BY email NULLS LAST, id NULLS LAST LIMIT 1"
        )
    ).scalar()


def seed_semantic_test_agents(db: Session, *, created_by: str | None = None, dry_run: bool = True) -> dict[str, Any]:
    seed_user = _resolve_seed_user(db, created_by)
    if not seed_user:
        raise ValueError("No valid users.user_id found for seeding; backfill user IDs first")

    seeds = [
        {
            "title": "Seed Human Static (Free Text)",
            "description": "Static human feedback for free_text/essay interactions",
            "role": "human",
            "is_structured": False,
            "provider": None,
            "model": None,
            "prompt_text": None,
            "inputs": [
                {"input_key": "question_content_blocks", "is_required": True, "sort_order": 10},
                {"input_key": "answer_text", "is_required": True, "sort_order": 20},
            ],
        },
        {
            "title": "Seed Human Static (Option)",
            "description": "Static human feedback for choice/dropdown option-level feedback",
            "role": "human",
            "is_structured": False,
            "provider": None,
            "model": None,
            "prompt_text": None,
            "inputs": [
                {"input_key": "all_options", "is_required": True, "sort_order": 10},
                {"input_key": "selected_option_index", "is_required": True, "sort_order": 20},
            ],
        },
        {
            "title": "Seed AI Dynamic (General)",
            "description": "Dynamic AI feedback with optional retrieval for integration testing",
            "role": "ai",
            "is_structured": True,
            "provider": "openai",
            "model": "gpt-4.1-mini",
            "prompt_text": "You are a helpful teaching assistant. Provide concise, constructive feedback.",
            "inputs": [
                {"input_key": "question_content_blocks", "is_required": True, "sort_order": 10},
                {"input_key": "answer_text", "is_required": False, "sort_order": 20},
                {"input_key": "selected_option_index", "is_required": False, "sort_order": 30},
                {
                    "input_key": "retrieved_slide_pages",
                    "is_required": False,
                    "sort_order": 40,
                    "retrieval_rule": {
                        "preferred_info_type": "text",
                        "selection_mode": "threshold_then_top_k",
                        "max_pages": 3,
                        "similarity_threshold": 0.7,
                        "include_similarity": True,
                    },
                },
            ],
        },
    ]

    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    for seed in seeds:
        existing = db.execute(
            text("SELECT agent_id FROM feedback_agent WHERE title = :title LIMIT 1"),
            {"title": seed["title"]},
        ).scalar()
        if existing:
            skipped.append({"title": seed["title"], "agent_id": existing, "reason": "already_exists"})
            continue

        agent_id = _generate_unique(db, "feedback_agent", "agent_id", "ag")
        db.execute(
            text(
                """
                INSERT INTO feedback_agent (
                  agent_id, source_agent_id, title, description, role, is_structured,
                  provider, model, prompt_text, access_scope, is_visible, created_by, created_at
                ) VALUES (
                  :agent_id, NULL, :title, :description, :role, :is_structured,
                  :provider, :model, :prompt_text, 'private', TRUE, :created_by, NOW()
                )
                """
            ),
            {
                "agent_id": agent_id,
                "title": seed["title"],
                "description": seed["description"],
                "role": seed["role"],
                "is_structured": seed["is_structured"],
                "provider": seed["provider"],
                "model": seed["model"],
                "prompt_text": seed["prompt_text"],
                "created_by": seed_user,
            },
        )

        for item in seed["inputs"]:
            agent_input_id = _generate_unique(db, "feedback_agent_input", "agent_input_id", "ai")
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
                    "input_key": item["input_key"],
                    "is_required": item["is_required"],
                    "sort_order": item["sort_order"],
                    "created_by": seed_user,
                },
            )

            if "retrieval_rule" in item:
                rr = item["retrieval_rule"]
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
                        "preferred_info_type": rr["preferred_info_type"],
                        "selection_mode": rr["selection_mode"],
                        "max_pages": rr.get("max_pages"),
                        "similarity_threshold": rr.get("similarity_threshold"),
                        "include_similarity": rr.get("include_similarity", True),
                        "created_by": seed_user,
                    },
                )

        created.append({"title": seed["title"], "agent_id": agent_id})

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return {
        "ok": True,
        "dry_run": dry_run,
        "seed_user_id": seed_user,
        "created": created,
        "skipped": skipped,
    }
