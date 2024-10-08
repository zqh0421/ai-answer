import os
from fastapi import HTTPException
from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_path
from io import BytesIO
from fastapi.responses import StreamingResponse
from ..models import ConvertModel, ConvertBatchModel

from fastapi import Depends
from openai import OpenAI
from ..config import Settings, get_settings
from typing_extensions import Annotated
import base64
import requests
from fastapi.responses import StreamingResponse
from io import BytesIO

# Function to encode the image
def encode_image(image_byte_arr):
    # Make sure to reset the pointer to the start of the byte array
    image_byte_arr.seek(0)

    # Read the byte array and encode it in base64
    img_base64 = base64.b64encode(image_byte_arr.read()).decode('utf-8')

    # Return the base64 encoded string
    return img_base64

def vision(img_byte_arr, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    print("Finding API KEY ...")
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the OpenAI API
    client = OpenAI(
        api_key=api_key
    )
    print("Encoding ...")
    # Getting the base64 string
    base64_image = encode_image(img_byte_arr)
    print("Encoding Finished.")
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
    return {
        "understandings": result
    }

async def convertController(convertModel: ConvertModel):
    # Get content of slide PDF file by page
    root_dir = os.path.dirname(os.path.abspath(__package__))
    file_path = os.path.join(root_dir, 'public', 'E-Learning.pdf')
    print(file_path)

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    page = convertModel.page + 1
    try:
        # pdf to image
        images = convert_from_path(file_path, first_page=page, last_page=page)
        if not images:
            raise HTTPException(status_code=404, detail="Page not found")
        # image to bytes stream
        img_byte_arr = BytesIO()
        images[0].save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        # return image stream
        return StreamingResponse(img_byte_arr, media_type="image/png")
        
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {e}")

async def convertBatchController(convertBatchModel: ConvertBatchModel, settings: Annotated[Settings, Depends(get_settings)]):
    # Get content of slide PDF file by page
    root_dir = os.path.dirname(os.path.abspath(__package__))
    file_path = os.path.join(root_dir, 'public', 'E-Learning.pdf')
    print(file_path)

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    try:
        # pdf to image
        images = convert_from_path(file_path)
        print("Convert Finished.")
        if not images:
            raise HTTPException(status_code=404, detail="Page not found")
        # image to bytes stream
        img_byte_arr = BytesIO()
        images[0].save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        print("Undestanding ...")
        return vision(img_byte_arr, settings)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {e}")