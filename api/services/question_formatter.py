from typing import List
from openai.types.responses import (
    ResponseInputParam,
    ResponseInputImageParam,
    ResponseInputTextParam,
)


def format_question(question: List[dict]) -> ResponseInputParam:
    """Format question payload into OpenAI response input schema."""
    formatted_question: ResponseInputParam = []
    for item in question:
        if item["type"] == "text":
            input_text: ResponseInputTextParam = {
                "type": "input_text",
                "text": item["content"],
            }
            formatted_question.append(input_text)
        elif item["type"] == "image":
            input_image: ResponseInputImageParam = {
                "type": "input_image",
                "image_url": f"{item['content']}",
                "detail": "auto",
            }
            formatted_question.append(input_image)
        else:
            raise ValueError(f"Unsupported question content type: {item['type']}")
    return formatted_question
