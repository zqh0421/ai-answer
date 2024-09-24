from langchain_openai import OpenAIEmbeddings
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated
import numpy as np
import math
from sklearn.metrics.pairwise import cosine_similarity

def create_embedding(text, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(api_key=api_key)

    result = embeddings_model.embed_query(text)

    return result

def combine_embedding(q_vector, a_vector, r_vector):
    # Concatenate, but ensure all vectors are the same size as content vectors
    dimension = 1536
    q_dimension = math.floor(dimension * 0.5)
    a_dimension = math.floor(dimension * 0.4)
    r_dimension = dimension - a_dimension - q_dimension
    combined_vector = q_vector[:q_dimension] + a_vector[:a_dimension] + r_vector[:r_dimension]
    return combined_vector

def embed_slide(contents, settings: Annotated[Settings, Depends(get_settings)], ):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(api_key=api_key)

    embeddings = embeddings_model.embed_documents(
        contents
    )
    return embeddings

def retrieve_reference(text_vector, content_vectors, contents):
    """
    Retrieve the most relevant slide based on cosine similarity between the query vector and slide vectors.
    """
    # Convert lists to numpy arrays for cosine similarity
    text_vector = np.array(text_vector).reshape(1, -1)
    content_vectors = np.array(content_vectors)

    # Compute cosine similarity between query vector and content vectors
    similarities = cosine_similarity(text_vector, content_vectors)

    # Get the index of the highest similarity
    best_match_idx = int(np.argmax(similarities))  # Convert numpy.int64 to Python int

    # Retrieve the best match content and its page number
    best_match_content = contents[best_match_idx]
    
    return best_match_idx, best_match_content