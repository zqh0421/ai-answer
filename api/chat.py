from fastapi import FastAPI, Depends
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from .config import Settings, get_settings
from typing_extensions import Annotated

def judge_answer(question, answer, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the OpenAI API
    client = OpenAI(
        api_key=api_key
    )
    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role":"system",
                "content": "You are a helpful assistant that verifies answers to questions.  Please respond with yes or no about whther the answer is correct, and provide short explanations using 2-3 sentences."
            },
            {
                "role": "user",
                "content": f"Question: {question}\nAnswer: {answer}\n"
            }
        ],
        stream=True,
    )

    result = ""
    for chunk in stream:
        if chunk.choices[0].delta.content is not None:
            if print_stream:
                print(chunk.choices[0].delta.content, end="")
            result += chunk.choices[0].delta.content
    return result