from fastapi import Depends
from ...config import Settings, get_settings
from typing_extensions import Annotated, List
from .call_gpt import call_gpt, format_question


def generate_feedback_using_few(question: List[dict], answer: str, feedbackFramework: str, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    prompt_none = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following questions, and students' answers, and feedback examples,  provide feedback  accurately and relevantly in 2-3 sentence.\n\n"
        f"Here are some examples:"
        f"1. Your answer is quite broad and doesn’t address the specific learning objectives of the course. Try focusing on how design principles guide e-learning strategies. This will make your response more relevant and targeted."
        f"2. Your answer is not conrrect. The link between learning and engineering is an interesting angle, but it needs more substance. Think about what aspects of e-learning design are critical to achieving effective learning outcomes. This could help make your answer more comprehensive."
        f"3. Your answer is conrrect. You did a great job! "
    )
    prompt_component = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following questions, and students' answers, and feedback examples,provide feedback step-by-step, accurately and relevantly, following the four feedback levels (task, process, self-regulatory, and self). each feedback level only contain 2-3 sentences\n\n"
        f" the output format must be: For Task:XXX\n For Process:XXX\n  For Self-Regulatory:XXX\n  For Self:XXX\n  "
        f"Here are some examples:"
        f"questions:what is Simple Regression? ;students' answers: simple regression is about the relationship between X and Y;    Feedback: For Task:your answer is not completely correct, simple regression is not just the basic relationship between X with Y, it has more detailed information ; For process:to improve your answer, you need read the content in provided slides, and consider the complete definition, it refers to the linear regression, modeling the relationship between two variables by fitting a linear equation to observed data; For Self-regulatory: now, you may already know the complete definition of Simple regression, to write it down using words yourself; For:Self:good job! but there's still room for improvement. Keep studying and practicing, and you'll get there!   Improved Answer:XX "
        f"questions:what is Simple Regression? ;students' answers: Simple regression is a statistical method used to model the relationship between two variables by fitting a linear equation to observed data. The two variables in simple regression are Dependent variable (Y) and Independent variable (X);    Feedback: For Task:your answer is completely correct! ; For process:to get more deep understanding of simple regression, you can read the content in provided slides ; For Self-regulatory: you already know the complete definition of Simple regression, the next step you can to explore think how to reduce error in fit you data in simple regression; For:Self:well done! you are an expert in this question.  Improved Answer:no"
    )
    prompt_feature = (
        f"You are a helpful assistant that verifies answers to questions.  Please respond with yes or no about whther the answer is correct, and provide short explanations using 2-3 sentences."
        f"Based on the following questions, and students' answers, and feedback examples, provide feedback accurately and relevantly, and feedback needs to have these features:  "
        f"1. Task-Focused and Clear: Feedback should focus on the task, be specific and clear, offering actionable suggestions for improvement."
        f"2. Elaborated and Manageable: Provide feedback that explains why an answer is correct or incorrect in small, digestible portions, avoiding overload."
        f"3. Goal-Oriented: Feedback should be timely, helping learners understand their progress toward goals and reducing uncertainty."
        f"4. Encourages Learning Orientation: Promote a growth mindset by framing mistakes as part of the learning process and emphasizing effort."
        f" Please integrate these four FEATURES into a single paragraph of feedback text, not by presenting them separately, but by fusing and integrating them\n\n"
        f"Here are some examples:"
        f"1.Your answer touches on the basic concept of simple regression, mentioning the relationship between X and Y, which is a good start. However, it’s important to be more specific—simple regression explores how changes in X predict changes in Y, typically using a linear equation. To improve, consider explaining how this relationship is quantified, such as by describing the slope and intercept. This will help deepen your understanding of the topic, showing progress toward a more complete grasp of regression analysis. Remember, mistakes or gaps in your answer are opportunities to learn and grow, so keep refining your explanation!"
        f"2.Your answer gives a solid overview of simple regression, correctly identifying it as a method for modeling the relationship between two variables using a linear equation. To strengthen your explanation, consider discussing how the changes in the independent variable (X) impact the dependent variable (Y). Keep refining your understanding—you're on the right track!"
    )

    question_message = format_question(question)

    user_prompt = question_message
    user_prompt.append({
        "type": "text",
        "text": f"Answer: {answer}"
    })

    if feedbackFramework == "none":
        result = call_gpt(
            prompt_none,
            user_prompt,
            settings
        )
    if feedbackFramework == "component":
        result = call_gpt(
            prompt_component,
            user_prompt,
            settings
        )
    if feedbackFramework == "feature":
        result = call_gpt(
            prompt_feature,
            user_prompt,
            settings
        )

    return f"{result}"
