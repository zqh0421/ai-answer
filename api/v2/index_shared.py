from fastapi import APIRouter, Depends
from typing_extensions import Annotated

from ..config import Settings, get_settings
from ..concurrency import run_openai_blocking
from ..models import TTSRequestModel, InteractiveNarrationModel, VisionModel

from .controllers_shared import (
    text_to_speech_shared,
    interactive_narration_shared,
    set_vision_shared
)

# Create router for shared endpoints (used by both OEQ and MCQ)
router = APIRouter(prefix="/api/v2/shared", tags=["Media / Shared (v2)"])

@router.post("/text-to-speech")
async def text_to_speech(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Shared endpoint: Generate audio narration for reference material using OpenAI TTS
    """
    return await text_to_speech_shared(request, settings)

@router.post("/interactive-narration")
async def interactive_narration(request: InteractiveNarrationModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Shared endpoint: Generate interactive, conversational narration using GPT-4o with visual analysis
    """
    return await interactive_narration_shared(request, settings)

@router.post("/vision")
async def vision(visionModel: VisionModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Shared endpoint: Process images with OpenAI Vision
    """
    result = await run_openai_blocking(set_vision_shared, visionModel.base64_image_arr, settings)
    return {"slide_content": result}
