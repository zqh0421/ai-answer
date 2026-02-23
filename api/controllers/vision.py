import base64

from fastapi import Depends
from openai import OpenAI
from pydantic import BaseModel
from typing_extensions import Annotated, List

from ..config import Settings, get_settings
from ..services.openai_vision_budget import acquire_openai_vision_budget


def encode_image(image_byte_arr):
    image_byte_arr.seek(0)
    return base64.b64encode(image_byte_arr.read()).decode("utf-8")


def visionController(question, answer, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    client = OpenAI(api_key=api_key)

    # Keep the existing public signature; `question` carries the image bytes here.
    base64_image = encode_image(question)

    stream = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "role":"system",
                "content": "You are a helpful assistant that analyzes contents in course slide images."
            },
            {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": "What's in this image?"
                  },
                  {
                    "type": "image_url",
                    "image_url": {
                      "url": f"data:image/png;base64,{base64_image}"
                    }
                  }
                ]
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


class VisionResponse(BaseModel):
    slide_content: str


def setVision(img_base64: List[str], settings: Annotated[Settings, Depends(get_settings)]):
    api_key = settings.openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    client = OpenAI(
        api_key=api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj
    )

    content = [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{item}"
            },
        }
        for item in img_base64
    ]

    with acquire_openai_vision_budget():
        result = client.beta.chat.completions.parse(
            model="gpt-5",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that analyzes contents in course slide images, capable of providing clear, accurate, and complete summaries from images."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Please summarize and describe the knowledge of this image (both text and visual information), extracting content directly to ensure accuracy. Do not arbitrarily add or remove content."
                        },
                        *content
                    ]
                }
            ],
            response_format=VisionResponse,
        )

    return result.choices[0].message.parsed.slide_content
