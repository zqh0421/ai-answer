from pydantic import BaseModel

class ConvertModel(BaseModel):
    slide_id: str
    page_number: int

class ConvertBatchModel(BaseModel):
    course: str