def setprompt_learner(slide_text,question, response):
    prompt_learner = (
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
        
        f"### Slides Content:\n{slide_text}\n"
        f"### Question:\n{question}\n"
        f"### Student's Response:\n{response}\n"
        f"using above information to generate feedback----,let's think and generate step by step"
        f"**Do not include your reasoning in the final output; only provide the feedback to the student.**\n\n"
    )
    return prompt_learner

def setprompt_knowledge(slide_text,question, response):
    prompt_knowledge = (
        f"based on following question and slides content, provide feedback accurately and relevantly to students' response."
        f"Feedback needs to have four-level focuses (including task, process, self-regulatory, and self). "
        f"Here’s how the feedback is structured step by step:\n"
        f"- Step 1: identify whether students' response is correct or incorrect, which means feedback need to contain corrective information that indicates how well a task is performed (task level), e.g., “The interpretation of this machine learning model is incorrect.\n"
        f"- Step 2: offer suggestions on how the student can improve their understanding or enhance their explanation using relevant strategies (process level), e.g., “This page may make more sense if you use the strategies we talked about earlier.”.\n"
        f"- Step 3: focus on self-regulation addresses how students monitor their learning (self-regulatory level) , e.g., “You already know the key features of the opening of an argument. Check to see whether you have incorporated them in your first paragraph.”.\n"
        f"- Lastly, provide personal evaluations (self level), e.g., “You are a great student.”, “Well done!”.\n\n"

        f"### Slides Content: {slide_text}\n\n"
        f"### Question: {question}\n\n"
        f"### Student's Response: {response}\n\n"
        f"### using above information to generate feedback----,let's think and generate step by step"
        f"**Do not include your reasoning in the final output; only provide the feedback to the student.**\n\n"
    )
    return prompt_knowledge

def setprompt_none(slide_text, question,response):
    prompt_none = (
        f"Using the following question, slides content, and student's response, generate constructive feedback.\n"
        f"Please **think step-by-step** to ensure your feedback is accurate and relevant.\n"
        f"- Step 1: Analyze the student's response in relation to the question and slides content.\n"
        f"- Step 2: Identify any inaccuracies or missing information.\n"
        f"- Step 3: Plan how to provide constructive feedback that addresses these points.\n\n"
        f" finally, give Feedback to the Student, not include reasoning in the final output\n"
        f"\n"
        f"### Slides Content:\n{slide_text}\n\n"
        f"### Question:\n{question}\n\n"
        f"### Student's Response:\n{response}\n\n"
        f"### using above information to generate feedback----,let's think and generate step by step"
        f"**Do not include your reasoning in the final output; only provide the feedback to the student.**\n\n"
    )
    return prompt_none