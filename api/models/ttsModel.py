from pydantic import BaseModel, Field


class TTSRequestModel(BaseModel):
    text: str
    voice: str = "alloy"


class InteractiveNarrationModel(BaseModel):
    student_answer: str
    feedback: str
    reference_content: str
    slide_title: str
    page_number: int
    has_images: bool = True
    voice: str = "alloy"
    slide_images: list[str] = Field(default_factory=list)
