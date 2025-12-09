from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ARRAY, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class RecordResult(Base):
    __tablename__ = 'record_result'

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)  # Unique ID for each record
    learner_id = Column(String, nullable=False)  # Learner ID who submitted the result
    study_id = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    # ip_address = Column(String, nullable=True)  # Optional IP address of the learner
    question_id = Column(String, nullable=False)  # Associated question ID
    answer = Column(Text, nullable=False)  # User's answer (text format)
    feedback = Column(Text)  # Feedback text provided to the learner

    preferred_info_type = Column(String)  # Preferred information type (e.g., text/vision)
    prompt_engineering_method = Column(String)  # Prompt engineering method used
    feedback_framework = Column(String)  # Feedback framework applied

    # Reference slide information
    reference_slide_id = Column(String, nullable=True)  # Slide image ID, optional
    reference_slide_content = Column(Text, nullable=True)  # Textual content of the slide
    reference_slide_page_number = Column(Integer, nullable=True)  # Page number of the reference slide

    # Additional metadata
    slide_retrieval_range = Column(ARRAY(String), nullable=True)  # Array of slide IDs in the retrieval range
    system_total_response_time = Column(Integer)  # Total system response time in seconds
    submission_time = Column(DateTime)  # Timestamp when the result was recorded
    
    # Rating feedback
    rating = Column(Boolean, nullable=True)  # Rating from learner: True (thumb up), False (thumb down), None (no rating)


class AudioNarrationUsage(Base):
    __tablename__ = 'audio_narration_usage'

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    record_result_id = Column(Integer, ForeignKey('record_result.id'), nullable=False, index=True)
    session_id = Column(String, nullable=False)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

    record_result = relationship('RecordResult', backref='audio_sessions')
