from fastapi import FastAPI, Depends, HTTPException
from typing_extensions import Annotated
from sqlalchemy.orm import Session
from .schema import User
from .database import SessionLocal
from .config import Settings, get_settings
from .models import AskModel, EmbedModel, ConvertModel, VisionModel, ConvertBatchModel, FeedbackRequestModel, FeedbackRequestRagModel
from .controllers import askController, embedController, convertController, convertBatchController, visionController, encode_image
from .controllers import generate_feedback_using_zero, generate_feedback_using_few
from .controllers import generate_feedback_using_graph_rag, generate_feedback_using_rag_cot, generate_feedback_using_rag_zero, generate_feedback_using_rag_few
# from fastapi.security import OAuth2PasswordBearer
# from google.oauth2 import id_token
# from google.auth.transport import requests
# from pydantic import BaseModel

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

# 依赖注入函数，用于每次请求后关闭数据库连接
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 增加用户
# @app.post("/api/users/")
# def create_user(name: str, email: str, db: Session = Depends(get_db)):
#     db_user = db.query(User).filter(User.email == email).first()
#     if db_user:
#         raise HTTPException(status_code=400, detail="Email already registered")
#     new_user = User(name=name, email=email)
#     db.add(new_user)
#     db.commit()
#     db.refresh(new_user)
#     return new_user

# # 查找用户
# @app.get("/api/users/{user_id}")
# def read_user(user_id: int, db: Session = Depends(get_db)):
#     user = db.query(User).filter(User.id == user_id).first()
#     if user is None:
#         raise HTTPException(status_code=404, detail="User not found")
#     return user

# # 删除用户
# @app.delete("/api/users/{user_id}")
# def delete_user(user_id: int, db: Session = Depends(get_db)):
#     user = db.query(User).filter(User.id == user_id).first()
#     if user is None:
#         raise HTTPException(status_code=404, detail="User not found")
#     db.delete(user)
#     db.commit()
#     return {"detail": "User deleted"}

# 根据邮箱验证用户
@app.post("/api/admin-auth")
def verify_user(email: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    return {"name": user.name, "email": user.email, "permitted": user is None or user.role != "admin"}

@app.post("/api/generate_feedback")
async def generate_feedback(request: FeedbackRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    feedback = ""
    if request.promptEngineering == "zero":
        feedback = generate_feedback_using_zero(request.question, request.answer, settings)
    elif request.promptEngineering == "few":
        feedback = generate_feedback_using_few(request.question, request.answer, settings)
    else:
        feedback = "Generate Feedback Error: Invalid Request."
        print("Generate Feedback Error: Invalid Request.")

    return {
        "feedback": feedback
    }

@app.post("/api/generate_feedback_rag")
async def generate_feedback_rag(request: FeedbackRequestRagModel, settings: Annotated[Settings, Depends(get_settings)]):
    feedback = ""
    if request.promptEngineering == "rag_zero":
        feedback = generate_feedback_using_rag_zero(request.question, request.answer, request.slide_text_arr, settings)
    elif request.promptEngineering == "rag_few":
        feedback = generate_feedback_using_rag_few(request.question, request.answer, request.slide_text_arr, settings)
    elif request.promptEngineering == "rag_cot":
        feedback = generate_feedback_using_rag_cot(request.question, request.answer, request.slide_text_arr, settings)
    elif request.promptEngineering == "graph_rag":
        feedback = generate_feedback_using_graph_rag(request.question, request.answer, request.slide_text_arr, settings)
    else:
        feedback = "Generate Feedback Error: Invalid Request."
        print("Generate Feedback Error: Invalid Request.")

    return {
        "feedback": feedback
    }