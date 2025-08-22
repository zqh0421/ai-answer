from fastapi import Depends
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from ...config import Settings, get_settings
from typing_extensions import Annotated, List
import time


def format_question(question: List[dict]) -> List[dict]:
    """
    Formats the question into a list of dictionaries that align with OpenAI's expected format.
    """
    formatted_question = []
    for item in question:
        if item["type"] == "text":
            formatted_question.append(
                {"type": "text", "text": item["content"]})
        elif item["type"] == "image":
            formatted_question.append(
                {"type": "image_url", "image_url": {"url": item["content"]}})
        else:
            raise ValueError(
                f"Unsupported question content type: {item['type']}")
    return formatted_question


def call_gpt(system_prompt: str, user_prompt: List[dict], settings: Annotated[Settings, Depends(get_settings)]) -> str:
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

    # Initialize the LangChain ChatOpenAI
    client = ChatOpenAI(
        openai_api_key=api_key,
        openai_organization=api_org,
        openai_project=api_proj,
        model="gpt-4o",
        max_tokens=4000,
        temperature=0.01,
        streaming=True
    )

    init_time = time.time()

    # Create messages using LangChain message classes
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt)
    ]

    # Use streaming with LangChain
    result = ""
    print_stream = True
    for chunk in client.stream(messages):
        if chunk.content is not None:
            # if print_stream:
            # print(chunk.content, end="")
            result += chunk.content
    result = result.replace("**", "\n")
    print("call_gpt")
    print(time.time() - init_time)
    return f"{result}"
