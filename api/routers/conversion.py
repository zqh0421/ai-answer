from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_db
from .. import schema
from ..models import ConvertModel
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
