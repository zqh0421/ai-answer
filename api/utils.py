from openai import OpenAI
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated
from typing import List
import math
import requests
from io import BytesIO
from .services.question_formatter import format_question

def fetch_pdf_from_drive(file_id: str, settings: Annotated[Settings, Depends(get_settings)]):
    file_id = str(file_id or "").strip()
    if not file_id:
        raise ValueError("Missing slide file id")

    def _extract_error_hint(resp: requests.Response) -> str:
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                top_error = payload.get("error")
                if isinstance(top_error, dict):
                    msg = top_error.get("message")
                    if msg:
                        return str(msg)
                if top_error:
                    return str(top_error)
        except Exception:
            pass
        try:
            text = (resp.text or "").strip()
        except Exception:
            text = ""
        return text[:240] if text else ""

    def _get_refresh_token_access_token() -> str | None:
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
            token = str((response.json() or {}).get("access_token") or "").strip()
            return token or None
        except Exception:
            return None

    auth_token = _get_refresh_token_access_token()
    request_variants = []
    if auth_token:
        request_variants.append(
            {
                "url": f"https://www.googleapis.com/drive/v3/files/{file_id}/export",
                "params": {"mimeType": "application/pdf"},
                "headers": {"Authorization": f"Bearer {auth_token}"},
                "mode": "oauth_refresh_token",
            }
        )
    request_variants.append(
        {
            "url": f"https://www.googleapis.com/drive/v3/files/{file_id}/export",
            "params": {"mimeType": "application/pdf", "key": settings.next_public_google_drive_api_key},
            "headers": {},
            "mode": "api_key",
        }
    )

    errors = []
    with requests.Session() as session:
        for variant in request_variants:
            try:
                response = session.get(
                    variant["url"],
                    params=variant["params"],
                    headers=variant["headers"],
                    allow_redirects=True,
                    timeout=15,
                )
            except Exception as exc:
                errors.append(f"{variant['mode']}: request_exception={type(exc).__name__}")
                continue

            content_type = str(response.headers.get("content-type") or "").lower()
            content = response.content or b""
            if response.status_code == 200 and (
                "application/pdf" in content_type or content.startswith(b"%PDF")
            ):
                return BytesIO(content)

            error_hint = _extract_error_hint(response)
            errors.append(
                f"{variant['mode']}: status={response.status_code}"
                + (f", hint={error_hint}" if error_hint else "")
            )

    raise ValueError("Failed to fetch PDF from drive; " + " | ".join(errors))

def create_embedding(
    content: List[dict],
    settings: Annotated[Settings, Depends(get_settings)],
    print_stream=False
):
    api_key = settings.openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize OpenAI client
    embeddings_model = OpenAI(
        api_key=api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj
    )

    # Format the content
    formatted_content = format_question(content)

    # Check if the content contains images
    contains_image = any(item["type"] == "image_url" for item in formatted_content)

    # If the content includes images, send it to GPT-4o for understanding
    if contains_image:
        system_prompt = (
            "You are an expert at understanding multi-modal inputs, including both text and images. "
            "Summarize the content in a structured way, integrating information from both text and image."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": formatted_content}
        ]

        # Call GPT-4o for processing the content
        gpt4o_client = OpenAI(
            api_key=api_key,
            organization=settings.openai_api_org,
            project=settings.openai_api_proj
        )

        gpt_result = gpt4o_client.chat.completions.create(
            model="gpt-5",
            messages=messages,
            stream=False,
        )
        # Extract understanding from GPT-4o response
        if gpt_result.choices[0].message.content:
            understanding = gpt_result.choices[0].message.content
        else:
            raise ValueError("LLM did not return any understanding of the content.")
    else:
        # If no images are present, concatenate all text content for embeddings
        understanding = " ".join(item["text"] for item in formatted_content if item["type"] == "text")

    # Send the understanding to the embedding API
    result = embeddings_model.embeddings.create(
        input=understanding,
        model="text-embedding-3-small"
    )

    return result.data[0].embedding

def _weighted_sum(vectors: List[List[float]], weights: List[float]) -> List[float]:
    if not vectors:
        raise ValueError("vectors list cannot be empty")
    if len(vectors) != len(weights):
        raise ValueError("Weights count must match vectors count.")

    length = len(vectors[0])
    for vector in vectors:
        if len(vector) != length:
            raise ValueError("All vectors must have the same length.")

    combined = [0.0] * length
    for weight, vector in zip(weights, vectors):
        for i, value in enumerate(vector):
            combined[i] += weight * value
    return combined


def combine_embedding(q_vector, a_vector, r_vector, weights = [0.5, 0.4, 0.1]):
    return _weighted_sum([q_vector, a_vector, r_vector], weights)

def embed_slide(contents, settings: Annotated[Settings, Depends(get_settings)], ):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAI(
        api_key=api_key,
        organization=settings.openai_api_org,
        project=settings.openai_api_proj
    )

    result = embeddings_model.embeddings.create(
        input=contents,
        model="text-embedding-3-small"
    )
    embeddings = [item.embedding for item in result.data]
    return embeddings

def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if len(vec_a) != len(vec_b):
        raise ValueError("Vectors must share the same dimensionality.")

    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))

    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)


def retrieve_reference(text_vector, content_vectors, contents, top_n=3):
    """
    Retrieve the top N most relevant slides based on cosine similarity between the query vector and slide vectors.
    """
    if not content_vectors:
        return []

    similarities = [
        _cosine_similarity(text_vector, vector) for vector in content_vectors
    ]

    # `similarities` is a Python list, so sort indices directly instead of using NumPy's argsort.
    top_count = min(top_n, len(similarities))
    top_indices = sorted(
        range(len(similarities)),
        key=lambda idx: similarities[idx],
        reverse=True,
    )[:top_count]

    # Retrieve the top N match contents and their indices
    top_matches = [
        {
            "text": contents[idx].text,
            "image_text": contents[idx].image_text,
            "page_number": contents[idx].page_number,
            "slide_id": contents[idx].slide_id
        }
        for idx in top_indices
    ]
    
    # return top_matches
    return top_matches
