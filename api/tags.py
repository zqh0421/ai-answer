from enum import Enum
from typing import List, Dict


class Tags(str, Enum):
    SYSTEM_HEALTH = "System / Health"
    FEEDBACK_AGENTS = "Feedback / Agents"
    FEEDBACK_LINKS = "Feedback / Links"
    FEEDBACK_COMPOSITIONS = "Feedback / Compositions"
    MEDIA_CONVERSION = "Media / Conversion"
    CONTENT_COURSES = "Content / Courses"
    CONTENT_MODULES = "Content / Modules"
    CONTENT_SLIDES = "Content / Slides"
    CONTENT_QUESTIONS = "Content / Questions"
    CONTENT_UPLOADS = "Content / Uploads"
    CONTENT_RECORDS = "Content / Records"
    IDENTITY_AUTH = "Identity / Auth"
    IDENTITY_LTI = "Identity / LTI"


def build_tags_metadata() -> List[Dict[str, str]]:
    return [
        {"name": Tags.SYSTEM_HEALTH, "description": "Service availability checks."},
        {"name": Tags.FEEDBACK_AGENTS, "description": "Semantic feedback agent CRUD, listing, and duplication."},
        {"name": Tags.FEEDBACK_LINKS, "description": "Semantic feedback links between question versions and agents."},
        {"name": Tags.FEEDBACK_COMPOSITIONS, "description": "Feedback composition rules and runtime resolve APIs."},
        {"name": Tags.MEDIA_CONVERSION, "description": "PDF/image conversion endpoints."},
        {"name": Tags.CONTENT_COURSES, "description": "Course CRUD and listing."},
        {"name": Tags.CONTENT_MODULES, "description": "Module CRUD and module-level operations."},
        {"name": Tags.CONTENT_SLIDES, "description": "Slide publishing and vector/vision updates."},
        {"name": Tags.CONTENT_QUESTIONS, "description": "Question CRUD and feedback updates."},
        {"name": Tags.CONTENT_UPLOADS, "description": "File upload endpoints."},
        {"name": Tags.CONTENT_RECORDS, "description": "Attempt records, usage logs, and ratings."},
        {"name": Tags.IDENTITY_AUTH, "description": "Administrative authentication."},
        {"name": Tags.IDENTITY_LTI, "description": "LTI 1.3 login, launch, and JWKS endpoints."},
    ]


# Export default metadata list for FastAPI app wiring
tags_metadata = build_tags_metadata()
