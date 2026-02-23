from typing import List, Optional

from pydantic import BaseModel


class QuestionContent(BaseModel):
    type: str
    content: str


class QuestionOption(BaseModel):
    text: str
    isCorrect: bool = False


class QuestionResponse(BaseModel):
    type: str
    content: List[QuestionContent]
    options: Optional[List[QuestionOption]] = None
    objective: Optional[List[str]] = None
    slide_ids: Optional[List[str]] = None
    creater_email: str
    human_feedback: Optional[str] = None
    mcq_human_feedback: Optional[List[str]] = None
    mcq_ai_feedback: Optional[List[str]] = None

    class Config:
        orm_mode = True


class QuestionUpdateFeedback(BaseModel):
    question_id: str
    human_feedback: Optional[str] = None
    mcq_human_feedback: Optional[List[str]] = None
    mcq_ai_feedback: Optional[List[str]] = None
    options: Optional[List[QuestionOption]] = None
