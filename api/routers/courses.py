from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schema
from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api/courses", tags=[Tags.CONTENT_COURSES])


@router.get("/createdby/{creater_email}")
def get_courses_created_by(creater_email: str, db: Session = Depends(get_db)):
    user = db.query(schema.User).filter(schema.User.email == creater_email).first()
    if not user:
        return {"error": "User not found"}, 404

    courses = db.query(schema.Course).filter(schema.Course.creater_id == user.id).all()
    if not courses:
        return {"message": "No courses found for this user"}, 200
    return courses


@router.post("/create")
def create_course(course: models.CourseResponse, db: Session = Depends(get_db)):
    db_course = schema.Course(
        course_title=course.title,
        course_description=course.description,
        creater_id=course.creater_id,
    )
    db.add(db_course)
    db.commit()
    db.refresh(db_course)
    return db_course


@router.get("/by_id/{course_id}")
def get_course_by_id(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.put("/by_id/{course_id}")
def update_course(course_id: str, course: models.CourseResponse, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    db_course.course_title = course.title
    db_course.course_description = course.description
    db.commit()
    db.refresh(db_course)
    return db_course


@router.delete("/by_id/{course_id}")
def delete_course(course_id: str, db: Session = Depends(get_db)):
    db_course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    db.delete(db_course)
    db.commit()
    return {"message": "Course deleted successfully"}


@router.get("/public")
def get_public_courses(db: Session = Depends(get_db)):
    return db.query(schema.Course).filter(schema.Course.authority == "public").order_by(schema.Course.course_title.asc()).all()
