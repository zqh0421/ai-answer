from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from .models import OidcStateRecord, LaunchSession


class InMemoryLtiStorage:
    """
    Minimal storage to get LTI running fast.
    Replace with Postgres later (same interface).
    """
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._states: Dict[str, OidcStateRecord] = {}
        self._sessions: Dict[str, LaunchSession] = {}

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def create_state(
        self,
        *,
        state: str,
        nonce: str,
        iss: str,
        client_id: str,
        ttl_seconds: int,
        login_hint: Optional[str] = None,
        lti_message_hint: Optional[str] = None,
        target_link_uri: Optional[str] = None,
    ) -> OidcStateRecord:
        now = self._now()
        rec = OidcStateRecord(
            state=state,
            nonce=nonce,
            iss=iss,
            client_id=client_id,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
            login_hint=login_hint,
            lti_message_hint=lti_message_hint,
            target_link_uri=target_link_uri,
        )
        with self._lock:
            self._states[state] = rec
        return rec

    def get_state(self, state: str) -> Optional[OidcStateRecord]:
        now = self._now()
        with self._lock:
            rec = self._states.get(state)
            if not rec:
                return None
            if rec.expires_at < now:
                self._states.pop(state, None)
                return None
            return rec

    def delete_state(self, state: str) -> None:
        with self._lock:
            self._states.pop(state, None)

    def create_launch_session(self, session: LaunchSession) -> None:
        with self._lock:
            self._sessions[session.session_id] = session

    def get_launch_session(self, session_id: str) -> Optional[LaunchSession]:
        with self._lock:
            return self._sessions.get(session_id)

    def get_latest_launch_session_for_sub(
        self,
        sub: str,
        *,
        message_type: Optional[str] = None,
    ) -> Optional[LaunchSession]:
        with self._lock:
            # dict preserves insertion order; iterate backwards to get most recent launch
            for session in reversed(list(self._sessions.values())):
                if str(session.sub) != str(sub):
                    continue
                if message_type and session.message_type != message_type:
                    continue
                return session
        return None
