import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schema
from ..config import Settings, get_settings
from ..dependencies import get_db
from ..tags import Tags
from ..schema.questionSchema import Question
from ..lti.routes import try_submit_lti_grade_for_launch, find_latest_lti_launch_id_for_learner

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_RECORDS])


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


def _attempt_lti_grade_passback(
    *,
    result: models.RecordResultModel,
    db: Session,
    settings: Settings,
) -> dict | None:
    mcq_score = _resolve_mcq_score(db, result.question_id, result.answer)
    score_given = mcq_score[0] if mcq_score else None
    score_maximum = mcq_score[1] if mcq_score else None

    candidate_launch_ids = []
    if getattr(result, "session_id", None):
        candidate_launch_ids.append(("record_result.session_id", str(result.session_id)))

    fallback_launch_id = find_latest_lti_launch_id_for_learner(result.learner_id)
    if fallback_launch_id and fallback_launch_id not in [cid for _, cid in candidate_launch_ids]:
        candidate_launch_ids.append(("learner_fallback", fallback_launch_id))

    if not candidate_launch_ids:
        print(
            "[LTI_AUTO_GRADE_FROM_RECORD_SKIP] "
            + json.dumps(
                {
                    "reason": "no_launch_id_and_no_learner_match",
                    "learner_id": result.learner_id,
                    "question_id": result.question_id,
                    "session_id": getattr(result, "session_id", None),
                },
                ensure_ascii=True,
                default=str,
            )
        )
        return None

    last_result = None
    for source, launch_id in candidate_launch_ids:
        try:
            grade_result = try_submit_lti_grade_for_launch(
                launch_id=str(launch_id),
                settings=settings,
                score_given=score_given,
                score_maximum=score_maximum,
                ai_structure_feedback=result.feedback,
                comment=result.feedback,
                expected_sub=result.learner_id,
            )
            print(
                "[LTI_AUTO_GRADE_FROM_RECORD] "
                + json.dumps(
                    {
                        "launch_id": str(launch_id),
                        "launch_id_source": source,
                        "learner_id": result.learner_id,
                        "question_id": result.question_id,
                        "score_inferred": mcq_score is not None,
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
    result: models.RecordResultModel,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    try:
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


@router.get("/record_result/count/{question_id}")
def get_record_count(question_id: str, learner_id: str = None, db: Session = Depends(get_db)):
    try:
        query = db.query(schema.RecordResult).filter(schema.RecordResult.question_id == question_id)

        if learner_id:
            query = query.filter(schema.RecordResult.learner_id == learner_id)

        count = query.count()
        return {"question_id": question_id, "learner_id": learner_id, "record_count": count}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error getting record count: {str(e)}")
