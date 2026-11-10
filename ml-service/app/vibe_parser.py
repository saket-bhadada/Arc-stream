from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.llm_client import chat_completion_json

logger = logging.getLogger(__name__)


class VibeTargets(BaseModel):
    model_config = ConfigDict(extra="ignore")

    target_energy: float = Field(ge=0.0, le=1.0)
    target_valence: float = Field(ge=0.0, le=1.0)
    target_danceability: float = Field(ge=0.0, le=1.0)
    tempo_min: float = Field(ge=40.0, le=240.0)
    tempo_max: float = Field(ge=40.0, le=240.0)
    energy_curve: list[float] | None = Field(default=None, min_length=5, max_length=30)
    summary: str
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator(
        "target_energy",
        "target_valence",
        "target_danceability",
        "confidence",
        mode="before",
    )
    @classmethod
    def clamp_unit_values(cls, value: Any) -> float:
        number = float(value)
        if not number == number:
            return 0.5
        return min(1.0, max(0.0, number))

    @field_validator("tempo_min", "tempo_max", mode="before")
    @classmethod
    def clamp_tempo(cls, value: Any) -> float:
        number = float(value)
        if not number == number:
            return 120.0
        return min(240.0, max(40.0, number))

    @field_validator("energy_curve", mode="before")
    @classmethod
    def clamp_energy_curve(cls, value: Any) -> list[float] | None:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("energy_curve must be a list.")
        values = [float(item) for item in value]
        return [0.5 if not item == item else min(1.0, max(0.0, item)) for item in values]

    @field_validator("summary", mode="before")
    @classmethod
    def limit_summary(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("summary must be text.")
        words = str(value).strip().split()
        return " ".join(words[:8]) or "Balanced listening"

    @model_validator(mode="after")
    def order_tempo_bounds(self) -> "VibeTargets":
        if self.tempo_min > self.tempo_max:
            self.tempo_min, self.tempo_max = self.tempo_max, self.tempo_min
        return self


def _contains(text: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(word)}\b", text) for word in words)


def keyword_fallback(prompt: str) -> VibeTargets:
    text = prompt.casefold()
    energy = 0.5
    valence = 0.5
    danceability = 0.5
    tempo_min, tempo_max = 80.0, 140.0

    if _contains(text, ("calm", "chill", "rainy", "study", "sleep", "soft", "quiet", "ambient")):
        energy = 0.25
        tempo_min, tempo_max = 55.0, 115.0
    if _contains(text, ("gym", "workout", "hype", "fast", "intense", "chaos", "energetic")):
        energy = 0.82
        danceability = 0.78
        tempo_min, tempo_max = 115.0, 190.0
    melancholic = _contains(text, ("melancholic", "sad", "blue", "heartbreak", "lonely"))
    warm = _contains(text, ("warm", "happy", "joyful", "uplifting", "sunny", "cheerful"))
    if melancholic:
        valence = 0.42 if warm else 0.24
    elif warm:
        valence = 0.72
    if _contains(text, ("dance", "party", "club", "groove")):
        danceability = 0.82

    curve = None
    if _contains(text, ("build", "builds", "building", "rise", "rising", "crescendo", "to chaos")):
        start = min(energy, 0.35)
        finish = max(energy, 0.92 if "chaos" in text else 0.78)
        curve = [start + (finish - start) * index / 9 for index in range(10)]
        energy = finish

    summary = " ".join(prompt.strip().split()[:8]) or "Balanced listening"
    return VibeTargets(
        target_energy=energy,
        target_valence=valence,
        target_danceability=danceability,
        tempo_min=tempo_min,
        tempo_max=tempo_max,
        energy_curve=curve,
        summary=summary,
        confidence=0.2,
    )


async def parse_vibe(prompt: str) -> VibeTargets:
    try:
        response = await chat_completion_json(prompt)
        return VibeTargets.model_validate(response)
    except Exception as error:
        logger.warning(
            "[Prompt DJ] LLM interpretation failed (%s); using keyword fallback.",
            type(error).__name__,
        )
        return keyword_fallback(prompt)
