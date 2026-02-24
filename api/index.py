from fastapi import FastAPI

from api.lti import lti_router
from .routers import (
    system,
    legacy,
    conversion,
    identity,
    feedback,
    courses,
    modules,
    slides,
    questions,
    uploads,
    records,
)
from .tags import tags_metadata
from .v2 import index_oeq, index_mcq

app = FastAPI(
    title="AI Answer API",
    openapi_tags=tags_metadata,
    swagger_ui_parameters={
        "docExpansion": "list",
        "defaultModelsExpandDepth": -1,
        "displayRequestDuration": True,
    },
)

# v2 routers
app.include_router(index_oeq.router)
app.include_router(index_mcq.router)

# lti router
app.include_router(lti_router)

# v1 / legacy routers grouped by domain
app.include_router(system.router)
app.include_router(legacy.router)
app.include_router(conversion.router)
app.include_router(identity.router)
app.include_router(feedback.router)
app.include_router(courses.router)
app.include_router(modules.router)
app.include_router(slides.router)
app.include_router(questions.router)
app.include_router(uploads.router)
app.include_router(records.router)
