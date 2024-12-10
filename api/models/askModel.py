from pydantic import BaseModel
from typing import List

class AskModel(BaseModel):
    question: str
    answer: str

class FeedbackRequestModel(BaseModel):
    promptEngineering: str
    feedbackFramework: str
    question: List[dict]
    answer: str

class FeedbackRequestRagModel(BaseModel):
    promptEngineering: str
    feedbackFramework: str
    question: List[dict]
    answer: str
    slide_text_arr: List[str]