from pydantic import BaseModel
from typing import Optional, List, Mapping, Dict, Any

class QuestionContent(BaseModel):
    type: str  # text, image, etc.
    content: str

class QuestionOption(BaseModel):
    text: str
    isCorrect: bool = False

class QuestionResponse(BaseModel):
    type: str  # e.g., "multiple choice", "open ended"
    content: List[QuestionContent]          # Question content as an array of objects
    options: Optional[List[QuestionOption]] = None # Question options with isCorrect flag
    objective: Optional[List[str]] = None   # Learning objectives
    slide_ids: Optional[List[str]] = None   # Related slide IDs
    creater_email: str
    human_feedback: Optional[str] = None  # Human feedback for OEQ questions
    mcq_human_feedback: Optional[List[str]] = None  # Human feedback for each MCQ option
    mcq_ai_feedback: Optional[List[str]] = None  # AI feedback for each MCQ option

    class Config:
        orm_mode = True  # Enable compatibility with SQLAlchemy models

class QuestionUpdateFeedback(BaseModel):
    question_id: str
    human_feedback: Optional[str] = None  # For OEQ questions
    mcq_human_feedback: Optional[List[str]] = None  # For MCQ questions
    mcq_ai_feedback: Optional[List[str]] = None  # For MCQ questions
    options: Optional[List[QuestionOption]] = None  # Updated options with isCorrect flags

