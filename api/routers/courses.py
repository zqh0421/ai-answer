from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .. import models, schema
from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api/courses", tags=[Tags.CONTENT_COURSES])


def _serialize_course(course: schema.Course) -> dict:
    return {
        "course_id": str(course.course_id),
        "title": course.course_title,
        "description": course.course_description,
        "course_title": course.course_title,
        "course_description": course.course_description,
        "creater_id": course.creater_id,
        "created_at": course.created_at,
        "authority": course.authority,
    }


@router.get("/createdby/{creater_email}")
def get_courses_created_by(creater_email: str, db: Session = Depends(get_db)):
    if creater_email in {"", "undefined", "null"}:
        return []

    user = db.query(schema.User).filter(schema.User.email == creater_email).first()
    creator_ids = [creater_email]
    if user and user.id not in creator_ids:
        creator_ids.append(user.id)
    if user and user.email and user.email not in creator_ids:
        creator_ids.append(user.email)

    courses = db.query(schema.Course).filter(schema.Course.creater_id.in_(creator_ids)).all()
    return [_serialize_course(course) for course in courses]


@router.post("/create")
def create_course(course: models.CourseResponse, db: Session = Depends(get_db)):
    creator = (course.creater_id or course.creater_email or course.email or "").strip()
    if creator in {"", "undefined", "null"}:
        raise HTTPException(status_code=422, detail="Valid creator identifier is required")

    db_course = schema.Course(
        course_title=course.title,
        course_description=course.description,
        creater_id=creator,
    )
    try:
        db.add(db_course)
        db.commit()
        db.refresh(db_course)
    except SQLAlchemyError:
        db.rollback()
        raise
    return _serialize_course(db_course)


@router.get("/by_id/{course_id}")
def get_course_by_id(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return _serialize_course(course)


@router.patch("/by_id/{course_id}/authority")
def update_course_authority(
    course_id: str,
    payload: models.CourseAuthorityUpdateRequest,
    db: Session = Depends(get_db),
):
    db_course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    db_course.authority = payload.authority
    db.commit()
    db.refresh(db_course)
    return _serialize_course(db_course)


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
    courses = db.query(schema.Course).filter(schema.Course.authority == "public").order_by(schema.Course.course_title.asc()).all()
    return [_serialize_course(course) for course in courses]


@router.get("/all")
def get_all_courses(db: Session = Depends(get_db)):
    courses = db.query(schema.Course).order_by(schema.Course.created_at.desc()).all()
    return [_serialize_course(course) for course in courses]
