from pydantic import BaseModel
from uuid import UUID 

class ConvertModel(BaseModel):
    slide_id: UUID
    page_number: int

class ConvertBatchModel(BaseModel):
    course: str