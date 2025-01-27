from pydantic import BaseModel
from typing import List
from uuid import UUID 

class EmbedModel(BaseModel):
    question_id: UUID
    question: List[dict]
    slideIds: List[str]
    preferredInfoType: str