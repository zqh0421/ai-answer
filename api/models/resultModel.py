from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
class RecordResultModel(BaseModel):
    learner_id: str
    session_id: str
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