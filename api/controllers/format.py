from typing import List
from fastapi import Depends
from ..config import Settings, get_settings
from typing_extensions import Annotated
from .feedback.call_gpt import call_gpt, format_question
import json


def process_feedback_to_json(
    question: List[dict],
    answer: str,
    slide_text_arr: List[str],
    feedback_text: str,
    settings: Annotated[Settings, Depends(get_settings)],
    print_stream=False
) -> dict:

    api_key = settings.openai_api_key

    system_prompt = """

    You are an extraction assistant. Your task is to process feedback text and output a strictly structured JSON object only, without any additional explanation or text.

    Your output must follow this structure:

    {
        "concised feedback": "[A clear, concise revision of the original feedback, retaining key points and removing redundancy. Tooltips are integrated as plain terms.]",
        "terms": [
            { "[term 1]": "[tooltip explanation]" },
            { "[term 2]": "[tooltip explanation]" }
        ],
        "quotes": [
            {
            "section": "statement",
            "quotes": [
                "[Direct, concise phrases stating correctness or incorrectness.]"
            ]
            },
            {
            "section": "explanation",
            "quotes": [
                "[Phrases explaining the mistake or correct reasoning.]"
            ]
            },
            {
            "section": "advice",
            "quotes": [
                "[Concrete improvement suggestions or reflective prompts.]"
            ]
            }
        ]
        }
        Detailed Instructions:
            First, revise the feedback to be concise and remove redundancy. Keep key information.
            Identify terms from the feedback that require explanation (e.g., key concepts or technical terms) and extract their tooltip-style explanations. Do not repeat tooltip details within the feedback body.
            Extract strictly quotable phrases from the concised feedback, categorized into:
            statement: Phrases about whether the answer is correct or incorrect.
            explanation: Reasoning that explains the mistake or correct logic.
            advice: Actionable suggestions for improvement.
            ⚠️ Output only the JSON in the exact format. No additional explanation, comments, or plain text are allowed.


    """

    question_message = format_question(question)

    user_prompt = question_message
    user_prompt.append({
        "type": "text",
        "text": f"Answer: {answer}"
    })
    user_prompt.append({
        "type": "text",
        "text": f"Context Reference: {slide_text_arr}"
    })
    result = call_gpt(
        system_prompt,
        user_prompt,
        settings
    )

    return json.loads(result)
