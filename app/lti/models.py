from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any


@dataclass
class OidcStateRecord:
    state: str
    nonce: str
    iss: str
    client_id: str
    created_at: datetime
    expires_at: datetime

    # optional hints (useful for debugging)
    login_hint: Optional[str] = None
    lti_message_hint: Optional[str] = None
    target_link_uri: Optional[str] = None


@dataclass
class LaunchSession:
    session_id: str
    iss: str
    client_id: str
    deployment_id: Optional[str]
    sub: str

    message_type: str
    context_id: Optional[str] = None
    resource_link_id: Optional[str] = None
    roles: Optional[list[str]] = None

    # Deep Linking (optional)
    deep_link_return_url: Optional[str] = None
    deep_link_data: Optional[str] = None

    raw_claims: Optional[Dict[str, Any]] = None
