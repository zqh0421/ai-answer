from typing import List
from fastapi import Depends
from ...config import Settings, get_settings
from typing_extensions import Annotated
from .call_gpt import call_gpt, format_question

def generate_feedback_using_rag_cot(question: List[dict], answer: str, slide_text_arr: List[str], feedbackFramework: str, isStructured: bool, settings: Annotated[Settings, Depends(get_settings)]) -> str:
    print("slide_text_arr:",slide_text_arr)

    if isStructured:
        prompt_corrective = (
            f"You are an expert in providing feedback for students' answers. Generate clear, effective feedback and format it into a combined structured output.\n\n"
            f"## Task 1: Generate Feedback\n"
            f"Generate feedback that meets all five criteria:\n\n"
            f"**Required Criteria:**\n"
            f"1. **Judgment Statement**: Begin by clearly stating whether the student's answer is correct or incorrect.\n"
            f"2. **Explain the Student's Answer with Context**:\n"
            f"   - If incorrect: Provide the correct answer directly to the student, and explain why this answer is correct and why the one they chose is incorrect.\n"
            f"   - If correct: Briefly explain why their choice fits and reference specific elements from the question.\n"
            f"3. **Use Specific Details from the Question**: Connect explanations to concrete elements from the question scenario—avoid abstract or generalized definitions.\n"
            f"4. **Provide suggestions for further study**: Include at least one strategy to help the student improve on similar future questions.\n"
            f"5. **Clarity and Brevity**: Keep the entire feedback clear, constructive, and under 100 words.\n\n"
            f"## Task 2: Format Output\n"
            f"Format your response as a JSON object with this exact structure:\n\n"
            f"```json\n"
            f"{{\n"
            f"  \"score\": \"[0 for incorrect, 1 for correct]\",\n"
            f"  \"feedback\": \"[A clear, concise revision of the original feedback, retaining key points and removing redundancy. Tooltips are integrated as plain terms.]\",\n"
            f"  \"structured_feedback\": \"<statement>[Your assessment - whether answer is correct or incorrect].</statement> <explanation>[Detailed explanation with <term explanation='[tooltip text]'>[highlighted terms]</term>].</explanation> <advice>[Actionable advice for improvement].</advice>\"\n"
            f"}}\n"
            f"```\n\n"
            f"**Formatting Instructions:**\n"
            f"- First, Identify terms from the feedback that require explanation (key concepts or technical terms) and extract their tooltip-style explanations\n"
            f"- Do not repeat tooltip details within the feedback body\n"
            f"- Extract strictly quotable phrases from the concised feedback, categorized into:\n"
            f"  - **statement**: Phrases about whether the answer is correct or incorrect\n"
            f"  - **explanation**: Reasoning that explains the mistake or correct logic  \n"
            f"  - **advice**: Actionable suggestions for improvement\n"
            f"- The terms in the \"terms\" array must use the exact wording as it appears in the feedback text\n"
            f"- The \"structured_feedback\" field MUST contain proper HTML with semantic tags:\n"
            f"  - Use <statement> tags for assessment (correct/incorrect)\n"
            f"  - Use <explanation> tags for detailed reasoning\n"
            f"  - Use <advice> tags for improvement suggestions\n"
            f"  - Use <term explanation='tooltip text'> tags for highlighted terms with tooltips\n"
            f"- IMPORTANT: The structured_feedback field must be valid HTML, not plain text\n"
            f"- You are not required to provide terms all the time, only provide terms when they are necessary for the learner to understand the feedback and improve their answer.\n"
            f"- For term explanation, not just providing the definition, but also provide the context of the term in the feedback, that is resonated with the learner's answer.\n"
            f"\n"
            f"**Example structured_feedback format:**\n"
            f"\"<statement>Your answer is incorrect.</statement> <explanation>The correct answer is <term explanation='A specific term that matches the question requirements'>test</term>. This matches the question's requirement for a specific term.</explanation> <advice>To improve, review the question carefully to ensure your answer aligns with the expected response.</advice>\"\n"
            f"\n"
            f"**Final Output**: Provide only the JSON object in the exact format specified above. No additional explanation, comments, or plain text are allowed.\n\n"
            f"Slides Content: {slide_text_arr}\n\n"
        )
        
        question_message = format_question(question)
        user_prompt = question_message
        user_prompt.append({
            "type": "text",
            "text": f"Answer: {answer}"
        })
        
        result = call_gpt(prompt_corrective, user_prompt, settings)
        return result
    
    # Original prompts for non-HTML format
    prompt_none = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following question, student's answer, and Slides Content, provide feedback accurately and relevantly in 2-3 sentences. Please think step by step using the following approach:\n\n"
        f"Please think step by step:"
        f"Step 1: Analyze the question and identify the key concepts that should be addressed.\n"
        f"Step 2: Evaluate the student's answer and determine if it addresses the key concepts and aligns with the content in the slides.\n"
        f"Step 3: Generate feedback that highlights any strengths or areas for improvement based on the comparison. Ensure the feedback is clear and actionable.\n"
        f"Here are some examples of feedback:\n"
        f"1. Your answer is quite broad and doesn't address the specific learning objectives of the course. According to the slides, try focusing on how design principles guide e-learning strategies. This will make your response more relevant and targeted.\n"
        f"2. Your answer is not correct. According to the slides, the link between learning and engineering is an interesting angle, but it needs more substance. Think about what aspects of e-learning design are critical to achieving effective learning outcomes. This could help make your answer more comprehensive.\n"
        f"3. Your answer is correct and consistent with the content in the slides. You did a great job!\n\n"
        f"Slides Content: {slide_text_arr}\n\n"
    )

    prompt_component = (
        f"You are an expert in providing feedback using 2-3 sentences for students' answer based on the questions"
        f"Based on the following questions, and students' answers, and Slides Content,provide feedback step-by-step, accurately and relevantly, following the four feedback levels (task, process, self-regulatory, and self). each feedback level only contain 2-3 sentences\n\n"  
        f" the output format must be: For Task:XXX\n For Process:XXX\n  For Self-Regulatory:XXX\n  For Self:XXX\n  "
        f"Please think step by step:"
        f"Step 1: Analyze the question and identify the key concepts that should be addressed.\n"
        f"Step 2: Evaluate the student's answer and determine if it addresses the key concepts and aligns with the content in the slides.\n"
        f"Step 3: Generate feedback about tasks.\n"
        f"Step 4: Generate feedback about Process.\n"
        f"Step 5: Generate feedback about Self-regulatory.\n"
        f"Step 6: Generate feedback about Self-Self.\n"
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
        f"Based on the following question, student's response, provide feedback accurately and relevantly, which is designed to promote learning, help learners obtain varied and frequent feedback information, and help them to develop understandings of their own role in the feedback process. "
        f"feedback content needs to meet the requirements of the below feedback characteristics\n"
        f"- Feedback encourages positive learner affect (i.e., Positively framed feedback comments are known to enhance learner self-efficacy and motivation).\n"
        f"- Feedback is usable for learners,be both clear and specific, give explanation, but please do not directly give the right answer if students' response is incorrect.\n "
        f"- Feedback needs to strengthen teacher and learner relationships,for instance, including a brief relational comment to display recognition and value of the individual learner behind the piece of work\n "
        f"- Feedback needs to invite dialogue about feedback, promote learner independence (i.e., invite students to ask question from teachers; invite dialogue through text-based feedback comments).\n"
        f"keep theses five requirements of feedback characteristics in mind, and then generate feedback according to following steps:"
        f"Step 1: provide critiques about the student's answer (that is to directly tell the student whether their response is correct or not, and give the reason). Please provide a strict evaluation based on the text of the provided slides.\n"
        f"Step 2: highlight the strengths of the student's answer (i.e., praise student in some aspect according to their response).\n"
        f"Step 3: provide actionable information for future learning (i.e., giving suggestion for the tasks, suggest learning skills or strategies).\n"
        f"Step 4: encourage the student's agency (e.g., direct invitations to discuss feedback or performance with the teacher; suggesting that the learner seek help from sources or resources other than the teacher; encouraging the learner to engage in further independent study).\n"
        f"The output should be a single paragraph containing less than 4 sentences.\n"
        f"Note: Please provide the feedback in a single paragraph without mentioning any 'components'.\n\n"
        f"Please think step-by-step according to above characteristics and components to analyze the student's response in relation to the question and the slides content. However, **do not include your reasoning in the final output; only provide the feedback to the student**.\n"
        f"\n"
        
        f"### Slides Content:\n{slide_text_arr}\n"
        f"using above information to generate feedback----,let's think and generate step by step"
        f"**Do not include your reasoning in the final output; only provide the feedback to the student.**\n\n"
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