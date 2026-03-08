from __future__ import annotations

import json
import re
from typing import Any, Optional

from openai import OpenAI
from sqlalchemy import text

from ..config import get_settings
from ..database import SessionLocal
from .ids import generate_short_id

_PROMPT_VAR_RE = re.compile(r"\{\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\}")

STRUCTURED_FEEDBACK_PROMPT_SUFFIX = """
Return valid JSON only.
""".strip()

DEFAULT_GENERATION_BLOCK = (
    "Generate feedback that starts with a clear judgment (correct/incorrect/partially correct), "
    "explains the reasoning with context from the question, and keeps the feedback concise and actionable."
)

DEFAULT_ADDITIONAL_FORMATTING_INSTRUCTIONS = (
    "No additional formatting instructions."
)


def _load_feedback_link_generation_context(db, feedback_link_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              fl.feedback_link_id,
              fl.question_version_id,
              fl.agent_id,
              fl.created_by AS link_created_by,
              fl.is_visible AS link_is_visible,
              fa.title AS agent_title,
              fa.role,
              fa.is_structured,
              fa.provider,
              fa.model,
              fa.prompt_text,
              fa.llm_params_text
            FROM feedback_link fl
            JOIN feedback_agent fa ON fa.agent_id = fl.agent_id
            WHERE fl.feedback_link_id = :feedback_link_id
            LIMIT 1
            """
        ),
        {"feedback_link_id": feedback_link_id},
    ).mappings().first()
    return dict(row) if row else None


def _load_question_version_text(db, question_version_id: str) -> dict[str, Any]:
    blocks = db.execute(
        text(
            """
            SELECT block_order, block_type, text_content, media_url, alt_text
            FROM content_question_content_block
            WHERE question_version_id = :qv
            ORDER BY block_order ASC
            """
        ),
        {"qv": question_version_id},
    ).mappings().all()
    interactions = db.execute(
        text(
            """
            SELECT
              i.interaction_id,
              i.interaction_order,
              i.interaction_type,
              i.prompt_text,
              (to_jsonb(i)->>'reference_answer_text') AS reference_answer_text,
              (to_jsonb(i)->'reference_answer_meta') AS reference_answer_meta
            FROM content_question_interaction i
            WHERE i.question_version_id = :qv
            ORDER BY interaction_order ASC
            """
        ),
        {"qv": question_version_id},
    ).mappings().all()

    options_by_interaction: dict[str, list[dict[str, Any]]] = {}
    interaction_ids = [r["interaction_id"] for r in interactions]
    if interaction_ids:
        option_rows = db.execute(
            text(
                """
                SELECT interaction_id, option_order, option_label, option_value, is_correct
                FROM content_question_interaction_option
                WHERE interaction_id = ANY(:interaction_ids)
                ORDER BY interaction_id ASC, option_order ASC
                """
            ),
            {"interaction_ids": interaction_ids},
        ).mappings().all()
        for row in option_rows:
            options_by_interaction.setdefault(str(row["interaction_id"]), []).append(dict(row))

    return {
        "blocks": [dict(r) for r in blocks],
        "interactions": [
            {**dict(r), "options": options_by_interaction.get(str(r["interaction_id"]), [])} for r in interactions
        ],
    }


def _compose_generation_input(question_payload: dict[str, Any]) -> str:
    parts: list[str] = []

    blocks = question_payload.get("blocks") or []
    if blocks:
        parts.append("Question content blocks:")
        for block in blocks:
            block_type = str(block.get("block_type") or "text")
            if block_type == "image":
                content = block.get("alt_text") or block.get("media_url") or ""
            else:
                content = block.get("text_content") or block.get("media_url") or ""
            if content:
                parts.append(f"- [{block_type}] {content}")

    interactions = question_payload.get("interactions") or []
    if interactions:
        parts.append("")
        parts.append("Question interaction(s):")
        for it in interactions:
            parts.append(
                f"- type={it.get('interaction_type')} prompt={it.get('prompt_text') or ''}".strip()
            )
            interaction_type = str(it.get("interaction_type") or "").strip().lower()
            reference_answer_text = str(it.get("reference_answer_text") or "").strip()
            if interaction_type in {"free_text", "essay"} and reference_answer_text:
                parts.append(f"  - correct_answer: {reference_answer_text}")
            for opt in it.get("options") or []:
                label = opt.get("option_label") or opt.get("option_value") or ""
                parts.append(f"  - option {opt.get('option_order')}: {label}")

    return "\n".join(parts).strip() or "No question content available."


def _default_question_content_blocks_text(question_payload: dict[str, Any]) -> str | None:
    lines: list[str] = []
    pending_correct_answers: list[str] = []
    for interaction in question_payload.get("interactions") or []:
        interaction_type = str(interaction.get("interaction_type") or "").strip().lower()
        prompt_text = str(interaction.get("prompt_text") or "").strip()
        if prompt_text:
            lines.append(prompt_text)
        options = interaction.get("options") or []
        correct_options: list[str] = []
        for idx, option in enumerate(options, start=1):
            label = str(option.get("option_label") or option.get("option_value") or "").strip()
            if not label:
                continue
            lines.append(f"Option {idx}: {label}")
            if bool(option.get("is_correct")):
                correct_options.append(label)
        if correct_options:
            pending_correct_answers.append(f"Correct Answer: {'; '.join(correct_options)}")
        reference_answer_text = str(interaction.get("reference_answer_text") or "").strip()
        if interaction_type in {"free_text", "essay"} and reference_answer_text:
            pending_correct_answers.append(f"Correct Answer: {reference_answer_text}")
    for block in question_payload.get("blocks") or []:
        block_type = str(block.get("block_type") or "text")
        if block_type == "image":
            content = str(block.get("alt_text") or block.get("media_url") or "").strip()
        else:
            content = str(block.get("text_content") or block.get("media_url") or "").strip()
        if content:
            lines.append(f"- [{block_type}] {content}")
    lines.extend(pending_correct_answers)
    if not lines:
        return None
    return "\n".join(lines)


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if len(vec_a) != len(vec_b):
        return 0.0
    dot_product = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for a, b in zip(vec_a, vec_b):
        dot_product += a * b
        norm_a += a * a
        norm_b += b * b
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    return dot_product / ((norm_a ** 0.5) * (norm_b ** 0.5))


def _embed_texts_for_retrieval(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    client = OpenAI(
        api_key=settings.openai_api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj,
    )
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts,
    )
    return [list(item.embedding) for item in response.data]


def _load_agent_retrieval_rule(db, agent_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              fai.input_key,
              fair.preferred_info_type,
              fair.selection_mode,
              fair.max_pages,
              fair.similarity_threshold,
              fair.include_similarity
            FROM feedback_agent_input fai
            LEFT JOIN feedback_agent_input_retrieval_rule fair
              ON fair.agent_input_id = fai.agent_input_id
            WHERE fai.agent_id = :agent_id
              AND fai.input_key = 'retrieved_slide_pages'
            ORDER BY fai.sort_order ASC, fai.input_key ASC
            LIMIT 1
            """
        ),
        {"agent_id": agent_id},
    ).mappings().first()
    return dict(row) if row else None


def _load_scoped_pages_for_question_version(db, question_version_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              p.page_id::text AS page_id,
              p.slide_id::text AS slide_id,
              p.page_number,
              p.text,
              p.image_text,
              s.slide_title,
              s.slide_google_id
            FROM content_question_slide_scope qs
            JOIN page p ON p.slide_id = qs.slide_id
            LEFT JOIN slide s ON s.id = p.slide_id
            WHERE qs.question_version_id = :question_version_id
              AND (qs.page_start IS NULL OR p.page_number >= qs.page_start)
              AND (qs.page_end IS NULL OR p.page_number <= qs.page_end)
            ORDER BY p.slide_id ASC, p.page_number ASC
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().all()
    dedup: dict[str, dict[str, Any]] = {}
    for row in rows:
        page_id = str(row["page_id"])
        if page_id not in dedup:
            dedup[page_id] = dict(row)
    return list(dedup.values())


def _page_text_for_preferred_type(page: dict[str, Any], preferred_info_type: str) -> str:
    text_value = (page.get("text") or "").strip()
    image_text_value = (page.get("image_text") or "").strip()
    if preferred_info_type == "vision":
        return image_text_value or text_value
    if preferred_info_type == "mixed":
        if text_value and image_text_value:
            return f"Text: {text_value}\nVision: {image_text_value}"
        return text_value or image_text_value
    return text_value or image_text_value


def _select_retrieved_pages(
    scored_pages: list[dict[str, Any]],
    *,
    selection_mode: str,
    max_pages: int | None,
    similarity_threshold: float | None,
) -> list[dict[str, Any]]:
    if not scored_pages:
        return []
    if selection_mode == "all":
        return list(scored_pages)
    if selection_mode == "threshold":
        if similarity_threshold is None:
            return list(scored_pages)
        return [p for p in scored_pages if float(p["similarity"]) >= float(similarity_threshold)]

    top_k = int(max_pages) if max_pages is not None and int(max_pages) > 0 else 3
    if selection_mode == "threshold_then_top_k":
        if similarity_threshold is not None:
            filtered = [p for p in scored_pages if float(p["similarity"]) >= float(similarity_threshold)]
            if filtered:
                return filtered[:top_k]
        return scored_pages[:top_k]
    return scored_pages[:top_k]


def _format_retrieved_slide_pages_for_prompt(value: Any) -> str:
    if not value:
        return "none"
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else "none"
    if not isinstance(value, list):
        text_value = _stringify_prompt_value(value).strip()
        return text_value if text_value else "none"

    lines: list[str] = []
    for idx, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            fallback = _stringify_prompt_value(item).strip() or "none"
            lines.append(
                f"{idx}. Slide Title: none | Page Number: none | Similarity Val: none | Content: {fallback}"
            )
            continue
        slide_title = (_stringify_prompt_value(item.get("slide_title")).strip() or "none")
        page_number = (_stringify_prompt_value(item.get("page_number")).strip() or "none")
        similarity_val = (_stringify_prompt_value(item.get("similarity")).strip() or "none")
        content = (_stringify_prompt_value(item.get("content")).strip() or "none")
        lines.append(
            f"{idx}. Slide Title: {slide_title} | Page Number: {page_number} | Similarity Val: {similarity_val} | Content: {content}"
        )
    return "\n".join(lines) if lines else "none"


def _format_prompt_template_value(key: str, value: Any) -> str:
    if key == "retrieved_slide_pages":
        return _format_retrieved_slide_pages_for_prompt(value)
    return _stringify_prompt_value(value)


def _parse_llm_params(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text_value = raw.strip()
        if not text_value:
            return {}
        try:
            parsed = json.loads(text_value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _format_max_score_for_prompt(max_score: float) -> str:
    if float(max_score).is_integer():
        return str(int(max_score))
    return str(round(max_score, 4))


def _load_question_prompt_context(db, question_version_id: str) -> dict[str, Any]:
    row = db.execute(
        text(
            """
            SELECT question_type, score_maximum
            FROM content_question_version
            WHERE question_version_id = :question_version_id
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id},
    ).mappings().first()
    if not row:
        return {"question_type": "open-ended", "max_score": 1.0}

    question_type = str(row.get("question_type") or "open-ended")
    score_maximum = float(row.get("score_maximum") or 1)
    return {"question_type": question_type, "max_score": score_maximum}


def _human_question_type_label(question_type: str) -> str:
    q = (question_type or "").strip().lower()
    if q in {"single_choice", "multi_choice", "dropdown", "true_false"}:
        return "multiple-choice"
    if q in {"free_text", "essay"}:
        return "open-ended"
    return "open-ended"


def _score_hint_for_question_type(question_type: str, max_score: float) -> str:
    q = (question_type or "").strip().lower()
    if q in {"single_choice", "multi_choice", "dropdown", "true_false", "free_text"}:
        return "[0 for incorrect, 1 for correct]"
    if abs(float(max_score) - 2.0) < 1e-9:
        return "[0 for incorrect, 1 for correct, 2 for partially correct]"
    return f"[Numeric score from 0 to { _format_max_score_for_prompt(float(max_score)) }]"


def _build_output_schema_json_block(*, is_structured: bool, score_hint: str, max_score: float) -> str:
    feedback_key = "structured_feedback" if is_structured else "text_feedback"
    feedback_hint = "[Structured feedback text]" if is_structured else "[Plain text feedback]"
    return (
        "{\n"
        f"  \"score\": \"{score_hint}\",\n"
        f"  \"max_score\": \"[{_format_max_score_for_prompt(float(max_score))}]\",\n"
        f"  \"{feedback_key}\": \"{feedback_hint}\"\n"
        "}"
    )


def _build_formatting_instructions_text(*, is_structured: bool, max_score: float, additional: str) -> str:
    feedback_key = "structured_feedback" if is_structured else "text_feedback"
    max_score_literal = _format_max_score_for_prompt(float(max_score))
    extra = (additional or "").strip() or DEFAULT_ADDITIONAL_FORMATTING_INSTRUCTIONS
    return (
        "- Return valid JSON only; no markdown, no extra keys.\n"
        f"- Include exactly 3 keys: score, max_score, {feedback_key}.\n"
        "- score and max_score must be numeric values.\n"
        f"- Set max_score to exactly {max_score_literal}.\n"
        f"- {feedback_key} must be a string.\n"
        f"- Additional formatting instructions: {extra}\n"
        "- Final output must be only the JSON object."
    )


def _build_system_prompt_from_blocks(
    *,
    question_type_label: str,
    generation_block: str,
    output_schema_json: str,
    formatting_instructions: str,
) -> str:
    generation = (generation_block or "").strip() or DEFAULT_GENERATION_BLOCK
    return (
        f"You are tasked with generating clear, effective feedback for a student's {question_type_label} answer "
        f"and then formatting it into a structured JSON output. Complete both tasks in sequence.\n\n"
        f"### Task 1: Generate Feedback\n"
        f"{generation}\n\n"
        f"### Task 2: Format Output\n"
        f"After generating the feedback, format your response as a JSON object with this exact structure:\n\n"
        f"```json\n"
        f"{output_schema_json}\n"
        f"```\n\n"
        f"#### Formatting Instructions:\n"
        f"{formatting_instructions}\n"
    )


def _build_retrieval_query_text(input_values: dict[str, Any] | None, fallback_text: str) -> str:
    if not input_values:
        return fallback_text
    parts: list[str] = []
    q_blocks = input_values.get("question_content_blocks")
    if q_blocks is not None:
        text_value = _stringify_prompt_value(q_blocks).strip()
        if text_value:
            parts.append(text_value)
    answer_text = input_values.get("answer_text")
    if answer_text is not None:
        text_value = _stringify_prompt_value(answer_text).strip()
        if text_value:
            parts.append(text_value)
    combined = "\n\n".join(parts).strip()
    return combined or fallback_text


def _resolve_retrieved_slide_pages(
    db,
    *,
    ctx: dict[str, Any],
    input_values: dict[str, Any] | None,
    fallback_text: str,
) -> list[dict[str, Any]] | None:
    rule = _load_agent_retrieval_rule(db, str(ctx["agent_id"]))
    if not rule:
        return None

    pages = _load_scoped_pages_for_question_version(db, str(ctx["question_version_id"]))
    if not pages:
        return []

    preferred_info_type = str(rule.get("preferred_info_type") or "text")
    selection_mode = str(rule.get("selection_mode") or "top_k")
    max_pages = int(rule["max_pages"]) if rule.get("max_pages") is not None else None
    similarity_threshold = float(rule["similarity_threshold"]) if rule.get("similarity_threshold") is not None else None
    include_similarity = bool(rule.get("include_similarity", True))

    page_contents: list[str] = []
    scoped_pages: list[dict[str, Any]] = []
    for page in pages:
        content = _page_text_for_preferred_type(page, preferred_info_type).strip()
        if not content:
            continue
        scoped_pages.append(page)
        page_contents.append(content)
    if not page_contents:
        return []

    query_text = _build_retrieval_query_text(input_values, fallback_text)
    if not query_text.strip():
        return []

    vectors = _embed_texts_for_retrieval([query_text] + page_contents)
    if len(vectors) != len(page_contents) + 1:
        return []
    query_vector = vectors[0]
    page_vectors = vectors[1:]

    scored_pages: list[dict[str, Any]] = []
    for page, page_vector in zip(scoped_pages, page_vectors):
        similarity = _cosine_similarity(query_vector, page_vector)
        image_text_value = (page.get("image_text") or "").strip()
        text_value = (page.get("text") or "").strip()
        content_value = image_text_value or text_value or "none"
        row = {
            "slide_title": page.get("slide_title"),
            "page_number": int(page["page_number"]) if page.get("page_number") is not None else None,
            "content": content_value,
        }
        if include_similarity:
            row["similarity"] = float(round(similarity, 6))
        else:
            row["similarity"] = similarity
        scored_pages.append(row)
    scored_pages.sort(key=lambda item: float(item.get("similarity") or 0.0), reverse=True)

    selected = _select_retrieved_pages(
        scored_pages,
        selection_mode=selection_mode,
        max_pages=max_pages,
        similarity_threshold=similarity_threshold,
    )
    if not include_similarity:
        for row in selected:
            row.pop("similarity", None)
    return selected


def _stringify_prompt_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value)
    except Exception:
        return str(value)


def _render_prompt_template(prompt_text: str, input_values: dict[str, Any] | None) -> str:
    if not prompt_text or not input_values:
        return prompt_text

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in input_values:
            return match.group(0)
        return _format_prompt_template_value(key, input_values.get(key))

    return _PROMPT_VAR_RE.sub(_replace, prompt_text)


def _compose_generation_input_from_values(input_values: dict[str, Any] | None) -> str | None:
    if not input_values:
        return None

    parts: list[str] = []

    q_blocks = input_values.get("question_content_blocks")
    if isinstance(q_blocks, str):
        text_value = q_blocks.strip()
        if text_value:
            # Keep parity with frontend preview when question blocks are already preformatted.
            parts.append(text_value)
    elif q_blocks is not None:
        text_value = _stringify_prompt_value(q_blocks).strip()
        if text_value:
            parts.append(f"question_content_blocks: {text_value}")

    answer_text = input_values.get("answer_text")
    if answer_text is not None:
        text_value = _stringify_prompt_value(answer_text).strip()
        if text_value:
            parts.append(f"answer_text: {text_value}")

    retrieved_pages = input_values.get("retrieved_slide_pages")
    if retrieved_pages is not None:
        text_value = _format_retrieved_slide_pages_for_prompt(retrieved_pages).strip()
        if text_value:
            parts.append(f"retrieved_slide_pages: {text_value}")

    if not parts:
        for key, value in input_values.items():
            text_value = _stringify_prompt_value(value).strip()
            if text_value:
                parts.append(f"{key}: {text_value}")

    if not parts:
        return None
    return "\n\n".join(parts)


def _normalize_effort(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"minimal", "low", "medium", "high"}:
        return normalized
    return "low"


def _normalize_verbosity(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized
    return "low"


def _positive_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _call_feedback(
    *,
    provider: str,
    model: str,
    system_prompt: str,
    user_text: str,
    llm_params: dict[str, Any] | None = None,
) -> str:
    normalized_provider = (provider or "openai").strip().lower()
    if normalized_provider not in {"", "openai"}:
        raise ValueError(f"Unsupported provider for static auto-generation: {normalized_provider}")

    params = dict(llm_params or {})
    effort = _normalize_effort(params.get("effort") or params.get("reasoning_effort"))
    verbosity = _normalize_verbosity(params.get("verbosity") or params.get("text_verbosity"))
    max_output_tokens = _positive_int_or_none(params.get("max_output_tokens"))
    temperature = _float_or_none(params.get("temperature"))
    top_p = _float_or_none(params.get("top_p"))

    settings = get_settings()
    client = OpenAI(
        api_key=settings.openai_api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj,
    )
    request_payload: dict[str, Any] = {
        "model": model,
        "reasoning": {"effort": effort},
        "text": {"verbosity": verbosity},
        "instructions": system_prompt,
        # Responses API requires non-empty `input`. Keep logical user prompt empty
        # while sending a minimal transport placeholder.
        "input": (user_text if user_text != "" else " "),
    }
    if max_output_tokens is not None:
        request_payload["max_output_tokens"] = max_output_tokens
    if temperature is not None:
        request_payload["temperature"] = temperature
    if top_p is not None:
        request_payload["top_p"] = top_p

    response = client.responses.create(
        **request_payload,
    )
    return (response.output_text or "").strip()


def _generate_feedback_text_from_context(
    db,
    ctx: dict[str, Any],
    *,
    input_values: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    provider = (ctx.get("provider") or "openai").strip().lower()
    model = (ctx.get("model") or "").strip() or "gpt-5"
    llm_params = _parse_llm_params(ctx.get("llm_params_text"))
    effective_input_values = dict(input_values or {})
    fallback_question_payload = _load_question_version_text(db, str(ctx["question_version_id"]))
    default_question_blocks = _default_question_content_blocks_text(fallback_question_payload)
    if default_question_blocks:
        # Use backend-built question blocks as the source of truth so
        # reference answers are always part of question_content_blocks.
        effective_input_values["question_content_blocks"] = default_question_blocks
    fallback_user_text = _compose_generation_input(fallback_question_payload)
    existing_retrieved_pages = effective_input_values.get("retrieved_slide_pages")
    if existing_retrieved_pages in (None, "", [], {}):
        resolved_pages = _resolve_retrieved_slide_pages(
            db,
            ctx=ctx,
            input_values=effective_input_values if effective_input_values else None,
            fallback_text=fallback_user_text,
        )
        if resolved_pages is not None:
            effective_input_values["retrieved_slide_pages"] = resolved_pages

    prompt_ctx = _load_question_prompt_context(db, str(ctx["question_version_id"]))
    question_type = str(prompt_ctx["question_type"])
    max_score = float(prompt_ctx["max_score"])
    generation_block = str(llm_params.get("feedback_generation_block") or (ctx.get("prompt_text") or "").strip() or DEFAULT_GENERATION_BLOCK)
    additional_formatting_instructions = str(llm_params.get("additional_formatting_instructions_block") or "")
    score_hint = _score_hint_for_question_type(question_type, max_score)
    output_schema_json = _build_output_schema_json_block(
        is_structured=bool(ctx.get("is_structured")),
        score_hint=score_hint,
        max_score=max_score,
    )
    formatting_instructions = _build_formatting_instructions_text(
        is_structured=bool(ctx.get("is_structured")),
        max_score=max_score,
        additional=additional_formatting_instructions,
    )
    system_prompt = _build_system_prompt_from_blocks(
        question_type_label=_human_question_type_label(question_type),
        generation_block=generation_block,
        output_schema_json=output_schema_json,
        formatting_instructions=formatting_instructions,
    )
    system_prompt = _render_prompt_template(system_prompt, effective_input_values)

    # Keep user prompt empty; all context should be encoded via system prompt template variables.
    user_text = ""
    generated = _call_feedback(
        provider=provider,
        model=model,
        system_prompt=system_prompt,
        user_text=user_text,
        llm_params=llm_params,
    )
    
    if not generated:
        raise ValueError("LLM returned empty feedback text")
    debug_payload = {
        "resolved_input_values": effective_input_values,
        "resolved_system_prompt": system_prompt,
        "resolved_user_text": user_text,
    }
    return generated, debug_payload


def resolve_feedback_prompt_for_feedback_link(
    feedback_link_id: str,
    *,
    input_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Resolve prompts for a feedback_link without calling the LLM.
    Useful for recording/debugging prompt payloads.
    """
    with SessionLocal() as db:
        ctx = _load_feedback_link_generation_context(db, feedback_link_id)
        if not ctx:
            return {"ok": False, "feedback_link_id": feedback_link_id, "reason": "link_not_found"}
        if not ctx.get("link_is_visible", True):
            return {"ok": False, "feedback_link_id": feedback_link_id, "reason": "link_not_visible"}
        if str(ctx.get("role") or "") != "ai":
            return {"ok": False, "feedback_link_id": feedback_link_id, "reason": "agent_not_ai"}

        llm_params = _parse_llm_params(ctx.get("llm_params_text"))
        effective_input_values = dict(input_values or {})
        fallback_question_payload = _load_question_version_text(db, str(ctx["question_version_id"]))
        default_question_blocks = _default_question_content_blocks_text(fallback_question_payload)
        if default_question_blocks:
            effective_input_values["question_content_blocks"] = default_question_blocks
        fallback_user_text = _compose_generation_input(fallback_question_payload)
        existing_retrieved_pages = effective_input_values.get("retrieved_slide_pages")
        if existing_retrieved_pages in (None, "", [], {}):
            resolved_pages = _resolve_retrieved_slide_pages(
                db,
                ctx=ctx,
                input_values=effective_input_values if effective_input_values else None,
                fallback_text=fallback_user_text,
            )
            if resolved_pages is not None:
                effective_input_values["retrieved_slide_pages"] = resolved_pages

        prompt_ctx = _load_question_prompt_context(db, str(ctx["question_version_id"]))
        question_type = str(prompt_ctx["question_type"])
        max_score = float(prompt_ctx["max_score"])
        generation_block = str(
            llm_params.get("feedback_generation_block")
            or (ctx.get("prompt_text") or "").strip()
            or DEFAULT_GENERATION_BLOCK
        )
        additional_formatting_instructions = str(llm_params.get("additional_formatting_instructions_block") or "")
        score_hint = _score_hint_for_question_type(question_type, max_score)
        output_schema_json = _build_output_schema_json_block(
            is_structured=bool(ctx.get("is_structured")),
            score_hint=score_hint,
            max_score=max_score,
        )
        formatting_instructions = _build_formatting_instructions_text(
            is_structured=bool(ctx.get("is_structured")),
            max_score=max_score,
            additional=additional_formatting_instructions,
        )
        system_prompt = _build_system_prompt_from_blocks(
            question_type_label=_human_question_type_label(question_type),
            generation_block=generation_block,
            output_schema_json=output_schema_json,
            formatting_instructions=formatting_instructions,
        )
        system_prompt = _render_prompt_template(system_prompt, effective_input_values)

        user_text = ""

        return {
            "ok": True,
            "feedback_link_id": feedback_link_id,
            "resolved_input_values": effective_input_values,
            "resolved_system_prompt": system_prompt,
            "resolved_user_text": user_text,
        }


def _generate_unique_id(db, table: str, col: str, prefix: str) -> str:
    sql = text(f"SELECT 1 FROM {table} WHERE {col} = :v LIMIT 1")
    for _ in range(50):
        candidate = generate_short_id(prefix)
        if not db.execute(sql, {"v": candidate}).scalar():
            return candidate
    raise ValueError(f"Unable to generate unique id for {table}.{col}")


def _ensure_static_feedback_version_schema(db) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS feedback_static_feedback_version (
                version_id VARCHAR(16) PRIMARY KEY,
                question_id VARCHAR(16) NOT NULL,
                question_version_id VARCHAR(16) NOT NULL,
                agent_id VARCHAR(16) NOT NULL,
                revision_no INT NOT NULL,
                question_feedback_text TEXT NULL,
                parent_version_id VARCHAR(16) NULL,
                restored_from_version_id VARCHAR(16) NULL,
                created_by VARCHAR(16) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_static_feedback_version_question_agent_created_at
            ON feedback_static_feedback_version (question_id, agent_id, created_at DESC);
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS feedback_static_feedback_version_option (
                version_option_id VARCHAR(16) PRIMARY KEY,
                version_id VARCHAR(16) NOT NULL REFERENCES feedback_static_feedback_version(version_id) ON DELETE CASCADE,
                interaction_option_id VARCHAR(16) NOT NULL,
                feedback_text TEXT NOT NULL,
                created_by VARCHAR(16) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_feedback_static_feedback_version_option UNIQUE (version_id, interaction_option_id)
            );
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE feedback_static_feedback_version
            ALTER COLUMN created_at TYPE TIMESTAMPTZ
            USING created_at AT TIME ZONE 'UTC';
            """
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE feedback_static_feedback_version_option
            ALTER COLUMN created_at TYPE TIMESTAMPTZ
            USING created_at AT TIME ZONE 'UTC';
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_static_feedback_version_option_version_id
            ON feedback_static_feedback_version_option (version_id);
            """
        )
    )


def _load_feedback_snapshot_state(
    db,
    *,
    question_version_id: str,
    agent_id: str,
) -> tuple[str | None, list[dict[str, Any]]]:
    q_row = db.execute(
        text(
            """
            SELECT static_feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'question_version'
              AND target_entity_id = :question_version_id
              AND is_visible = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().first()
    question_feedback_text = str(q_row["static_feedback_text"]) if q_row and q_row.get("static_feedback_text") is not None else None

    option_rows = db.execute(
        text(
            """
            SELECT target_entity_id AS interaction_option_id, static_feedback_text AS feedback_text
            FROM feedback_link
            WHERE question_version_id = :question_version_id
              AND agent_id = :agent_id
              AND target_entity_type = 'interaction_option'
              AND is_visible = TRUE
            ORDER BY target_entity_id ASC
            """
        ),
        {"question_version_id": question_version_id, "agent_id": agent_id},
    ).mappings().all()
    option_feedback: list[dict[str, Any]] = []
    for row in option_rows:
        text_value = (row.get("feedback_text") or "").strip()
        if text_value:
            option_feedback.append(
                {
                    "interaction_option_id": str(row["interaction_option_id"]),
                    "feedback_text": text_value,
                }
            )
    return question_feedback_text, option_feedback


def _create_static_feedback_snapshot_for_feedback_link(
    db,
    *,
    feedback_link_id: str,
    created_by: str | None,
) -> dict[str, Any]:
    ctx = db.execute(
        text(
            """
            SELECT
              q.question_id,
              fl.question_version_id,
              fl.agent_id,
              fl.created_by AS link_created_by
            FROM feedback_link fl
            JOIN content_question_version qv ON qv.question_version_id = fl.question_version_id
            JOIN content_question q ON q.question_id = qv.question_id
            WHERE fl.feedback_link_id = :feedback_link_id
            LIMIT 1
            """
        ),
        {"feedback_link_id": feedback_link_id},
    ).mappings().first()
    if not ctx:
        raise ValueError(f"feedback_link not found for version snapshot: {feedback_link_id}")

    question_id = str(ctx["question_id"])
    question_version_id = str(ctx["question_version_id"])
    agent_id = str(ctx["agent_id"])
    snapshot_created_by = (created_by or "").strip() or str(ctx["link_created_by"] or "").strip()
    if not snapshot_created_by:
        raise ValueError("missing created_by for static feedback snapshot")

    latest = db.execute(
        text(
            """
            SELECT version_id, revision_no
            FROM feedback_static_feedback_version
            WHERE question_id = :question_id AND agent_id = :agent_id
            ORDER BY revision_no DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"question_id": question_id, "agent_id": agent_id},
    ).mappings().first()
    parent_version_id = str(latest["version_id"]) if latest else None
    revision_no = int(latest["revision_no"]) + 1 if latest else 1

    question_feedback_text, option_feedback = _load_feedback_snapshot_state(
        db, question_version_id=question_version_id, agent_id=agent_id
    )

    version_id = _generate_unique_id(db, "feedback_static_feedback_version", "version_id", "fv")
    db.execute(
        text(
            """
            INSERT INTO feedback_static_feedback_version (
              version_id, question_id, question_version_id, agent_id, revision_no,
              question_feedback_text, parent_version_id, restored_from_version_id, created_by, created_at
            ) VALUES (
              :version_id, :question_id, :question_version_id, :agent_id, :revision_no,
              :question_feedback_text, :parent_version_id, NULL, :created_by, NOW()
            )
            """
        ),
        {
            "version_id": version_id,
            "question_id": question_id,
            "question_version_id": question_version_id,
            "agent_id": agent_id,
            "revision_no": revision_no,
            "question_feedback_text": question_feedback_text,
            "parent_version_id": parent_version_id,
            "created_by": snapshot_created_by,
        },
    )

    for item in option_feedback:
        db.execute(
            text(
                """
                INSERT INTO feedback_static_feedback_version_option (
                  version_option_id, version_id, interaction_option_id, feedback_text, created_by, created_at
                ) VALUES (
                  :version_option_id, :version_id, :interaction_option_id, :feedback_text, :created_by, NOW()
                )
                """
            ),
            {
                "version_option_id": _generate_unique_id(
                    db, "feedback_static_feedback_version_option", "version_option_id", "fo"
                ),
                "version_id": version_id,
                "interaction_option_id": item["interaction_option_id"],
                "feedback_text": item["feedback_text"],
                "created_by": snapshot_created_by,
            },
        )

    return {
        "version_id": version_id,
        "revision_no": revision_no,
        "question_id": question_id,
        "question_version_id": question_version_id,
        "agent_id": agent_id,
    }


def generate_static_feedback_for_feedback_link(
    feedback_link_id: str,
    *,
    persist: bool = True,
    enforce_ai_role: bool = True,
    input_values: dict[str, Any] | None = None,
    include_debug: bool = False,
) -> dict[str, Any]:
    """
    RQ worker job: generate and persist static feedback text for an AI+static feedback_link.
    """
    with SessionLocal() as db:
        ctx = _load_feedback_link_generation_context(db, feedback_link_id)
        if not ctx:
            raise ValueError(f"feedback_link not found: {feedback_link_id}")
        if not ctx.get("link_is_visible", True):
            return {"ok": False, "feedback_link_id": feedback_link_id, "skipped": True, "reason": "link_not_visible"}
        if enforce_ai_role and str(ctx.get("role") or "") != "ai":
            return {"ok": False, "feedback_link_id": feedback_link_id, "skipped": True, "reason": "agent_not_ai"}

        generated, debug_payload = _generate_feedback_text_from_context(db, ctx, input_values=input_values)

        if persist:
            db.execute(
                text(
                    """
                    UPDATE feedback_link
                    SET static_feedback_text = :static_feedback_text
                    WHERE feedback_link_id = :feedback_link_id
                    """
                ),
                {"feedback_link_id": feedback_link_id, "static_feedback_text": generated},
            )
            db.commit()
        result = {
            "ok": True,
            "feedback_link_id": feedback_link_id,
            "length": len(generated),
            "persisted": persist,
            "static_feedback_text": generated,
        }
        if include_debug:
            result.update(debug_payload)
        return result


def generate_static_feedback_with_version_snapshot_for_feedback_link(
    feedback_link_id: str,
    *,
    created_by: str | None = None,
) -> dict[str, Any]:
    with SessionLocal() as db:
        result = generate_static_feedback_for_feedback_link(
            feedback_link_id,
            persist=True,
            enforce_ai_role=True,
        )
        if not result.get("ok") or result.get("skipped"):
            return result

        _ensure_static_feedback_version_schema(db)
        snapshot = _create_static_feedback_snapshot_for_feedback_link(
            db,
            feedback_link_id=feedback_link_id,
            created_by=created_by,
        )
        db.commit()
        result["version_id"] = snapshot["version_id"]
        result["revision_no"] = int(snapshot["revision_no"])
        result["question_id"] = snapshot["question_id"]
        result["question_version_id"] = snapshot["question_version_id"]
        result["agent_id"] = snapshot["agent_id"]
        return result
