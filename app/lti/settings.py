from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.config import Settings


@dataclass(frozen=True)
class PlatformConfig:
    """LMS platform registration info (per iss+client_id)."""
    iss: str
    client_id: str
    auth_login_url: str              # OIDC auth endpoint
    jwks_url: str                    # Platform JWKS URL
    deployment_id: Optional[str] = None


def get_platform_config(settings: Settings, iss: str, client_id: str) -> PlatformConfig:
    try:
       data: Dict[str, Any] = json.loads(settings.lti_platforms_json)
    except json.JSONDecodeError as e:
        raise RuntimeError("Invalid LTI_PLATFORMS_JSON") from e
    iss_obj = data.get(iss) or {}
    cfg = iss_obj.get(client_id)

    if not cfg:
        raise RuntimeError(f"No platform registration for iss={iss}, client_id={client_id}")

    return PlatformConfig(
        iss=iss,
        client_id=client_id,
        auth_login_url=cfg["auth_login_url"],
        jwks_url=cfg["jwks_url"],
        deployment_id=cfg.get("deployment_id"),
    )
