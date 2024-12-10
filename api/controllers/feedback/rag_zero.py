from typing import List
from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated
from .call_gpt import call_gpt, format_question

def generate_feedback_using_rag_zero(question: List[dict], answer: str, slide_text_arr: List[str], feedbackFramework: str, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    print("slide_text_arr:",slide_text_arr)
    prompt_none = (
        f"You are an expert tutor in providing feedback for studnet answers to questions. Please respond with correctness, and provide short explanations using 2-3 sentences, referring to given course materials. Please proposed a clear rubric and score the answer based on that."
        f"Based on the following questions, and students' answers, and Slides Content,  provide feedback  accurately and relevantly in 2-3 sentence.\n\n" 
        f"Slides Content: {slide_text_arr}\n\n"
    )
    prompt_component = (
        f"You are an expert tutor in providing feedback for studnet answers to questions. Please respond with correctness, and provide short explanations using 2-3 sentences, referring to given course materials."
        f"Based on the following questions, and students' answers, and Slides Content,provide feedback step-by-step, accurately and relevantly, following the four feedback levels (task, process, self-regulatory, and self). each feedback level only contain 2-3 sentences\n\n"  
        f" the output format must be: For Task:XXX\n For Process:XXX\n  For Self-Regulatory:XXX\n  For Self:XXX\n  "
        f"Slides Content: {slide_text_arr}\n\n"
    )
    prompt_feature = (
        f"You are an expert tutor in providing feedback for studnet answers to questions. Please respond with correctness, and provide short explanations using 2-3 sentences, referring to given course materials"
        f"Based on the following questions, Slides content, and students' answers, provide feedback accurately and relevantly, and feedback needs to have these features:  "
        f"1. Task-Focused and Clear: Feedback should focus on the task, be specific and clear, offering actionable suggestions for improvement."
        f"2. Elaborated and Manageable: Provide feedback that explains why an answer is correct or incorrect in small, digestible portions, avoiding overload."
        f"3. Goal-Oriented: Feedback should be timely, helping learners understand their progress toward goals and reducing uncertainty."
        f"4. Encourages Learning Orientation: Promote a growth mindset by framing mistakes as part of the learning process and emphasizing effort."
        f" Please integrate these four FEATURES into a single paragraph of feedback text, not by presenting them separately, but by fusing and integrating them\n\n"
        f"Slides Content: {slide_text_arr}\n\n"
    )

    question_message = format_question(question)

    user_prompt = question_message
    user_prompt.append({
        "type": "text",
        "text": f"Answer: {answer}"
    })
    
    if feedbackFramework=="none":
        result = call_gpt(
            prompt_none,
            user_prompt,
            settings
        )
    if feedbackFramework=="component":
        result = call_gpt(
            prompt_component,
            user_prompt,
            settings
        )
    if feedbackFramework=="feature":
        result = call_gpt(
            prompt_feature,
            user_prompt,
            settings
        )
    
    return f"{result}"