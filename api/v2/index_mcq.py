from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
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
from ..services.feedback_composition_expr import CompositionExprError, compile_condition_expression
from ..services.feedback_link_generation_jobs import generate_static_feedback_for_feedback_link
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
    composition_id: Optional[str] = None
    learner_id: Optional[str] = None

class MCQHumanFeedbackRequest(BaseModel):
    question_id: str
    selected_option_index: int

class MCQFeedbackResponse(BaseModel):
    feedback: str
    isCorrect: bool
    feedbackType: str
    attemptCount: Optional[int] = None
    structured_feedback: Optional[str] = None


def _semantic_question_exists(db: Session, question_id: str) -> bool:
    return bool(
        db.execute(
            text("SELECT 1 FROM content_question WHERE question_id = :question_id LIMIT 1"),
            {"question_id": question_id},
        ).scalar()
    )


def _semantic_mcq_options(db: Session, question_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT o.option_value, o.option_label, o.is_correct
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
    return [
        {
            "text": str(r["option_value"] or ""),
            "label": str(r["option_label"] or ""),
            "isCorrect": bool(r["is_correct"]),
        }
        for r in rows
    ]


def _resolve_attempt_stats(db: Session, learner_id: str, question_id: str) -> dict[str, int]:
    if question_id.startswith("qn_"):
        row = db.execute(
            text(
                """
                SELECT
                  COUNT(*)::INT AS attempted_count,
                  COALESCE(SUM(
                    CASE
                      WHEN COALESCE(score_maximum, 0) > 0
                       AND COALESCE(score_given, 0) >= COALESCE(score_maximum, 0)
                      THEN 1 ELSE 0 END
                  ), 0)::INT AS correct_count
                FROM feedback_record_result
                WHERE question_id = :question_id AND participant_id = :learner_id
                """
            ),
            {"question_id": question_id, "learner_id": learner_id},
        ).mappings().first()
        attempted = int(row["attempted_count"] or 0) if row else 0
        correct = int(row["correct_count"] or 0) if row else 0
        return {
            "attempted_count": attempted,
            "correct_count": correct,
            "wrong_count": max(attempted - correct, 0),
        }

    attempted = db.execute(
        text(
            """
            SELECT COUNT(*)::INT AS attempted_count
            FROM record_result
            WHERE question_id = :question_id AND learner_id = :learner_id
            """
        ),
        {"question_id": question_id, "learner_id": learner_id},
    ).scalar()
    attempted_count = int(attempted or 0)
    return {
        "attempted_count": attempted_count,
        "correct_count": 0,
        "wrong_count": attempted_count,
    }


def _resolve_composition_mode(
    db: Session,
    *,
    composition_id: str,
    question_id: str,
    learner_id: str,
) -> dict[str, Any] | None:
    comp = db.execute(
        text(
            """
            SELECT composition_id, question_id, is_visible
            FROM feedback_compositions
            WHERE composition_id = :composition_id
            """
        ),
        {"composition_id": composition_id},
    ).mappings().first()
    if not comp or not bool(comp["is_visible"]):
        return None
    bound_qid = comp["question_id"]
    if bound_qid and str(bound_qid) != question_id:
        return None

    rules = db.execute(
        text(
            """
            SELECT
              rule_id, rule_order, condition_expression, feedback_mode, feedback_agent_id, slide_mode, is_enabled
            FROM feedback_composition_rules
            WHERE composition_id = :composition_id
            ORDER BY rule_order ASC, rule_id ASC
            """
        ),
        {"composition_id": composition_id},
    ).mappings().all()
    context = _resolve_attempt_stats(db, learner_id=learner_id, question_id=question_id)
    for row in rules:
        if not bool(row["is_enabled"]):
            continue
        try:
            compiled = compile_condition_expression(str(row["condition_expression"]))
            if compiled.evaluate(context):
                return {
                    "matched_rule_id": str(row["rule_id"]),
                    "feedback_mode": str(row["feedback_mode"]),
                    "feedback_agent_id": str(row["feedback_agent_id"]),
                    "slide_mode": str(row["slide_mode"]),
                    "variables": context,
                }
        except CompositionExprError:
            continue
    return {
        "matched_rule_id": None,
        "feedback_mode": None,
        "feedback_agent_id": None,
        "slide_mode": None,
        "variables": context,
    }


def _semantic_static_feedback_for_option(
    db: Session,
    *,
    question_id: str,
    agent_id: str,
    selected_option_index: int,
) -> tuple[str | None, bool | None]:
    options = db.execute(
        text(
            """
            SELECT o.interaction_option_id, o.is_correct
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
    if selected_option_index < 0 or selected_option_index >= len(options):
        return None, None
    target_option_id = str(options[selected_option_index]["interaction_option_id"])
    is_correct = bool(options[selected_option_index]["is_correct"])

    feedback_link_id: str | None = None

    row = db.execute(
        text(
            """
            SELECT fl.feedback_link_id, fl.static_feedback_text
            FROM content_question q
            JOIN feedback_link fl ON fl.question_version_id = q.current_version_id
            WHERE q.question_id = :question_id
              AND fl.agent_id = :agent_id
              AND fl.target_entity_type = 'interaction_option'
              AND fl.target_entity_id = :target_option_id
              AND fl.is_visible = TRUE
            ORDER BY fl.priority ASC, fl.created_at ASC
            LIMIT 1
            """
        ),
        {"question_id": question_id, "agent_id": agent_id, "target_option_id": target_option_id},
    ).mappings().first()
    if row:
        feedback_link_id = str(row["feedback_link_id"])
        if row.get("static_feedback_text"):
            return str(row["static_feedback_text"]), is_correct

    fallback = db.execute(
        text(
            """
            SELECT fl.feedback_link_id, fl.static_feedback_text
            FROM content_question q
            JOIN feedback_link fl ON fl.question_version_id = q.current_version_id
            WHERE q.question_id = :question_id
              AND fl.agent_id = :agent_id
              AND fl.target_entity_type = 'question_version'
              AND fl.is_visible = TRUE
            ORDER BY fl.priority ASC, fl.created_at ASC
            LIMIT 1
            """
        ),
        {"question_id": question_id, "agent_id": agent_id},
    ).mappings().first()
    if fallback:
        feedback_link_id = str(fallback["feedback_link_id"])
        if fallback.get("static_feedback_text"):
            return str(fallback["static_feedback_text"]), is_correct

    # use_latest_version fallback: if saved static feedback is missing, generate at runtime.
    if feedback_link_id:
        try:
            generated = generate_static_feedback_for_feedback_link(
                feedback_link_id,
                persist=False,
                enforce_ai_role=True,
                include_debug=False,
            )
            if generated.get("ok"):
                runtime_text = str(generated.get("static_feedback_text") or "").strip()
                if runtime_text:
                    return runtime_text, is_correct
        except Exception:
            pass

    return None, is_correct

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
        question = None
        is_semantic = request.question_id.startswith("qn_")
        if is_semantic:
            if not _semantic_question_exists(db, request.question_id):
                raise HTTPException(status_code=404, detail="Question not found")
        else:
            question = db.query(Question).filter(Question.question_id == request.question_id).first()
        if not is_semantic and not question:
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
        
        # Legacy UUID question persists AI feedback on question table.
        # Semantic qn_ questions do not persist in legacy table.
        if not is_semantic and question is not None:
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
        # Optional composition-aware dispatch: if mode resolves to use_latest_version,
        # return saved/static feedback instead of AI runtime feedback.
        if request.composition_id:
            resolved = _resolve_composition_mode(
                db,
                composition_id=request.composition_id,
                question_id=request.question_id,
                learner_id=request.learner_id or request.participant_id,
            )
            if resolved and resolved.get("feedback_mode") == "use_latest_version":
                agent_id = resolved.get("feedback_agent_id")
                if request.question_id.startswith("qn_") and agent_id:
                    feedback_text, is_correct = _semantic_static_feedback_for_option(
                        db,
                        question_id=request.question_id,
                        agent_id=str(agent_id),
                        selected_option_index=request.selected_option_index,
                    )
                    if feedback_text:
                        return MCQFeedbackResponse(
                            feedback=feedback_text,
                            isCorrect=bool(is_correct),
                            feedbackType="human",
                            structured_feedback=feedback_text,
                        )
                # Legacy fallback for UUID questions.
                human = get_mcq_human_feedback_for_option(
                    question_id=request.question_id,
                    selected_option_index=request.selected_option_index,
                    db=db,
                )
                if "error" not in human:
                    return MCQFeedbackResponse(
                        feedback=str(human.get("feedback", "")),
                        isCorrect=bool(human.get("isCorrect", False)),
                        feedbackType="human",
                        structured_feedback=str(human.get("structured_feedback") or human.get("feedback") or ""),
                    )

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
        
        # Get options for selected option index resolution
        question = None
        options: list[dict[str, Any]] = []
        if question_id.startswith("qn_"):
            options = _semantic_mcq_options(db, question_id)
        else:
            from ..schema.questionSchema import Question

            question = db.query(Question).filter(Question.question_id == question_id).first()
            if question and isinstance(question.options, list):
                options = list(question.options)

        selected_option_index = -1
        is_correct = False
        if options:
            for idx, option in enumerate(options):
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
