from fastapi import FastAPI

from api.lti import lti_router
from .routers import (
    system,
    identity,
    courses,
    modules,
    slides,
    questions,
    uploads,
    records,
    feedback_agents,
    feedback_links,
    feedback_compositions,
    questions_semantic,
)
from .tags import tags_metadata

app = FastAPI(
    title="AI Answer API",
    openapi_tags=tags_metadata,
    swagger_ui_parameters={
        "docExpansion": "list",
        "defaultModelsExpandDepth": -1,
        "displayRequestDuration": True,
    },
)

# lti router
app.include_router(lti_router)

# v1 / legacy routers grouped by domain
app.include_router(system.router)
app.include_router(identity.router)
app.include_router(courses.router)
app.include_router(modules.router)
app.include_router(slides.router)
app.include_router(questions.router)
app.include_router(uploads.router)
app.include_router(records.router)
app.include_router(feedback_agents.router)
app.include_router(feedback_links.router)
app.include_router(feedback_compositions.router)
app.include_router(questions_semantic.router)
