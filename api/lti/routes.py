from __future__ import annotations

import json
import logging
import secrets
import time
import re
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel
import requests
from jose import jwt

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
logger = logging.getLogger(__name__)

# For now, in-memory storage. Swap to DB later.
_STORAGE = InMemoryLtiStorage()


class DeepLinkSelectionRequest(BaseModel):
    launch_id: str
    resource_url: str
    title: Optional[str] = None
    text: Optional[str] = None


class LtiGradeSubmitRequest(BaseModel):
    launch_id: str
    ai_structure_feedback: Optional[str] = None
    score_given: Optional[float] = None
    score_maximum: Optional[float] = None
    max_score: Optional[float] = None
    comment: Optional[str] = None


def _extract_score_from_feedback(text: Optional[str]) -> tuple[Optional[float], Optional[float]]:
    if not text:
        return None, None

    # Try JSON-ish payloads first.
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            for score_key in ("score_given", "score", "points", "earned"):
                if score_key in obj and obj[score_key] is not None:
                    given = float(obj[score_key])
                    max_val = None
                    for max_key in ("score_maximum", "max_score", "max", "total_points", "possible"):
                        if max_key in obj and obj[max_key] is not None:
                            max_val = float(obj[max_key])
                            break
                    return given, max_val
    except Exception:
        pass

    ratio = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", text)
    if ratio:
        return float(ratio.group(1)), float(ratio.group(2))

    pct = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
    if pct:
        return float(pct.group(1)), 100.0

    return None, None


def _append_query_params(url: str, **params: Optional[str]) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for key, value in params.items():
        if value is None:
            continue
        query[key] = str(value)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _build_lti_client_assertion(settings: Settings, *, client_id: str, token_url: str) -> str:
    now = int(time.time())
    private_key = Path(settings.lti_private_key_path).read_text(encoding="utf-8")
    claims = {
        "iss": client_id,
        "sub": client_id,
        "aud": token_url,
        "iat": now,
        "exp": now + 300,
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": settings.lti_jwk_kid},
    )


def _post_lti_ags_score(*, session: LaunchSession, settings: Settings, score_given: float, score_maximum: float, comment: Optional[str]) -> dict:
    ags_claim = (session.raw_claims or {}).get("https://purl.imsglobal.org/spec/lti-ags/claim/endpoint") or {}
    lineitem_url = ags_claim.get("lineitem")
    scopes = ags_claim.get("scope") or []
    if not isinstance(scopes, list):
        scopes = [str(scopes)]
    if not lineitem_url:
        raise RuntimeError("Missing AGS lineitem endpoint in launch claims")

    platform = get_platform_config(settings, session.iss, session.client_id)
    token_url = platform.auth_token_url
    if not token_url:
        raise RuntimeError("Missing platform auth_token_url/token_url in LTI platform config")

    requested_scope = "https://purl.imsglobal.org/spec/lti-ags/scope/score"
    if scopes and requested_scope not in scopes:
        # Use granted scopes if LMS omitted explicit score scope in response claim.
        requested_scope = " ".join(scopes)

    client_assertion = _build_lti_client_assertion(settings, client_id=session.client_id, token_url=token_url)
    token_resp = requests.post(
        token_url,
        data={
            "grant_type": "client_credentials",
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": client_assertion,
            "scope": requested_scope,
        },
        timeout=15,
    )
    token_resp.raise_for_status()
    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise RuntimeError("LTI token response missing access_token")

    score_url = lineitem_url.rstrip("/") + "/scores"
    payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scoreGiven": float(score_given),
        "scoreMaximum": float(score_maximum),
        "userId": session.sub,
        "activityProgress": "Completed",
        "gradingProgress": "FullyGraded",
    }
    if comment:
        payload["comment"] = comment

    score_resp = requests.post(
        score_url,
        json=payload,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.ims.lis.v1.score+json",
        },
        timeout=15,
    )
    score_resp.raise_for_status()
    return {
        "score_url": score_url,
        "lineitem": lineitem_url,
        "scoreGiven": payload["scoreGiven"],
        "scoreMaximum": payload["scoreMaximum"],
        "status_code": score_resp.status_code,
    }


def try_submit_lti_grade_for_launch(
    *,
    launch_id: str,
    settings: Settings,
    score_given: Optional[float] = None,
    score_maximum: Optional[float] = None,
    ai_structure_feedback: Optional[str] = None,
    comment: Optional[str] = None,
    expected_sub: Optional[str] = None,
) -> dict:
    session = _STORAGE.get_launch_session(launch_id)
    if not session:
        return {"ok": False, "skipped": True, "reason": "unknown_session", "launch_id": launch_id}
    if session.message_type != "LtiResourceLinkRequest":
        return {"ok": False, "skipped": True, "reason": "not_resource_link_launch", "launch_id": launch_id}
    if expected_sub and session.sub and str(session.sub) != str(expected_sub):
        return {
            "ok": False,
            "skipped": True,
            "reason": "learner_mismatch",
            "launch_id": launch_id,
            "expected_sub": str(expected_sub),
            "session_sub": str(session.sub),
        }

    parsed_given, parsed_max = _extract_score_from_feedback(ai_structure_feedback)
    if score_given is None and parsed_given is None:
        return {
            "ok": False,
            "skipped": True,
            "reason": "missing_score_given",
            "launch_id": launch_id,
        }
    resolved_max = (
        score_maximum
        if score_maximum is not None
        else parsed_max
        if parsed_max is not None
        else 1.0
    )
    resolved_given = (
        score_given
        if score_given is not None
        else parsed_given
        if parsed_given is not None
        else None
    )

    if resolved_max <= 0:
        return {"ok": False, "skipped": True, "reason": "invalid_score_maximum", "launch_id": launch_id}
    if resolved_given is None:
        return {"ok": False, "skipped": True, "reason": "missing_score_given", "launch_id": launch_id}
    resolved_given = max(0.0, min(float(resolved_given), float(resolved_max)))

    result = _post_lti_ags_score(
        session=session,
        settings=settings,
        score_given=resolved_given,
        score_maximum=resolved_max,
        comment=comment or ai_structure_feedback,
    )
    return {
        "ok": True,
        "launch_id": launch_id,
        "score_given": resolved_given,
        "score_maximum": resolved_max,
        **result,
    }


def find_latest_lti_launch_id_for_learner(learner_id: str) -> Optional[str]:
    if not learner_id:
        return None
    session = _STORAGE.get_latest_launch_session_for_sub(
        str(learner_id),
        message_type="LtiResourceLinkRequest",
    )
    return session.session_id if session else None


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
    return RedirectResponse(url=redirect_url, status_code=303)


@router.post("/launch")
async def lti_launch(request: Request, settings: Settings = Depends(get_settings)):
    """
    Launch endpoint (receives form_post with id_token and state).
    """
    form = await request.form()
    state = form.get("state")
    id_token = form.get("id_token")
    form_dict = {k: v for k, v in form.items()}
    launch_input_debug = dict(form_dict)
    if "id_token" in launch_input_debug and launch_input_debug["id_token"] is not None:
        token_str = str(launch_input_debug["id_token"])
        launch_input_debug["id_token"] = f"<jwt length={len(token_str)}>"
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
    claim_target_link_uri = claims.get("https://purl.imsglobal.org/spec/lti/claim/target_link_uri")

    resource_link = claims.get("https://purl.imsglobal.org/spec/lti/claim/resource_link") or {}
    resource_link_id = resource_link.get("id")

    roles = claims.get("https://purl.imsglobal.org/spec/lti/claim/roles") or []

    logger.info(
        "lti_launch_claims_full",
        extra={
            "message_type": msg_type,
            "claims": json.dumps(claims, ensure_ascii=True, default=str),
        },
    )

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

    ui_url = f"{settings.public_base_url}/lti/questions"
    if is_deep_linking_request(claims):
        ui_url = f"{ui_url}?lti_mode=deep_link&launch_id={launch_session.session_id}"
    else:
        redirect_source = "default_questions"
        if isinstance(claim_target_link_uri, str) and claim_target_link_uri.strip():
            ui_url = claim_target_link_uri.strip()
            redirect_source = "claim_target_link_uri"
        ui_url = _append_query_params(
            ui_url,
            lti_launch_id=session_id,
            lti_user_id=str(sub) if sub else None,
            lti_context_id=str(context_id) if context_id else None,
            lti_resource_link_id=str(resource_link_id) if resource_link_id else None,
        )
    return RedirectResponse(url=ui_url, status_code=302)


def _complete_deep_link(
    *,
    launch_id: str,
    resource_url: str,
    title: Optional[str],
    text: Optional[str],
    settings: Settings,
) -> HTMLResponse | PlainTextResponse:
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


@router.api_route("/deep-link/complete", methods=["GET", "POST"])
async def complete_deep_link(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    if request.method == "POST":
        payload_dict = {}
        content_type = (request.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            payload_dict = await request.json()
        else:
            form = await request.form()
            payload_dict = dict(form)
    else:
        payload_dict = dict(request.query_params)

    payload = DeepLinkSelectionRequest(**payload_dict)

    return _complete_deep_link(
        launch_id=payload.launch_id,
        resource_url=payload.resource_url,
        title=payload.title,
        text=payload.text,
        settings=settings,
    )


@router.post("/grade")
async def submit_lti_grade(
    payload: LtiGradeSubmitRequest,
    settings: Settings = Depends(get_settings),
):
    try:
        result = try_submit_lti_grade_for_launch(
            launch_id=payload.launch_id,
            settings=settings,
            score_given=payload.score_given,
            score_maximum=payload.score_maximum if payload.score_maximum is not None else payload.max_score,
            ai_structure_feedback=payload.ai_structure_feedback,
            comment=payload.comment or payload.ai_structure_feedback,
        )
        if result.get("skipped"):
            reason = result.get("reason", "grade_submission_skipped")
            status_code = 404 if reason == "unknown_session" else 400
            return JSONResponse(result, status_code=status_code)
        return JSONResponse(
            {
                **result,
            }
        )
    except requests.HTTPError as e:
        body = None
        try:
            body = e.response.text
        except Exception:
            body = str(e)
        return JSONResponse(
            {"ok": False, "error": "LTI grade post failed", "detail": body},
            status_code=502,
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@router.get("/context")
async def get_lti_context(
    request: Request,
    learner_id: Optional[str] = None,
    launch_id: Optional[str] = None,
):
    cookie_launch_id = request.cookies.get("ai_answer_lti_launch_id")
    resolved_launch_id = launch_id or find_latest_lti_launch_id_for_learner(learner_id or "") or cookie_launch_id
    session = _STORAGE.get_launch_session(resolved_launch_id) if resolved_launch_id else None
    ags_claim = {}
    if session and isinstance(session.raw_claims, dict):
        ags_claim = session.raw_claims.get("https://purl.imsglobal.org/spec/lti-ags/claim/endpoint") or {}

    payload = {
        "ok": True,
        "detected": bool(session),
        "lookup": {
            "input_learner_id": learner_id,
            "input_launch_id": launch_id,
            "resolved_launch_id": resolved_launch_id,
            "strategy": (
                "launch_id"
                if launch_id
                else "learner_id"
                if learner_id
                else "cookie"
                if cookie_launch_id
                else "none"
            ),
        },
        "session": None,
        "grade_passback": {
            "ags_available": bool(ags_claim.get("lineitem")) if session else False,
            "lineitem": ags_claim.get("lineitem") if session else None,
            "scope": ags_claim.get("scope") if session else None,
        },
    }

    if session:
        payload["session"] = {
            "session_id": session.session_id,
            "iss": session.iss,
            "client_id": session.client_id,
            "deployment_id": session.deployment_id,
            "sub": session.sub,
            "message_type": session.message_type,
            "context_id": session.context_id,
            "resource_link_id": session.resource_link_id,
            "roles": session.roles,
        }
        if learner_id:
            payload["learner_match"] = str(learner_id) == str(session.sub)
    elif launch_id:
        payload["reason"] = "input_launch_id_not_found"
    elif learner_id:
        payload["reason"] = "no_lti_session_found_for_learner"
    elif cookie_launch_id:
        payload["reason"] = "launch_cookie_present_but_session_not_found"
    else:
        payload["reason"] = "no_lookup_input"

    return JSONResponse(payload)


@router.get("/.well-known/jwks.json")
async def lti_jwks(settings: Settings = Depends(get_settings)):
    return JSONResponse(get_jwks(settings))
