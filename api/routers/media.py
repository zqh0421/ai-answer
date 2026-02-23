import base64
import openai
from fastapi import APIRouter, Depends, HTTPException
from typing_extensions import Annotated

from ..config import Settings, get_settings
from ..concurrency import run_openai_blocking
from ..models import TTSRequestModel, InteractiveNarrationModel
from ..tags import Tags

router = APIRouter(prefix="/api")


def _text_to_speech_sync(request: TTSRequestModel, api_key: str) -> dict:
    client = openai.OpenAI(api_key=api_key)
    response = client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=request.text,
    )
    audio_bytes = response.content
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    return {"audio_base64": audio_base64, "text": request.text, "voice": "alloy"}


def _interactive_narration_sync(request: InteractiveNarrationModel, api_key: str) -> dict:
    client = openai.OpenAI(api_key=api_key)
    visual_analysis = ""
    if request.has_images and hasattr(request, "slide_images") and request.slide_images:
        try:
            vision_content = [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_base64}"}}
                for img_base64 in request.slide_images
            ]
            vision_response = client.chat.completions.create(
                model="gpt-5",
                messages=[
                    {
                        "role": "system",
                        "content": "You are an teaching expert at analyzing educational slide images. Describe the visual elements, their locations, and what they illustrate in a structured way that can be used for audio narration guidance within in 50 words.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Analyze this slide image and describe: 1) What visual elements are present (diagrams, charts, text, images, etc.) 2) Their specific locations (top-left, center, bottom-right, etc.) 3) What each element illustrates or demonstrates. Be very specific about locations and content.",
                            },
                            *vision_content,
                        ],
                    },
                ],
            )
            visual_analysis = vision_response.choices[0].message.content
        except Exception:
            visual_analysis = "Visual elements are present but could not be analyzed in detail."

    system_prompt = """You are an expert teaching assistant who analyzes student answers, understands their learning gaps, and provides targeted guidance by pointing to specific visual elements on slides. Your role is to:

1. ANALYZE the student's answer to identify:
   - What they understand correctly
   - What they're missing or misunderstanding
   - Specific learning gaps or misconceptions

2. UNDERSTAND the structured feedback to identify:
   - Key areas that need improvement
   - Specific concepts the student should focus on
   - Learning objectives they haven't met

3. PROVIDE TARGETED GUIDANCE by:
   - Pointing to SPECIFIC visual elements on the slide that address their gaps
   - Explaining HOW these visual elements help solve their specific problems
   - Connecting visual content directly to their learning needs
   - Using precise directional language (top-right corner, center-left, bottom section, etc.)

4. BE CONVERSATIONAL AND SUPPORTIVE:
   - Acknowledge what they got right
   - Show empathy for their learning challenges
   - Provide encouraging, actionable guidance
   - Keep it concise but comprehensive (2-3 sentences) MUST BE LESS THAN 50 WORDS

CRITICAL: Your guidance must be directly tied to the student's specific answer and feedback. Don't give generic advice - address their exact learning needs."""

    user_prompt = f"""Analyze the student's answer and feedback, then provide targeted guidance by pointing to specific visual elements on the slide.

STUDENT ANALYSIS:
- Student's answer: \"{request.student_answer}\"
- Feedback received: \"{request.feedback}\"
- Learning context: Slide {request.page_number} from \"{request.slide_title}\"

VISUAL CONTENT:
- Slide content: \"{request.reference_content}\"
- Visual analysis: \"{visual_analysis if visual_analysis else 'No visual analysis available'}\"

YOUR TASK:
1. First, identify the student's specific learning gaps from their answer and feedback
2. Then, point to SPECIFIC visual elements on the slide that directly address these gaps
3. Explain HOW these visual elements help solve their specific problems
4. Provide actionable guidance on what to look for and how to understand it

EXAMPLE STRUCTURE:
\"Your answer shows you understand [correct part], but you're missing [specific gap]. Look at [specific location] on the slide - the [visual element] there shows [specific concept] which directly addresses [student's gap]. Pay attention to [specific detail] because it demonstrates [how to solve their problem].\"

IMPORTANT REQUIREMENTS:
- Be very specific about visual locations (top-right corner, center-left, bottom section, etc.)
- Reference actual visual content from the analysis
- Connect visual elements directly to the student's learning needs
- Provide concrete, actionable guidance
- Keep it encouraging and supportive

Generate a response that directly helps this specific student solve their specific learning problems."""

    chat_response = client.chat.completions.create(
        model="gpt-5",
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
    )
    interactive_text = (chat_response.choices[0].message.content or "Let me help you understand this material better.").strip()

    speech_response = client.audio.speech.create(model="tts-1", voice="alloy", input=interactive_text)
    audio_base64 = base64.b64encode(speech_response.content).decode("utf-8")

    return {
        "audio_base64": audio_base64,
        "text": interactive_text,
        "voice": request.voice,
        "interactive": True,
        "visual_analysis": visual_analysis,
    }


@router.post("/text-to-speech", tags=[Tags.MEDIA_SHARED_V1])
async def text_to_speech(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """Generate audio narration for reference material using OpenAI TTS."""
    try:
        return await run_openai_blocking(_text_to_speech_sync, request, settings.openai_api_key)
    except Exception as e:  # pragma: no cover - passthrough to HTTPException
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")


@router.post("/interactive-narration", tags=[Tags.MEDIA_SHARED_V1])
async def interactive_narration(request: InteractiveNarrationModel, settings: Annotated[Settings, Depends(get_settings)]):
    """Generate interactive, conversational narration using GPT-4o with visual analysis."""
    try:
        return await run_openai_blocking(_interactive_narration_sync, request, settings.openai_api_key)
    except Exception as e:  # pragma: no cover - passthrough to HTTPException
        raise HTTPException(status_code=500, detail=f"Interactive narration generation failed: {str(e)}")
