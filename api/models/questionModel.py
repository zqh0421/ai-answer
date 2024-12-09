from pydantic import BaseModel
from typing import Optional, List, Mapping

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

    class Config:
        orm_mode = True  # Enable compatibility with SQLAlchemy models

