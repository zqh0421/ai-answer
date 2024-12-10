from typing import List
from fastapi import Depends
from openai import OpenAI
from ...config import Settings, get_settings
from typing_extensions import Annotated
from .call_gpt import call_gpt, format_question

def generate_feedback_using_rag_few(question: List[dict], answer: str, slide_text_arr: List[str], feedbackFramework: str, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    api_key = settings.openai_api_key  # Corrected to access openai_api_key
    print("slide_text_arr:",slide_text_arr)
    prompt_none = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following questions, and students' answers, and Slides Content,  provide feedback  accurately and relevantly in 2-3 sentence.\n\n" 
        f"Here are some examples:"
        f"1. Your answer is quite broad and doesn’t address the specific learning objectives of the course. According to slides,Try focusing on how design principles guide e-learning strategies. This will make your response more relevant and targeted."
        f"2. Your answer is not conrrect. According to slides,The link between learning and engineering is an interesting angle, but it needs more substance. Think about what aspects of e-learning design are critical to achieving effective learning outcomes. This could help make your answer more comprehensive."
        f"3. Your answer is conrrect. and it is consistent with the content in slides. You did a great job! "
        f"Slides Content: {slide_text_arr}\n\n"
    )
    prompt_component = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following questions, and students' answers, and Slides Content,provide feedback step-by-step, accurately and relevantly, following the four feedback levels (task, process, self-regulatory, and self). each feedback level only contain 2-3 sentences\n\n"  
        f" the output format must be: For Task:XXX\n For Process:XXX\n  For Self-Regulatory:XXX\n  For Self:XXX\n  "
        f"Here are some examples:"
        f"Example 1:\n"
        f"Question: What is Simple Regression?\n"
        f"PPT Content: Simple regression, also known as simple linear regression, is a statistical method used to model the relationship between two variables by fitting a linear equation to observed data. The two variables in simple regression are:\n"
        f"- Dependent variable (Y): The outcome or response variable that you are trying to predict or explain.\n" 
        f"- Independent variable (X): The predictor or explanatory variable that you use to predict the dependent variable.\n"
        f"Student's Answer: Simple regression is about the relationship between X and Y.\n"
        f"Step-by-step feedback:\n"
        f"- Task: your answer is partly correct but lacks the full explanation of what simple regression entails. Simple regression isn't just about the relationship between X and Y but about how a linear model is fitted to observed data to predict one variable using the other.\n"
        f"- Process: To improve the answer, you should revisit the content on linear regression and focus on the method used to fit the linear equation to data points. Reviewing the definitions of 'dependent' and 'independent' variables will help.\n"
        f"- Self-regulatory: You should reflect on how to expand your explanation and ensure they include details about the modeling process. ask youself whether you have addressed all the steps involved in simple regression.\n"
        f"- Self: Good effort! You're on the right track, but try to include more details next time. Keep practicing!\n"
        f"- Overall: Yout is on the right track but needs to add more details about the mechanics of fitting a linear equation in simple regression. With more focus, they will improve their understanding.\n"
        f"- Improved Answer: Simple regression models the relationship between X and Y by fitting a linear equation to observed data, where X is the independent variable used to predict Y, the dependent variable.\n\n"

        f"Example 2:\n"
        f"Question: What is Simple Regression?\n"
        f"PPT Content: Simple regression, also known as simple linear regression, is a statistical method used to model the relationship between two variables by fitting a linear equation to observed data. The two variables in simple regression are:\n"
        f"- Dependent variable (Y): The outcome or response variable that you are trying to predict or explain.\n"
        f"- Independent variable (X): The predictor or explanatory variable that you use to predict the dependent variable.\n"
        f"Student's Answer: Simple regression is a statistical method used to model the relationship between two variables by fitting a linear equation to observed data. The two variables in simple regression are Dependent variable (Y) and Independent variable (X).\n"
        f"Step-by-step feedback:\n"
        f"- Task: Your answer is completely correct!\n"
        f"- Process: To deepen their understanding, you could focus on how the model minimizes errors when fitting the linear equation. Reviewing examples of error minimization strategies may help.\n"
        f"- Self-regulatory: Please reflect on how they can reduce errors in future regression models. Are there ways they can validate their model further?\n"
        f"- Self: Excellent work! You have a strong understanding of simple regression. Keep exploring advanced concepts to sharpen your skills!\n"
        f"- Overall: Your answer is accurate.  Next, you should explore how errors can be minimized when fitting the linear model to data.\n"
        f"- Improved Answer: No need, the answer is already correct.\n"
        
        f"Now, apply the same process to the Slides Content, provided question and answer."

        f"Slides Content: {slide_text_arr}\n\n"
    )
    prompt_feature = (
        f"You are a helpful assistant that verifies answers to questions.  Please respond with yes or no about whther the answer is correct, and provide short explanations using 2-3 sentences."
        f"Based on the following questions, Slides content, and students' answers, provide feedback accurately and relevantly, and feedback needs to have these features:  "
        f"1. Task-Focused and Clear: Feedback should focus on the task, be specific and clear, offering actionable suggestions for improvement."
        f"2. Elaborated and Manageable: Provide feedback that explains why an answer is correct or incorrect in small, digestible portions, avoiding overload."
        f"3. Goal-Oriented: Feedback should be timely, helping learners understand their progress toward goals and reducing uncertainty."
        f"4. Encourages Learning Orientation: Promote a growth mindset by framing mistakes as part of the learning process and emphasizing effort."
        f" Please integrate these four FEATURES into a single paragraph of feedback text, not by presenting them separately, but by fusing and integrating them\n\n"
        f"Here are some examples:"
        f"Your answer is on the right track, focusing on the task of estimating Y values from X using the sum of squared errors, which is a key concept from the slide content. However, it could be more elaborated. The sum of squared errors, also known as residuals, is a measure of how well the regression line fits the data. The smaller the sum of squared errors, the better the estimate. But remember, it's not just about knowing the method, it's about understanding why and how it works. This understanding will help you progress towards your goal of mastering the topic. Also, don't be discouraged if you make mistakes or find this concept challenging. Learning is a process, and effort is more important than perfection. Keep practicing and you'll get there."
        f"Now, generate feedback for the follwing information:"
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