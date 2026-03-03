from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_QUESTIONS])


_DEPRECATED_DETAIL = (
    "Legacy question table endpoints are removed. "
    "Use semantic endpoints instead: POST /api/questions, GET /api/questions, "
    "GET /api/questions/{question_id}, DELETE /api/questions/{question_id}."
)


@router.post("/questions/create")
def create_question(_db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail=_DEPRECATED_DETAIL)


@router.get("/questions/all")
def get_all_question(_db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail=_DEPRECATED_DETAIL)


@router.get("/questions/by_id/{question_id}")
def get_question_by_id(question_id: str, _db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail=_DEPRECATED_DETAIL)


@router.delete("/questions/by_id/{question_id}")
def delete_question_by_id(question_id: str, _db: Session = Depends(get_db)):
    raise HTTPException(status_code=410, detail=_DEPRECATED_DETAIL)
