from typing import List, Dict, Optional, Any
import asyncio
import json
from fastapi import Depends
from sqlalchemy.orm import Session
from ....config import Settings, get_settings
from ....schema.resultSchema import RecordResult
from ....schema.questionSchema import Question
from ....schema.courseSchema import Slide
from ..call_gpt_mcq import call_gpt_mcq_async, format_question_mcq
from typing_extensions import Annotated


def get_participant_question_record_count_mcq(participant_id: str, question_id: str, db: Session) -> int:
    """
    Get the count of records for a specific participant and question.
    This helps determine if it's the learner's first attempt.
    """
    return db.query(RecordResult).filter(
        RecordResult.learner_id == participant_id,
        RecordResult.question_id == question_id
    ).count()


async def generate_feedback_for_option(
    option_index: int,
    option_text: str,
    is_correct: bool,
    question_content: List[Dict[str, Any]],
    all_options: List[Dict[str, str]],
    human_feedback: Optional[str],
    slide_text_arr: List[str],
    feedback_type: str,  # "corrective" or "learner"
    settings: Settings
) -> Dict[str, Any]:
    """
    Generate feedback for a single MCQ option.

    Returns:
        Dict with feedback information for this option
    """

    # Build context about all options
    options_context = "\n".join([
        f"{i+1}. {opt['text']} {'(Correct)' if opt.get('isCorrect', False) else '(Incorrect)'}"
        for i, opt in enumerate(all_options)
    ])

    # Find the correct option(s) - needed for both feedback types
    correct_options = [
        i+1 for i, opt in enumerate(all_options) if opt.get('isCorrect', False)]
    correct_text = f"Option {', '.join(map(str, correct_options))}" if correct_options else "Not specified"

    if feedback_type == "corrective":

        system_prompt = (

            f"# Integrated Student Feedback Generation and Formatting Prompt for Multiple-Choice Questions\n\n"
            f"## Task 1: Generate Feedback\n"
            f"Generate feedback that meets all five criteria:\n\n"
            f"**Required Criteria:**\n"
            f"1. **Judgment Statement**: Begin by clearly stating whether the student's answer is correct, incorrect.\n"
            f"2. **Explain the Student's Answer with Context**:\n"
            f"   - If incorrect: Provide the correct answer directly to the student, and explain why this answer is correct and why the one they provided is incorrect.\n"
            f"   - If correct: Briefly explain why their answer is accurate and reference specific elements from the question.\n"
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
            f"  \"score\": \"[0 for incorrect, 1 for correct]\",\n"
            f"  \"feedback\": \"[A clear, concise revision of the original feedback, retaining key points and removing redundancy. Tooltips are integrated as plain terms.]\",\n"
            f"  \"structured_feedback\": \"<statement>[Your assessment - whether answer is correct or incorrect].</statement> <explanation>[Detailed explanation with <term explanation='[tooltip text]'>[highlighted terms]</term>].</explanation> <advice>[Actionable advice for improvement].</advice>\"\n"
            f"}}\n"
            f"```\n\n"
            f"**Formatting Instructions:**\n"
            f" - First, Identify terms from the feedback that require explanation (key concepts or technical terms) and extract their tooltip-style explanations\n"
            f"  - Do not repeat tooltip details within the feedback body\n"
            f"  - Extract strictly quotable phrases from the concised feedback, categorized into:\n"
            f"  - **statement**: Phrases about whether the answer is correct or incorrect\n"
            f"  - **explanation**: Reasoning that explains the mistake or correct logic\n"
            f"  - **advice**: Actionable suggestions for improvement\n"
            f"   CRITICAL: The terms in the 'terms' array must use the exact wording as it appears in the feedback text, with no modifications, paraphrasing, or rewording whatsoever\n"
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
    else:  # learner feedback
        system_prompt = (
            f"# Integrated Student Feedback Generation and Formatting Prompt\n\n"
            f"You are tasked with generating clear, effective feedback for a student's multiple-choice answer and then formatting it into a structured JSON output. Complete both tasks in sequence.\n\n"
            f"## Task 1: Generate Feedback\n\n"
            f"Generate feedback that meets all seven criteria:\n\n"
            f"**Required Criteria:**\n\n"
            f"1. **Judgment Statement**: Begin by clearly stating whether the student's answer is correct or incorrect.\n\n"
            f"2. **Explain the Student's Answer with Context**:\n"
            f"   - If incorrect: **Start by directly quoting or paraphrasing the student's specific response**, then explain what their answer means and why it doesn't fully address the question requirements. **CRITICAL: DO NOT reveal, mention, hint at, or describe the correct answer in any form.**\n"
            f"   - If correct: **Reference their specific response**, briefly explain why their choice fits and reference specific elements from the question.\n"
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
            f"  \"score\": \"[0 for incorrect, 1 for correct]\",\n"
            f"  \"feedback\": \"[Encouraging, learning-focused feedback that guides understanding]\",\n"
            f"  \"structured_feedback\": \"<statement>[Supportive assessment of their attempt].</statement> <explanation>[Clear, encouraging explanation with <term explanation='[helpful context]'>[key concepts]</term>].</explanation> <advice>[Constructive suggestions including reflective questions].</advice>\"\n"
            f"}}\n"
            f"```\n\n"
            f"**Formatting Instructions:**\n"
            f"- **CRITICAL**: Maintain the same ABSOLUTE RESTRICTION as Task 1 - DO NOT reveal, mention, hint at, or describe the correct answer, model answer, or any specific elements from the model answer during formatting\n"
            f"- **Terms Extraction**: Please identify 1-3 key technical terms or concepts from the feedback that students might need clarification on (e.g., 'multimedia principle', 'cognitive load', 'relevance', 'learning objectives', 'decoractive', etc.). The terms must use the exact wording as it appears in the feedback text.\n"
            f"- **Content Composition Guidelines**:"
            f"- The \"structured_feedback\" field MUST contain proper HTML with semantic tags:\n"
            f"  - Use <statement> tags for supportive assessment\n"
            f"  - Use <explanation> tags for clear, encouraging explanations\n"
            f"  - Use <advice> tags for constructive learning suggestions (must include reflective questions)\n"
            f"  - Use <term explanation='tooltip text'> tags for key concepts with helpful explanations\n"
            f"**Final Output**: Provide only the JSON object. Focus on encouraging learning and building confidence while guiding self-discovery.\n\n"
            f"Slides Content: {slide_text_arr}\n\n"
        )

    # Format question content
    formatted_question = format_question_mcq(question_content)

    # Add the specific option being evaluated
    user_content = formatted_question + [
        {"type": "input_text", "text": f"\nAll MCQ options:\n{options_context}\nCorrect answer:{correct_text}" +
            f"\nStudent selected: Option {option_index + 1}: {option_text}"}
    ]

    try:
        response = await call_gpt_mcq_async(system_prompt, user_content, settings)
        # Parse JSON response
        feedback_data = json.loads(response)

        # Extract structured feedback (following OEQ pattern)
        structured_feedback = feedback_data.get("structured_feedback", "")
        regular_feedback = feedback_data.get("feedback", "")
        score = feedback_data.get("score", "1" if is_correct else "0")

        # Use structured feedback as the main feedback (like OEQ)
        if not structured_feedback and regular_feedback:
            # Fallback: create basic structured format if only regular feedback exists
            structured_feedback = f"""<statement>{'Your choice is correct.' if is_correct else 'Your choice is incorrect.'}</statement>
                <explanation>{regular_feedback}</explanation>
                <advice>Continue practicing to improve your understanding.</advice>"""

        return {
            "option_index": option_index,
            "feedback_type": feedback_type,
            "feedback": structured_feedback,  # Use structured feedback as main
            "score": score,
            "isCorrect": is_correct
        }
    except Exception as e:
        print(f"Error generating feedback for option {option_index}: {e}")
        # Return empty feedback on error - no fallback
        return {
            "option_index": option_index,
            "feedback_type": feedback_type,
            "feedback": "",  # Empty feedback indicates generation failed
            "isCorrect": is_correct
        }


async def generate_all_feedback_for_mcq(
    question_id: str,
    question_content: List[Dict[str, Any]],
    options: List[Dict[str, Any]],
    mcq_human_feedback: Optional[List[str]],
    slide_ids: List[str],
    settings: Settings,
    db: Session
) -> Dict[str, List[str]]:
    """
    Generate feedback for all MCQ options in parallel.
    Returns both corrective and learner feedback arrays.

    Note: 
    - Corrective feedback is used for subsequent attempts in v2a/v2b, and all attempts in other versions
    - Learner feedback is used for first attempt in v2a and v2b
    - For non-v2a/v2b versions, only corrective AI feedback is displayed
    """

    # Fetch slide content from pages
    from ....schema.courseSchema import Page
    slide_text_arr = []
    if slide_ids:
        # Get all pages for the given slide IDs
        pages = db.query(Page).filter(Page.slide_id.in_(slide_ids)).order_by(
            Page.slide_id, Page.page_number).all()
        for page in pages:
            if page.text:
                slide_text_arr.append(page.text)
            if page.image_text:
                slide_text_arr.append(page.image_text)

    # Prepare tasks for parallel execution
    tasks = []

    for i, option in enumerate(options):
        option_text = option.get("text", "")
        is_correct = option.get("isCorrect", False)
        human_feedback = mcq_human_feedback[i] if mcq_human_feedback and i < len(
            mcq_human_feedback) else None

        # Always generate corrective feedback
        tasks.append(
            generate_feedback_for_option(
                i, option_text, is_correct, question_content, options,
                human_feedback, slide_text_arr, "corrective", settings
            )
        )
        # Generate learner feedback for v2c version (for first attempt support)
        # For other versions, we'll only use corrective AI feedback
        tasks.append(
            generate_feedback_for_option(
                i, option_text, is_correct, question_content, options,
                human_feedback, slide_text_arr, "learner", settings
            )
        )

    # Execute all tasks in parallel with error handling
    # No timeout since feedback generation is expected to take time
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Organize results with error handling
    corrective_feedback = [""] * len(options)
    learner_feedback = [""] * len(options)

    for result in results:
        # Skip exceptions and invalid results
        if isinstance(result, Exception):
            print(f"Error in feedback generation: {result}")
            continue
        if not isinstance(result, dict):
            continue

        idx = result.get("option_index")
        if idx is None or idx >= len(options):
            continue

        if result.get("feedback_type") == "corrective":
            corrective_feedback[idx] = result.get("feedback", "")
        else:
            learner_feedback[idx] = result.get("feedback", "")

    return {
        "corrective_feedback": corrective_feedback,
        "learner_feedback": learner_feedback
    }


def get_mcq_ai_feedback_for_option(
    question_id: str,
    participant_id: str,
    selected_option_index: int,
    course_version: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """
    Get AI-generated feedback for a selected MCQ option.
    Returns error if no AI feedback is available.
    """

    # Get the question from database
    question = db.query(Question).filter(
        Question.question_id == question_id).first()
    if not question:
        return {
            "error": "Question not found",
            "feedback": "Failed to get feedback: Question not found",
            "isCorrect": False,
            "feedbackType": "error"
        }

    # Check if option index is valid
    if not question.options or selected_option_index >= len(question.options):
        return {
            "error": "Invalid option index",
            "feedback": "Failed to get feedback: Invalid option index",
            "isCorrect": False,
            "feedbackType": "error"
        }

    # Get option details
    selected_option = question.options[selected_option_index]
    is_correct = selected_option.get("isCorrect", False)

    # Determine feedback type based on version
    # v2b: always corrective
    # v2c: first try learner, later corrective  
    # For all other versions: always use corrective (AI feedback)
    if course_version == "v2b":
        # v2b always uses corrective feedback
        feedback_type = "corrective"
        record_count = -1
        print(
            f"[MCQ AI] Version {course_version} - Using corrective AI feedback only")
    elif course_version == "v2c":
        # v2c uses learner/corrective based on attempts
        record_count = get_participant_question_record_count_mcq(
            participant_id, question_id, db)
        feedback_type = "learner" if record_count < 1 else "corrective"
        print(
            f"[MCQ AI] Version {course_version} - Participant: {participant_id}, Attempts: {record_count}, Using: {feedback_type}")
    else:
        # For all other versions, always use corrective AI feedback
        feedback_type = "corrective"
        record_count = -1
        print(
            f"[MCQ AI] Version {course_version or 'default'} - Using corrective AI feedback only")

    # Get AI feedback only
    feedback_text = ""

    if question.mcq_ai_feedback:
        print(
            f"[MCQ AI] AI feedback structure type: {type(question.mcq_ai_feedback)}")
        if isinstance(question.mcq_ai_feedback, dict):
            feedback_array = (
                question.mcq_ai_feedback.get("corrective_feedback", [])
                if feedback_type == "corrective"
                else question.mcq_ai_feedback.get("learner_feedback", [])
            )
            print(
                f"[MCQ AI] Using {feedback_type} feedback array with {len(feedback_array)} items")
            if feedback_array and selected_option_index < len(feedback_array):
                feedback_text = feedback_array[selected_option_index]
                print(
                    f"[MCQ AI] Retrieved AI feedback for option {selected_option_index}")
        elif isinstance(question.mcq_ai_feedback, list) and selected_option_index < len(question.mcq_ai_feedback):
            feedback_text = question.mcq_ai_feedback[selected_option_index]
            print(f"[MCQ AI] Using legacy array format AI feedback")

    # Return error if no AI feedback found
    if not feedback_text:
        return {
            "error": "No AI feedback available",
            "feedback": "Failed to get AI feedback for this option",
            "isCorrect": is_correct,
            "feedbackType": "error"
        }

    return {
        "feedback": feedback_text,
        "isCorrect": is_correct,
        "feedbackType": feedback_type,
        "attemptCount": record_count if course_version in ["v2a", "v2b"] else None,
        "structured_feedback": feedback_text
    }


def get_mcq_human_feedback_for_option(
    question_id: str,
    selected_option_index: int,
    db: Session
) -> Dict[str, Any]:
    """
    Get human-provided feedback for a selected MCQ option.
    Returns error if no human feedback is available.
    """

    # Get the question from database
    question = db.query(Question).filter(
        Question.question_id == question_id).first()
    if not question:
        return {
            "error": "Question not found",
            "feedback": "Failed to get feedback: Question not found",
            "isCorrect": False
        }

    # Check if option index is valid
    if not question.options or selected_option_index >= len(question.options):
        return {
            "error": "Invalid option index",
            "feedback": "Failed to get feedback: Invalid option index",
            "isCorrect": False
        }

    # Get option details
    selected_option = question.options[selected_option_index]
    is_correct = selected_option.get("isCorrect", False)

    # Get human feedback only
    feedback_text = ""

    if question.mcq_human_feedback and selected_option_index < len(question.mcq_human_feedback):
        feedback_text = question.mcq_human_feedback[selected_option_index]

    # Return error if no human feedback found
    if not feedback_text:
        return {
            "error": "No human feedback available",
            "feedback": "Failed to get human feedback for this option",
            "isCorrect": is_correct
        }
    return {
        "feedback": feedback_text,
        "isCorrect": is_correct,
        "structured_feedback": feedback_text
    }
