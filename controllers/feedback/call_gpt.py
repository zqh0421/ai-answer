from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated, List
import time
from openai.types.responses import (
    ResponseInputParam,
    ResponseInputImageParam,
    ResponseInputTextParam,
    ResponseInputItemParam
)


def format_question(question: List[dict]) -> ResponseInputParam:
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


def call_gpt(system_prompt: str, user_prompt: list[ResponseInputItemParam], settings: Annotated[Settings, Depends(get_settings)]) -> str:
    api_key = settings.openai_api_key  # Corrected to access openai_api_key
    api_org = settings.openai_api_org
    api_proj = settings.openai_api_proj

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    if not api_org:
        raise ValueError(
            "OPENAI_API_ORG is not set in the environment variables")

    if not api_proj:
        raise ValueError(
            "OPENAI_API_PROJ is not set in the environment variables")

    # Initialize the OpenAI API
    client = OpenAI(
        api_key=api_key,
        organization=api_org,
        project=api_proj
    )

    init_time = time.time()

    print(user_prompt)
    response = client.responses.create(
        model="gpt-5",
        instructions=system_prompt,
        input=[
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
        reasoning={
            "effort": "minimal"
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
    print("result")
    print(result)
    print("call_gpt")
    print(time.time() - init_time)
    return f"{result}"
