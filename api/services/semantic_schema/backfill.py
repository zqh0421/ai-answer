from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ids import generate_short_id


_SELECT_MISSING_USERS_SQL = text(
    """
    SELECT id, email, user_id
    FROM users
    WHERE user_id IS NULL OR user_id = ''
    ORDER BY email NULLS LAST, id
    """
)

_SELECT_EXISTS_SQL = text("SELECT 1 FROM users WHERE user_id = :user_id LIMIT 1")
_UPDATE_USER_ID_SQL = text("UPDATE users SET user_id = :user_id WHERE id = :legacy_id")
_COUNT_SQL = text(
    """
    SELECT
      COUNT(*)::int AS total_users,
      COUNT(user_id)::int AS users_with_user_id,
      COUNT(*) FILTER (WHERE user_id IS NULL OR user_id = '')::int AS users_missing_user_id
    FROM users
    """
)


def _generate_unique_user_id(db: Session) -> str:
    for _ in range(50):
        candidate = generate_short_id("us")
        exists = db.execute(_SELECT_EXISTS_SQL, {"user_id": candidate}).scalar()
        if not exists:
            return candidate
    raise RuntimeError("Unable to generate unique user_id after multiple attempts")


def backfill_user_user_ids(db: Session, *, dry_run: bool = False, limit: int | None = None) -> dict[str, Any]:
    rows = db.execute(_SELECT_MISSING_USERS_SQL).mappings().all()
    if limit is not None and limit >= 0:
        rows = rows[:limit]

    updates: list[dict[str, str]] = []
    preview: list[dict[str, str | None]] = []

    for row in rows:
        generated = _generate_unique_user_id(db)
        updates.append({"legacy_id": row["id"], "user_id": generated})
        if len(preview) < 10:
            preview.append(
                {
                    "legacy_id": str(row["id"]),
                    "email": row.get("email"),
                    "user_id": generated,
                }
            )

    if not dry_run:
        for item in updates:
            db.execute(_UPDATE_USER_ID_SQL, item)
        db.commit()
    else:
        db.rollback()

    counts = db.execute(_COUNT_SQL).mappings().one()
    return {
        "ok": True,
        "dry_run": dry_run,
        "requested_limit": limit,
        "updated_count": len(updates),
        "preview": preview,
        "counts": dict(counts),
        "id_format": {"prefix": "us", "length": 16},
    }
