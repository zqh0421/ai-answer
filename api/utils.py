from openai import OpenAI
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import requests
from io import BytesIO

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
            return BytesIO(response.content)  # Return the PDF as a BytesIO stream
        else:
            print(f"Failed to fetch PDF: {response.status_code}")
            return None

def create_embedding(text, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
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
        input=text,
        model="text-embedding-3-small"
    )

    return result.data[0].embedding

def combine_embedding(q_vector, a_vector, r_vector, weights = [0.5, 0.4, 0.1]):
    q_weight, a_weight, r_weight = weights
    combined_vector = q_weight * np.array(q_vector) + a_weight * np.array(a_vector) + r_weight * np.array(r_vector)
    return combined_vector

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
    top_indices = similarities.argsort()[-top_n:][::-1]  # Sort and get top N indices

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