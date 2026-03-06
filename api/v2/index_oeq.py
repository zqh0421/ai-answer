from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing_extensions import Annotated
from sqlalchemy.orm import Session
from sqlalchemy import text
import json

from ..database import SessionLocal
from ..config import Settings, get_settings
from ..models import FeedbackRequestRagModel
from ..schema.questionSchema import Question

from .controllers_oeq import (
    generate_feedback_using_rag_cot_oeq,
    generate_feedback_using_rag_cot_stream_oeq
)

# Create router for OEQ endpoints
router = APIRouter(prefix="/api/v2", tags=["Feedback / OEQ (v2)"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_feedback_json(feedback: str) -> dict:
    try:
        parsed = json.loads(feedback)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'```json\s*(\{.*?\})\s*```', feedback, re.DOTALL)
        if not json_match:
            return {}
        try:
            parsed = json.loads(json_match.group(1))
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

@router.post("/generate_feedback_rag_oeq")
async def generate_feedback_rag_oeq(request: FeedbackRequestRagModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    """
    OEQ-specific feedback generation endpoint (supports rag_cot)
    """
    if request.promptEngineering == "rag_cot":
        return await _generate_feedback_rag_cot_oeq_impl(request, settings, db)
    else:
        raise HTTPException(status_code=400, detail="This endpoint only supports rag_cot prompt engineering method")

async def _generate_feedback_rag_cot_oeq_impl(request: FeedbackRequestRagModel, settings: Annotated[Settings, Depends(get_settings)], db: Session):
    """
    OEQ-specific RAG COT feedback generation endpoint
    """
    if request.promptEngineering != "rag_cot":
        raise HTTPException(status_code=400, detail="This endpoint only supports rag_cot prompt engineering method")
    
    feedback = generate_feedback_using_rag_cot_oeq(
        request.participant_id, 
        request.question_id, 
        request.question, 
        request.answer, 
        request.slide_text_arr, 
        request.feedbackFramework, 
        request.isStructured, 
        request.course_version, 
        settings, 
        db
    )

    parsed_feedback = _parse_feedback_json(feedback)
    if request.isStructured:
        if parsed_feedback:
            return {
                "score": parsed_feedback.get("score", ""),
                "max_score": parsed_feedback.get("max_score", ""),
                "structured_feedback": parsed_feedback.get("structured_feedback", parsed_feedback.get("feedback", "")),
            }
        return {"score": "", "max_score": "", "structured_feedback": feedback}

    if parsed_feedback:
        return {
            "score": parsed_feedback.get("score", ""),
            "max_score": parsed_feedback.get("max_score", ""),
            "text_feedback": parsed_feedback.get("text_feedback", parsed_feedback.get("feedback", "")),
        }
    return {"score": "", "max_score": "", "text_feedback": feedback}

@router.post("/generate_feedback_rag_stream_oeq")
async def generate_feedback_rag_stream_oeq(request: FeedbackRequestRagModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    """
    OEQ-specific streaming feedback generation endpoint (supports rag_cot)
    """
    if request.promptEngineering == "rag_cot":
        return await _generate_feedback_rag_cot_stream_oeq_impl(request, settings, db)
    else:
        raise HTTPException(status_code=400, detail="This endpoint only supports rag_cot prompt engineering method")

async def _generate_feedback_rag_cot_stream_oeq_impl(request: FeedbackRequestRagModel, settings: Annotated[Settings, Depends(get_settings)], db: Session):
    """
    OEQ-specific streaming RAG COT feedback generation endpoint
    """
    if request.promptEngineering != "rag_cot":
        raise HTTPException(status_code=400, detail="This endpoint only supports rag_cot prompt engineering method")
    
    def event_generator():
        try:
            for chunk in generate_feedback_using_rag_cot_stream_oeq(
                request.participant_id, 
                request.question_id, 
                request.question, 
                request.answer, 
                request.slide_text_arr, 
                request.feedbackFramework, 
                request.isStructured, 
                request.course_version,
                settings,
                db
            ):
                yield chunk
                
        except Exception as e:
            yield f"data: Error generating feedback: {str(e)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    )

@router.get("/get_human_feedback_oeq/{question_id}")
def get_human_feedback_oeq(question_id: str, db: Session = Depends(get_db)):
    """
    Get human-provided feedback for an OEQ question.
    Returns error if no human feedback is available.
    """
    try:
        if question_id.startswith("qn_"):
            exists = db.execute(
                text("SELECT 1 FROM content_question WHERE question_id = :qid LIMIT 1"),
                {"qid": question_id},
            ).scalar()
            if not exists:
                raise HTTPException(status_code=404, detail=f"Question with ID {question_id} not found")
            raise HTTPException(status_code=404, detail=f"No human feedback available for question {question_id}")

        question = db.query(Question).filter(Question.question_id == question_id).first()
        
        if not question:
            raise HTTPException(status_code=404, detail=f"Question with ID {question_id} not found")
        
        if question.human_feedback is None or question.human_feedback.strip() == "":
            raise HTTPException(status_code=404, detail=f"No human feedback available for question {question_id}")
        
        return {"human_feedback": question.human_feedback}
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error retrieving human feedback for question {question_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
