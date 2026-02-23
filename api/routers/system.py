from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..dependencies import get_db
from ..dependencies import stop_tunnel
from ..tags import Tags

router = APIRouter(prefix="/api")


@router.on_event("shutdown")
async def shutdown_event():
    stop_tunnel()


@router.get("/test", tags=[Tags.SYSTEM_HEALTH])
def test():
    return {"message": "Backend Connected!"}


@router.get("/system/db-context", tags=[Tags.SYSTEM_HEALTH])
def db_context(db: Session = Depends(get_db)):
    settings = get_settings()
    current_database = db.execute(text("select current_database()")).scalar()
    current_schema = db.execute(text("select current_schema()")).scalar()
    search_path = db.execute(text("show search_path")).scalar()
    current_user = db.execute(text("select current_user")).scalar()
    server_addr = db.execute(text("select inet_server_addr()::text")).scalar()
    server_port = db.execute(text("select inet_server_port()")).scalar()
    course_regclass = db.execute(text("select to_regclass('course')")).scalar()
    public_course_regclass = db.execute(text("select to_regclass('public.course')")).scalar()
    course_count = db.execute(text("select count(*) from course")).scalar() if course_regclass else 0
    course_samples = []
    course_by_schema = []
    if course_regclass:
        rows = db.execute(
            text(
                """
                select course_id::text as course_id, course_title, creater_id, created_at, authority
                from public.course
                order by created_at desc nulls last
                limit 5
                """
            )
        ).mappings().all()
        course_samples = [dict(row) for row in rows]
    schema_rows = db.execute(
        text(
            """
            select table_schema
            from information_schema.tables
            where table_name = 'course'
            order by table_schema
            """
        )
    ).fetchall()
    for row in schema_rows:
        schema_name = row[0]
        row_count = db.execute(text(f'select count(*) from "{schema_name}"."course"')).scalar()
        course_by_schema.append({"schema": schema_name, "count": row_count})
    return {
        "env": settings.env,
        "configured_database_host": settings.database_host,
        "configured_database_name": settings.database_name,
        "configured_tunnel_host": settings.database_tunnel_host,
        "current_database": current_database,
        "current_schema": current_schema,
        "search_path": search_path,
        "current_user": current_user,
        "server_addr": server_addr,
        "server_port": server_port,
        "to_regclass_course": course_regclass,
        "to_regclass_public_course": public_course_regclass,
        "course_count": course_count,
        "course_by_schema": course_by_schema,
        "course_samples": course_samples,
    }
