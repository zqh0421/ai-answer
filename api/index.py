from fastapi import FastAPI, Depends
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing_extensions import Annotated
from .config import Settings, get_settings
from .chat import judge_answer
from .embedding import create_embedding

app = FastAPI()

class AskModel(BaseModel):
    question: str
    answer: str

class EmbedModel(BaseModel):
    text: str

@app.get("/api/test")
def test():
    return {"message": "Backend Connected!"}

@app.post("/api/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = judge_answer(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}

@app.post("/api/embed")
def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = create_embedding(embedModel.text, settings)
    return {"result": f"{result}"}