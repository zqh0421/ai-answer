from fastapi import APIRouter, Depends, HTTPException
from typing_extensions import Annotated
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..concurrency import run_openai_blocking
from ..controllers import convertBatchController
from ..controllers.vision import setVision
from ..dependencies import get_db
from .. import schema
from ..models import ConvertModel, ConvertBatchModel, VisionModel
from ..tags import Tags

router = APIRouter(prefix="/api")


@router.post("/pdf-to-image", tags=[Tags.MEDIA_CONVERSION])
async def convert(convertModel: ConvertModel, db: Session = Depends(get_db)):
    try:
        result = db.query(schema.Page).filter(
            schema.Page.slide_id == convertModel.slide_id,
            schema.Page.page_number == convertModel.page_number,
        ).first()

        if not result:
            raise HTTPException(status_code=404, detail="Page not found for the given slide_id and page_number")

        return {
            "slide_id": result.slide_id,
            "page_number": result.page_number,
            "text": result.text,
            "img_base64": result.img_base64,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/openai-vision", tags=[Tags.MEDIA_VISION_V1])
async def vision(visionModel: VisionModel, settings: Annotated[Settings, Depends(get_settings)]):
    return await run_openai_blocking(setVision, visionModel.base64_image_arr, settings)


@router.post("/pdf-to-img-rephrase", tags=[Tags.MEDIA_CONVERSION])
async def convert_batch(convertBatchModel: ConvertBatchModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = await convertBatchController(convertBatchModel, settings)
    return result
