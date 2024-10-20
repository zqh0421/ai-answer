from langchain_openai import OpenAIEmbeddings
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

def create_embedding(text, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(
        api_key=api_key,
        model="text-embedding-ada-002"
    )

    result = embeddings_model.embed_query(text)

    return result

def combine_embedding(q_vector, a_vector, r_vector, weights = [0.5, 0.4, 0.1]):
    q_weight, a_weight, r_weight = weights
    combined_vector = q_weight * np.array(q_vector) + a_weight * np.array(a_vector) + r_weight * np.array(r_vector)
    return combined_vector

def embed_slide(contents, settings: Annotated[Settings, Depends(get_settings)], ):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(
        api_key=api_key,
        model="text-embedding-ada-002"
    )

    embeddings = embeddings_model.embed_documents(
        contents
    )
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
            "content": f"{contents[idx]}",
            "page_number": int(idx)
        }
        for idx in top_indices
    ]
    
    return top_matches