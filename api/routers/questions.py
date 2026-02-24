from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schema
from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_QUESTIONS])


@router.post("/questions/create")
def create_question(request: models.QuestionResponse, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(schema.User.email == request.creater_email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    serialized_content = [content.dict() for content in request.content]
    options_dict = [opt.dict() for opt in request.options] if request.options else None

    db_question = schema.Question(
        type=request.type,
        content=serialized_content,
        options=options_dict,
        objective=request.objective,
        slide_ids=request.slide_ids,
        creater_email=request.creater_email,
        human_feedback=request.human_feedback,
        mcq_human_feedback=request.mcq_human_feedback,
        mcq_ai_feedback=request.mcq_ai_feedback,
    )
    db.add(db_question)
    db.commit()
    db.refresh(db_question)
    return db_question


@router.get("/questions/all")
def get_all_question(db: Session = Depends(get_db)):
    return db.query(schema.Question).all()


@router.get("/questions/by_id/{question_id}")
def get_question_by_id(question_id: str, db: Session = Depends(get_db)):
    question = db.query(schema.Question).filter(schema.Question.question_id == question_id).first()
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


@router.delete("/questions/by_id/{question_id}")
def delete_question_by_id(question_id: str, db: Session = Depends(get_db)):
    db_question = db.query(schema.Question).filter(schema.Question.question_id == question_id).first()
    if db_question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    db.delete(db_question)
    db.commit()
    return {"message": "Question deleted successfully"}
