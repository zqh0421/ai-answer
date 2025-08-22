from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated
from typing import List
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import requests
from io import BytesIO
from .controllers.feedback.call_gpt import format_question


def fetch_pdf_from_drive(file_id: str, settings: Annotated[Settings, Depends(get_settings)]):
    download_url = f'https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType=application/pdf&key={settings.next_public_google_drive_api_key}'

    # Make the request to fetch the PDF content, allowing redirects
    with requests.Session() as session:
        response = session.get(download_url, allow_redirects=True)
        print(response)
        # Google Drive sometimes serves a confirmation page for large files
        if 'content-disposition' not in response.headers:
            # Parse out the confirmation URL from the page
            confirm_url = f"{download_url}&confirm={response.cookies['download_warning']}"
            response = session.get(confirm_url)

        # Check if the file was fetched successfully
        if response.status_code == 200:
            print("PDF fetched successfully!")
            # Return the PDF as a BytesIO stream
            return BytesIO(response.content)
        else:
            print(f"Failed to fetch PDF: {response.status_code}")
            return None


def create_embedding(
    content: List[dict],
    settings: Annotated[Settings, Depends(get_settings)],
    print_stream=False
):
    api_key = settings.openai_api_key

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    # Initialize LangChain OpenAI embeddings
    embeddings_model = OpenAIEmbeddings(
        openai_api_key=api_key,
        openai_organization=settings.openai_api_org,
        openai_project=settings.openai_api_proj
    )

    # Format the content
    formatted_content = format_question(content)

    # Check if the content contains images
    contains_image = any(
        item["type"] == "image_url" for item in formatted_content)

    # If the content includes images, send it to GPT-4o for understanding
    if contains_image:
        system_prompt = (
            "You are an expert at understanding multi-modal inputs, including both text and images. "
            "Summarize the content in a structured way, integrating information from both text and image."
        )

        # Initialize LangChain ChatOpenAI
        gpt4o_client = ChatOpenAI(
            openai_api_key=api_key,
            openai_organization=settings.openai_api_org,
            openai_project=settings.openai_api_proj,
            model="gpt-4o",
            max_tokens=4000,
            temperature=0.01
        )

        # Create messages using LangChain message classes
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=formatted_content)
        ]

        # Call GPT-4o for processing the content
        gpt_result = gpt4o_client.invoke(messages)

        # Extract understanding from GPT-4o response
        if gpt_result.content:
            understanding = gpt_result.content
        else:
            raise ValueError(
                "GPT-4o did not return any understanding of the content.")
    else:
        # If no images are present, concatenate all text content for embeddings
        understanding = " ".join(
            item["text"] for item in formatted_content if item["type"] == "text")

    # Send the understanding to the embedding API
    result = embeddings_model.embed_query(understanding)

    return result


def combine_embedding(q_vector, a_vector, r_vector, weights=[0.5, 0.4, 0.1]):
    q_weight, a_weight, r_weight = weights
    combined_vector = q_weight * \
        np.array(q_vector) + a_weight * np.array(a_vector) + \
        r_weight * np.array(r_vector)
    return combined_vector


def embed_slide(contents, settings: Annotated[Settings, Depends(get_settings)], ):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model using LangChain
    embeddings_model = OpenAIEmbeddings(
        openai_api_key=api_key,
        openai_organization=settings.openai_api_org,
        openai_project=settings.openai_api_proj
    )

    result = embeddings_model.embed_documents(contents)
    return result


def retrieve_reference(text_vector, content_vectors, contents, top_n=3):
    """
    Retrieve the top N most relevant slides based on cosine similarity between the query vector and slide vectors.
    """
    # Convert lists to numpy arrays for cosine similarity
    text_vector = np.array(text_vector).reshape(1, -1)
    content_vectors = np.array(content_vectors)

    # Compute cosine similarity between query vector and content vectors
    similarities = cosine_similarity(text_vector, content_vectors).flatten()

    # Get the indices of the top N highest similarities
    # Sort and get top N indices
    top_indices = similarities.argsort()[-top_n:][::-1]

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
