from __future__ import annotations

import secrets
import time
from html import escape
from pathlib import Path
from typing import Any, Dict, Optional

from jose import jwt

from api.config import Settings
from .models import LaunchSession

CLAIM_MESSAGE_TYPE = "https://purl.imsglobal.org/spec/lti/claim/message_type"
CLAIM_VERSION = "https://purl.imsglobal.org/spec/lti/claim/version"
CLAIM_DEEP_LINKING_SETTINGS = "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings"
CLAIM_CONTENT_ITEMS = "https://purl.imsglobal.org/spec/lti-dl/claim/content_items"
CLAIM_DATA = "https://purl.imsglobal.org/spec/lti-dl/claim/data"


def is_deep_linking_request(claims: Dict[str, Any]) -> bool:
    msg_type = claims.get(CLAIM_MESSAGE_TYPE)
    return msg_type == "LtiDeepLinkingRequest"


def get_deep_linking_settings(claims: Dict[str, Any]) -> Dict[str, Any]:
    return claims.get(CLAIM_DEEP_LINKING_SETTINGS) or {}


def get_deep_link_return_url(claims: Dict[str, Any]) -> str:
    settings = get_deep_linking_settings(claims)
    url = settings.get("deep_link_return_url")
    if not url:
        raise RuntimeError("Missing deep_link_return_url")
    return url


def build_deep_link_response_jwt(
    *,
    settings: Settings,
    launch_session: LaunchSession,
    resource_url: str,
    title: str,
    text: Optional[str] = None,
) -> str:
    """
    Build and sign an LtiDeepLinkingResponse JWT for form_post back to LMS.
    """
    now = int(time.time())
    tool_issuer = launch_session.client_id
    claims = {
        "iss": tool_issuer,
        "sub": tool_issuer,
        "aud": launch_session.iss,
        "iat": now,
        "exp": now + 600,
        "jti": secrets.token_urlsafe(16),
        CLAIM_MESSAGE_TYPE: "LtiDeepLinkingResponse",
        CLAIM_VERSION: "1.3.0",
        CLAIM_CONTENT_ITEMS: [
            {
                "type": "ltiResourceLink",
                "title": title,
                "text": text or title,
                "url": resource_url,
            }
        ],
    }

    if launch_session.deep_link_data:
        claims[CLAIM_DATA] = launch_session.deep_link_data

    key_path = Path(settings.lti_private_key_path)
    private_key = key_path.read_text(encoding="utf-8")
    return jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": settings.lti_jwk_kid},
    )


def build_auto_post_html(return_url: str, jwt_value: str) -> str:
    safe_return_url = escape(return_url, quote=True)
    safe_jwt = escape(jwt_value, quote=True)
    return f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Returning to LMS...</title></head>
  <body>
    <form id="ltiDeepLinkForm" method="POST" action="{safe_return_url}">
      <input type="hidden" name="JWT" value="{safe_jwt}">
      <noscript><button type="submit">Continue</button></noscript>
    </form>
    <script>document.getElementById('ltiDeepLinkForm').submit();</script>
  </body>
</html>"""
