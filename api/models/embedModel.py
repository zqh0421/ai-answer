from pydantic import BaseModel
from typing import List

class EmbedModel(BaseModel):
    question: str
    slideIds: List[str]
    preferredInfoType: str