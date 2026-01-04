from pydantic import BaseModel

class TTSRequestModel(BaseModel):
    text: str
    voice: str = "alloy"  # Default voice, can be "echo", "fable", "onyx", "nova", "shimmer"

class InteractiveNarrationModel(BaseModel):
    student_answer: str
    feedback: str
    reference_content: str
    slide_title: str
    page_number: int
    has_images: bool = True
    voice: str = "alloy"
    slide_images: list[str] = []  # Base64 encoded slide images for visual analysis 