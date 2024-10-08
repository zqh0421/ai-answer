from pydantic import BaseModel

class ConvertModel(BaseModel):
    page: int

class ConvertBatchModel(BaseModel):
    course: str