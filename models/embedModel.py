from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID 

# class EmbedModel(BaseModel):
#     question_id: Optional[UUID] 
#     question: List[dict]
#     slideIds: List[str]
#     preferredInfoType: str

# from pydantic import BaseModel, Field, ConfigDict
# from typing import List, Optional, Literal

# class QuestionContent(BaseModel):
#     type: Literal["text", "image"]
#     content: str

class EmbedModel(BaseModel):
    question_id: Optional[UUID]
    question: List[dict]
    slideIds: List[str]
    preferredInfoType: str