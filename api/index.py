import os
from openai import OpenAI
from pydantic import BaseModel
from fastapi import FastAPI, Depends
from typing_extensions import Annotated
from langchain_community.document_loaders import PyPDFLoader
from pydantic_settings import BaseSettings, SettingsConfigDict

from .chat import judge_answer
from .config import Settings, get_settings
from .embedding import create_embedding, embed_slide, combine_embedding, retrieve_reference

app = FastAPI()

class AskModel(BaseModel):
    question: str
    answer: str

class EmbedModel(BaseModel):
    question: str
    answer: str
    result: str

@app.get("/api/test")
def test():
    return {"message": "Backend Connected!"}

@app.post("/api/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = judge_answer(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}

@app.post("/api/embed")
def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)]):
    # Create query
    q_vector = create_embedding(embedModel.question, settings)
    a_vector = create_embedding(embedModel.answer, settings)
    r_vector = create_embedding(embedModel.result, settings)
    text_vector = combine_embedding(q_vector, a_vector, r_vector)

    # Get content of slide PDF file by page
    current_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_dir, '..', 'public', 'E-Learning.pdf')

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    loader = PyPDFLoader(file_path)

    docs = loader.load()

    # print(docs[0].metadata)

    contents = []
    for i in range(len(docs)):
        contents.append(docs[i].page_content)

    # Get slide vectors
    content_vectors = embed_slide(contents, settings)

    # Retrieve the most relevant reference based on cosine similarity
    page_number, best_match_content = retrieve_reference(text_vector, content_vectors, contents)

    # retrieve related reference from given slide and return the page
    return {
        "result": {
            "content": f"{best_match_content}",
            "page_number": page_number
        }
    }

