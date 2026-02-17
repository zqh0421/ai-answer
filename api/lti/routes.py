from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Optional


from fastapi import APIRouter, Request, Depends
from api.config import Settings, get_settings

from fastapi.responses import JSONResponse, RedirectResponse, PlainTextResponse

from .settings import get_platform_config
from .storage import InMemoryLtiStorage
from .jwks import get_jwks
from .oidc import build_login_redirect_url
# from .jwt import verify_platform_id_token
from .models import LaunchSession
# from .deep_linking import is_deep_linking_request, get_deep_link_return_url

router = APIRouter(prefix="/api/lti", tags=["Identity / LTI"])

# For now, in-memory storage. Swap to DB later.
_STORAGE = InMemoryLtiStorage()

LTI_STATE_COOKIE = "state"
STATE_MAX_AGE = 60 * 60 * 24

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

    # Set cookie EXACTLY like the example semantics
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
    pass
    # state = form.get("state")
    # id_token = form.get("id_token")

    # if not state or not id_token:
    #     return PlainTextResponse("Missing state or id_token", status_code=400)

    # cookie_state = request.cookies.get(LTI_STATE_COOKIE)
    # if not cookie_state or cookie_state != state:
    #     return PlainTextResponse("State cookie mismatch", status_code=400)


    # state_rec = _STORAGE.get_state(str(state))
    # if not state_rec:
    #     return PlainTextResponse("Invalid or expired state", status_code=400)

    # platform = get_platform_config(settings, state_rec.iss, state_rec.client_id)

    # # Verify LMS JWT
    # claims = await verify_platform_id_token(
    #     id_token=str(id_token),
    #     settings=settings,
    #     platform=platform,
    #     expected_nonce=state_rec.nonce,
    # )

    # # one-time state (reduce replay window)
    # _STORAGE.delete_state(str(state))

    # # Determine message type
    # msg_type = claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type", "UNKNOWN")
    # deployment_id = claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id")
    # sub = claims.get("sub", "")

    # # Extract some useful claims
    # context = claims.get("https://purl.imsglobal.org/spec/lti/claim/context") or {}
    # context_id = context.get("id")

    # resource_link = claims.get("https://purl.imsglobal.org/spec/lti/claim/resource_link") or {}
    # resource_link_id = resource_link.get("id")

    # roles = claims.get("https://purl.imsglobal.org/spec/lti/claim/roles") or []

    # session_id = secrets.token_urlsafe(24)

    # launch_session = LaunchSession(
    #     session_id=session_id,
    #     iss=platform.iss,
    #     client_id=platform.client_id,
    #     deployment_id=deployment_id,
    #     sub=sub,
    #     message_type=msg_type,
    #     context_id=context_id,
    #     resource_link_id=resource_link_id,
    #     roles=roles,
    #     raw_claims=claims,
    # )

    # # Deep Linking handling (optional for now)
    # if is_deep_linking_request(claims):
    #     try:
    #         dl_return_url = get_deep_link_return_url(claims)
    #         dl_settings = claims.get("https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings") or {}
    #         dl_data = dl_settings.get("data")

    #         launch_session.deep_link_return_url = dl_return_url
    #         launch_session.deep_link_data = dl_data
    #     except Exception:
    #         # If platform sends DL request but we can't parse, fail clearly
    #         return PlainTextResponse("Deep Linking request received but not supported yet", status_code=501)

    # _STORAGE.create_launch_session(launch_session)

    # # Redirect to your public Next.js UI page (no "Identity / LTI" in path if you prefer)
    # # Example: https://muf-in.com/app?sid=...
    # ui_url = f"{settings.public_base_url}/app?sid={session_id}"
    # return RedirectResponse(url=ui_url, status_code=302)


@router.get("/.well-known/jwks.json")
async def lti_jwks(settings: Settings = Depends(get_settings)):
    return JSONResponse(get_jwks(settings))
