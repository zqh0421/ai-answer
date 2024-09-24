from fastapi import FastAPI, Depends
from pydantic import BaseModel
from .chat import judge_answer
import os
from openai import OpenAI
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing_extensions import Annotated
from .config import Settings, get_settings
app = FastAPI()

class AskModel(BaseModel):
    question: str
    answer: str

@app.get("/api/test")
def test():
    return {"message": "Backend Connected!"}

@app.post("/api/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = judge_answer(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}