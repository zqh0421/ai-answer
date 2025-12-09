from sqlalchemy import (
    Column,
    String,
    ForeignKey,
    DateTime,
    JSON,
    ARRAY,
    Enum,
    Integer
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
import uuid
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Question(Base):
    __tablename__ = "question"

    question_id = Column(PG_UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid4)
    type = Column(String, nullable=False)  # e.g., "multiple choice", "open ended"
    content = Column(ARRAY(JSON), nullable=False)  # Array of JSON objects for question content
    options = Column(JSON, nullable=True)  # JSON structure for optional question options
    objective = Column(ARRAY(String), nullable=True)  # Array of learning objectives
    slide_ids = Column(ARRAY(PG_UUID(as_uuid=True)), nullable=True)  # Related slide IDs
    creater_email = Column(String, ForeignKey("users.email"), nullable=False)  # Foreign key to users
    created_at = Column(DateTime, default=datetime.utcnow)  # Timestamp of creation

    creater = relationship("User", back_populates="questions")

class RoleEnum(enum.Enum):
    student = "student"
    instructor = "instructor"
    course_designer = "course designer"
    admin = "admin"

class User(Base):
    __tablename__ = 'users'

    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True)
    image = Column(String)
    role = Column(Enum(RoleEnum), default=RoleEnum.student)

    questions = relationship("Question", back_populates="creater")
