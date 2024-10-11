from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
# from .models import Base
from .config import Settings, get_settings
from fastapi import FastAPI, Depends, HTTPException
from typing_extensions import Annotated

# 替换为你的 AWS RDS PostgreSQL 配置信息
settings: Annotated[Settings, Depends(get_settings)] = get_settings()
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建数据库表（如果不存在）

# Base.metadata.create_all(bind=engine)