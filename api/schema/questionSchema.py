from sqlalchemy import (
    Column,
    String,
    ForeignKey,
    DateTime,
    JSON,
    ARRAY
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from sqlalchemy.ext.declarative import declarative_base
from .userSchema import *

Base = declarative_base()

class Question(Base):
    __tablename__ = "question"

    question_id = Column(PG_UUID(as_uuid=True), primary_key=True, index=True)
    type = Column(String, nullable=False)  # e.g., "multiple choice", "open ended"
    content = Column(ARRAY(JSON), nullable=False)  # Array of JSON objects for question content
    options = Column(JSON, nullable=True)  # JSON structure for optional question options
    objective = Column(ARRAY(String), nullable=True)  # Array of learning objectives
    slide_ids = Column(ARRAY(PG_UUID(as_uuid=True)), nullable=True)  # Related slide IDs
    embed_result = Column(JSON)
    # creater_id = Column(String, ForeignKey("users.id"), nullable=False)  # Foreign key to users
    created_at = Column(DateTime, default=datetime.utcnow)  # Timestamp of creation

    # creater = relationship("User", back_populates="questions")
    def as_dict(self):
        return {col.name: getattr(self, col.name) for col in self.__table__.columns}