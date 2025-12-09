from pydantic import BaseModel, validator
import base64
from typing import List

class VisionModel(BaseModel):
    base64_image_arr: List[str]  # A list of Base64-encoded image strings

    @validator('base64_image_arr', each_item=True)
    def validate_base64_image(cls, value: str) -> str:
        try:
            # Attempt to decode each Base64 string to validate
            base64.b64decode(value)
        except Exception as e:
            raise ValueError("Invalid Base64 image string") from e
        return value
