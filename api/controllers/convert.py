import os
from fastapi import HTTPException
from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_path
from io import BytesIO
from fastapi.responses import StreamingResponse
from ..models import ConvertModel

async def pdf_to_image(convertModel: ConvertModel):
     # Get content of slide PDF file by page
    current_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_dir, '..', 'public', 'E-Learning.pdf')

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

def convertController(convertModel: ConvertModel):
  result = pdf_to_image(convertModel)
  return result