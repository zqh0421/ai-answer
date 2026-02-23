from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from api.config import Settings


@dataclass(frozen=True)
class PlatformConfig:
    """LMS platform registration info (per iss+client_id)."""
    iss: str
    client_id: str
    auth_login_url: str              # OIDC auth endpoint
    jwks_url: str                    # Platform JWKS URL
    auth_token_url: Optional[str] = None  # OAuth2 token endpoint (for AGS/NRPS)
    deployment_id: Optional[str] = None


def get_platform_config(settings: Settings, iss: str, client_id: str) -> PlatformConfig:
    path = Path(settings.lti_platforms_path)
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception as e:
        raise RuntimeError(f"Failed to read LTI_PLATFORMS_PATH='{path}': {e}") from e

    try:
        data: Dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid JSON in LTI_PLATFORMS_PATH='{path}'") from e

    iss_obj = data.get(iss) or {}
    cfg = iss_obj.get(client_id)

    if not cfg:
        raise RuntimeError(f"No platform registration for iss={iss}, client_id={client_id}")

    return PlatformConfig(
        iss=iss,
        client_id=client_id,
        auth_login_url=cfg["auth_login_url"],
        auth_token_url=cfg.get("auth_token_url") or cfg.get("token_url"),
        jwks_url=cfg["jwks_url"],
        deployment_id=cfg.get("deployment_id"),
    )
