from typing import List, Optional
from fastapi import Depends
from ....config import Settings, get_settings
from typing_extensions import Annotated
from ..call_gpt_oeq import call_gpt_oeq, format_question_oeq
from sqlalchemy.orm import Session
from ....schema.resultSchema import RecordResult


def get_participant_question_record_count_oeq(participant_id: str, question_id: str, db: Session) -> int:
    """
    Get the count of records for a specific participant and question.
    This helps determine if it's the learner's first attempt.

    Args:
        participant_id: The ID of the participant/learner
        question_id: The ID of the question
        db: Database session

    Returns:
        int: Number of records found for this participant-question combination
    """
    return db.query(RecordResult).filter(
        RecordResult.learner_id == participant_id,
        RecordResult.question_id == question_id
    ).count()


def generate_feedback_using_rag_cot_oeq(participant_id: str, question_id: str, question: List[dict], answer: str, slide_text_arr: List[str], feedbackFramework: str, isStructured: bool, course_version: Optional[str], settings: Annotated[Settings, Depends(get_settings)], db: Session) -> str:
    print("slide_text_arr:", slide_text_arr)

    if isStructured:
        prompt_corrective = (
            f"# Integrated Student Feedback Generation and Formatting Prompt for Open-Ended Questions\n\n"
            f"## Task 1: Generate Feedback\n"
            f"Generate feedback that meets all five criteria:\n\n"
            f"**Required Criteria:**\n"
            f"1. **Judgment Statement**: Begin by clearly stating whether the student's answer is correct, incorrect, or partially correct.\n"
            f"Note: Please evaluate the student’s response to the open-ended question by comparing it with the reference answer:\n"
            f"- Score 1 (Correct): The response fully covers all key points in the reference answer, with no contradictions.\n"
            f"- Score 2 (Partially Correct): The response includes some of the key points but misses others or contains information that partly contradicts the reference.\n"
            f"- Score 0 (Incorrect): The response does not cover any key points from the reference answer or directly contradicts them.\n"
            f"2. **Explain the Student's Answer with Context**:\n"
            f"   - If incorrect: Provide the correct answer directly to the student, and explain why this answer is correct and why the one they provided is incorrect.\n"
            f"   - If correct: Briefly explain why their answer is accurate and reference specific elements from the question.\n"
            f"   - If partially correct: Acknowledge what aspects are correct, then explain what is missing or incorrect, and provide the complete correct answer."
            f"3. **Use Specific Details from the Question**: Connect explanations to concrete elements from the question scenario—avoid abstract or generalized definitions.\n"
            f"4. **Provide suggestions for further study**: Include at least one strategy to help the student improve on similar future questions. This can be:\n"
            f"  - A practical tip (e.g., 'Try asking whether this shows appearance or relationships.')"
            f"  - A strategic suggestion for solving similar problems (e.g., 'Take a look at…')"
            f"  - A suggestion to help students remember key knowledge or review specific materials (e.g., 'Review the concept of…')"
            f"  - A reflective question (e.g., 'What kind of information does this help you understand?')"
            f"5. **Clarity and Brevity**: Keep the entire feedback clear, constructive, and under 100 words.\n\n"

            f"## Task 2: Format Output\n"
            f"Format your response as a JSON object with this exact structure:\n\n"
            f"```json\n"
            f"{{\n"
            f"  \"score\": \"[0 for incorrect, 1 for correct, 2 for partially correct]\",\n"
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
            f"  - Use <statement> tags for short sentense/phrases for whether the answer is correct or incorrect\n"
            f"  - Use <explanation> tags for reasoning that explains the mistake or correct logicn"
            f"  - Use <advice> tags for actionable suggestions for improvement\n"
            f"  - Use <term explanation='tooltip text'> tags for highlighted terms with tooltips, must use the exact wording as it appears in the feedback text\n"
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

        prompt_learner = (
            f"# Integrated Student Feedback Generation and Formatting Prompt\n\n"
            f"You are tasked with generating clear, effective feedback for a student's open-ended answer and then formatting it into a structured JSON output. Complete both tasks in sequence.\n\n"
            f"## Task 1: Generate Feedback\n\n"
            f"Generate feedback that meets all seven criteria:\n\n"
            f"**Required Criteria:**\n\n"
            f"1. **Judgment Statement**: Begin by clearly stating whether the student's answer is correct or incorrect.\n\n"
            f"Note: Please evaluate the student’s response to the open-ended question by comparing it with the reference answer:\n"
            f"- Score 1 (Correct): The response fully covers all key points in the reference answer, with no contradictions.\n"
            f"- Score 2 (Partially Correct): The response includes some of the key points but misses others or contains information that partly contradicts the reference.\n"
            f"- Score 0 (Incorrect): The response does not cover any key points from the reference answer or directly contradicts them.\n"
            f"2. **Explain the Student's Answer with Context**:\n"
            f"   - If incorrect: **Start by directly quoting or paraphrasing the student's specific response**, then explain what their answer means and why it doesn't fully address the question requirements. **CRITICAL: DO NOT reveal, mention, hint at, or describe the correct answer in any form.**\n"
            f"   - If correct: **Reference their specific response**, briefly explain why their choice fits and reference specific elements from the question.\n"
            f"   - If partially correct: **Acknowledge their specific response and what aspects are correct**, then tell students that something is missing or incomplete in their analysis, but **CRITICAL: DO NOT reveal, mention, hint at, or describe the correct answer in any form.**\n\n"
            f"3. **Use Specific Details from the Question**: Connect explanations to concrete elements from the question scenario—avoid abstract or generalized definitions. **MANDATORY: Reference at least 3 specific elements mentioned in the question prompt**. **Connect the student's response directly to these specific scenario elements.**\n\n"
            f"4. **Provide Multiple Suggestions for Further Study**: Include several strategies to help the student improve on similar future questions. **MUST incorporate specific references to the retrieved slides content and question context. CRITICAL: Must include at least 2-3 specific reflective questions that guide the student's thinking process**:\n"
            f"   - **Context-specific reflective questions** that guide critical thinking about the specific scenario presented. **MANDATORY: Generate 2-3 very specific reflective questions directly related to this question's scenario and content**\n"
            f"   - **Slide-informed learning strategies** that reference relevant concepts from the retrieved slides\n"
            f"   - **Scenario-based exploration prompts** that encourage students to examine similar examples or apply the same analytical framework to comparable situations\n"
            f"   - **Question-specific metacognitive prompts** that help students develop critical thinking skills for evaluating the specific type of content or scenario presented\n\n"
            f"5. **Encourage Student Autonomy and Agency**: \n"
            f"   - Invite students to take ownership of their learning\n"
            f"   - Suggest they seek additional resources or engage in independent study\n"
            f"   - Encourage them to ask questions and engage in dialogue\n"
            f"   - Frame learning as an active, student-driven process\n"
            f"   - **Connect to specific slide content and encourage independent exploration**\n\n"
            f"6. **Maintain Highly Positive and Supportive Tone**: Use encouraging language that:\n"
            f"   - Celebrates their thinking process and effort\n"
            f"   - Frames mistakes as learning opportunities\n"
            f"   - Builds confidence and motivation\n"
            f"   - Recognizes their potential for growth\n"
            f"   - Values their engagement and curiosity\n\n"
            f"7. **Clarity and Engagement**: Keep the entire feedback clear, constructive, and under 120 words in a single paragraph format that feels conversational and supportive. "
            f"**Must include at least 2-3 specific references to elements from the question scenario and 1-2 references to the slide content. Include 2-4 key technical terms that would benefit from tooltip explanations. "
            f"CRITICAL: Must include at least 2 specific reflective questions that guide student thinking about this particular scenario.**\n\n"
            f"**ABSOLUTE RESTRICTION**: \n"
            f"- **NEVER provide, hint at, or describe the correct answer**\n"
            f"- **NEVER mention specific elements that should or shouldn't be included**\n"
            f"- Focus ONLY on guiding the student's thinking process and self-discovery\n\n"
            f"**REQUIRED INTEGRATION**: \n"
            f"- **MUST reference specific elements from the question scenario** (using the concrete details, examples, or contexts provided in the question prompt)\n"
            f"- **MUST incorporate guidance from the retrieved slides** (referencing relevant principles, concepts, frameworks, or information shown in the slide content)\n"
            f"- **MUST make suggestions contextually relevant** to the specific scenario and learning context rather than generic advice\n\n"
            f"## Task 2: Format Output\n"
            f"Format your response as a JSON object with this exact structure:\n\n"
            f"```json\n"
            f"{{\n"
            f"  \"score\": \"[0 for incorrect, 1 for correct, 2 for partially correct]\",\n"
            f"  \"feedback\": \"[Encouraging, learning-focused feedback that guides understanding]\",\n"
            f"  \"structured_feedback\": \"<statement>[Supportive assessment of their attempt].</statement> <explanation>[Clear, encouraging explanation with <term explanation='[helpful context]'>[key concepts]</term>].</explanation> <advice>[Constructive suggestions including reflective questions].</advice>\"\n"
            f"}}\n"
            f"```\n\n"
            f"**Formatting Instructions:**\n"
            f"- Identify key concepts that need explanation and provide helpful tooltips\n"
            f"- Use an encouraging, supportive tone throughout\n"
            f"- The \"structured_feedback\" field MUST contain proper HTML with semantic tags:\n"
            f"  - Use <statement> tags for supportive assessment\n"
            f"  - Use <explanation> tags for clear, encouraging explanations\n"
            f"  - Use <advice> tags for constructive learning suggestions (must include reflective questions)\n"
            f"  - Use <term explanation='tooltip text'> tags for key concepts with helpful explanations\n"
            f"- Remember: This is their first attempt - be encouraging and supportive!\n"
            f"- CRITICAL: The advice section MUST include 2-3 specific reflective questions about the scenario\n\n"
            f"**Final Output**: Provide only the JSON object. Focus on encouraging learning and building confidence while guiding self-discovery.\n\n"
            f"Slides Content: {slide_text_arr}\n\n"
        )

        question_message = format_question_oeq(question)
        user_prompt = question_message
        user_prompt.append({
            "type": "input_text",
            "text": f"Answer: {answer}"
        })

        # Handle course versions
        # v2b: always corrective
        # v2c: first try learner, later corrective
        # other versions: use attempt-based logic (default behavior)
        if course_version == "v2b":
            system_prompt = prompt_corrective  # Always use corrective feedback for v2b
            print(
                f"[DEBUG] Course version v2b detected - using prompt_corrective for participant {participant_id}")
        elif course_version == "v2c":
            # v2c uses learner/corrective based on attempts
            record_count = get_participant_question_record_count_oeq(
                participant_id, question_id, db)
            print(
                f"[DEBUG] Course version v2c - Participant: {participant_id}, Question: {question_id}, Record Count: {record_count}")

            # Select prompt based on attempt count
            if record_count < 1:
                system_prompt = prompt_learner  # First attempt - learning focus
                print(
                    f"[DEBUG] v2c Using prompt_learner (first attempt) for participant {participant_id}")
            else:
                system_prompt = prompt_corrective  # Subsequent attempts - corrective focus
                print(
                    f"[DEBUG] v2c Using prompt_corrective (attempt #{record_count + 1}) for participant {participant_id}")
        else:
            # Get record count to determine which prompt to use (default behavior)
            record_count = get_participant_question_record_count_oeq(
                participant_id, question_id, db)
            print(
                f"[DEBUG] Participant: {participant_id}, Question: {question_id}, Record Count: {record_count}")

            # Select prompt based on attempt count
            if record_count < 1:
                system_prompt = prompt_learner  # First attempt - learning focus
                print(
                    f"[DEBUG] Using prompt_learner (first attempt) for participant {participant_id}")
            else:
                system_prompt = prompt_corrective  # Subsequent attempts - corrective focus
                print(
                    f"[DEBUG] Using prompt_corrective (attempt #{record_count + 1}) for participant {participant_id}")

        result = call_gpt_oeq(system_prompt, user_prompt, settings)
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

    question_message = format_question_oeq(question)

    user_prompt = question_message
    user_prompt.append({
        "type": "input_text",
        "text": f"Answer: {answer}"
    })

    if feedbackFramework == "none":
        result = call_gpt_oeq(
            prompt_none,
            user_prompt,
            settings
        )
    if feedbackFramework == "component":
        result = call_gpt_oeq(
            prompt_component,
            user_prompt,
            settings
        )
    if feedbackFramework == "feature":
        result = call_gpt_oeq(
            prompt_feature,
            user_prompt,
            settings
        )

    return f"{result}"


def generate_feedback_using_rag_cot_stream_oeq(participant_id: str, question_id: str, question: List[dict], answer: str, slide_text_arr: List[str], feedbackFramework: str, isStructured: bool, course_version: Optional[str], settings: Annotated[Settings, Depends(get_settings)], db: Session):
    """
    Streaming version of generate_feedback_using_rag_cot for structured feedback
    """
    print("slide_text_arr:", slide_text_arr)

    if not isStructured:
        # For non-structured feedback, fall back to regular function
        result = generate_feedback_using_rag_cot_oeq(
            participant_id, question_id, question, answer, slide_text_arr, feedbackFramework, isStructured, course_version, settings, db)
        yield f"data: {result}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Define both prompts for structured feedback
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
        f"  \"score\": \"[0 for incorrect, 1 for correct, 2 for partially correct]\",\n"
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

    prompt_learner = (
        f"You are a supportive teaching assistant helping a student learn. This is their FIRST attempt at this question. Generate encouraging, learning-focused feedback.\n\n"
        f"## Your Role:\n"
        f"As this is the student's first attempt, focus on:\n"
        f"- Encouraging exploration and learning\n"
        f"- Building confidence while guiding understanding\n"
        f"- Providing constructive guidance without being overly critical\n\n"
        f"## Task 1: Generate Learning-Focused Feedback\n"
        f"Generate feedback that meets these criteria:\n\n"
        f"**Required Elements:**\n"
        f"1. **Acknowledgment**: Start by acknowledging their attempt and effort.\n"
        f"2. **Assessment with Encouragement**:\n"
        f"   - If incorrect: Gently guide them toward the correct understanding without harsh criticism.\n"
        f"   - If correct: Celebrate their success and reinforce why their answer works.\n"
        f"3. **Learning Guidance**: Provide clear explanations that help them understand the concept better.\n"
        f"4. **Next Steps**: Suggest specific ways to deepen their understanding or build on what they've learned.\n"
        f"5. **Supportive Tone**: Maintain an encouraging, supportive tone throughout (under 100 words).\n\n"
        f"## Task 2: Format Output\n"
        f"Format your response as a JSON object with this exact structure:\n\n"
        f"```json\n"
        f"{{\n"
        f"  \"score\": \"[0 for incorrect, 1 for correct, 2 for partially correct]\",\n"
        f"  \"feedback\": \"[Encouraging, learning-focused feedback that guides understanding]\",\n"
        f"  \"structured_feedback\": \"<statement>[Supportive assessment of their attempt].</statement> <explanation>[Clear, encouraging explanation with <term explanation='[helpful context]'>[key concepts]</term>].</explanation> <advice>[Constructive suggestions for learning].</advice>\"\n"
        f"}}\n"
        f"```\n\n"
        f"**Formatting Instructions:**\n"
        f"- Identify key concepts that need explanation and provide helpful tooltips\n"
        f"- Use an encouraging, supportive tone throughout\n"
        f"- The \"structured_feedback\" field MUST contain proper HTML with semantic tags:\n"
        f"  - Use <statement> tags for supportive assessment\n"
        f"  - Use <explanation> tags for clear, encouraging explanations\n"
        f"  - Use <advice> tags for constructive learning suggestions\n"
        f"  - Use <term explanation='tooltip text'> tags for key concepts with helpful explanations\n"
        f"- Remember: This is their first attempt - be encouraging!\n"
        f"\n"
        f"**Example structured_feedback format:**\n"
        f"\"<statement>Good effort on your first attempt!</statement> <explanation>While your answer isn't quite right, you're thinking in the right direction. The correct approach involves <term explanation='A fundamental concept that helps solve this type of problem'>key concept</term>.</explanation> <advice>Try reviewing the slides about this topic, and think about how the concepts connect to real examples.</advice>\"\n"
        f"\n"
        f"**Final Output**: Provide only the JSON object. Focus on encouraging learning and building confidence.\n\n"
        f"Slides Content: {slide_text_arr}\n\n"
    )

    question_message = format_question_oeq(question)
    user_prompt = question_message
    user_prompt.append({
        "type": "input_text",
        "text": f"Answer: {answer}"
    })

    # Handle course versions
    # v2b: always corrective
    # v2c: first try learner, later corrective
    # other versions: use attempt-based logic (default behavior)
    if course_version == "v2b":
        prompt_version = "prompt_corrective"
        system_prompt = prompt_corrective  # Always use corrective feedback for v2b
        print(
            f"[DEBUG STREAM] Course version v2b detected - using prompt_corrective for participant {participant_id}")
    elif course_version == "v2c":
        # v2c uses learner/corrective based on attempts
        record_count = get_participant_question_record_count_oeq(
            participant_id, question_id, db)
        print(
            f"[DEBUG STREAM] Course version v2c - Participant: {participant_id}, Question: {question_id}, Record Count: {record_count}")

        # Determine prompt version based on attempt count
        prompt_version = "prompt_learner" if record_count < 1 else "prompt_corrective"

        # Select prompt based on attempt count
        if record_count < 1:
            system_prompt = prompt_learner  # First attempt - learning focus
            print(
                f"[DEBUG STREAM] v2c Using prompt_learner (first attempt) for participant {participant_id}")
        else:
            system_prompt = prompt_corrective  # Subsequent attempts - corrective focus
            print(
                f"[DEBUG STREAM] v2c Using prompt_corrective (attempt #{record_count + 1}) for participant {participant_id}")
    else:
        # Get record count to determine which prompt to use (default behavior)
        record_count = get_participant_question_record_count_oeq(
            participant_id, question_id, db)
        print(
            f"[DEBUG STREAM] Participant: {participant_id}, Question: {question_id}, Record Count: {record_count}")

        # Determine prompt version based on attempt count
        prompt_version = "prompt_learner" if record_count < 1 else "prompt_corrective"

        # Select prompt based on attempt count
        if record_count < 1:
            system_prompt = prompt_learner  # First attempt - learning focus
            print(
                f"[DEBUG STREAM] Using prompt_learner (first attempt) for participant {participant_id}")
        else:
            system_prompt = prompt_corrective  # Subsequent attempts - corrective focus
            print(
                f"[DEBUG STREAM] Using prompt_corrective (attempt #{record_count + 1}) for participant {participant_id}")

    # Send prompt version as metadata
    import json
    metadata = {
        "type": "metadata",
        "prompt_version": prompt_version
    }
    yield f"data: {json.dumps(metadata)}\n\n"

    # Stream the response chunk by chunk
    for chunk in call_gpt_oeq(system_prompt, user_prompt, settings):
        yield f"data: {chunk}\n\n"

    yield "data: [DONE]\n\n"
