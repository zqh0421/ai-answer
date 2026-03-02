from typing import List, Dict, Any
import openai
import json
from ...config import Settings
from ...concurrency import run_openai_blocking
from openai.types.responses import ResponseInputImageParam, ResponseInputParam
from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated, List
import time
from openai.types.responses import ResponseInputImageParam, ResponseInputParam, ResponseInputTextParam


def format_question_mcq(question: List[dict]) -> List[dict]:
    """
    Formats the question into a list of dictionaries that align with OpenAI's expected format.
    """
    formatted_question: ResponseInputParam = []
    for item in question:
        if item["type"] == "text":
            input_text: ResponseInputTextParam = {
                "type": "input_text", "text": item["content"]}
            formatted_question.append(input_text)
        elif item["type"] == "image":
            input_image: ResponseInputImageParam = {
                "type": "input_image", "image_url": f"{item['content']}", "detail": "auto"}
            formatted_question.append(input_image)
        else:
            raise ValueError(
                f"Unsupported question content type: {item['type']}")
    return formatted_question


def call_gpt_mcq(system_prompt: str, user_content: List[Dict[str, Any]], settings: Settings) -> str:
    client = openai.OpenAI(api_key=settings.openai_api_key)
    try:
        response = client.responses.create(
            model="gpt-5",
            instructions=system_prompt,
            input=[
                {
                    "role": "user",
                    "content": user_content,
                }
            ],
            reasoning={
                "effort": "low"
            },
            text={
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "output",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "score": {
                                "type": "string",
                                "enum": ["0", "1"]
                            },
                            "feedback": {
                                "type": "string",
                                "minLength": 1
                            },
                            "structured_feedback": {
                                "type": "string",
                                "minLength": 20
                            }
                        },
                        "required": [
                            "score",
                            "feedback",
                            "structured_feedback"
                        ],
                        "additionalProperties": False
                    }
                }
            }
        )
        result = response.output_text
        print(result)
        print("call_gpt_mcq")
        return f"{result}"
    except Exception as e:
        print(f"Error calling GPT for MCQ: {e}")
        raise


async def call_gpt_mcq_async(system_prompt: str, user_content: List[Dict[str, Any]], settings: Settings) -> str:
    """
    Async version of call_gpt_mcq for parallel processing.

    Args:
        system_prompt: The system prompt with instructions
        user_content: The formatted question and option content
        settings: Application settings with API key

    Returns:
        str: The generated feedback response
    """
    return await run_openai_blocking(
        call_gpt_mcq,
        system_prompt,
        user_content,
        settings,
    )
