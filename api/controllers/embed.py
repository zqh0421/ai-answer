import os
from typing_extensions import Annotated
from fastapi import Depends
from langchain_community.document_loaders import PyPDFLoader
from ..models import EmbedModel
from ..config import Settings, get_settings
from ..utils import create_embedding, embed_slide, combine_embedding, retrieve_reference

def embedController(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)]):
    # Create query
    q_vector = create_embedding(embedModel.question, settings)
    # a_vector = create_embedding(embedModel.answer, settings)
    # r_vector = create_embedding(embedModel.result, settings)
    # text_vector = combine_embedding(q_vector, a_vector, r_vector)

    # Get content of slide PDF file by page
    root_dir = os.path.dirname(os.path.abspath(__package__))
    file_path = os.path.join(root_dir, 'public', 'E-Learning.pdf')

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"The file {file_path} does not exist.")

    loader = PyPDFLoader(file_path)

    docs = loader.load()

    print(docs[0].metadata)

    contents = []

    for i in range(len(docs)):
        contents.append(docs[i].page_content)

    # Get slide vectors
    content_vectors = embed_slide(contents, settings)

    # Retrieve the most relevant reference based on cosine similarity
    top_matches = retrieve_reference(q_vector, content_vectors, contents)

    # retrieve related reference from given slide and return the page
    return {
        "result": top_matches
    }