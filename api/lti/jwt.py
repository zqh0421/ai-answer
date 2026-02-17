from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx
from jose import jwt
from jose.exceptions import JWTError

from api.config import Settings

from .settings import PlatformConfig


@dataclass
class JwksCacheEntry:
    expires_at: float
    jwks: Dict[str, Any]


_JWKS_CACHE: Dict[str, JwksCacheEntry] = {}


async def _fetch_platform_jwks(jwks_url: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(jwks_url)
        r.raise_for_status()
        return r.json()


async def get_cached_platform_jwks(jwks_url: str, ttl_seconds: int = 600) -> Dict[str, Any]:
    now = time.time()
    entry = _JWKS_CACHE.get(jwks_url)
    if entry and entry.expires_at > now:
        return entry.jwks

    jwks = await _fetch_platform_jwks(jwks_url)
    _JWKS_CACHE[jwks_url] = JwksCacheEntry(expires_at=now + ttl_seconds, jwks=jwks)
    return jwks


def _pick_key(jwks: Dict[str, Any], kid: Optional[str]) -> Dict[str, Any]:
    keys = jwks.get("keys", [])
    if not keys:
        raise RuntimeError("Platform JWKS has no keys")
    if kid:
        for k in keys:
            if k.get("kid") == kid:
                return k
    # fallback: first key
    return keys[0]


async def verify_platform_id_token(
    *,
    id_token: str,
    settings: Settings,
    platform: PlatformConfig,
    expected_nonce: str,
) -> Dict[str, Any]:
    """
    Verify LMS-issued id_token using platform JWKS and validate core claims.
    """
    # 1) decode header to get kid
    try:
        header = jwt.get_unverified_header(id_token)
    except Exception as e:
        raise RuntimeError("Invalid JWT header") from e

    kid = header.get("kid")

    # 2) fetch platform jwks and select key
    jwks = await get_cached_platform_jwks(platform.jwks_url)
    key = _pick_key(jwks, kid)

    # 3) verify signature + standard claims
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=[header.get("alg", "RS256")],
            audience=platform.client_id,
            issuer=platform.iss,
            options={
                "verify_aud": True,
                "verify_iss": True,
                "verify_exp": True,
                "verify_iat": False,  # iat varies across platforms
            },
        )
    except JWTError as e:
        raise RuntimeError(f"JWT verification failed: {str(e)}") from e

    # 4) nonce check
    nonce = claims.get("nonce")
    if not nonce or nonce != expected_nonce:
        raise RuntimeError("Nonce mismatch")

    # 5) deployment check (if configured)
    dep = claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id")
    if platform.deployment_id and dep != platform.deployment_id:
        raise RuntimeError("Deployment ID mismatch")

    return claims
