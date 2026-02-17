# jwks.py

import base64
from typing import Dict, Any

from fastapi import Depends
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from api.config import Settings, get_settings


def _b64url_uint(n: int) -> str:
    byte_len = (n.bit_length() + 7) // 8
    raw = n.to_bytes(byte_len, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

def _load_rsa_private_key(settings) -> rsa.RSAPrivateKey:
    path = settings.lti_private_key_path
    if path:
        try:
            with open(path, "rb") as f:
                pem_bytes = f.read()
        except Exception as e:
            raise RuntimeError(f"Failed to read LTI_PRIVATE_KEY_PATH='{path}': {e}")

    try:
        key = serialization.load_pem_private_key(pem_bytes, password=None)
    except Exception as e:
        raise RuntimeError(f"Invalid RSA private key PEM: {e}")

    if not isinstance(key, rsa.RSAPrivateKey):
        raise RuntimeError("Provided key is not an RSA private key")

    return key


def get_jwks(
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    """
    Return JWKS derived from the Tool's RSA private key.

    Settings are injected via FastAPI Depends(get_settings),
    so env variables are read through the Settings object.
    """
    private_key = _load_rsa_private_key(settings)
    public_key = private_key.public_key()
    numbers = public_key.public_numbers()

    jwk = {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": settings.lti_jwk_kid or "lti-tool-key-1",
        "n": _b64url_uint(numbers.n),
        "e": _b64url_uint(numbers.e),
    }

    return {"keys": [jwk]}
