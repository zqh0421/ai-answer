from pydantic import BaseModel

class EmbedModel(BaseModel):
    question: str
    answer: str
    result: str