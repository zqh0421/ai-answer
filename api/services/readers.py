from __future__ import annotations

from collections import defaultdict
import base64
import json
import math
from pathlib import Path
import threading
import time
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings


_GOOGLE_TOKEN_CACHE: dict[str, Any] = {"access_token": None, "expires_at": 0.0}
_GOOGLE_TOKEN_LOCK = threading.Lock()
_PRESENTATION_SLIDES_CACHE: dict[str, tuple[float, list[str]]] = {}
_PRESENTATION_SLIDES_CACHE_LOCK = threading.Lock()
_PRESENTATION_SLIDES_TTL_SECONDS = 600.0


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if len(vec_a) != len(vec_b):
        return -1.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return -1.0
    return dot / (norm_a * norm_b)


def _to_float_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list):
        seq = value
    elif isinstance(value, tuple):
        seq = list(value)
    else:
        try:
            seq = list(value)
        except Exception:
            return None
    if not seq:
        return None
    out: list[float] = []
    try:
        for item in seq:
            out.append(float(item))
    except Exception:
        return None
    return out


def _resolve_scope_most_relevant_pages(
    db: Session,
    *,
    question_vector: list[float] | None,
    scopes: list[dict[str, Any]],
) -> dict[str, int]:
    if not question_vector or not scopes:
        return {}

    slide_ids = [s.get("slide_id") for s in scopes if s.get("slide_id")]
    if not slide_ids:
        return {}

    pages = db.execute(
        text(
            """
            SELECT slide_id::text AS slide_id, page_number, vector
            FROM page
            WHERE slide_id = ANY(CAST(:slide_ids AS UUID[]))
              AND vector IS NOT NULL
            ORDER BY slide_id ASC, page_number ASC
            """
        ),
        {"slide_ids": slide_ids},
    ).mappings().all()
    if not pages:
        return {}

    scope_by_slide: dict[str, dict[str, Any]] = {}
    for scope in scopes:
        sid = str(scope.get("slide_id") or "")
        if sid and sid not in scope_by_slide:
            scope_by_slide[sid] = scope

    best_by_slide: dict[str, tuple[float, int]] = {}
    for row in pages:
        sid = str(row.get("slide_id") or "")
        scope = scope_by_slide.get(sid)
        if not scope:
            continue
        page_number = int(row.get("page_number") or 0)
        if page_number <= 0:
            continue
        page_start = scope.get("page_start")
        page_end = scope.get("page_end")
        if page_start is not None and page_number < int(page_start):
            continue
        if page_end is not None and page_number > int(page_end):
            continue
        vec = _to_float_vector(row.get("vector"))
        if not vec:
            continue
        similarity = _cosine_similarity(question_vector, vec)
        if similarity < 0:
            continue
        best = best_by_slide.get(sid)
        if best is None or similarity > best[0]:
            best_by_slide[sid] = (similarity, page_number)

    return {sid: page_no for sid, (_, page_no) in best_by_slide.items()}


def _get_google_access_token_from_refresh_token() -> tuple[str | None, str | None]:
    now = time.time()
    with _GOOGLE_TOKEN_LOCK:
        cached = _GOOGLE_TOKEN_CACHE.get("access_token")
        if cached and float(_GOOGLE_TOKEN_CACHE.get("expires_at") or 0) > now + 30:
            return str(cached), None

    settings = get_settings()
    try:
        response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.auth_google_id,
                "client_secret": settings.auth_google_secret,
                "refresh_token": settings.auth_secret,
                "grant_type": "refresh_token",
            },
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        token = str(payload.get("access_token") or "").strip()
        expires_in = int(payload.get("expires_in") or 3600)
        if not token:
            return None, "oauth_token_missing_access_token"
        with _GOOGLE_TOKEN_LOCK:
            _GOOGLE_TOKEN_CACHE["access_token"] = token
            _GOOGLE_TOKEN_CACHE["expires_at"] = time.time() + max(expires_in - 60, 60)
        return token, None
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        body = ""
        if exc.response is not None:
            try:
                body = exc.response.text[:500]
            except Exception:
                body = ""
        print(f"[GOOGLE_OAUTH_TOKEN_ERROR] status={status} body={body}")
        return None, f"oauth_token_http_{status}"
    except Exception as exc:
        print(f"[GOOGLE_OAUTH_TOKEN_ERROR] exception={type(exc).__name__}: {exc}")
        return None, f"oauth_token_exception_{type(exc).__name__}"


def _get_google_access_token_from_service_account() -> tuple[str | None, str | None]:
    settings = get_settings()
    client_email = str(settings.google_service_account_email or "").strip()
    private_key_raw = str(settings.google_service_account_private_key or "").strip()
    key_file = str(settings.google_service_account_private_key_file or "").strip()

    if key_file:
        try:
            data = json.loads(Path(key_file).read_text(encoding="utf-8"))
            client_email = str(data.get("client_email") or client_email).strip()
            private_key_raw = str(data.get("private_key") or private_key_raw).strip()
        except FileNotFoundError:
            return None, "service_account_key_file_not_found"
        except Exception as exc:
            print(f"[GOOGLE_SERVICE_ACCOUNT_KEY_FILE_ERROR] exception={type(exc).__name__}: {exc}")
            return None, f"service_account_key_file_exception_{type(exc).__name__}"

    if not client_email or not private_key_raw:
        return None, "service_account_config_missing"

    private_key_pem = private_key_raw.replace("\\n", "\n")
    now = int(time.time())
    payload = {
        "iss": client_email,
        "scope": "https://www.googleapis.com/auth/presentations.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }
    header = {"alg": "RS256", "typ": "JWT"}
    try:
        private_key = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
        signing_input = (
            f"{_b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))}."
            f"{_b64url(json.dumps(payload, separators=(',', ':')).encode('utf-8'))}"
        )
        signature = private_key.sign(
            signing_input.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        assertion = f"{signing_input}.{_b64url(signature)}"
    except Exception as exc:
        print(f"[GOOGLE_SERVICE_ACCOUNT_SIGN_ERROR] exception={type(exc).__name__}: {exc}")
        return None, f"service_account_sign_exception_{type(exc).__name__}"

    try:
        response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            timeout=8,
        )
        response.raise_for_status()
        payload_json = response.json()
        token = str(payload_json.get("access_token") or "").strip()
        expires_in = int(payload_json.get("expires_in") or 3600)
        if not token:
            return None, "service_account_token_missing_access_token"
        with _GOOGLE_TOKEN_LOCK:
            _GOOGLE_TOKEN_CACHE["access_token"] = token
            _GOOGLE_TOKEN_CACHE["expires_at"] = time.time() + max(expires_in - 60, 60)
        return token, None
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        body = ""
        if exc.response is not None:
            try:
                body = exc.response.text[:500]
            except Exception:
                body = ""
        print(f"[GOOGLE_SERVICE_ACCOUNT_TOKEN_ERROR] status={status} body={body}")
        return None, f"service_account_token_http_{status}"
    except Exception as exc:
        print(f"[GOOGLE_SERVICE_ACCOUNT_TOKEN_ERROR] exception={type(exc).__name__}: {exc}")
        return None, f"service_account_token_exception_{type(exc).__name__}"


def _get_presentation_slide_object_ids(presentation_id: str) -> tuple[list[str] | None, str | None]:
    presentation_id = str(presentation_id or "").strip()
    if not presentation_id:
        return None, "missing_slide_google_id"
    now = time.time()
    with _PRESENTATION_SLIDES_CACHE_LOCK:
        cached = _PRESENTATION_SLIDES_CACHE.get(presentation_id)
        if cached and cached[0] > now:
            return list(cached[1]), None

    settings = get_settings()
    url = f"https://slides.googleapis.com/v1/presentations/{presentation_id}"
    headers: dict[str, str] = {}
    params: dict[str, str] = {"fields": "slides.objectId"}
    token, token_error = _get_google_access_token_from_service_account()
    auth_mode = "service_account"
    if not token:
        token, token_error = _get_google_access_token_from_refresh_token()
        auth_mode = "oauth_refresh_token"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        # Fallback for publicly accessible decks.
        params["key"] = settings.next_public_google_drive_api_key

    try:
        response = requests.get(url, headers=headers, params=params, timeout=8)
        response.raise_for_status()
        payload = response.json()
        slides = payload.get("slides") or []
        object_ids: list[str] = []
        for item in slides:
            if not isinstance(item, dict):
                continue
            object_id = str(item.get("objectId") or "").strip()
            if object_id:
                object_ids.append(object_id)
        with _PRESENTATION_SLIDES_CACHE_LOCK:
            _PRESENTATION_SLIDES_CACHE[presentation_id] = (
                time.time() + _PRESENTATION_SLIDES_TTL_SECONDS,
                object_ids,
            )
        return object_ids, None
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        body = ""
        if exc.response is not None:
            try:
                body = exc.response.text[:1000]
            except Exception:
                body = ""
        auth_mode = auth_mode if token else "api_key"
        print(
            f"[GOOGLE_SLIDES_API_ERROR] auth_mode={auth_mode} presentation_id={presentation_id} "
            f"status={status} token_error={token_error} body={body}"
        )
        return None, f"slides_api_http_{status}"
    except Exception as exc:
        auth_mode = auth_mode if token else "api_key"
        print(
            f"[GOOGLE_SLIDES_API_ERROR] auth_mode={auth_mode} presentation_id={presentation_id} "
            f"token_error={token_error} exception={type(exc).__name__}: {exc}"
        )
        return None, f"slides_api_exception_{type(exc).__name__}"


def _build_most_relevant_slide_embed_url(
    slide_google_id: str | None, most_relevant_page_number: int | None
) -> tuple[str | None, str | None]:
    if not slide_google_id or most_relevant_page_number is None or most_relevant_page_number < 1:
        return None, "missing_slide_id_or_page"
    object_ids, error = _get_presentation_slide_object_ids(slide_google_id)
    if not object_ids or most_relevant_page_number > len(object_ids):
        return None, error or "page_out_of_bounds_or_missing_object_ids"
    object_id = object_ids[most_relevant_page_number - 1]
    slide_anchor = object_id if object_id.startswith("id.") else f"id.{object_id}"
    return (
        f"https://docs.google.com/presentation/d/{slide_google_id}/embed"
        f"?slide={slide_anchor}#slide={slide_anchor}"
    ), None


def get_semantic_question_version_detail(db: Session, question_version_id: str) -> dict[str, Any] | None:
    version = db.execute(
        text(
            """
            SELECT
              qv.question_version_id,
              qv.question_id,
              q.current_version_id,
              q.access_scope,
              q.is_visible,
              q.created_by AS question_created_by,
              q.created_at AS question_created_at,
              qv.version_no,
              qv.question_type,
              qv.title,
              qv.change_note,
              qv.score_maximum,
              qv.score_input_format,
              qv.score_normalize_to_maximum,
              qv.score_rounding_mode,
              qv.score_rounding_step,
              COALESCE((to_jsonb(qv)->>'randomize_option_order')::boolean, TRUE) AS randomize_option_order,
              qv.question_vector,
              qv.question_answer_vector,
              qv.created_by AS version_created_by,
              qv.created_at AS version_created_at
            FROM content_question_version qv
            JOIN content_question q ON q.question_id = qv.question_id
            WHERE qv.question_version_id = :question_version_id
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().first()
    if not version:
        return None

    content_blocks = db.execute(
        text(
            """
            SELECT content_block_id, question_version_id, block_order, block_type, text_content, media_url, alt_text, created_by, created_at
            FROM content_question_content_block
            WHERE question_version_id = :question_version_id
            ORDER BY block_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    interactions = db.execute(
        text(
            """
            SELECT
              i.interaction_id,
              i.question_version_id,
              i.interaction_order,
              i.interaction_type,
              i.prompt_text,
              i.is_required,
              i.max_score,
              (to_jsonb(i)->>'reference_answer_text') AS reference_answer_text,
              (to_jsonb(i)->'reference_answer_meta') AS reference_answer_meta,
              i.created_by,
              i.created_at
            FROM content_question_interaction i
            WHERE i.question_version_id = :question_version_id
            ORDER BY interaction_order ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    interaction_ids = [row["interaction_id"] for row in interactions]

    options_by_interaction: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if interaction_ids:
        option_rows = db.execute(
            text(
                """
                SELECT interaction_option_id, interaction_id, option_order, option_value, option_label, is_correct, created_by, created_at
                FROM content_question_interaction_option
                WHERE interaction_id = ANY(:interaction_ids)
                ORDER BY interaction_id ASC, option_order ASC
                """
            ),
            {"interaction_ids": interaction_ids},
        ).mappings().all()
        for row in option_rows:
            options_by_interaction[row["interaction_id"]].append(dict(row))

    slide_scope = db.execute(
        text(
            """
            SELECT
              s.slide_scope_id,
              s.question_version_id,
              s.slide_id::text AS slide_id,
              s.page_start,
              s.page_end,
              s.created_by,
              s.created_at,
              sl.slide_google_id,
              sl.slide_title,
              COALESCE(pc.total_pages, 0) AS slide_total_pages,
              NULL::int AS most_relevant_page_number
            FROM content_question_slide_scope s
            LEFT JOIN slide sl ON sl.id = s.slide_id
            LEFT JOIN (
              SELECT slide_id, COUNT(*)::int AS total_pages
              FROM page
              GROUP BY slide_id
            ) pc ON pc.slide_id = s.slide_id
            WHERE s.question_version_id = :question_version_id
            ORDER BY s.created_at ASC, s.slide_scope_id ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    feedback_links = db.execute(
        text(
            """
            SELECT
              fl.feedback_link_id,
              fl.question_version_id,
              fl.agent_id,
              fa.title AS agent_title,
              fa.role AS agent_role,
              fa.is_structured,
              fl.target_entity_type,
              fl.target_entity_id,
              fl.priority,
              fl.static_feedback_text,
              fl.structured_feedback_text,
              fl.is_visible,
              fl.created_by,
              fl.created_at
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.question_version_id = :question_version_id
            ORDER BY fl.priority ASC, fl.created_at ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()

    interaction_items: list[dict[str, Any]] = []
    for interaction in interactions:
        item = dict(interaction)
        item["options"] = options_by_interaction.get(interaction["interaction_id"], [])
        interaction_items.append(item)

    retrieval_vector = _to_float_vector(version.get("question_answer_vector")) or _to_float_vector(
        version.get("question_vector")
    )
    most_relevant_by_slide = _resolve_scope_most_relevant_pages(
        db,
        question_vector=retrieval_vector,
        scopes=[dict(r) for r in slide_scope],
    )
    slide_scope_items: list[dict[str, Any]] = []
    for row in (dict(r) for r in slide_scope):
        most_relevant_page_number = most_relevant_by_slide.get(str(row.get("slide_id")))
        embed_url, embed_error = _build_most_relevant_slide_embed_url(
            row.get("slide_google_id"),
            most_relevant_page_number,
        )
        slide_scope_items.append(
            {
                **row,
                "most_relevant_page_number": most_relevant_page_number,
                "most_relevant_slide_embed_url": embed_url,
                "most_relevant_slide_embed_url_error": embed_error,
                "slide": {
                    "slide_id": row.get("slide_id"),
                    "slide_google_id": row.get("slide_google_id"),
                    "slide_title": row.get("slide_title"),
                },
            }
        )

    return {
        "ok": True,
        "question": {
            "question_id": version["question_id"],
            "current_version_id": version["current_version_id"],
            "access_scope": version["access_scope"],
            "is_visible": version["is_visible"],
            "created_by": version["question_created_by"],
            "created_at": version["question_created_at"],
        },
        "question_version": {
            "question_version_id": version["question_version_id"],
            "version_no": version["version_no"],
            "question_type": version["question_type"],
            "title": version["title"],
            "change_note": version["change_note"],
            "score_maximum": version["score_maximum"],
            "score_input_format": version["score_input_format"],
            "score_normalize_to_maximum": version["score_normalize_to_maximum"],
            "score_rounding_mode": version["score_rounding_mode"],
            "score_rounding_step": version["score_rounding_step"],
            "randomize_option_order": version["randomize_option_order"],
            "created_by": version["version_created_by"],
            "created_at": version["version_created_at"],
        },
        "content_blocks": [dict(r) for r in content_blocks],
        "interactions": interaction_items,
        "slide_scope": slide_scope_items,
        "feedback_links": [dict(r) for r in feedback_links],
    }
