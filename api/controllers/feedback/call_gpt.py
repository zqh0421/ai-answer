from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated

def call_gpt(system_prompt: str, user_prompt: str, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    api_key = settings.openai_api_key  # Corrected to access openai_api_key
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

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role":"system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        stream=True,
        max_tokens=4000,
        temperature=0.01
    )
    result = ""
    print_stream = True
    for chunk in stream:
        if chunk.choices[0].delta.content is not None:
            if print_stream:
                print(chunk.choices[0].delta.content, end="")
            result += chunk.choices[0].delta.content
    result = result.replace("**", "|")
    return f"{result}"