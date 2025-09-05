from pydantic import BaseModel
from typing import Optional, List, Mapping, Dict, Any

class QuestionContent(BaseModel):
    type: str  # text, image, etc.
    content: str

class QuestionResponse(BaseModel):
    type: str  # e.g., "multiple choice", "open ended"
    content: List[QuestionContent]          # Question content as an array of objects
    options: Optional[List[str]] = None # Question options if applicable
    objective: Optional[List[str]] = None   # Learning objectives
    slide_ids: Optional[List[str]] = None   # Related slide IDs
    creater_email: str
    mcq_human_feedback: Optional[List[str]] = None  # Human feedback for each MCQ option
    mcq_ai_feedback: Optional[List[str]] = None  # AI feedback for each MCQ option

    class Config:
        orm_mode = True  # Enable compatibility with SQLAlchemy models

class QuestionUpdateFeedback(BaseModel):
    question_id: str
    mcq_human_feedback: Optional[List[str]] = None
    mcq_ai_feedback: Optional[List[str]] = None

