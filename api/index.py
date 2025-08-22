from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile
import boto3
import uuid
from uuid import UUID
from typing_extensions import Annotated
from sqlalchemy.orm import Session
from .schema import User, Course
from .database import SessionLocal, tunnel
from .config import Settings, get_settings
from sqlalchemy.dialects.postgresql import insert
import tempfile
from io import BytesIO
from .models import AskModel, EmbedModel, ConvertModel, VisionModel, ConvertBatchModel, FeedbackRequestModel, FeedbackRequestRagModel, AuthModel, TTSRequestModel, InteractiveNarrationModel
from .controllers import askController, embedController, convertController, convertBatchController, visionController, encode_image
from .controllers import generate_feedback_using_zero, generate_feedback_using_few
from .controllers import generate_feedback_using_graph_rag, generate_feedback_using_rag_cot, generate_feedback_using_rag_zero, generate_feedback_using_rag_few
# from fastapi.security import OAuth2PasswordBearer
# from google.oauth2 import id_token
# from google.auth.transport import requests
# from pydantic import BaseModel
from .utils import fetch_pdf_from_drive
# from typing import List
from . import schema, models
from langchain_community.document_loaders import PyPDFLoader
from pdf2image import convert_from_path, convert_from_bytes
import base64
import os
from uuid import UUID
# from sqlalchemy import cast
from .controllers.vision import setVision
import re
# import time
import json
import traceback
# from .controllers.format import process_feedback_to_json
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

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


@app.post("/api/text-to-speech")
async def text_to_speech(request: TTSRequestModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Generate audio narration for reference material using OpenAI TTS
    Note: LangChain doesn't have built-in TTS, so we'll need to use OpenAI directly for this feature
    """
    try:
        # For TTS, we still need to use OpenAI directly as LangChain doesn't support audio generation
        import openai
        client = openai.OpenAI(api_key=settings.openai_api_key)

        # Generate speech using OpenAI TTS
        response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",  # You can change to "echo", "fable", "onyx", "nova", "shimmer"
            input=request.text
        )

        # Convert the audio to base64
        audio_bytes = response.content
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')

        return {
            "audio_base64": audio_base64,
            "text": request.text,
            "voice": "alloy"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"TTS generation failed: {str(e)}")


@app.post("/api/interactive-narration")
async def interactive_narration(request: InteractiveNarrationModel, settings: Annotated[Settings, Depends(get_settings)]):
    """
    Generate interactive, conversational narration using GPT-4o with visual analysis
    """
    try:
        # Initialize LangChain ChatOpenAI
        client = ChatOpenAI(
            openai_api_key=settings.openai_api_key,
            model="gpt-4o",
            max_tokens=300,
            temperature=0.3
        )

        # First, analyze the slide images if available to understand visual content
        visual_analysis = ""
        if request.has_images and hasattr(request, 'slide_images') and request.slide_images:
            try:
                # Analyze the slide images using GPT-4o vision
                vision_content = []
                for img_base64 in request.slide_images:
                    vision_content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{img_base64}"
                        }
                    })

                # Create messages using LangChain message classes
                vision_messages = [
                    SystemMessage(content="You are an teaching expert at analyzing educational slide images. Describe the visual elements, their locations, and what they illustrate in a structured way that can be used for audio narration guidance within in 50 words."),
                    HumanMessage(content=[
                        {
                            "type": "text",
                            "text": "Analyze this slide image and describe: 1) What visual elements are present (diagrams, charts, text, images, etc.) 2) Their specific locations (top-left, center, bottom-right, etc.) 3) What each element illustrates or demonstrates. Be very specific about locations and content."
                        },
                        *vision_content
                    ])
                ]

                vision_response = client.invoke(vision_messages)
                visual_analysis = vision_response.content

            except Exception as e:
                print(f"Vision analysis failed: {str(e)}")
                visual_analysis = "Unable to analyze visual content"

        # Create a conversational prompt for GPT-4o
        system_prompt = """You are an expert teaching assistant who analyzes student answers, understands their learning gaps, and provides targeted guidance by pointing to specific visual elements on slides. Your role is to:

1. ANALYZE the student's answer to identify:
   - What they understand correctly
   - What they're missing or misunderstanding
   - Specific learning gaps or misconceptions

2. UNDERSTAND the structured feedback to identify:
   - Key areas that need improvement
   - Specific concepts the student should focus on
   - Learning objectives they haven't met

3. PROVIDE TARGETED GUIDANCE by:
   - Pointing to SPECIFIC visual elements on the slide that address their gaps
   - Explaining HOW these visual elements help solve their specific problems
   - Connecting visual content directly to their learning needs
   - Using precise directional language (top-right corner, center-left, bottom section, etc.)

4. BE CONVERSATIONAL AND SUPPORTIVE:
   - Acknowledge what they got right
   - Show empathy for their learning challenges
   - Provide encouraging, actionable guidance
   - Keep it concise but comprehensive (2-3 sentences) MUST BE LESS THAN 50 WORDS

CRITICAL: Your guidance must be directly tied to the student's specific answer and feedback. Don't give generic advice - address their exact learning needs."""

        # Create the user prompt with context including visual analysis
        user_prompt = f"""Analyze the student's answer and feedback, then provide targeted guidance by pointing to specific visual elements on the slide.

STUDENT ANALYSIS:
- Student's answer: "{request.student_answer}"
- Feedback received: "{request.feedback}"
- Learning context: Slide {request.page_number} from "{request.slide_title}"

VISUAL CONTENT:
- Slide content: "{request.reference_content}"
- Visual analysis: "{visual_analysis if visual_analysis else 'No visual analysis available'}"

YOUR TASK:
1. First, identify the student's specific learning gaps from their answer and feedback
2. Then, point to SPECIFIC visual elements on the slide that directly address these gaps
3. Explain HOW these visual elements help solve their specific problems
4. Provide actionable guidance on what to look for and how to understand it

EXAMPLE STRUCTURE:
"Your answer shows you understand [correct part], but you're missing [specific gap]. Look at [specific location] on the slide - the [visual element] there shows [specific concept] which directly addresses [student's gap]. Pay attention to [specific detail] because it demonstrates [how to solve their problem]."

IMPORTANT REQUIREMENTS:
- Be very specific about visual locations (top-right corner, center-left, bottom section, etc.)
- Reference actual visual content from the analysis
- Connect visual elements directly to the student's learning needs
- Provide concrete, actionable guidance
- Keep it encouraging and supportive

Generate a response that directly helps this specific student solve their specific learning problems."""

        # Generate interactive text using GPT-4o
        chat_response = client.invoke(
            messages=[
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt)
            ]
        )

        interactive_text = chat_response.content
        if interactive_text:
            interactive_text = interactive_text.strip()
        else:
            interactive_text = "Let me help you understand this material better."

        # Generate speech using OpenAI TTS (LangChain doesn't support audio generation)
        import openai
        tts_client = openai.OpenAI(api_key=settings.openai_api_key)
        speech_response = tts_client.audio.speech.create(
            model="tts-1",
            voice="alloy",  # You can change to "echo", "fable", "onyx", "nova", "shimmer"
            input=interactive_text
        )

        # Convert the audio to base64
        audio_bytes = speech_response.content
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')

        return {
            "audio_base64": audio_base64,
            "text": interactive_text,
            "voice": request.voice,
            "interactive": True,
            "visual_analysis": visual_analysis
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Interactive narration generation failed: {str(e)}")


@app.post("/api/ask")
def ask(askModel: AskModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = askController(askModel.question, askModel.answer, settings)
    return {"result": f"{result}"}


def serialize_with_uuid(obj):
    """
    Helper function to convert UUIDs to strings for JSON serialization.
    """
    if isinstance(obj, UUID):
        return str(obj)
    raise TypeError(
        f"Object of type {type(obj).__name__} is not JSON serializable")


@app.post("/api/embed")
async def embed(embedModel: EmbedModel, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    result = None

    if embedModel.question_id:
        question = db.query(schema.Question).filter(
            schema.Question.question_id == embedModel.question_id,
            schema.Question.embed_result.isnot(None),
        ).first()

        if question and question.embed_result is not None:
            result = json.loads(question.embed_result)
            return result
        else:
            print("No cached embed result found, computing new embedding.")

    # 即使 question_id 不存在或为空，也允许继续
    result = embedController(embedModel, settings, db)

    # 如果传入了 question_id 且数据库有记录，更新 embed_result
    if embedModel.question_id:
        question_to_update = db.query(schema.Question).filter(
            schema.Question.question_id == embedModel.question_id
        ).first()

        if question_to_update:
            escaped_json = json.dumps(result, default=serialize_with_uuid)
            question_to_update.embed_result = escaped_json
            db.add(question_to_update)
            db.commit()
            print("Embed result saved to database.")
        else:
            print("Question not found in database. Embed result not saved.")

    return result


@app.post("/api/pdf-to-image")
async def convert(convertModel: ConvertModel, db: Session = Depends(get_db)):
    try:
        # Query the page table for the matching slide_id and page_number
        result = db.query(schema.Page).filter(
            schema.Page.slide_id == convertModel.slide_id,
            schema.Page.page_number == convertModel.page_number
        ).first()

        if not result:
            raise HTTPException(
                status_code=404, detail="Page not found for the given slide_id and page_number")

        # Return the matched result
        return {
            "slide_id": result.slide_id,
            "page_number": result.page_number,
            "text": result.text,
            "img_base64": result.img_base64
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/openai-vision")
def vision(visionModel: VisionModel, settings: Annotated[Settings, Depends(get_settings)]):
    result = setVision(visionModel.base64_image_arr, settings)
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
        feedback = generate_feedback_using_zero(
            request.question, request.answer, request.feedbackFramework, settings)
    elif request.promptEngineering == "few":
        feedback = generate_feedback_using_few(
            request.question, request.answer, request.feedbackFramework, settings)
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
        feedback = generate_feedback_using_rag_zero(
            request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "rag_few":
        feedback = await generate_feedback_using_rag_few(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    elif request.promptEngineering == "rag_cot":
        feedback = generate_feedback_using_rag_cot(
            request.question, request.answer, request.slide_text_arr, request.feedbackFramework, request.isStructured, settings)
    # elif request.promptEngineering == "graph_rag":
    #     feedback = generate_feedback_using_graph_rag(request.question, request.answer, request.slide_text_arr, request.feedbackFramework, settings)
    else:
        feedback = "Generate Feedback Error: Invalid Request."
        print("Generate Feedback Error: Invalid Request.")

    if request.isStructured:
        # parse feedback to json
        try:
            # Try to parse the feedback as JSON directly
            parsed_feedback = json.loads(feedback)
            return {
                "score": parsed_feedback.get("score", ""),
                "feedback": parsed_feedback.get("feedback", ""),
                "structured_feedback": parsed_feedback.get("structured_feedback", {})
            }
        except json.JSONDecodeError:
            # If direct parsing fails, try to extract JSON from markdown code blocks
            import re
            json_match = re.search(
                r'```json\s*(\{.*?\})\s*```', feedback, re.DOTALL)
            if json_match:
                try:
                    parsed_feedback = json.loads(json_match.group(1))
                    return {
                        "score": parsed_feedback.get("score", ""),
                        "feedback": parsed_feedback.get("feedback", ""),
                        "structured_feedback": parsed_feedback.get("structured_feedback", {})
                    }
                except json.JSONDecodeError:
                    # If still fails, return default structure
                    return {
                        "score": "",
                        "feedback": feedback,
                        "structured_feedback": {}
                    }
            else:
                # No JSON found, return default structure
                return {
                    "score": "",
                    "feedback": feedback,
                    "structured_feedback": {}
                }
    else:
        return {
            "feedback": feedback
        }


@app.get("/api/courses/createdby/{creater_email}")
def get_courses_created_by(creater_email: str, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(
        schema.User.email == creater_email).first()

    if not user:
        return {"error": "User not found"}, 404

    # Now filter courses by the user's id
    courses = db.query(schema.Course).filter(
        schema.Course.creater_id == user.id).all()
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
    course = db.query(schema.Course).filter(
        schema.Course.course_id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@app.put("/api/courses/by_id/{course_id}")
def update_course(course_id: str, course: models.CourseResponse, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(
        schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    db_course.course_title = course.title
    db_course.course_description = course.description
    db.commit()
    db.refresh(db_course)
    return db_course


@app.delete("/api/courses/by_id/{course_id}")
def delete_course(course_id: str, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(
        schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    db.delete(db_course)
    db.commit()
    return {"message": "Course deleted successfully"}


@app.get("/api/courses/by_id/{course_id}/modules")
def get_modules_by_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(
        schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    modules = db.query(schema.Module).filter(schema.Module.course_id ==
                                             course_id).order_by(schema.Module.module_order.asc()).all()
    return {"modules": modules}


@app.post("/api/courses/by_id/{course_id}/modules", status_code=201)
def create_module(course_id: str, module: models.ModuleCreate, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(
        schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    db_module = schema.Module(course_id=course_id, module_title=module.title)
    db.add(db_module)
    db.commit()
    db.refresh(db_module)

    return db_module


@app.get("/api/modules/{module_id}/slides")
def get_slides_by_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(
        schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    slides = db.query(schema.Slide).filter(schema.Slide.module_id ==
                                           module_id).order_by(schema.Slide.slide_title.asc()).all()

    result = [{
        "id": slide.id,
        "slide_google_id": slide.slide_google_id,
        "slide_title": slide.slide_title,
        "slide_cover": slide.slide_cover,
        "published": slide.published,
        "gotVision": slide.vision_summary is not None,
        "module_id": slide.module_id,
        "slide_google_url": slide.slide_google_url
    }
        for slide in slides
    ]

    return {
        "slides": result
    }


@app.post("/api/modules/{module_id}/slides/batch", status_code=status.HTTP_201_CREATED)
def create_slides_batch(module_id: str, slides: models.SlidesCreate, db: Session = Depends(get_db)):
    # Check if module exists
    module = db.query(schema.Module).filter(
        schema.Module.module_id == module_id).first()
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
    module = db.query(schema.Module).filter(
        schema.Module.module_id == module_id).first()
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
    slide = db.query(schema.Slide).filter(schema.Slide.id ==
                                          slide_id, schema.Slide.module_id == module_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    # Delete the slide
    db.delete(slide)
    db.commit()

    return {"detail": "Slide deleted successfully"}


@app.get("/api/courses/public")
def get_public_courses(db: Session = Depends(get_db)):
    # 查询所有状态为 public 的课程
    public_courses = db.query(schema.Course).filter(
        schema.Course.authority == "public").order_by(schema.Course.course_title.asc()).all()

    return public_courses


@app.post("/api/slides/{slide_id}/{slide_google_id}/publish")
async def publish_slide(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    pdfstream = fetch_pdf_from_drive(slide_google_id, settings)
    if pdfstream is None:
        raise HTTPException(
            status_code=404, detail="Failed to fetch PDF from drive")

    print("Slide ID:", slide_id, "Slide Google ID:", slide_google_id)
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf_file:
            temp_pdf_file.write(pdfstream.getvalue())
            temp_pdf_path = temp_pdf_file.name

            print("Temporary PDF path created:", temp_pdf_path)

            images = convert_from_bytes(pdfstream.getvalue())
            if not images:
                raise HTTPException(
                    status_code=404, detail="No pages found in PDF")

            loader = PyPDFLoader(temp_pdf_path)
            pages = loader.load()
            print("Number of images:", len(images),
                  "Number of text pages:", len(pages))

            if len(images) != len(pages):
                raise HTTPException(
                    status_code=500, detail="Mismatch between the number of images and pages")

            for img, page in zip(images, pages):
                img_byte_arr = BytesIO()
                img.save(img_byte_arr, format='PNG')
                img_byte_arr.seek(0)
                img_base64 = base64.b64encode(
                    img_byte_arr.read()).decode('utf-8')

                new_page = schema.Page(
                    slide_id=slide_id,
                    page_number=page.metadata['page'],
                    text=page.page_content,
                    img_base64=img_base64
                )
                db.add(new_page)

            slide = db.query(schema.Slide).filter(
                schema.Slide.id == slide_id).first()
            if slide:
                slide.published = True
            else:
                raise HTTPException(status_code=404, detail="Slide not found")

            db.commit()
            print("Pages successfully added to the database.")

        return {"message": "Slide published successfully"}
    except Exception as e:
        db.rollback()
        error_message = f"Error publishing slide: {str(e)}"
        print(error_message)
        print(traceback.format_exc())  # 打印完整的堆栈信息
        raise HTTPException(status_code=500, detail=error_message)
    finally:
        # 删除临时文件
        if 'temp_pdf_path' in locals():
            try:
                os.remove(temp_pdf_path)
                print("Temporary PDF file deleted:", temp_pdf_path)  # 调试信息
            except Exception as e:
                print("Failed to delete temporary file:", str(e))


@app.post("/api/slides/{slide_id}/{slide_google_id}/set-vision")
async def set_vision(slide_id: str, slide_google_id: str, settings: Annotated[Settings, Depends(get_settings)], db: Session = Depends(get_db)):
    slide = db.query(schema.Slide).filter(schema.Slide.id == slide_id,
                                          schema.Slide.slide_google_id == slide_google_id).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    # Get list of pages for the slide
    pages = db.query(schema.Page).filter(
        schema.Page.slide_id == slide_id).all()
    if not pages:
        raise HTTPException(
            status_code=404, detail="No pages found for this slide")

    # Process vision for each page
    page_visions = []
    for page in pages:
        if page.img_base64 is not None:
            vision_info = setVision([page.img_base64], settings=settings)
            page_visions.append(vision_info)
            page.image_text = vision_info  # Save vision info to each page

    # Optional: Aggregate vision information for the entire slide
    if pages:
        img_base64_list = [
            page.img_base64 for page in pages if page.img_base64 is not None]
        if img_base64_list:
            sum_vision_info = setVision(img_base64_list, settings=settings)
            slide.vision_summary = sum_vision_info

    # Save changes to the database
    db.commit()

    return {"message": "Vision set successfully"}


@app.post("/api/questions/create")
def create_question(request: models.QuestionResponse, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(
        schema.User.email == request.creater_email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    serialized_content = [content.dict() for content in request.content]
    db_question = schema.Question(
        type=request.type,
        content=serialized_content,
        options=request.options,
        objective=request.objective,
        slide_ids=request.slide_ids,
        creater_email=request.creater_email,
    )
    db.add(db_question)
    db.commit()
    db.refresh(db_question)
    return db_question


@app.get("/api/questions/all")
def get_all_question(db: Session = Depends(get_db)):
    questions = db.query(schema.Question).all()
    # result = [{
    #         "id": slide.id,
    #         "slide_google_id": slide.slide_google_id,
    #         "slide_title": slide.slide_title,
    #         "slide_cover": slide.slide_cover,
    #         "published": slide.published,
    #         "gotVision": slide.vision_summary is not None,
    #         "module_id": slide.module_id,
    #         "slide_google_url": slide.slide_google_url
    #     }
    #     for question in questions
    # ]
    return questions


@app.get("/api/questions/by_id/{question_id}")
def get_question_by_id(question_id: str, db: Session = Depends(get_db)):
    question = db.query(schema.Question).filter(
        schema.Question.question_id == question_id).first()
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


@app.delete("/api/questions/by_id/{question_id}")
def delete_question_by_id(question_id: str, db: Session = Depends(get_db)):
    db_question = db.query(schema.Question).filter(
        schema.Question.question_id == question_id).first()

    if db_question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    db.delete(db_question)
    db.commit()
    return {"message": "Question deleted successfully"}


@app.post("/api/s3upload")
async def upload_file(settings: Annotated[Settings, Depends(get_settings)], file: UploadFile = File(...)):
    try:
        file.file.seek(0)
        if file.filename is None:
            raise HTTPException(status_code=400, detail="Filename is required")
        file_extension = file.filename.split(".")[-1]
        file_name_sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", file.filename)
        file_key = f"uploads/{uuid.uuid4()}_{file_name_sanitized}"

        s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region_name,
        )

        s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            file_key,
            ExtraArgs={
                "ContentType": file.content_type or "application/octet-stream"},
        )
        file_url = f"https://{settings.s3_bucket_name}.s3.amazonaws.com/{file_key}"

        return {"url": file_url}
    except Exception as e:
        print("error")
        raise HTTPException(status_code=404, detail=str(e))


@app.post('/api/record_result')
def record_result(result: models.RecordResultModel, db: Session = Depends(get_db)):
    try:
        # 创建新的 RecordResult 实例
        record_data = {
            "learner_id": result.learner_id,
            "question_id": result.question_id,
            "answer": result.answer,
            "preferred_info_type": result.preferred_info_type,
            "prompt_engineering_method": result.prompt_engineering_method,
            "feedback_framework": result.feedback_framework,
            "feedback": result.feedback,
            "system_total_response_time": result.system_total_response_time,
            "submission_time": result.submission_time,
        }

        # 只有 reference_slide_id 非空时才加入相关字段
        if result.reference_slide_id:
            record_data.update({
                "reference_slide_id": result.reference_slide_id,
                "reference_slide_content": result.reference_slide_content,
                "reference_slide_page_number": result.reference_slide_page_number,
                "slide_retrieval_range": result.slide_retrieval_range,
            })

        # 创建实例
        db_result = schema.RecordResult(**record_data)

        # 添加到数据库
        db.add(db_result)
        db.commit()

        return db_result

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400, detail=f"Error recording result: {str(e)}")


@app.get("/api/get_human_feedback/{question_id}")
def get_human_feedback(question_id: str, db: Session = Depends(get_db)):
    try:
        question = db.query(schema.Question).filter(
            schema.Question.question_id == question_id).first()

        if not question or question.human_feedback is None:
            raise HTTPException(
                status_code=404, detail="No human feedback found for this question_id")

        return {"human_feedback": question.human_feedback}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
