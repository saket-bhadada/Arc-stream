import uuid
from sqlalchemy import Column, String, Float, Integer, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector
from .database import Base


class TrackFeature(Base):
    __tablename__='track_features'