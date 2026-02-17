from __future__ import annotations

from typing import Any, Dict


def is_deep_linking_request(claims: Dict[str, Any]) -> bool:
    msg_type = claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type")
    return msg_type == "LtiDeepLinkingRequest"


def get_deep_link_return_url(claims: Dict[str, Any]) -> str:
    settings = claims.get("https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings") or {}
    url = settings.get("deep_link_return_url")
    if not url:
        raise RuntimeError("Missing deep_link_return_url")
    return url
