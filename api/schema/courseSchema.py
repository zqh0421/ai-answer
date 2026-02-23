from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey, Float, UniqueConstraint, Boolean
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
    vision_summary = Column(String)

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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    slide = relationship("Slide", back_populates="pages")

    __table_args__ = (
        UniqueConstraint('slide_id', 'page_number', name='_slide_id_page_number_uc'),
    )


class SlideProcessJob(Base):
    __tablename__ = "slide_process_jobs"

    job_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status = Column(String, nullable=False, default="queued", index=True)
    total_count = Column(Integer, nullable=False, default=0)
    processed_count = Column(Integer, nullable=False, default=0)
    skipped_count = Column(Integer, nullable=False, default=0)
    failed_count = Column(Integer, nullable=False, default=0)
    requested_by = Column(String, nullable=True)
    force_process_all = Column(Boolean, nullable=False, default=False)
    cancel_requested = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    items = relationship("SlideProcessJobItem", back_populates="job", cascade="all, delete-orphan")


class SlideProcessJobItem(Base):
    __tablename__ = "slide_process_job_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("slide_process_jobs.job_id", ondelete="CASCADE"), nullable=False, index=True)
    slide_id = Column(UUID(as_uuid=True), ForeignKey("slide.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="queued", index=True)
    error = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    total_steps = Column(Integer, nullable=False, default=0)
    completed_steps = Column(Integer, nullable=False, default=0)
    current_step_label = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    job = relationship("SlideProcessJob", back_populates="items")

    __table_args__ = (
        UniqueConstraint("job_id", "slide_id", name="u_slide_process_job_slide"),
    )


class SlidePageImportJob(Base):
    __tablename__ = "slide_page_import_jobs"

    job_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status = Column(String, nullable=False, default="queued", index=True)
    total_count = Column(Integer, nullable=False, default=0)
    processed_count = Column(Integer, nullable=False, default=0)
    skipped_count = Column(Integer, nullable=False, default=0)
    failed_count = Column(Integer, nullable=False, default=0)
    requested_by = Column(String, nullable=True)
    cancel_requested = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    items = relationship("SlidePageImportJobItem", back_populates="job", cascade="all, delete-orphan")


class SlidePageImportJobItem(Base):
    __tablename__ = "slide_page_import_job_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("slide_page_import_jobs.job_id", ondelete="CASCADE"), nullable=False, index=True)
    slide_id = Column(UUID(as_uuid=True), ForeignKey("slide.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="queued", index=True)
    error = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    total_steps = Column(Integer, nullable=False, default=1)
    completed_steps = Column(Integer, nullable=False, default=0)
    current_step_label = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    job = relationship("SlidePageImportJob", back_populates="items")

    __table_args__ = (
        UniqueConstraint("job_id", "slide_id", name="u_slide_page_import_job_slide"),
    )
