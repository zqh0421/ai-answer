from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated

def generate_feedback_using_few(question: str, answer: str, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    return f"Feedback for Few: Your answer '{answer}' doesn't quite match the question '{question}'. Please try again."