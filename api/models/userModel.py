from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import List

class AuthModel(BaseModel):
    email: str

class CourseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)

    title: str = Field(min_length=1)
    description: str | None = "N/A"
    creater_id: str | None = Field(default=None, alias="creator_id")
    creater_email: str | None = Field(default=None, alias="creator_email")
    email: str | None = None

    @model_validator(mode="after")
    def validate_course_fields(self) -> "CourseResponse":
        if not (self.title or "").strip():
            raise ValueError("title is required")
        if not (self.description or "").strip():
            self.description = "N/A"
        return self


class CourseAuthorityUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    authority: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_authority(self) -> "CourseAuthorityUpdateRequest":
        value = (self.authority or "").strip().lower()
        if value not in {"private", "public"}:
            raise ValueError("authority must be 'private' or 'public'")
        self.authority = value
        return self

class ModuleCreate(BaseModel):
    title: str

class SlideCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)

    slide_google_id: str = Field(min_length=1, alias="google_id")
    slide_title: str = Field(min_length=1, alias="title")
    slide_url: str = Field(min_length=1, alias="url")
    slide_cover: str = Field(default="", alias="cover")
    gotVision: bool = False
    slide_order: int | None = None

    @model_validator(mode="after")
    def validate_slide_url(self) -> "SlideCreate":
        url = self.slide_url.lower()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ValueError("slide_url/url must start with http:// or https://")
        return self

class SlidesCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slides: List[SlideCreate]


class SlideBatchProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide_ids: List[str] = Field(min_length=1)
    force_process_all: bool = False


class SlideBatchDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slide_ids: List[str] = Field(min_length=1)
