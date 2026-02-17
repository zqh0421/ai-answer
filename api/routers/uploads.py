import re
import uuid
import boto3
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from typing_extensions import Annotated

from ..config import Settings, get_settings
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_UPLOADS])


@router.post("/s3upload")
async def upload_file(settings: Annotated[Settings, Depends(get_settings)], file: UploadFile = File(...)):
    try:
        file.file.seek(0)
        if file.filename is None:
            raise HTTPException(status_code=400, detail="Filename is required")
        file_extension = file.filename.split(".")[-1]
        file_name_sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", file.filename)
        file_key = f"uploads/{uuid.uuid4()}_{file_name_sanitized}"

        s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region_name,
        )

        s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            file_key,
            ExtraArgs={"ContentType": file.content_type or "application/octet-stream"},
        )
        file_url = f"https://{settings.s3_bucket_name}.s3.amazonaws.com/{file_key}"

        return {"url": file_url}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
