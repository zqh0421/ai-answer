import json
import re
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from .. import schema
from ..config import Settings, get_settings
from ..concurrency import run_openai_blocking
from ..controllers import (
    generate_feedback_using_zero,
    generate_feedback_using_few,
    generate_feedback_using_rag_zero,
    generate_feedback_using_rag_few,
    generate_feedback_using_rag_cot,
)
from ..controllers.feedback.rag_cot import generate_feedback_using_rag_cot_stream
from ..dependencies import get_db
from ..models import FeedbackRequestModel, FeedbackRequestRagModel
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.FEEDBACK_CORE_V1])


@router.post("/generate_feedback")
async def generate_feedback(request: FeedbackRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    if request.promptEngineering == "zero":
        feedback = await run_openai_blocking(
            generate_feedback_using_zero,
            request.question,
            request.answer,
            request.feedbackFramework,
            settings,
        )
    elif request.promptEngineering == "few":
        feedback = await run_openai_blocking(
            generate_feedback_using_few,
            request.question,
            request.answer,
            request.feedbackFramework,
            settings,
        )
    else:
        feedback = "Generate Feedback Error: Invalid Request."
    return {"feedback": feedback}


@router.post("/generate_feedback_rag")
async def generate_feedback_rag(
    request: FeedbackRequestRagModel,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Session = Depends(get_db),
):
    feedback = ""
    if request.promptEngineering == "rag_zero":
        feedback = await run_openai_blocking(
            generate_feedback_using_rag_zero,
            request.question,
            request.answer,
            request.slide_text_arr,
            request.feedbackFramework,
            settings,
        )
    elif request.promptEngineering == "rag_few":
        feedback = await generate_feedback_using_rag_few(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "rag_cot":
        feedback = generate_feedback_using_rag_cot(
            request.participant_id,
            request.question_id,
            request.question,
            request.answer,
            request.slide_text_arr,
            request.feedbackFramework,
            request.isStructured,
            request.course_version,
            settings,
            db,
        )
    else:
        feedback = "Generate Feedback Error: Invalid Request."

    if request.isStructured:
        try:
            parsed_feedback = json.loads(feedback)
            return {
                "score": parsed_feedback.get("score", ""),
                "feedback": parsed_feedback.get("feedback", ""),
                "structured_feedback": parsed_feedback.get("structured_feedback", {}),
            }
        except json.JSONDecodeError:
            json_match = re.search(r"```json\s*(\{.*?\})\s*```", feedback, re.DOTALL)
            if json_match:
                try:
                    parsed_feedback = json.loads(json_match.group(1))
                    return {
                        "score": parsed_feedback.get("score", ""),
                        "feedback": parsed_feedback.get("feedback", ""),
                        "structured_feedback": parsed_feedback.get("structured_feedback", {}),
                    }
                except json.JSONDecodeError:
                    return {"score": "", "feedback": feedback, "structured_feedback": {}}
            else:
                return {"score": "", "feedback": feedback, "structured_feedback": {}}
    else:
        return {"feedback": feedback}


@router.post("/generate_feedback_rag_stream")
async def generate_feedback_rag_stream(
    request: FeedbackRequestRagModel,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Session = Depends(get_db),
):
    """Streaming version of generate_feedback_rag that returns Server-Sent Events."""

    def event_generator():
        try:
            if request.promptEngineering == "rag_cot":
                for chunk in generate_feedback_using_rag_cot_stream(
                    request.participant_id,
                    request.question_id,
                    request.question,
                    request.answer,
                    request.slide_text_arr,
                    request.feedbackFramework,
                    request.isStructured,
                    request.course_version,
                    settings,
                    db,
                ):
                    yield chunk
            else:
                yield "data: Streaming not supported for this method, falling back to regular generation...\n\n"

                if request.promptEngineering == "rag_zero":
                    feedback = generate_feedback_using_rag_zero(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
                elif request.promptEngineering == "rag_few":
                    import asyncio

                    feedback = asyncio.run(
                        generate_feedback_using_rag_few(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
                    )
                else:
                    feedback = "Generate Feedback Error: Invalid Request."

                yield f"data: {feedback}\n\n"
                yield "data: [DONE]\n\n"

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
        },
    )


@router.get("/get_human_feedback/{question_id}")
def get_human_feedback(question_id: str, db: Session = Depends(get_db)):
    try:
        if question_id.startswith("qn_"):
            exists = db.execute(
                text("SELECT 1 FROM content_question WHERE question_id = :qid LIMIT 1"),
                {"qid": question_id},
            ).scalar()
            if not exists:
                raise HTTPException(status_code=404, detail="No human feedback found for this question_id")
            raise HTTPException(status_code=404, detail="No human feedback found for this question_id")

        question = db.query(schema.Question).filter(schema.Question.question_id == question_id).first()

        if not question or question.human_feedback is None:
            raise HTTPException(status_code=404, detail="No human feedback found for this question_id")

        return {"human_feedback": question.human_feedback}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
