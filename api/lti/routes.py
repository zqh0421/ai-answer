from __future__ import annotations

import json
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel

from api.config import Settings, get_settings

from .deep_linking import (
    build_auto_post_html,
    build_deep_link_response_jwt,
    get_deep_link_return_url,
    get_deep_linking_settings,
    is_deep_linking_request,
)
from .jwks import get_jwks
from .jwt import verify_platform_id_token
from .models import LaunchSession
from .oidc import build_login_redirect_url
from .settings import get_platform_config
from .storage import InMemoryLtiStorage

router = APIRouter(prefix="/api/lti", tags=["Identity / LTI"])

# For now, in-memory storage. Swap to DB later.
_STORAGE = InMemoryLtiStorage()

LTI_STATE_COOKIE = "state"
LTI_LAUNCH_COOKIE = "lti_launch"
STATE_MAX_AGE = 60 * 60 * 24


class DeepLinkSelectionRequest(BaseModel):
    resource_url: str
    title: Optional[str] = None
    text: Optional[str] = None


@router.api_route("/login", methods=["GET", "POST"])
async def lti_login(request: Request, settings: Settings = Depends(get_settings)):
    # Merge params: query + form (form wins)
    params = dict(request.query_params)
    if request.method == "POST":
        form = await request.form()
        params.update({k: v for k, v in form.items()})

    # REQUIRED by Simon example test
    iss = params.get("iss")
    client_id = params.get("client_id")
    login_hint = params.get("login_hint")
    target_link_uri = params.get("target_link_uri")

    if not iss or not client_id or not login_hint or not target_link_uri:
        return PlainTextResponse(
            "Missing required parameters: iss, client_id, login_hint, target_link_uri",
            status_code=400,
        )

    # Fail fast if registration does not exist (matches example behavior)
    try:
        _ = get_platform_config(settings, str(iss), str(client_id))
    except Exception as e:
        return PlainTextResponse(f"Unknown platform registration: {e}", status_code=400)

    # Generate state/nonce
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)

    # Build redirect to platform OIDC auth endpoint
    redirect_url = build_login_redirect_url(
        settings=settings,
        storage=_STORAGE,
        iss=str(iss),
        client_id=str(client_id),
        login_hint=str(login_hint),
        target_link_uri=str(target_link_uri),
        lti_message_hint=params.get("lti_message_hint"),
        state=state,
        nonce=nonce,
    )

    # 303 like the Simon test (302 also acceptable, but match the test)
    resp = RedirectResponse(url=redirect_url, status_code=303)

    # State cookie is currently set for compatibility; launch no longer enforces match.
    resp.set_cookie(
        key=LTI_STATE_COOKIE,
        value=state,
        max_age=STATE_MAX_AGE,
        path="/",
        secure=True,
        httponly=True,
        samesite="none",
    )
    return resp


@router.post("/launch")
async def lti_launch(request: Request, settings: Settings = Depends(get_settings)):
    """
    Launch endpoint (receives form_post with id_token and state).
    """
    form = await request.form()
    state = form.get("state")
    id_token = form.get("id_token")

    if not state or not id_token:
        return PlainTextResponse("Missing state or id_token", status_code=400)

    state_rec = _STORAGE.get_state(str(state))
    if not state_rec:
        return PlainTextResponse("Invalid or expired state", status_code=400)

    platform = get_platform_config(settings, state_rec.iss, state_rec.client_id)

    # Verify LMS JWT
    claims = await verify_platform_id_token(
        id_token=str(id_token),
        settings=settings,
        platform=platform,
        expected_nonce=state_rec.nonce,
    )

    # one-time state (reduce replay window)
    _STORAGE.delete_state(str(state))

    # Determine message type
    msg_type = claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type", "UNKNOWN")
    deployment_id = claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id")
    sub = claims.get("sub", "")

    # Extract some useful claims
    context = claims.get("https://purl.imsglobal.org/spec/lti/claim/context") or {}
    context_id = context.get("id")

    resource_link = claims.get("https://purl.imsglobal.org/spec/lti/claim/resource_link") or {}
    resource_link_id = resource_link.get("id")

    roles = claims.get("https://purl.imsglobal.org/spec/lti/claim/roles") or []

    if msg_type == "LtiResourceLinkRequest":
        learner_debug = {
            "iss": platform.iss,
            "client_id": platform.client_id,
            "deployment_id": deployment_id,
            "sub": sub,
            "name": claims.get("name"),
            "given_name": claims.get("given_name"),
            "family_name": claims.get("family_name"),
            "email": claims.get("email"),
            "roles": roles,
            "context_id": context_id,
            "resource_link_id": resource_link_id,
        }
        print(f"[LTI_LEARNER_INFO] {json.dumps(learner_debug, ensure_ascii=True)}")

    session_id = secrets.token_urlsafe(24)

    launch_session = LaunchSession(
        session_id=session_id,
        iss=platform.iss,
        client_id=platform.client_id,
        deployment_id=deployment_id,
        sub=sub,
        message_type=msg_type,
        context_id=context_id,
        resource_link_id=resource_link_id,
        roles=roles,
        raw_claims=claims,
    )

    if is_deep_linking_request(claims):
        try:
            dl_return_url = get_deep_link_return_url(claims)
            dl_settings = get_deep_linking_settings(claims)
            dl_data = dl_settings.get("data")
            launch_session.deep_link_return_url = dl_return_url
            launch_session.deep_link_data = dl_data
        except Exception as e:
            return PlainTextResponse(f"Invalid Deep Linking launch: {e}", status_code=400)

    _STORAGE.create_launch_session(launch_session)

    ui_url = f"{settings.public_base_url}/manage"
    if is_deep_linking_request(claims):
        ui_url = f"{ui_url}?lti_mode=deep_link"
    resp = RedirectResponse(url=ui_url, status_code=302)
    resp.set_cookie(
        key=LTI_LAUNCH_COOKIE,
        value=session_id,
        max_age=STATE_MAX_AGE,
        path="/",
        secure=True,
        httponly=True,
        samesite="none",
    )
    return resp


def _complete_deep_link(
    *,
    request: Request,
    resource_url: str,
    title: Optional[str],
    text: Optional[str],
    settings: Settings,
) -> HTMLResponse | PlainTextResponse:
    launch_id = request.cookies.get(LTI_LAUNCH_COOKIE)
    if not launch_id:
        return PlainTextResponse("Missing launch cookie", status_code=400)

    session = _STORAGE.get_launch_session(launch_id)
    if not session:
        return PlainTextResponse("Unknown session", status_code=404)
    if session.message_type != "LtiDeepLinkingRequest":
        return PlainTextResponse("Session is not a deep-linking launch", status_code=400)
    if not session.deep_link_return_url:
        return PlainTextResponse("Missing deep_link_return_url in session", status_code=400)

    resolved_title = title or "AI Answer Practice"
    jwt_value = build_deep_link_response_jwt(
        settings=settings,
        launch_session=session,
        resource_url=resource_url,
        title=resolved_title,
        text=text,
    )
    html = build_auto_post_html(session.deep_link_return_url, jwt_value)
    return HTMLResponse(content=html, status_code=200)


@router.post("/deep-link/complete")
async def complete_deep_link_post(
    payload: DeepLinkSelectionRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
):
    return _complete_deep_link(
        request=request,
        resource_url=payload.resource_url,
        title=payload.title,
        text=payload.text,
        settings=settings,
    )


@router.get("/deep-link/complete")
async def complete_deep_link_get(
    request: Request,
    resource_url: str,
    title: Optional[str] = None,
    text: Optional[str] = None,
    settings: Settings = Depends(get_settings),
):
    return _complete_deep_link(
        request=request,
        resource_url=resource_url,
        title=title,
        text=text,
        settings=settings,
    )


@router.get("/.well-known/jwks.json")
async def lti_jwks(settings: Settings = Depends(get_settings)):
    return JSONResponse(get_jwks(settings))
