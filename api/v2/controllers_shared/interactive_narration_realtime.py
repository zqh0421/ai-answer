from fastapi import Depends, HTTPException
import json
import websocket
import base64
from typing_extensions import Annotated
from ...config import Settings, get_settings
from ...models import InteractiveNarrationModel

async def interactive_narration_realtime(request: InteractiveNarrationModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Generate interactive narration using OpenAI Realtime API for direct audio output.
    This provides low-latency, natural-sounding audio responses with multimodal understanding.
    """
    try:
        # Connect to Realtime API via WebSocket
        url = f"wss://api.openai.com/v1/realtime?model=gpt-realtime"
        ws = websocket.WebSocket()
        ws.connect(url, header={"Authorization": f"Bearer {settings.openai_api_key}"})
        
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
                "instructions": """You are an expert teaching assistant who provides targeted audio guidance.
                
                When analyzing student work:
                1. Identify what they understand correctly
                2. Pinpoint specific learning gaps or misconceptions
                3. Reference visual elements on slides when relevant
                4. Provide encouraging, actionable guidance
                5. Keep responses concise (under 50 words)
                6. Speak naturally with appropriate emotion and pacing
                
                Your audio should feel conversational and engaging, like a supportive tutor."""
            }
        }
        ws.send(json.dumps(session_config))
        
        # Build the conversation context
        conversation_context = f"""Student's answer: "{request.student_answer}"
Feedback received: "{request.feedback}"
Learning context: Slide {request.page_number} from "{request.slide_title}"
Reference content: "{request.reference_content}"

Provide targeted audio guidance that addresses their specific learning gaps."""
        
        # If images are provided, prepare them for multimodal input
        content_items = [
            {
                "type": "input_text",
                "text": conversation_context
            }
        ]
        
        # Add slide images if available for visual context
        if request.has_images and request.slide_images:
            for img_base64 in request.slide_images[:3]:  # Limit to 3 images for performance
                content_items.append({
                    "type": "image",
                    "image": img_base64
                })
        
        # Send the conversation item
        conversation_item = {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": content_items
            }
        }
        ws.send(json.dumps(conversation_item))
        
        # Request audio response
        response_request = {
            "type": "response.create",
            "response": {
                "modalities": ["audio", "text"],  # Request both audio and text
                "instructions": "Provide helpful guidance that directly addresses the student's learning gaps. Be encouraging and specific."
            }
        }
        ws.send(json.dumps(response_request))
        
        # Collect the response
        audio_chunks = []
        text_response = ""
        response_complete = False
        
        while not response_complete:
            message = ws.recv()
            event = json.loads(message)
            
            if event["type"] == "response.output_audio.delta":
                # Collect audio chunks
                audio_chunks.append(event.get("delta", ""))
                
            elif event["type"] == "response.output_text.delta":
                # Collect text response for reference
                text_response += event.get("delta", "")
                
            elif event["type"] == "response.done":
                # Response complete
                response_complete = True
                
            elif event["type"] == "error":
                # Handle errors
                error_msg = event.get("error", {}).get("message", "Unknown error")
                ws.close()
                raise HTTPException(status_code=500, detail=f"Realtime API error: {error_msg}")
        
        # Close the WebSocket connection
        ws.close()
        
        # Combine audio chunks into final base64 audio
        audio_base64 = "".join(audio_chunks)
        
        # Ensure we have valid audio data
        if not audio_base64:
            raise HTTPException(status_code=500, detail="No audio generated from Realtime API")
        
        return {
            "audio_base64": audio_base64,
            "text": text_response if text_response else "Audio guidance generated",
            "voice": request.voice,
            "interactive": True,
            "realtime_api": True
        }
        
    except websocket.WebSocketException as ws_error:
        raise HTTPException(status_code=500, detail=f"WebSocket connection error: {str(ws_error)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Interactive narration generation failed: {str(e)}")