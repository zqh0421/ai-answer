import json
import websocket
import base64
import asyncio
from typing import Optional, Dict, Any
import openai
from fastapi import HTTPException

class RealtimeAPIClient:
    """
    Wrapper for OpenAI Realtime API WebSocket connection
    """
    def __init__(self, api_key: str, model: str = "gpt-realtime"):
        self.api_key = api_key
        self.model = model
        self.ws = None
        self.session_config = {
            "type": "realtime",
            "model": model,
            "audio": {
                "output": {
                    "voice": "alloy"
                }
            }
        }
        
    async def connect(self):
        """Establish WebSocket connection to Realtime API"""
        url = f"wss://api.openai.com/v1/realtime?model={self.model}"
        self.ws = websocket.WebSocket()
        self.ws.connect(url, header={"Authorization": f"Bearer {self.api_key}"})
        
        # Initialize session
        self.ws.send(json.dumps({
            "type": "session.update",
            "session": self.session_config
        }))
        
    async def disconnect(self):
        """Close WebSocket connection"""
        if self.ws:
            self.ws.close()
            
    def set_voice(self, voice: str):
        """Update the voice for audio output"""
        self.session_config["audio"]["output"]["voice"] = voice
        if self.ws:
            self.ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "audio": {
                        "output": {
                            "voice": voice
                        }
                    }
                }
            }))
            
    async def send_text_for_audio(self, text: str, voice: str = "alloy") -> Dict[str, Any]:
        """
        Send text to Realtime API and get audio response
        """
        try:
            if not self.ws:
                await self.connect()
                
            # Update voice if different
            if voice != self.session_config["audio"]["output"]["voice"]:
                self.set_voice(voice)
            
            # Send conversation item with text
            message_event = {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": text
                        }
                    ]
                }
            }
            self.ws.send(json.dumps(message_event))
            
            # Request response
            response_event = {
                "type": "response.create",
                "response": {
                    "modalities": ["audio"],
                    "instructions": "Convert the provided text to natural speech with appropriate emotion and pacing."
                }
            }
            self.ws.send(json.dumps(response_event))
            
            # Collect audio chunks
            audio_chunks = []
            transcript = ""
            
            while True:
                message = self.ws.recv()
                event = json.loads(message)
                
                if event["type"] == "response.output_audio.delta":
                    # Audio chunk received
                    audio_chunks.append(event["delta"])
                elif event["type"] == "response.output_audio_transcript.delta":
                    # Transcript chunk received
                    transcript += event.get("delta", "")
                elif event["type"] == "response.done":
                    # Response complete
                    break
                elif event["type"] == "error":
                    raise Exception(f"Realtime API error: {event.get('error', {}).get('message', 'Unknown error')}")
            
            # Combine audio chunks
            audio_base64 = "".join(audio_chunks)
            
            return {
                "audio_base64": audio_base64,
                "text": transcript if transcript else text,
                "voice": voice
            }
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Realtime API error: {str(e)}")
            
    async def send_conversation_with_images(self, system_prompt: str, user_prompt: str, 
                                           images: Optional[list[str]] = None,
                                           voice: str = "alloy") -> Dict[str, Any]:
        """
        Send a conversation with optional images and get audio response
        """
        try:
            if not self.ws:
                await self.connect()
                
            # Update voice if different
            if voice != self.session_config["audio"]["output"]["voice"]:
                self.set_voice(voice)
            
            # Build content array for user message
            user_content = [{"type": "input_text", "text": user_prompt}]
            
            # Add images if provided
            if images:
                for img_base64 in images:
                    user_content.append({
                        "type": "image",
                        "image": img_base64
                    })
            
            # Send system message
            system_event = {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": system_prompt
                        }
                    ]
                }
            }
            self.ws.send(json.dumps(system_event))
            
            # Send user message with content
            user_event = {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": user_content
                }
            }
            self.ws.send(json.dumps(user_event))
            
            # Request response with both text and audio
            response_event = {
                "type": "response.create",
                "response": {
                    "modalities": ["text", "audio"],
                    "instructions": "Provide a helpful response with natural speech."
                }
            }
            self.ws.send(json.dumps(response_event))
            
            # Collect response
            audio_chunks = []
            text_chunks = []
            
            while True:
                message = self.ws.recv()
                event = json.loads(message)
                
                if event["type"] == "response.output_audio.delta":
                    # Audio chunk received
                    audio_chunks.append(event.get("delta", ""))
                elif event["type"] == "response.output_text.delta":
                    # Text chunk received
                    text_chunks.append(event.get("delta", ""))
                elif event["type"] == "response.done":
                    # Response complete
                    break
                elif event["type"] == "error":
                    raise Exception(f"Realtime API error: {event.get('error', {}).get('message', 'Unknown error')}")
            
            # Combine chunks
            audio_base64 = "".join(audio_chunks)
            response_text = "".join(text_chunks)
            
            return {
                "audio_base64": audio_base64,
                "text": response_text,
                "voice": voice
            }
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Realtime API error: {str(e)}")


async def generate_client_secret(api_key: str, session_config: Optional[Dict[str, Any]] = None) -> str:
    """
    Generate an ephemeral client secret for client-side Realtime API connections
    """
    import httpx
    
    if not session_config:
        session_config = {
            "session": {
                "type": "realtime",
                "model": "gpt-realtime",
                "audio": {
                    "output": {"voice": "alloy"}
                }
            }
        }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json=session_config
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, 
                              detail=f"Failed to generate client secret: {response.text}")
        
        data = response.json()
        return data.get("value")