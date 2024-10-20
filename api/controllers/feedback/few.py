def generate_feedback_using_few(question: str, answer: str) -> str:
    return f"Feedback for Few: Your answer '{answer}' doesn't quite match the question '{question}'. Please try again."