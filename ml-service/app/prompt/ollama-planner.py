"""Backward-compatibility module forwarding to groq_planner."""

from __future__ import annotations

from app.prompt.groq_planner import (
    PromptPlaylistPlan,
    plan_playlist_from_prompt,
)

__all__ = ["PromptPlaylistPlan", "plan_playlist_from_prompt"]
