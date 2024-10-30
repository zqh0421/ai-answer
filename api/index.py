from fastapi import FastAPI, Depends, HTTPException, status
from typing_extensions import Annotated
from sqlalchemy.orm import Session
from .schema import User, Course
from .database import SessionLocal
from .config import Settings, get_settings
from sqlalchemy.dialects.postgresql import insert
import tempfile
from io import BytesIO
from .models import AskModel, EmbedModel, ConvertModel, VisionModel, ConvertBatchModel, FeedbackRequestModel, FeedbackRequestRagModel, AuthModel
from .controllers import askController, embedController, convertController, convertBatchController, visionController, encode_image
from .controllers import generate_feedback_using_zero, generate_feedback_using_few
from .controllers import generate_feedback_using_graph_rag, generate_feedback_using_rag_cot, generate_feedback_using_rag_zero, generate_feedback_using_rag_few
# from fastapi.security import OAuth2PasswordBearer
# from google.oauth2 import id_token
# from google.auth.transport import requests
# from pydantic import BaseModel
from .utils import fetch_pdf_from_drive
from typing import List
from . import schema, models
from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_path, convert_from_bytes
import base64

app = FastAPI()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("shutdown")
async def shutdown_event():
    if tunnel:
        tunnel.stop()

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
def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    result = embedController(embedModel, settings, db)
    return result

@app.post("/api/pdf-to-image")
async def convert(convertModel: ConvertModel, db: Session = Depends(get_db)):
    try:
        # Query the page table for the matching slide_id and page_number
        result = db.query(schema.Page).filter(
            schema.Page.slide_id == convertModel.slide_id,
            schema.Page.page_number == convertModel.page_number
        ).first()  # Use .first() to get the first matching result (you can use .all() if you expect multiple matches)

        if not result:
            raise HTTPException(status_code=404, detail="Page not found for the given slide_id and page_number")

        # Return the matched result
        return {
            "slide_id": result.slide_id,
            "page_number": result.page_number,
            "text": result.text,
            "img_base64": result.img_base64
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("api/openai-vision")
def vision(visionModel: VisionModel):
    result = visionController(visionModel)
    return result

@app.post("/api/pdf-to-img-rephrase")
async def convert_batch(convertBatchModel: ConvertBatchModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = await convertBatchController(convertBatchModel, settings)
    return result



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

# 查找用户
@app.get("/api/users/{user_id}")
def read_user(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

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
@app.post("/api/admin_auth")
def verify_user(auth: AuthModel, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == auth.email).first()
    if user:
        return {
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "image": user.image,
            "permitted": user.role != "admin"
        }
    return {
        "user_id": "",
        "name": "",
        "email": "",
        "image": "",
        "permitted": False
    }
        

@app.post("/api/generate_feedback")
async def generate_feedback(request: FeedbackRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    feedback = ""
    if request.promptEngineering == "zero":
        feedback = generate_feedback_using_zero(request.question, request.answer, request.feedbackFramework, settings)
    elif request.promptEngineering == "few":
        feedback = generate_feedback_using_few(request.question, request.answer, request.feedbackFramework, settings)
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
        feedback = generate_feedback_using_rag_zero(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "rag_few":
        feedback = generate_feedback_using_rag_few(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "rag_cot":
        feedback = generate_feedback_using_rag_cot(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "graph_rag":
        feedback = generate_feedback_using_graph_rag(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    else:
        feedback = "Generate Feedback Error: Invalid Request."
        print("Generate Feedback Error: Invalid Request.")

    return {
        "feedback": feedback
    }

@app.get("/api/courses/createdby/{creater_email}")
def get_courses_created_by(creater_email: str, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(schema.User.email == creater_email).first()

    if not user:
        return {"error": "User not found"}, 404

    # Now filter courses by the user's id
    courses = db.query(schema.Course).filter(schema.Course.creater_id == user.id).all()
    print(courses)
    if not courses:
        return {"message": "No courses found for this user"}, 200

    return courses

@app.post("/api/courses/create")
def create_course(course: models.CourseResponse, db: Session = Depends(get_db)):
    db_course = schema.Course(
        course_title=course.title,
        course_description=course.description,
        creater_id=course.creater_id
    )
    db.add(db_course)
    db.commit()
    db.refresh(db_course)
    return db_course

@app.get("/api/courses/by_id/{course_id}")
def get_course_by_id(course_id: str, db: Session = Depends(get_db)):
    print("getting")
    print(course_id)
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course

@app.put("/api/courses/by_id/{course_id}")
def update_course(course_id: str, course: models.CourseResponse, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    
    db_course.course_title = course.title
    db_course.course_description = course.description
    db.commit()
    db.refresh(db_course)
    return db_course

@app.delete("/api/courses/by_id/{course_id}")
def delete_course(course_id: str, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    
    db.delete(db_course)
    db.commit()
    return {"message": "Course deleted successfully"}

@app.get("/api/courses/by_id/{course_id}/modules")
def get_modules_by_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    modules = db.query(schema.Module).filter(schema.Module.course_id == course_id).order_by(schema.Module.module_order.asc()).all()
    return {"modules": modules}

@app.post("/api/courses/by_id/{course_id}/modules", status_code=201)
def create_module(course_id: str, module: models.ModuleCreate, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    db_module = schema.Module(course_id=course_id, module_title=module.title)
    db.add(db_module)
    db.commit()
    db.refresh(db_module)
    
    return db_module

@app.get("/api/modules/{module_id}/slides")
def get_slides_by_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    slides = db.query(schema.Slide).filter(schema.Slide.module_id == module_id).order_by(schema.Slide.slide_title.asc()).all()
    return {"slides": slides}

@app.post("/api/modules/{module_id}/slides/batch", status_code=status.HTTP_201_CREATED)
def create_slides_batch(module_id: str, slides: models.SlidesCreate, db: Session = Depends(get_db)):
    # Check if module exists
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Prepare the list of slides to insert
    slide_values = [
        {
            "module_id": module_id,
            "slide_google_id": slide_data.slide_google_id,
            "slide_title": slide_data.slide_title,
            "slide_google_url": slide_data.slide_url,
            "slide_cover": slide_data.slide_cover
        }
        for slide_data in slides.slides
    ]

    stmt = insert(schema.Slide).values(slide_values)
    
    try:
        db.execute(stmt)
        db.commit()  # Commit after inserting all slides
    except Exception as e:
        db.rollback()  # Rollback in case of any failure
        raise HTTPException(status_code=500, detail="Failed to upload slides")

    return {"message": f"{len(slides.slides)} slides uploaded successfully!"}

# Delete module and all slides associated with it
@app.delete("/api/modules/by_id/{module_id}")
def delete_module(module_id: str, db: Session = Depends(get_db)):
    # Find the module by its ID
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Delete all slides associated with this module
    db.query(schema.Slide).filter(schema.Slide.module_id == module_id).delete()

    # Delete the module itself
    db.delete(module)
    db.commit()

    return {"detail": "Module and its slides deleted successfully"}

# Delete a slide by its ID
@app.delete("/api/modules/{module_id}/slides/{slide_id}")
def delete_slide(module_id: str, slide_id: str, db: Session = Depends(get_db)):
    # Find the slide by its ID
    slide = db.query(schema.Slide).filter(schema.Slide.slide_google_id == slide_id, schema.Slide.module_id == module_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    # Delete the slide
    db.delete(slide)
    db.commit()

    return {"detail": "Slide deleted successfully"}

@app.get("/api/courses/public")
def get_public_courses(db: Session = Depends(get_db)):
    # 查询所有状态为 public 的课程
    public_courses = db.query(schema.Course).filter(schema.Course.authority == "public").order_by(schema.Course.course_title.asc()).all()
    
    return public_courses

@app.post("/api/slides/{slide_id}/{slide_google_id}/publish")
def publish_slide(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    pdfstream = fetch_pdf_from_drive(slide_google_id, settings)
    print(slide_id, slide_google_id)
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf_file:
            temp_pdf_file.write(pdfstream.getvalue())
            temp_pdf_path = temp_pdf_file.name

            images = convert_from_bytes(pdfstream.getvalue())
            if not images:
                raise HTTPException(status_code=404, detail="Page not found")
            
            loader = PyPDFLoader(temp_pdf_path)
            pages = loader.load() # texts for each page

            if len(images) != len(pages):
                raise HTTPException(status_code=500, detail="Mismatch between the number of images and pages")
            # new_slide = schema.Page(slide_id=slide_id, page_number=pages[0].metadata['page'], text=pages[0].page_content)
            for (img, page) in zip(images, pages):
                img_byte_arr = BytesIO()
                img.save(img_byte_arr, format='PNG')
                img_byte_arr.seek(0)
                img_base64 = base64.b64encode(img_byte_arr.read()).decode('utf-8')
                new_slide = schema.Page(slide_id=slide_id, page_number=page.metadata['page'], text=page.page_content, img_base64=img_base64)
                db.add(new_slide)
                db.commit()
        return {"message": "Slide published successfully"}
    except Exception as e:
        db.rollback()  # Rollback in case of error
        raise HTTPException(status_code=500, detail=str(e))