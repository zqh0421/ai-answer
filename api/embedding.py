from langchain_openai import OpenAIEmbeddings
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated

def create_embedding(text, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(api_key=api_key)

    result = embeddings_model.embed_query(text)

    return result

def combine_embedding(question, answer, result):
  return question + answer + result