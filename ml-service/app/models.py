import uuid
from sqlalchemy import Column, String, Float, Integer, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from database import Base


class TrackFeature(Base):
    __tablename__ = 'track_features'

    id           = Column(String(64), primary_key=True)  
    track_name   = Column(String)                         
    artists      = Column(String)                         
    danceability = Column(Float)
    energy       = Column(Float)
    key          = Column(Integer)
    loudness     = Column(Float)
    mode         = Column(Integer)
    tempo        = Column(Float)
    valence      = Column(Float)
    z_vector     = Column(Vector(33), nullable=False)


class PredictionHistory(Base):
    __tablename__ = 'prediction_history'

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    session_id            = Column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4)
    user_spotify_id       = Column(String(128), nullable=False)
    target_energy         = Column(Float, nullable=False)
    predicted_vector      = Column(JSONB, nullable=False)
    recommended_track_id  = Column(String(64), nullable=False)
    seq_len               = Column(Integer, nullable=False)
    created_at            = Column(DateTime, server_default=func.now())