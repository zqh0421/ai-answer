import json
from urllib.parse import parse_qsl, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models, schema
from ..config import Settings, get_settings
from ..dependencies import get_db
from ..tags import Tags
from ..schema.questionSchema import Question
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


def _resolve_mcq_score(db: Session, question_id: str, answer: str) -> tuple[float, float] | None:
    question = db.query(Question).filter(Question.question_id == question_id).first()
    if not question:
        return None
    options = question.options or []
    if not isinstance(options, list):
        return None

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


def _attempt_lti_grade_passback(
    *,
    result: models.RecordResultModel,
    db: Session,
    settings: Settings,
) -> dict | None:
    mcq_score = _resolve_mcq_score(db, result.question_id, result.answer)
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

        record_data = {
            "learner_id": result.learner_id,
            "study_id": result.study_id,
            "session_id": result.session_id,
            "question_id": result.question_id,
            "answer": result.answer,
            "preferred_info_type": result.preferred_info_type,
            "prompt_engineering_method": result.prompt_engineering_method,
            "feedback_framework": result.feedback_framework,
            "feedback": result.feedback,
            "system_total_response_time": result.system_total_response_time,
            "submission_time": result.submission_time,
        }

        if result.reference_slide_id:
            record_data.update(
                {
                    "reference_slide_id": result.reference_slide_id,
                    "reference_slide_content": result.reference_slide_content,
                    "reference_slide_page_number": result.reference_slide_page_number,
                    "slide_retrieval_range": result.slide_retrieval_range,
                }
            )

        db_result = schema.RecordResult(**record_data)
        db.add(db_result)
        db.commit()
        db.refresh(db_result)

        lti_grade = _attempt_lti_grade_passback(
            result=result,
            db=db,
            settings=settings,
        )

        response = {"id": db_result.id, "message": "Record created successfully"}
        if lti_grade is not None:
            response["lti_grade"] = lti_grade
        return response

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error recording result: {str(e)}")


@router.post("/record_result/{record_id}/audio-usage")
def log_audio_narration_usage(record_id: int, payload: models.AudioNarrationUsageEvent, db: Session = Depends(get_db)):
    try:
        db_record = db.query(schema.RecordResult).filter(schema.RecordResult.id == record_id).first()
        if not db_record:
            raise HTTPException(status_code=404, detail="Record not found")

        if payload.action == "start":
            usage = schema.AudioNarrationUsage(
                record_result_id=record_id,
                session_id=payload.session_id,
                started_at=payload.timestamp,
            )
            db.add(usage)
            db.commit()
            db.refresh(usage)
            return {"usage_id": usage.id, "message": "Audio narration started"}

        if payload.action == "stop":
            query = db.query(schema.AudioNarrationUsage).filter(
                schema.AudioNarrationUsage.record_result_id == record_id,
                schema.AudioNarrationUsage.session_id == payload.session_id,
                schema.AudioNarrationUsage.ended_at.is_(None),
            )

            if payload.usage_id is not None:
                query = query.filter(schema.AudioNarrationUsage.id == payload.usage_id)

            usage = query.order_by(schema.AudioNarrationUsage.started_at.desc()).first()

            if not usage:
                raise HTTPException(status_code=404, detail="Active audio narration session not found")

            usage.ended_at = payload.timestamp
            db.commit()
            db.refresh(usage)
            return {"usage_id": usage.id, "message": "Audio narration stopped"}

        raise HTTPException(status_code=400, detail="Unsupported action")

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error logging audio narration usage: {str(e)}")


@router.put("/record_result/{record_id}/rating")
def update_rating(record_id: int, rating_update: models.UpdateRatingModel, db: Session = Depends(get_db)):
    try:
        db_record = db.query(schema.RecordResult).filter(schema.RecordResult.id == record_id).first()
        if not db_record:
            raise HTTPException(status_code=404, detail="Record not found")

        db_record.rating = rating_update.rating
        db.commit()

        return {"message": "Rating updated successfully", "rating": rating_update.rating}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error updating rating: {str(e)}")

