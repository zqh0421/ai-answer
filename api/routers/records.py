import json
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import models
from ..config import Settings, get_settings
from ..dependencies import get_db
from ..services.ids import generate_short_id
from ..services.feedback_link_generation_jobs import resolve_feedback_prompt_for_feedback_link
from ..tags import Tags
from ..lti.routes import try_submit_lti_grade_for_launch

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_RECORDS])

_NON_LTI_LEARNER_SENTINELS = {
    "",
    "anonymous_user",
    "anonymous",
    "unknown",
    "none",
    "null",
    "undefined",
}
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _resolve_mcq_score(db: Session, question_id: str, answer: str) -> tuple[float, float] | None:
    if not question_id.startswith("qn_"):
        return None

    rows = db.execute(
        text(
            """
            SELECT o.option_value, o.is_correct
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            JOIN content_question_interaction i ON i.question_version_id = qv.question_version_id
            JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
            WHERE q.question_id = :question_id
            ORDER BY i.interaction_order ASC, o.option_order ASC
            """
        ),
        {"question_id": question_id},
    ).mappings().all()
    options = [{"text": str(r["option_value"] or ""), "isCorrect": bool(r["is_correct"])} for r in rows]

    normalized_answer = (answer or "").strip()
    selected_index = None

    if normalized_answer.isdigit():
        idx = int(normalized_answer)
        if 0 <= idx < len(options):
            selected_index = idx

    if selected_index is None:
        for idx, option in enumerate(options):
            option_text = option.get("text") if isinstance(option, dict) else str(option)
            if str(option_text).strip() == normalized_answer:
                selected_index = idx
                break

    if selected_index is None:
        return None

    selected_option = options[selected_index]
    is_correct = bool(selected_option.get("isCorrect")) if isinstance(selected_option, dict) else False
    return (1.0 if is_correct else 0.0, 1.0)


def _resolve_mcq_selected_option_id(db: Session, question_id: str, answer: str) -> str | None:
    if not question_id.startswith("qn_"):
        return None
    rows = db.execute(
        text(
            """
            SELECT o.interaction_option_id, o.option_value
            FROM content_question q
            JOIN content_question_version qv ON qv.question_version_id = q.current_version_id
            JOIN content_question_interaction i ON i.question_version_id = qv.question_version_id
            JOIN content_question_interaction_option o ON o.interaction_id = i.interaction_id
            WHERE q.question_id = :question_id
            ORDER BY i.interaction_order ASC, o.option_order ASC
            """
        ),
        {"question_id": question_id},
    ).mappings().all()
    if not rows:
        return None

    normalized_answer = (answer or "").strip()
    if normalized_answer.isdigit():
        idx = int(normalized_answer)
        if 0 <= idx < len(rows):
            return str(rows[idx]["interaction_option_id"])

    for row in rows:
        if str(row.get("option_value") or "").strip() == normalized_answer:
            return str(row["interaction_option_id"])
    return None


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_score_pair_from_feedback_text(feedback: object) -> tuple[float | None, float | None]:
    if feedback is None:
        return None, None
    raw = str(feedback).strip()
    if not raw:
        return None, None

    candidate = raw
    fenced = _JSON_FENCE_RE.search(raw)
    if fenced:
        candidate = fenced.group(1).strip()

    obj = None
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            obj = parsed
    except Exception:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(candidate[start : end + 1])
                if isinstance(parsed, dict):
                    obj = parsed
            except Exception:
                obj = None

    if not isinstance(obj, dict):
        return None, None

    score = _safe_float(obj.get("score"))
    max_score = _safe_float(obj.get("max_score"))
    if max_score is None:
        max_score = _safe_float(obj.get("score_maximum"))
    return score, max_score


def _extract_lti_context_from_request(request: Request) -> dict[str, str]:
    values: dict[str, str] = {}

    for key in ("lti_launch_id", "lti_user_id"):
        query_val = (request.query_params.get(key) or "").strip()
        if query_val:
            values[key] = query_val

    header_map = {
        "lti_launch_id": "x-lti-launch-id",
        "lti_user_id": "x-lti-user-id",
    }
    for field, header in header_map.items():
        if field in values:
            continue
        header_val = (request.headers.get(header) or "").strip()
        if header_val:
            values[field] = header_val

    referer = (request.headers.get("referer") or "").strip()
    if referer:
        try:
            referer_query = dict(parse_qsl(urlsplit(referer).query, keep_blank_values=True))
            for key in ("lti_launch_id", "lti_user_id"):
                if key in values:
                    continue
                ref_val = str(referer_query.get(key) or "").strip()
                if ref_val:
                    values[key] = ref_val
        except Exception:
            pass

    return values


def _next_feedback_record_result_id(db: Session) -> str:
    for _ in range(50):
        candidate = generate_short_id("rr")
        exists = db.execute(
            text("SELECT 1 FROM feedback_record_result WHERE record_result_id = :rid LIMIT 1"),
            {"rid": candidate},
        ).scalar()
        if not exists:
            return candidate
    raise RuntimeError("Unable to generate unique feedback_record_result.record_result_id")


def _semantic_question_version_id(db: Session, question_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT current_version_id
            FROM content_question
            WHERE question_id = :question_id
            LIMIT 1
            """
        ),
        {"question_id": question_id},
    ).scalar()
    return str(row) if row else None


def _select_ai_feedback_link_id(
    db: Session,
    *,
    question_version_id: str,
    selected_option_id: str | None,
) -> str | None:
    if selected_option_id:
        row = db.execute(
            text(
                """
                SELECT fl.feedback_link_id
                FROM feedback_link fl
                JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
                WHERE fl.question_version_id = :question_version_id
                  AND fl.target_entity_type = 'interaction_option'
                  AND fl.target_entity_id = :selected_option_id
                  AND fl.is_visible = TRUE
                  AND LOWER(TRIM(COALESCE(fa.role, ''))) = 'ai'
                ORDER BY fl.priority ASC, fl.created_at ASC
                LIMIT 1
                """
            ),
            {"question_version_id": question_version_id, "selected_option_id": selected_option_id},
        ).scalar()
        if row:
            return str(row)

    row = db.execute(
        text(
            """
            SELECT fl.feedback_link_id
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :question_version_id
              AND fl.target_entity_type = 'question_version'
              AND fl.target_entity_id = :question_version_id
              AND fl.is_visible = TRUE
              AND LOWER(TRIM(COALESCE(fa.role, ''))) = 'ai'
            ORDER BY fl.priority ASC, fl.created_at ASC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).scalar()
    if row:
        return str(row)

    row = db.execute(
        text(
            """
            SELECT fl.feedback_link_id
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :question_version_id
              AND fl.is_visible = TRUE
              AND LOWER(TRIM(COALESCE(fa.role, ''))) = 'ai'
            ORDER BY
              CASE WHEN fl.target_entity_type = 'question_version' THEN 0 ELSE 1 END ASC,
              fl.priority ASC,
              fl.created_at ASC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).scalar()
    return str(row) if row else None


def _resolve_prompt_from_feedback_link(
    db: Session,
    *,
    question_id: str,
    question_version_id: str,
    participant_id: str,
    answer_text: str,
) -> tuple[str | None, str | None]:
    selected_option_id = _resolve_mcq_selected_option_id(db, question_id, answer_text)
    feedback_link_id = _select_ai_feedback_link_id(
        db,
        question_version_id=question_version_id,
        selected_option_id=selected_option_id,
    )
    if not feedback_link_id:
        return None, None

    resolved = resolve_feedback_prompt_for_feedback_link(
        str(feedback_link_id),
        input_values={
            "answer_text": answer_text,
            "learner_id": participant_id,
            "question_id": question_id,
            "selected_option_id": selected_option_id,
        },
    )
    if not resolved.get("ok"):
        return None, None
    system_prompt = (
        str(resolved.get("resolved_system_prompt")) if resolved.get("resolved_system_prompt") is not None else None
    )
    user_prompt = str(resolved.get("resolved_user_text")) if resolved.get("resolved_user_text") is not None else None
    return system_prompt, user_prompt


def _ensure_feedback_record_result_prompt_columns(db: Session) -> None:
    db.execute(
        text(
            """
            ALTER TABLE feedback_record_result
            ADD COLUMN IF NOT EXISTS llm_system_prompt TEXT NULL,
            ADD COLUMN IF NOT EXISTS llm_user_prompt TEXT NULL
            """
        )
    )


def _ensure_feedback_record_result_composition_column(db: Session) -> None:
    db.execute(
        text(
            """
            ALTER TABLE feedback_record_result
            ADD COLUMN IF NOT EXISTS composition_id VARCHAR(64) NULL
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_record_result_participant_question_composition
            ON feedback_record_result (participant_id, question_id, composition_id)
            """
        )
    )


def _resolve_composition_scoring_config(
    db: Session,
    *,
    composition_id: str,
) -> tuple[bool, bool]:
    row = db.execute(
        text(
            """
            SELECT composition_id, is_visible
            FROM feedback_compositions
            WHERE composition_id = :composition_id
            LIMIT 1
            """
        ),
        {"composition_id": composition_id},
    ).mappings().first()
    if not row or not bool(row.get("is_visible", True)):
        return False, False

    has_scoring = "scoring" in str(composition_id).lower()
    return True, has_scoring


def _resolve_question_score_maximum(db: Session, *, question_id: str) -> float | None:
    if not question_id.startswith("qn_"):
        return None
    row = db.execute(
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
    if not row:
        return None
    raw = row.get("score_maximum")
    if raw is None:
        qtype = str(row.get("question_type") or "").strip().lower()
        if qtype == "single_choice":
            return 1.0
        if qtype in {"free_text", "essay"}:
            return 2.0
        return None
    try:
        return float(raw)
    except Exception:
        return None


def _feedback_record_result_timestamp_column(db: Session) -> str | None:
    cols = db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'feedback_record_result'
              AND table_schema = current_schema()
              AND column_name = ANY(CAST(:candidates AS text[]))
            """
        ),
        {"candidates": ["updated_at", "created_at", "submission_time"]},
    ).scalars().all()
    available = {str(c) for c in cols}
    for col in ("updated_at", "created_at", "submission_time"):
        if col in available:
            return col
    return None


def _to_iso_utc(value: datetime | None) -> str:
    dt = value or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


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


def _load_cached_runtime_prompt(
    db: Session,
    *,
    participant_id: str,
    question_id: str,
    answer_text: str | None,
) -> tuple[str | None, str | None]:
    _ensure_feedback_runtime_prompt_cache_schema(db)
    row = db.execute(
        text(
            """
            SELECT llm_system_prompt, llm_user_prompt, answer_text
            FROM feedback_runtime_prompt_cache
            WHERE participant_id = :participant_id
              AND question_id = :question_id
            LIMIT 1
            """
        ),
        {"participant_id": participant_id, "question_id": question_id},
    ).mappings().first()
    if not row:
        return None, None

    cached_answer = str(row["answer_text"]) if row.get("answer_text") is not None else None
    if answer_text is not None and cached_answer is not None and str(answer_text).strip() != cached_answer.strip():
        return None, None

    system_prompt = str(row["llm_system_prompt"]) if row.get("llm_system_prompt") is not None else None
    user_prompt = str(row["llm_user_prompt"]) if row.get("llm_user_prompt") is not None else None
    return system_prompt, user_prompt


def _attempt_lti_grade_passback(
    *,
    result: models.RecordResultModel,
    db: Session,
    settings: Settings,
) -> dict | None:
    try:
        mcq_score = _resolve_mcq_score(db, result.question_id, result.answer)
    except Exception as e:
        print(
            "[LTI_AUTO_GRADE_FROM_RECORD_SCORE_RESOLVE_ERROR] "
            + json.dumps(
                {
                    "error": str(e),
                    "question_id": result.question_id,
                    "learner_id": result.learner_id,
                    "lti_launch_id": getattr(result, "lti_launch_id", None),
                },
                ensure_ascii=True,
                default=str,
            )
        )
        mcq_score = None
    inferred_score_given = mcq_score[0] if mcq_score else None
    inferred_score_maximum = mcq_score[1] if mcq_score else None
    score_given = result.score_given if result.score_given is not None else inferred_score_given
    score_maximum = result.score_maximum if result.score_maximum is not None else inferred_score_maximum

    candidate_launch_ids = []
    explicit_lti_launch_id = (getattr(result, "lti_launch_id", None) or "").strip()
    if explicit_lti_launch_id:
        candidate_launch_ids.append(("record_result.lti_launch_id", explicit_lti_launch_id))

    normalized_learner_id = str(result.learner_id or "").strip()
    normalized_lti_user_id = str(getattr(result, "lti_user_id", "") or "").strip()

    if not candidate_launch_ids:
        print(
            "[LTI_AUTO_GRADE_FROM_RECORD_SKIP] "
            + json.dumps(
                {
                    "reason": "missing_lti_launch_id",
                    "learner_id": result.learner_id,
                    "question_id": result.question_id,
                    "session_id": getattr(result, "session_id", None),
                    "lti_launch_id": getattr(result, "lti_launch_id", None),
                    "lti_user_id": getattr(result, "lti_user_id", None),
                    "candidate_launch_ids": candidate_launch_ids,
                },
                ensure_ascii=True,
                default=str,
            )
        )
        return None

    last_result = None
    expected_sub = None
    if normalized_lti_user_id and normalized_lti_user_id.lower() not in _NON_LTI_LEARNER_SENTINELS:
        expected_sub = normalized_lti_user_id
    elif normalized_learner_id and normalized_learner_id.lower() not in _NON_LTI_LEARNER_SENTINELS:
        expected_sub = normalized_learner_id

    for source, launch_id in candidate_launch_ids:
        try:
            grade_result = try_submit_lti_grade_for_launch(
                launch_id=str(launch_id),
                settings=settings,
                score_given=score_given,
                score_maximum=score_maximum,
                ai_structure_feedback=result.feedback,
                comment=result.feedback,
                expected_sub=expected_sub,
            )
            print(
                "[LTI_AUTO_GRADE_FROM_RECORD] "
                + json.dumps(
                    {
                        "launch_id": str(launch_id),
                        "launch_id_source": source,
                        "learner_id": result.learner_id,
                        "lti_user_id": getattr(result, "lti_user_id", None),
                        "question_id": result.question_id,
                        "score_inferred": mcq_score is not None,
                        "score_explicit": result.score_given is not None,
                        "score_maximum_explicit": result.score_maximum is not None,
                        "score_given_used": score_given,
                        "score_maximum_used": score_maximum,
                        "expected_sub_used": expected_sub,
                        "candidate_launch_ids": candidate_launch_ids,
                        "result": grade_result,
                    },
                    ensure_ascii=True,
                    default=str,
                )
            )
            last_result = grade_result
            if grade_result.get("ok"):
                return grade_result
            if grade_result.get("reason") not in {"unknown_session", "learner_mismatch"}:
                return grade_result
        except Exception as e:
            error_payload = {
                "ok": False,
                "error": str(e),
                "launch_id": str(launch_id),
                "launch_id_source": source,
                "learner_id": result.learner_id,
                "question_id": result.question_id,
            }
            print("[LTI_AUTO_GRADE_FROM_RECORD_ERROR] " + json.dumps(error_payload, ensure_ascii=True, default=str))
            return error_payload

    return last_result


@router.post("/record_result")
def record_result(
    request: Request,
    result: models.RecordResultModel,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    try:
        req_lti = _extract_lti_context_from_request(request)
        if req_lti:
            print(
                "[LTI_RECORD_REQUEST_CONTEXT] "
                + json.dumps(
                    {
                        "lti_launch_id": req_lti.get("lti_launch_id"),
                        "lti_user_id": req_lti.get("lti_user_id"),
                        "referer_present": bool((request.headers.get("referer") or "").strip()),
                    },
                    ensure_ascii=True,
                    default=str,
                )
            )
            result = result.model_copy(
                update={
                    "lti_launch_id": result.lti_launch_id or req_lti.get("lti_launch_id"),
                    "lti_user_id": result.lti_user_id or req_lti.get("lti_user_id"),
                }
            )

        if not str(result.question_id).startswith("qn_"):
            raise HTTPException(
                status_code=410,
                detail="Legacy record_result table writes are removed. Provide a semantic question_id (qn_...).",
            )

        question_version_id = _semantic_question_version_id(db, result.question_id)
        if not question_version_id:
            raise HTTPException(status_code=400, detail="semantic question current_version_id not found")

        inferred_score = _resolve_mcq_score(db, result.question_id, result.answer)
        parsed_feedback_score, parsed_feedback_max = _extract_score_pair_from_feedback_text(result.feedback)
        score_given = (
            result.score_given
            if result.score_given is not None
            else (inferred_score[0] if inferred_score else parsed_feedback_score)
        )
        score_maximum = (
            result.score_maximum
            if result.score_maximum is not None
            else (inferred_score[1] if inferred_score else parsed_feedback_max)
        )
        _ensure_feedback_record_result_composition_column(db)
        previous_attempts = db.execute(
            text(
                """
                SELECT COUNT(*)::INT
                FROM feedback_record_result
                WHERE question_id = :question_id
                  AND participant_id = :participant_id
                  AND composition_id IS NOT DISTINCT FROM :composition_id
                """
            ),
            {
                "question_id": result.question_id,
                "participant_id": result.learner_id,
                "composition_id": result.composition_id,
            },
        ).scalar()
        attempt_count = int(previous_attempts or 0) + 1
        semantic_record_id = _next_feedback_record_result_id(db)
        _ensure_feedback_record_result_prompt_columns(db)
        rendered_prompt = result.rendered_prompt if isinstance(result.rendered_prompt, dict) else {}
        llm_system_prompt = result.llm_system_prompt or rendered_prompt.get("system_prompt")
        llm_user_prompt = result.llm_user_prompt or rendered_prompt.get("user_text") or rendered_prompt.get("user_prompt")
        if not llm_system_prompt and not llm_user_prompt:
            cached_system_prompt, cached_user_prompt = _load_cached_runtime_prompt(
                db,
                participant_id=result.learner_id,
                question_id=result.question_id,
                answer_text=result.answer,
            )
            llm_system_prompt = llm_system_prompt or cached_system_prompt
            llm_user_prompt = llm_user_prompt or cached_user_prompt
        if not llm_system_prompt and not llm_user_prompt:
            reconstructed_system, reconstructed_user = _resolve_prompt_from_feedback_link(
                db,
                question_id=result.question_id,
                question_version_id=question_version_id,
                participant_id=result.learner_id,
                answer_text=result.answer,
            )
            llm_system_prompt = llm_system_prompt or reconstructed_system
            llm_user_prompt = llm_user_prompt or reconstructed_user

        db.execute(
            text(
                """
                INSERT INTO feedback_record_result (
                    record_result_id,
                    participant_id,
                    question_id,
                    composition_id,
                    question_version_id,
                    answer_text,
                    attempt_count,
                    feedback_text,
                    structured_feedback_text,
                    score_given_raw,
                    score_given,
                    score_maximum,
                    preferred_info_type,
                    generation_strategy,
                    feedback_framework,
                    llm_system_prompt,
                    llm_user_prompt,
                    system_total_response_time_ms
                )
                VALUES (
                    :record_result_id,
                    :participant_id,
                    :question_id,
                    :composition_id,
                    :question_version_id,
                    :answer_text,
                    :attempt_count,
                    :feedback_text,
                    :structured_feedback_text,
                    :score_given_raw,
                    :score_given,
                    :score_maximum,
                    :preferred_info_type,
                    :generation_strategy,
                    :feedback_framework,
                    :llm_system_prompt,
                    :llm_user_prompt,
                    :system_total_response_time_ms
                )
                """
            ),
            {
                "record_result_id": semantic_record_id,
                "participant_id": result.learner_id,
                "question_id": result.question_id,
                "composition_id": result.composition_id,
                "question_version_id": question_version_id,
                "answer_text": result.answer,
                "attempt_count": attempt_count,
                "feedback_text": result.feedback,
                "structured_feedback_text": result.feedback,
                "score_given_raw": score_given,
                "score_given": score_given,
                "score_maximum": score_maximum,
                "preferred_info_type": result.preferred_info_type,
                "generation_strategy": result.prompt_engineering_method,
                "feedback_framework": result.feedback_framework,
                "llm_system_prompt": llm_system_prompt,
                "llm_user_prompt": llm_user_prompt,
                "system_total_response_time_ms": result.system_total_response_time,
            },
        )
        db.commit()
        created_record_id: str = semantic_record_id

        try:
            lti_grade = _attempt_lti_grade_passback(
                result=result,
                db=db,
                settings=settings,
            )
        except Exception as e:
            print(
                "[LTI_AUTO_GRADE_FROM_RECORD_UNCAUGHT_ERROR] "
                + json.dumps(
                    {
                        "error": str(e),
                        "question_id": result.question_id,
                        "learner_id": result.learner_id,
                        "lti_launch_id": getattr(result, "lti_launch_id", None),
                    },
                    ensure_ascii=True,
                    default=str,
                )
            )
            lti_grade = {"ok": False, "error": str(e)}

        response = {"id": created_record_id, "message": "Record created successfully"}
        if lti_grade is not None:
            response["lti_grade"] = lti_grade
        return response

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error recording result: {str(e)}")


@router.get("/submission-stats")
def get_submission_stats(
    learner_id: str | None = Query(default=None),
    question_id: str | None = Query(default=None),
    composition_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if not learner_id or not str(learner_id).strip():
        raise HTTPException(status_code=400, detail={"code": "INVALID_PARAMS", "message": "learner_id is required"})
    if not question_id or not str(question_id).strip():
        raise HTTPException(status_code=400, detail={"code": "INVALID_PARAMS", "message": "question_id is required"})
    if not composition_id or not str(composition_id).strip():
        raise HTTPException(status_code=400, detail={"code": "INVALID_PARAMS", "message": "composition_id is required"})

    normalized_learner_id = str(learner_id).strip()
    normalized_question_id = str(question_id).strip()
    normalized_composition_id = str(composition_id).strip()

    try:
        _ensure_feedback_record_result_composition_column(db)

        exists, has_scoring = _resolve_composition_scoring_config(
            db,
            composition_id=normalized_composition_id,
        )
        if not exists:
            raise HTTPException(
                status_code=404,
                detail={"code": "COMPOSITION_NOT_FOUND", "message": "composition not found"},
            )

        timestamp_col = _feedback_record_result_timestamp_column(db)
        ts_select = f"MAX({timestamp_col}) AS latest_ts," if timestamp_col else "NULL::timestamp AS latest_ts,"
        stats_row = db.execute(
            text(
                f"""
                SELECT
                  COUNT(*)::INT AS attempt_count,
                  MAX(score_given) AS best_score,
                  MAX(score_maximum) AS best_score_max,
                  {ts_select}
                  NOW() AS now_ts
                FROM feedback_record_result
                WHERE participant_id = :learner_id
                  AND question_id = :question_id
                  AND composition_id = :composition_id
                """
            ),
            {
                "learner_id": normalized_learner_id,
                "question_id": normalized_question_id,
                "composition_id": normalized_composition_id,
            },
        ).mappings().first()
        first_attempt_row = db.execute(
            text(
                """
                SELECT
                  MAX(score_given) AS score_given,
                  MAX(score_maximum) AS score_maximum
                FROM feedback_record_result
                WHERE participant_id = :learner_id
                  AND question_id = :question_id
                  AND composition_id = :composition_id
                  AND attempt_count = (
                    SELECT MIN(fr2.attempt_count)
                    FROM feedback_record_result fr2
                    WHERE fr2.participant_id = :learner_id
                      AND fr2.question_id = :question_id
                      AND fr2.composition_id = :composition_id
                      AND fr2.attempt_count IS NOT NULL
                  )
                """
            ),
            {
                "learner_id": normalized_learner_id,
                "question_id": normalized_question_id,
                "composition_id": normalized_composition_id,
            },
        ).mappings().first()
        latest_attempt_order_by = "attempt_count DESC, record_result_id DESC"
        if timestamp_col:
            latest_attempt_order_by = f"attempt_count DESC, {timestamp_col} DESC, record_result_id DESC"
        latest_attempt_row = db.execute(
            text(
                f"""
                SELECT score_given, score_maximum
                FROM feedback_record_result
                WHERE participant_id = :learner_id
                  AND question_id = :question_id
                  AND composition_id = :composition_id
                ORDER BY {latest_attempt_order_by}
                LIMIT 1
                """
            ),
            {
                "learner_id": normalized_learner_id,
                "question_id": normalized_question_id,
                "composition_id": normalized_composition_id,
            },
        ).mappings().first()

        attempt_count = int((stats_row or {}).get("attempt_count") or 0)
        best_score_raw = (stats_row or {}).get("best_score")
        best_score_max_raw = (stats_row or {}).get("best_score_max")
        first_attempt_score_raw = (first_attempt_row or {}).get("score_given")
        first_attempt_score_max_raw = (first_attempt_row or {}).get("score_maximum")
        latest_attempt_score_raw = (latest_attempt_row or {}).get("score_given")
        latest_attempt_score_max_raw = (latest_attempt_row or {}).get("score_maximum")
        updated_at_value = (stats_row or {}).get("latest_ts") or (stats_row or {}).get("now_ts")
        best_score_max = float(best_score_max_raw) if best_score_max_raw is not None else None
        first_attempt_score = float(first_attempt_score_raw) if first_attempt_score_raw is not None else None
        first_attempt_score_max = (
            float(first_attempt_score_max_raw) if first_attempt_score_max_raw is not None else None
        )
        latest_attempt_score = float(latest_attempt_score_raw) if latest_attempt_score_raw is not None else None
        latest_attempt_score_max = (
            float(latest_attempt_score_max_raw) if latest_attempt_score_max_raw is not None else None
        )
        max_attempts = 3 if has_scoring else None
        attempt_time_limit_seconds = None
        question_score_maximum = _resolve_question_score_maximum(db, question_id=normalized_question_id)
        resolved_max_score = question_score_maximum
        remaining_attempts = None
        if max_attempts is not None:
            remaining_attempts = max(int(max_attempts) - max(attempt_count, 0), 0)

        return {
            "learner_id": normalized_learner_id,
            "question_id": normalized_question_id,
            "composition_id": normalized_composition_id,
            "attempt_count": max(attempt_count, 0),
            "attempted_count": max(attempt_count, 0),
            "max_attempts": max_attempts,
            "remaining_attempts": remaining_attempts,
            "is_unlimited": (not has_scoring),
            "best_score": (float(best_score_raw) if best_score_raw is not None else None),
            "best_score_max": resolved_max_score,
            "first_attempt_score": first_attempt_score,
            "firstAttemptScore": first_attempt_score,
            "first_attempt_score_max": (resolved_max_score if first_attempt_score is not None else first_attempt_score_max),
            "latest_score": latest_attempt_score,
            "latestScore": latest_attempt_score,
            "final_score": latest_attempt_score,
            "finalScore": latest_attempt_score,
            "latest_score_max": (resolved_max_score if latest_attempt_score is not None else latest_attempt_score_max),
            "max_score": resolved_max_score,
            "maxScore": resolved_max_score,
            "score_maximum": resolved_max_score,
            "attempt_time_limit_seconds": attempt_time_limit_seconds,
            "attempt_time_limit": attempt_time_limit_seconds,
            "attemptTimeLimit": attempt_time_limit_seconds,
            "updated_at": _to_iso_utc(updated_at_value),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_SERVER_ERROR", "message": str(exc)},
        ) from exc


@router.post("/record_result/{record_id}/audio-usage")
def log_audio_narration_usage(record_id: str, _payload: models.AudioNarrationUsageEvent, _db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=410,
        detail="Legacy audio_narration_usage endpoint is removed and has no semantic-table replacement yet.",
    )


@router.put("/record_result/{record_id}/rating")
def update_rating(record_id: str, _rating_update: models.UpdateRatingModel, _db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=410,
        detail="Legacy record_result rating endpoint is removed and has no semantic-table replacement yet.",
    )
