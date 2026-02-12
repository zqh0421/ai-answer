from __future__ import annotations

from typing import Optional
from urllib.parse import urlencode

from .settings import get_platform_config
from .storage import InMemoryLtiStorage
from app.config import Settings


def build_login_redirect_url(
    *,
    settings: Settings,
    storage: InMemoryLtiStorage,
    iss: str,
    client_id: str,
    login_hint: str,
    target_link_uri: str,
    lti_message_hint: Optional[str],
    state: str,
    nonce: str,
) -> str:
    platform = get_platform_config(settings, iss, client_id)

    storage.create_state(
        state=state,
        nonce=nonce,
        iss=iss,
        client_id=client_id,
        ttl_seconds=settings.lti_state_ttl_seconds,
        login_hint=login_hint,
        lti_message_hint=lti_message_hint,
        target_link_uri=target_link_uri,
    )

    redirect_uri = f"{settings.public_base_url}/launch"  # external-facing
    params = {
        "scope": "openid",
        "response_type": "id_token",
        "response_mode": "form_post",
        "prompt": "none",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "login_hint": login_hint,
        "state": state,
        "nonce": nonce,
    }
    if lti_message_hint:
        params["lti_message_hint"] = lti_message_hint

    return f"{platform.auth_login_url}?{urlencode(params)}"
