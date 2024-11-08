from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated
from .call_gpt import call_gpt

def generate_feedback_using_zero(question: str, answer: str, feedbackFramework: str, settings: Annotated[Settings, Depends(get_settings)], print_stream=False) -> str:
    prompt_none = (
        f"Based on the following questions, and students' answers, provide feedback  accurately and relevantly in 2-3 sentence.\n\n"  
        f"Question: {question}\n\n"
        f"Answer: {answer}\n\n"
    )
    prompt_component = (
        f"Based on the following questions, and students' answers, provide feedback step-by-step, accurately and relevantly, following the four feedback levels (task, process, self-regulatory, and self). each feedback level only contain 2-3 sentences\n\n"  
        f" the output format must be: For Task:XXX\n For Process:XXX\n  For Self-Regulatory:XXX\n  For Self:XXX\n  "
        f"Question: {question}\n\n"
        f"Answer: {answer}\n\n"
    )
    prompt_feature = (
        f"Based on the following questions, and students' answers, provide feedback accurately and relevantly, and feedback needs to have these features:  "
        f"1. Task-Focused and Clear: Feedback should focus on the task, be specific and clear, offering actionable suggestions for improvement."
        f"2. Elaborated and Manageable: Provide feedback that explains why an answer is correct or incorrect in small, digestible portions, avoiding overload."
        f"3. Goal-Oriented: Feedback should be timely, helping learners understand their progress toward goals and reducing uncertainty."
        f"4. Encourages Learning Orientation: Promote a growth mindset by framing mistakes as part of the learning process and emphasizing effort."
        f" Please integrate these four FEATURES into a single paragraph of feedback text, not by presenting them separately, but by fusing and integrating them\n\n"
        f"Question: {question}\n\n"
        f"Answer: {answer}\n\n"

    )
    
    if feedbackFramework=="none":
        result = call_gpt(
            "You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions",
            prompt_none,
            settings
        )
    if feedbackFramework=="component":
        result = call_gpt(
            "You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions",
            prompt_component,
            settings
        )
    if feedbackFramework=="feature":
        result = call_gpt(
            "You are a helpful assistant that verifies answers to questions.  Please respond with yes or no about whther the answer is correct, and provide short explanations using 2-3 sentences.",
            prompt_feature,
            settings
        )
    
    return f"{result}"