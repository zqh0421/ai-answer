from fastapi import Depends
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.pydantic_v1 import BaseModel
from ..config import Settings, get_settings
from typing_extensions import Annotated, List
import base64
import requests
import base64
from fastapi.responses import StreamingResponse
from io import BytesIO

# Function to encode the image


def encode_image(image_byte_arr):
    img_byte_arr.seek(0)
    img_base64 = base64.b64encode(img_byte_arr.read()).decode('utf-8')
    # response = StreamingResponse(BytesIO(base64.b64decode(img_base64)), media_type="image/png")
    return img_base64


def visionController(question, answer, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    # Initialize the LangChain ChatOpenAI
    client = ChatOpenAI(
        openai_api_key=api_key,
        model="gpt-4o-mini",
        streaming=True
    )

    # Getting the base64 string
    base64_image = encode_image(image_path)

    # Create messages using LangChain message classes
    messages = [
        SystemMessage(
            content="You are a helpful assistant that analyzes contents in course slide images."),
        HumanMessage(content=[
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
        ])
    ]

    # Use streaming with LangChain
    result = ""
    for chunk in client.stream(messages):
        if chunk.content is not None:
            # if print_stream:
            # print(chunk.content, end="")
            result += chunk.content
    return result


class VisionResponse(BaseModel):
    slide_content: str


def setVision(img_base64: List[str], settings: Annotated[Settings, Depends(get_settings)]):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    # Initialize the LangChain ChatOpenAI
    client = ChatOpenAI(
        openai_api_key=api_key,
        openai_organization=settings.openai_api_org,
        openai_project=settings.openai_api_proj,
        model="gpt-4o-mini"
    )

    content = [{
        "type": "image_url",
        "image_url": {
            "url": f"data:image/png;base64,{item}"
        }
    } for item in img_base64
    ]

    # Create messages using LangChain message classes
    messages = [
        SystemMessage(content="You are a helpful assistant that analyzes contents in course slide images, capable of providing clear, accurate, and complete summaries from images."),
        HumanMessage(content=[
            {
                "type": "text",
                "text": "Please summarize and describe the knowledge of this image (both text and visual information), extracting content directly to ensure accuracy. Do not arbitrarily add or remove content."
            },
            *content
        ])
    ]

    # Use LangChain to get the response
    result = client.invoke(messages)

    # For now, return the content directly since LangChain doesn't have built-in response parsing like OpenAI's beta features
    # You might need to implement custom parsing logic here
    return result.content
