from fastapi import Depends
from openai import OpenAI
from ..config import Settings, get_settings
from typing_extensions import Annotated
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
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the OpenAI API
    client = OpenAI(
        api_key=api_key
    )

    # Getting the base64 string
    base64_image = encode_image(image_path)

    stream = client.chat.completions.create(
        model="gpt-4o-mini",
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