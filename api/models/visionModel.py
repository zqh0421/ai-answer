import base64
from typing import List

from pydantic import BaseModel, validator


class VisionModel(BaseModel):
    base64_image_arr: List[str]

    @validator("base64_image_arr", each_item=True)
    def validate_base64_image(cls, value: str) -> str:
        try:
            base64.b64decode(value)
        except Exception as e:
            raise ValueError("Invalid Base64 image string") from e
        return value
