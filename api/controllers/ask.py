from fastapi import Depends
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from ..config import Settings, get_settings
from typing_extensions import Annotated


def askController(question, answer, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    # Initialize the LangChain ChatOpenAI
    client = ChatOpenAI(
        openai_api_key=api_key,
        model="gpt-4o",
        streaming=True
    )

    # Create messages using LangChain message classes
    messages = [
        SystemMessage(content="You are a helpful assistant that verifies answers to questions.  Please respond with yes or no about whther the answer is correct, and provide short explanations using 2-3 sentences."),
        HumanMessage(content=f"Question: {question}\nAnswer: {answer}\n")
    ]

    # Use streaming with LangChain
    result = ""
    for chunk in client.stream(messages):
        if chunk.content is not None:
            if print_stream:
                print(chunk.content, end="")
            result += chunk.content
    return result
