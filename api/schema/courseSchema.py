from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey, Float, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from datetime import datetime
import uuid
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()

class Course(Base):
    __tablename__ = "course"

    course_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_title = Column(String(255), nullable=False)
    course_description = Column(Text, nullable=False)
    creater_id = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    authority = Column(String, default="public")

    modules = relationship("Module", back_populates="course", cascade="all, delete-orphan")


class Module(Base):
    __tablename__ = "module"

    module_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module_title = Column(String, index=True)
    course_id = Column(UUID(as_uuid=True), ForeignKey("course.course_id"))
    module_order = Column(Integer, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course", back_populates="modules")
    slides = relationship("Slide", back_populates="module", cascade="all, delete-orphan")

class Slide(Base):
    __tablename__ = 'slide'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    slide_google_id = Column(String, index=True)
    slide_title = Column(String, nullable=False)
    slide_google_url = Column(String)
    slide_cover = Column(String)
    module_id = Column(UUID(as_uuid=True), ForeignKey('module.module_id', ondelete="CASCADE"), nullable=False)

    module = relationship("Module", back_populates="slides")
    pages = relationship("Page", back_populates="slide", cascade="all, delete-orphan", primaryjoin="Slide.id == Page.slide_id")

class Page(Base):
    __tablename__ = "page"

    page_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    text = Column(String)
    image_text = Column(String)
    img_base64 = Column(Text)
    vector = Column(ARRAY(Float))  # Use ARRAY from postgresql dialect for storing arrays
    page_number = Column(Integer, index=True)
    slide_id = Column(UUID(as_uuid=True), ForeignKey('slide.id', ondelete="CASCADE"), nullable=False)

    slide = relationship("Slide", back_populates="pages")

    __table_args__ = (
        UniqueConstraint('slide_id', 'page_number', name='_slide_id_page_number_uc'),
    )
