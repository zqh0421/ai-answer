from typing import List
from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated

def generate_feedback_using_graph_rag(question: str, answer: str, slide_text_arr: List[str], settings: Annotated[Settings, Depends(get_settings)]) -> str:
  return f"Feedback for Graph Rag"