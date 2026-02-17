from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from .. import models, schema
from ..dependencies import get_db
from ..tags import Tags

router = APIRouter(prefix="/api", tags=[Tags.CONTENT_MODULES])


@router.get("/courses/by_id/{course_id}/modules")
def get_modules_by_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    modules = db.query(schema.Module).filter(schema.Module.course_id == course_id).order_by(schema.Module.module_order.asc()).all()
    return {"modules": modules}


@router.post("/courses/by_id/{course_id}/modules", status_code=201)
def create_module(course_id: str, module: models.ModuleCreate, db: Session = Depends(get_db)):
    course = db.query(schema.Course).filter(schema.Course.course_id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    db_module = schema.Module(course_id=course_id, module_title=module.title)
    db.add(db_module)
    db.commit()
    db.refresh(db_module)
    return db_module


@router.post("/modules/{module_id}/slides/batch", status_code=status.HTTP_201_CREATED, tags=["Content / Slides"])
def create_slides_batch(module_id: str, slides: models.SlidesCreate, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    slide_values = [
        {
            "module_id": module_id,
            "slide_google_id": slide_data.slide_google_id,
            "slide_title": slide_data.slide_title,
            "slide_google_url": slide_data.slide_url,
            "slide_cover": slide_data.slide_cover,
        }
        for slide_data in slides.slides
    ]

    stmt = insert(schema.Slide).values(slide_values)

    try:
        db.execute(stmt)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to upload slides")

    return {"message": f"{len(slides.slides)} slides uploaded successfully!"}


@router.delete("/modules/by_id/{module_id}")
def delete_module(module_id: str, db: Session = Depends(get_db)):
    module = db.query(schema.Module).filter(schema.Module.module_id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    db.query(schema.Slide).filter(schema.Slide.module_id == module_id).delete()
    db.delete(module)
    db.commit()

    return {"detail": "Module and its slides deleted successfully"}
