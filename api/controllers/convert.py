import os
import base64
from io import BytesIO
from fastapi import Depends
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pdf2image import convert_from_path
from typing_extensions import Annotated

from ..config import Settings, get_settings
from ..models import ConvertBatchModel, ConvertModel


def _default_pdf_path() -> str:
    root_dir = os.path.dirname(os.path.abspath(__package__))
    return os.path.join(root_dir, "public", "E-Learning.pdf")


def encode_image(image_byte_arr):
    image_byte_arr.seek(0)
    img_base64 = base64.b64encode(image_byte_arr.read()).decode("utf-8")
    return img_base64


def vision(img_byte_arr, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    client = OpenAI(api_key=api_key)
    base64_image = encode_image(img_byte_arr)

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
    return {
        "understandings": result
    }


async def convertController(convertModel: ConvertModel):
    file_path = _default_pdf_path()

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    page = convertModel.page_number + 1
    try:
        images = convert_from_path(file_path, first_page=page, last_page=page)
        if not images:
            raise HTTPException(status_code=404, detail="Page not found")

        img_byte_arr = BytesIO()
        images[0].save(img_byte_arr, format="PNG")
        img_byte_arr.seek(0)

        return StreamingResponse(img_byte_arr, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {e}")


async def convertBatchController(_convertBatchModel: ConvertBatchModel, settings: Annotated[Settings, Depends(get_settings)]):
    file_path = _default_pdf_path()

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    try:
        images = convert_from_path(file_path)
        if not images:
            raise HTTPException(status_code=404, detail="Page not found")

        img_byte_arr = BytesIO()
        images[0].save(img_byte_arr, format="PNG")
        img_byte_arr.seek(0)

        return vision(img_byte_arr, settings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {e}")
