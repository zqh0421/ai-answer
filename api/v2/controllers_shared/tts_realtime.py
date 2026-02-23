from fastapi import Depends, HTTPException
import json
import websocket
from typing_extensions import Annotated
from ...config import Settings, get_settings
from ...concurrency import run_openai_blocking
from ...models import TTSRequestModel

def _text_to_speech_realtime_sync(request: TTSRequestModel, api_key: str):
    # Connect to Realtime API via WebSocket
    url = "wss://api.openai.com/v1/realtime?model=gpt-realtime"
    ws = websocket.WebSocket()
    ws.connect(url, header={"Authorization": f"Bearer {api_key}"})

    # Initialize session with audio configuration
    session_config = {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "model": "gpt-realtime",
            "audio": {
                "output": {
                    "voice": request.voice if request.voice else "alloy"
                }
            },
            "instructions": "Convert the provided text to natural, expressive speech with appropriate pacing and emotion."
        }
    }
    ws.send(json.dumps(session_config))

    # Send the text for conversion
    conversation_item = {
        "type": "conversation.item.create",
        "item": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": f"Please read the following text aloud:\n\n{request.text}"
                }
            ]
        }
    }
    ws.send(json.dumps(conversation_item))

    # Request audio response only
    response_request = {
        "type": "response.create",
        "response": {
            "modalities": ["audio"],
            "instructions": "Read the provided text naturally and expressively."
        }
    }
    ws.send(json.dumps(response_request))

    # Collect audio response
    audio_chunks = []
    response_complete = False

    while not response_complete:
        message = ws.recv()
        event = json.loads(message)

        if event["type"] == "response.output_audio.delta":
            audio_chunks.append(event.get("delta", ""))
        elif event["type"] == "response.done":
            response_complete = True
        elif event["type"] == "error":
            error_msg = event.get("error", {}).get("message", "Unknown error")
            ws.close()
            raise HTTPException(status_code=500, detail=f"Realtime API error: {error_msg}")

    ws.close()

    audio_base64 = "".join(audio_chunks)
    if not audio_base64:
        raise HTTPException(status_code=500, detail="No audio generated from Realtime API")

    return {
        "audio_base64": audio_base64,
        "text": request.text,
        "voice": request.voice if request.voice else "alloy",
        "realtime_api": True
    }


async def text_to_speech_realtime(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Generate audio narration using OpenAI Realtime API for direct, low-latency audio output.
    """
    try:
        return await run_openai_blocking(_text_to_speech_realtime_sync, request, settings.openai_api_key)
    except websocket.WebSocketException as ws_error:
        raise HTTPException(status_code=500, detail=f"WebSocket connection error: {str(ws_error)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")
