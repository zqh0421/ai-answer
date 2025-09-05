from pydantic import BaseModel
from typing import List, Optional

class AskModel(BaseModel):
    question: str
    answer: str

class FeedbackRequestModel(BaseModel):
    promptEngineering: str
    feedbackFramework: str
    question: List[dict]
    answer: str

class FeedbackRequestRagModel(FeedbackRequestModel):
    question_id: Optional[str]
    participant_id: Optional[str]
    slide_text_arr: List[str]
    isStructured: bool
    course_version: Optional[str] = None  # Add course_version field