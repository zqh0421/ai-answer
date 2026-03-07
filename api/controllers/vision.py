from fastapi import Depends
from openai import OpenAI
from pydantic import BaseModel
from typing_extensions import Annotated, List

from ..config import Settings, get_settings
from ..services.openai_vision_budget import acquire_openai_vision_budget


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
