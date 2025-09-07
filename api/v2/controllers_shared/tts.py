from fastapi import Depends, HTTPException
import openai
import base64
from typing_extensions import Annotated
from ...config import Settings, get_settings
from ...models import TTSRequestModel
from .tts_realtime import text_to_speech_realtime

async def text_to_speech_shared(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Shared TTS function: Generate audio narration using Realtime API for direct audio output
    """
    # Use the new Realtime API implementation for direct audio generation
    return await text_to_speech_realtime(request, settings)

async def text_to_speech_fallback(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Fallback TTS function: Generate audio narration using traditional OpenAI TTS API
    """
    try:
        # Initialize OpenAI client
        client = openai.OpenAI(api_key=settings.openai_api_key)
        
        # Generate speech using OpenAI TTS
        response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",  # You can change to "echo", "fable", "onyx", "nova", "shimmer"
            input=request.text
        )
        
        # Convert the audio to base64
        audio_bytes = response.content
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return {
            "audio_base64": audio_base64,
            "text": request.text,
            "voice": "alloy"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")