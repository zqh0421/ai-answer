from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel


class RecordResultModel(BaseModel):
    learner_id: str
    session_id: str
    lti_launch_id: Optional[str] = None
    lti_user_id: Optional[str] = None
    study_id: str
    # ip_address: Optional[str] = None
    question_id: str
    answer: str
    preferred_info_type: str
    prompt_engineering_method: str
    feedback_framework: str
    feedback: str
    reference_slide_id: Optional[str] = None
    reference_slide_content: Optional[str] = None
    reference_slide_page_number: Optional[int] = None

    slide_retrieval_range: Optional[List[str]] = None
    system_total_response_time: int

    submission_time: datetime


class UpdateRatingModel(BaseModel):
    rating: bool


class AudioNarrationUsageEvent(BaseModel):
    action: Literal["start", "stop"]
    session_id: str
    timestamp: datetime
    usage_id: Optional[int] = None
