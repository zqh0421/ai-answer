from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated, List
from typing import Any, Optional, Sequence
import time
from openai.types.responses import ResponseInputImageParam, ResponseInputParam

def format_question_oeq(question: List[dict]) -> List[dict]:
    """
    Formats the question into a list of dictionaries that align with OpenAI's expected format.
    """
    formatted_question: ResponseInputParam = []
    for item in question:
        if item["type"] == "text":
            formatted_question.append({"type": "input_text", "text": item["content"]})
        elif item["type"] == "image":
            input_image: ResponseInputImageParam = {"type": "input_image", "image_url": f"{item['content']}", "detail": "auto"}
            formatted_question.append(input_image)
        else:
            raise ValueError(f"Unsupported question content type: {item['type']}")
    return formatted_question

def _build_feedback_output_schema(
    *,
    is_structured: bool,
    max_score: float,
    allowed_scores: Optional[Sequence[float]] = None,
) -> dict[str, Any]:
    score_schema: dict[str, Any] = {"type": "number", "minimum": 0, "maximum": float(max_score)}
    if allowed_scores:
        score_schema["enum"] = [float(v) for v in allowed_scores]

    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "score": score_schema,
            "max_score": {"type": "number", "const": float(max_score)},
        },
        "required": ["score", "max_score"],
        "additionalProperties": False,
    }
    if is_structured:
        schema["properties"]["structured_feedback"] = {"type": "string", "minLength": 1}
        schema["required"].append("structured_feedback")
    else:
        schema["properties"]["text_feedback"] = {"type": "string", "minLength": 1}
        schema["required"].append("text_feedback")
    return schema


def call_gpt_oeq(
    system_prompt: str,
    user_prompt: List[dict],
    settings: Annotated[Settings, Depends(get_settings)],
    *,
    is_structured: bool = True,
    max_score: float = 2.0,
    allowed_scores: Optional[Sequence[float]] = None,
) -> str:
    api_key = settings.openai_api_key
    api_org = settings.openai_api_org
    api_proj = settings.openai_api_proj

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")
        
    if not api_org:
        raise ValueError("OPENAI_API_ORG is not set in the environment variables")
      
    if not api_proj:
        raise ValueError("OPENAI_API_PROJ is not set in the environment variables")

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
            "effort": "low"
        },
        text={
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "output",
                "strict": True,
                "schema": _build_feedback_output_schema(
                    is_structured=is_structured,
                    max_score=max_score,
                    allowed_scores=allowed_scores,
                ),
            }
        }
    )
    result = response.output_text
    print("result")
    print(result)
    print("call_gpt_oeq")
    print(time.time() - init_time)
    return f"{result}"

def call_gpt_stream_oeq(system_prompt: str, user_prompt: List[dict], settings: Annotated[Settings, Depends(get_settings)]):
    """
    Streaming version of call_gpt that yields chunks as they arrive from OpenAI
    """
    api_key = settings.openai_api_key
    api_org = settings.openai_api_org
    api_proj = settings.openai_api_proj

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")
        
    if not api_org:
        raise ValueError("OPENAI_API_ORG is not set in the environment variables")
      
    if not api_proj:
        raise ValueError("OPENAI_API_PROJ is not set in the environment variables")

    # Initialize the OpenAI API
    client = OpenAI(
        api_key=api_key,
        organization=api_org,
        project=api_proj
    )

    init_time = time.time()
    stream = client.responses.create(
        model="gpt-5",
        instructions=system_prompt,
        input=user_prompt,
        verbosity="minimal",
        stream=True
    )
    
    for chunk in stream:
        if chunk.choices[0].delta.content is not None:
            content = chunk.choices[0].delta.content.replace("**", "\n")
            yield content
        
        # Check if this is the last chunk
        if chunk.choices[0].finish_reason is not None:
            print("call_gpt_stream_oeq completed")
            print(time.time() - init_time)
            break
