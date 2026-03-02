from __future__ import annotations

import secrets

ID_LENGTH = 16
_RANDOM_LEN = ID_LENGTH - 3  # two-letter prefix + underscore
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def generate_short_id(prefix: str) -> str:
    if not isinstance(prefix, str) or len(prefix) != 2 or not prefix.isalpha() or not prefix.islower():
        raise ValueError("prefix must be exactly 2 lowercase letters")
    return f"{prefix}_" + "".join(secrets.choice(_ALPHABET) for _ in range(_RANDOM_LEN))
