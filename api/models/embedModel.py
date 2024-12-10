from pydantic import BaseModel
from typing import List

class EmbedModel(BaseModel):
    question: List[dict]
    slideIds: List[str]
    preferredInfoType: str