from pydantic import BaseModel
from typing import List

class AuthModel(BaseModel):
    email: str

class CourseResponse(BaseModel):
    title: str
    description: str
    creater_id: str

class ModuleCreate(BaseModel):
    title: str

class SlideCreate(BaseModel):
    slide_google_id: str
    slide_title: str
    slide_url: str
    slide_cover: str

class SlidesCreate(BaseModel):
    slides: List[SlideCreate]
