from pydantic import BaseModel

class AskModel(BaseModel):
    question: str
    answer: str