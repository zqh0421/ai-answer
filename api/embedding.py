from langchain_openai import OpenAIEmbeddings
from fastapi import Depends
from .config import Settings, get_settings
from typing_extensions import Annotated

def create_embedding(text, settings: Annotated[Settings, Depends(get_settings)], print_stream=False):
    api_key = settings.openai_api_key  # Corrected to access openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(api_key=api_key)

    result = embeddings_model.embed_query(text)

    return result

def combine_embedding(q_vector, a_vector, r_vector, weights=[0.5, 0.4, 0.1]):
    q_weight, a_weight, r_weight = weights
    combined_vector = [
        q_weight * q + a_weight * a + r_weight * r 
        for q, a, r in zip(q_vector, a_vector, r_vector)
    ]
    return combined_vector

def embed_slide(contents, settings: Annotated[Settings, Depends(get_settings)]):
    api_key = settings.openai_api_key

    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in the environment variables")

    # Initialize the embedding model
    embeddings_model = OpenAIEmbeddings(api_key=api_key)

    embeddings = embeddings_model.embed_documents(contents)
    return embeddings

def cosine_similarity(vec1, vec2):
    dot_product = sum(x * y for x, y in zip(vec1, vec2))
    magnitude_vec1 = math.sqrt(sum(x ** 2 for x in vec1))
    magnitude_vec2 = math.sqrt(sum(y ** 2 for y in vec2))
    if magnitude_vec1 == 0 or magnitude_vec2 == 0:
        return 0
    return dot_product / (magnitude_vec1 * magnitude_vec2)

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
    # # Convert lists to numpy arrays for cosine similarity
    # text_vector = np.array(text_vector).reshape(1, -1)
    # content_vectors = np.array(content_vectors)

    # Compute cosine similarity between query vector and content vectors
    similarities = [cosine_similarity_custom(text_vector, content_vec) for content_vec in content_vectors]

    # Get the index of the highest similarity
    best_match_idx = int(np.argmax(similarities))  # Convert numpy.int64 to Python int

    # Retrieve the best match content and its page number
    best_match_content = contents[best_match_idx]
    
    return best_match_idx, best_match_content