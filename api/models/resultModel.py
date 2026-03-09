from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class RecordResultModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    learner_id: str
    session_id: str
    lti_launch_id: Optional[str] = None
    lti_user_id: Optional[str] = None
    study_id: str
    # ip_address: Optional[str] = None
    question_id: str
    composition_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("composition_id", "compositionId"),
    )
    answer: str
    preferred_info_type: str
    prompt_engineering_method: str
    feedback_framework: str
    feedback: str
    llm_system_prompt: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("llm_system_prompt", "system_prompt", "resolved_system_prompt"),
    )
    llm_user_prompt: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("llm_user_prompt", "user_prompt", "user_text", "resolved_user_text"),
    )
    rendered_prompt: Optional[dict[str, Any]] = None
    score_given: Optional[float] = None
    score_maximum: Optional[float] = None
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
