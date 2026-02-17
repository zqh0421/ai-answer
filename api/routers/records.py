from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schema
from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_RECORDS])


@router.post("/record_result")
def record_result(result: models.RecordResultModel, db: Session = Depends(get_db)):
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

        return {"id": db_result.id, "message": "Record created successfully"}

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
