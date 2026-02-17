from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from ..database import SessionLocal
from ..config import Settings, get_settings
from typing_extensions import Annotated
from .controllers_mcq.feedback.rag_cot_mcq import (
    generate_all_feedback_for_mcq,
    get_mcq_ai_feedback_for_option,
    get_mcq_human_feedback_for_option
)
from ..schema.questionSchema import Question
import uuid

router = APIRouter(prefix="/api/v2/mcq", tags=["Feedback / MCQ (v2)"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Request/Response Models
class MCQFeedbackGenerationRequest(BaseModel):
    question_id: str
    participant_id: str
    question_content: List[Dict[str, Any]]
    options: List[Dict[str, Any]]  # [{text: str, isCorrect: bool}]
    mcq_human_feedback: Optional[List[str]] = None
    slide_ids: Optional[List[str]] = None
    course_version: Optional[str] = None

class MCQFeedbackRetrievalRequest(BaseModel):
    question_id: str
    participant_id: str
    selected_option_index: int
    course_version: Optional[str] = None

class MCQHumanFeedbackRequest(BaseModel):
    question_id: str
    selected_option_index: int

class MCQFeedbackResponse(BaseModel):
    feedback: str
    isCorrect: bool
    feedbackType: str
    attemptCount: Optional[int] = None
    structured_feedback: Optional[str] = None

@router.post("/generate_feedback")
async def generate_mcq_feedback(
    request: MCQFeedbackGenerationRequest,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Generate AI feedback for all MCQ options.
    This should be called after a question is created.
    """
    try:
        # Validate question exists
        question = db.query(Question).filter(Question.question_id == request.question_id).first()
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")
        
        # Generate feedback for all options
        feedback_results = await generate_all_feedback_for_mcq(
            question_id=request.question_id,
            question_content=request.question_content,
            options=request.options,
            mcq_human_feedback=request.mcq_human_feedback,
            slide_ids=request.slide_ids or [],
            settings=settings,
            db=db
        )
        
        # Update question with generated AI feedback
        question.mcq_ai_feedback = feedback_results
        db.commit()
        
        return {
            "status": "success",
            "message": "Feedback generated successfully",
            "feedback_data": feedback_results
        }
        
    except Exception as e:
        print(f"Error generating MCQ feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/get_ai_feedback", response_model=MCQFeedbackResponse)
def get_mcq_ai_feedback(
    request: MCQFeedbackRetrievalRequest,
    db: Session = Depends(get_db)
) -> MCQFeedbackResponse:
    """
    Get AI-generated feedback for a selected MCQ option.
    Returns error if no AI feedback is available.
    """
    try:
        result = get_mcq_ai_feedback_for_option(
            question_id=request.question_id,
            participant_id=request.participant_id,
            selected_option_index=request.selected_option_index,
            course_version=request.course_version,
            db=db
        )
        
        # Check for errors
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        
        return MCQFeedbackResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error retrieving MCQ AI feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/get_human_feedback")
def get_mcq_human_feedback(
    request: MCQHumanFeedbackRequest,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get human-provided feedback for a selected MCQ option.
    Returns error if no human feedback is available.
    """
    try:
        result = get_mcq_human_feedback_for_option(
            question_id=request.question_id,
            selected_option_index=request.selected_option_index,
            db=db
        )
        
        # Check for errors
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error retrieving MCQ human feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/get_latest_feedback/{question_id}/{participant_id}")
def get_latest_participant_feedback(
    question_id: str,
    participant_id: str,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get the latest feedback for a participant for a specific question.
    This retrieves from the RecordResult table, not from cache.
    Also includes reference material information.
    """
    from ..schema.resultSchema import RecordResult
    
    try:
        # Query the latest feedback from RecordResult table
        latest_record = db.query(RecordResult).filter(
            RecordResult.learner_id == participant_id,
            RecordResult.question_id == question_id
        ).order_by(RecordResult.submission_time.desc()).first()
        
        if not latest_record:
            return {
                "hasLatestFeedback": False,
                "feedback": None,
                "answer": None,
                "submission_time": None
            }
        
        # Parse the answer to get the selected option index if it's an MCQ answer
        selected_option_text = latest_record.answer
        
        # Get the question to find the option index
        from ..schema.questionSchema import Question
        question = db.query(Question).filter(Question.question_id == question_id).first()
        
        selected_option_index = -1
        is_correct = False
        if question and question.options:
            for idx, option in enumerate(question.options):
                option_text = option.get("text") if isinstance(option, dict) else option
                if option_text == selected_option_text:
                    selected_option_index = idx
                    is_correct = option.get("isCorrect", False) if isinstance(option, dict) else False
                    break
        
        return {
            "hasLatestFeedback": True,
            "feedback": latest_record.feedback,
            "answer": latest_record.answer,
            "selectedOptionIndex": selected_option_index,
            "isCorrect": is_correct,
            "submission_time": latest_record.submission_time.isoformat() if latest_record.submission_time else None,
            "prompt_engineering_method": latest_record.prompt_engineering_method,
            "feedback_framework": latest_record.feedback_framework,
            # Reference material data from the record
            "reference_slide_id": latest_record.reference_slide_id,
            "reference_slide_content": latest_record.reference_slide_content,
            "reference_slide_page_number": latest_record.reference_slide_page_number,
            "preferred_info_type": latest_record.preferred_info_type,
            "slide_retrieval_range": latest_record.slide_retrieval_range
        }
        
    except Exception as e:
        print(f"Error retrieving latest participant feedback: {e}")
        return {
            "hasLatestFeedback": False,
            "error": str(e)
        }

@router.get("/health")
def health_check():
    """Health check endpoint for MCQ service"""
    return {"status": "healthy", "service": "mcq_feedback"}