from sqlalchemy import Column, Integer, String, Enum
from sqlalchemy.ext.declarative import declarative_base
import enum

Base = declarative_base()

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
