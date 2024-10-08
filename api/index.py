from fastapi import FastAPI, Depends, HTTPException
from typing_extensions import Annotated

from .config import Settings, get_settings
from .models import AskModel, EmbedModel, ConvertModel
from .controllers import askController, embedController, convertController

from fastapi.security import OAuth2PasswordBearer
from google.oauth2 import id_token
from google.auth.transport import requests
from pydantic import BaseModel

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

# 用于Google OAuth2的配置
CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID"
AUTHORIZED_EMAILS = ["authorized_user@example.com"]  # 你希望授权的用户邮箱

# OAuth2 验证token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class User(BaseModel):
    email: str
    name: str

def verify_google_token(token: str):
    try:
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), CLIENT_ID)
        email = idinfo.get('email')
        if email not in AUTHORIZED_EMAILS:
            raise HTTPException(status_code=403, detail="Email not authorized")
        return User(email=email, name=idinfo.get('name'))
    except Exception as e:
        raise HTTPException(status_code=401, detail="Token verification failed")


@app.post("/login")
async def login(token: str = Depends(oauth2_scheme)):
    user = verify_google_token(token)
    return {"message": f"Welcome {user.name}"}
