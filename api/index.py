from fastapi import FastAPI, Depends
from typing_extensions import Annotated

from .config import Settings, get_settings
from .models import AskModel, EmbedModel, ConvertModel, VisionModel, ConvertBatchModel
from .controllers import askController, embedController, convertController, convertBatchController, visionController, encode_image

app = FastAPI()

@app.get("/api/test")
def test():
    return {
        "message": "Backend Connected!"
    }

@app.post("/api/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = askController(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}

@app.post("/api/embed")
def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = embedController(embedModel, settings)
    return result

@app.post("/api/pdf-to-image")
async def convert(convertModel: ConvertModel):
    result = await convertController(convertModel)
    return result

# @app.post("api/encode-image")
# def encode(encodeModel: EncodeModel):
#     result = encode_image(emcodeModel)
#     return result

@app.post("api/openai-vision")
def vision(visionModel: VisionModel):
    result = visionController(visionModel)
    return result

@app.post("/api/pdf-to-img-rephrase")
async def convert_batch(convertBatchModel: ConvertBatchModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = await convertBatchController(convertBatchModel, settings)
    return result
