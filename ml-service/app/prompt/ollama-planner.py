import os
import re
import json
import logging
import httpx
import numpy as np
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any

logger = logging.getLogger("arc_stream.ollama")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")


class PromptPlaylistPlan(BaseModel):
    playlist_title: str = Field(
        description="A creative, evocative 2-5 word title for this DJ mix"
    )
    vibe_summary: str = Field(
        description="A concise 1-2 sentence analysis of the acoustic and harmonic progression"
    )
    seed_queries: List[str] = Field(
        description="Exactly 5 track titles or artist names that anchor the sonic aesthetic",
        min_length=1,
        max_length=10,
    )
    energy_curve: List[float] = Field(
        description="Track-by-track energy values between 0.05 and 1.0 mapping the mix intensity",
        min_length=2,
    )
    target_valence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Overall mood from 0.0 (dark/melancholic/industrial) to 1.0 (euphoric/uplifting)",
    )
    recommended_bpm_range: List[int] = Field(
        default=[100, 128],
        min_length=2,
        max_length=2,
        description="[min_bpm, max_bpm] ideal tempo window for the set",
    )

    @field_validator("energy_curve")
    @classmethod
    def clamp_energy_values(cls, v: List[float]) -> List[float]:
        """Ensure all LLM-generated energy values strictly stay within [0.05, 1.0]."""
        return [round(float(np.clip(val, 0.05, 1.0)), 3) for val in v]

    def normalize_to_length(self, target_count: int, fallback_seeds: List[str]) -> "PromptPlaylistPlan":
        """
        Guarantees that:
        1. `energy_curve` has EXACTLY `target_count` points via linear interpolation if the LLM miscounted.
        2. `seed_queries` has EXACTLY 5 items.
        """
        # 1. Resample energy curve if length doesn't match target_count
        if len(self.energy_curve) != target_count:
            x_old = np.linspace(0.0, 1.0, len(self.energy_curve))
            x_new = np.linspace(0.0, 1.0, target_count)
            interpolated = np.interp(x_new, x_old, self.energy_curve)
            self.energy_curve = [round(float(np.clip(x, 0.05, 1.0)), 3) for x in interpolated]

        # 2. Enforce exactly 5 seed queries
        cleaned_seeds = [s.strip() for s in self.seed_queries if s and s.strip()]
        for fb in fallback_seeds:
            if len(cleaned_seeds) >= 5:
                break
            if fb not in cleaned_seeds:
                cleaned_seeds.append(fb)
        while len(cleaned_seeds) < 5:
            cleaned_seeds.append(cleaned_seeds[-1] if cleaned_seeds else "The Weeknd")

        self.seed_queries = cleaned_seeds[:5]
        return self


def _extract_song_metadata(song: Dict[str, Any], index: int) -> str:
    """Formats a user-selected input song with all available acoustic telemetry."""
    name = song.get("track_name") or song.get("name") or f"Track #{index + 1}"
    artist = song.get("artist_name") or song.get("artist") or "Unknown Artist"
    energy = song.get("energy")
    valence = song.get("valence")
    tempo = song.get("tempo")
    camelot = song.get("camelot")

    metrics = []
    if energy is not None:
        metrics.append(f"Energy: {float(energy):.2f}")
    if valence is not None:
        metrics.append(f"Valence/Mood: {float(valence):.2f}")
    if tempo is not None:
        metrics.append(f"Tempo: {float(tempo):.0f} BPM")
    if camelot:
        metrics.append(f"Camelot Key: {camelot}")

    metrics_str = ", ".join(metrics) if metrics else "Acoustic features pending"
    return f"  {index + 1}. '{name}' by {artist} [{metrics_str}]"


def _build_heuristic_fallback(
    prompt: str,
    track_count: int,
    input_songs: Optional[List[Dict[str, Any]]] = None,
) -> PromptPlaylistPlan:
    """
    Deterministic fallback planner when Ollama is offline or unreachable (e.g. cloud free tier).
    Analyzes prompt keywords and input song energy to synthesize a smooth trajectory.
    """
    p_lower = prompt.lower()

    # Determine starting energy from input songs if available
    start_e = 0.45
    if input_songs:
        energies = [
            float(s["energy"])
            for s in input_songs
            if s.get("energy") is not None
        ]
        if energies:
            start_e = float(np.mean(energies))

    # Keyword-driven trajectory shaping
    if any(w in p_lower for w in ["workout", "gym", "hype", "phonk", "hard", "rave", "peak"]):
        peak_e, end_e, valence, bpm = 0.92, 0.85, 0.65, [125, 150]
        curve = np.linspace(max(start_e, 0.55), peak_e, track_count)
    elif any(w in p_lower for w in ["chill", "sleep", "study", "rain", "ambient", "lofi", "calm"]):
        peak_e, end_e, valence, bpm = 0.40, 0.22, 0.35, [75, 105]
        curve = np.linspace(min(start_e, 0.45), end_e, track_count)
    elif any(w in p_lower for w in ["build", "escalat", "ramp", "progressive", "sunrise"]):
        peak_e, end_e, valence, bpm = 0.88, 0.88, 0.70, [110, 132]
        curve = np.linspace(start_e, peak_e, track_count)
    else:
        # Classic DJ Arc (warmup -> peak -> cooldown)
        valence, bpm = 0.55, [105, 128]
        t = np.linspace(0, np.pi, track_count)
        curve = np.clip(start_e + 0.35 * np.sin(t), 0.1, 0.95)

    seed_names = [
        (s.get("track_name") or s.get("name") or s.get("artist_name") or "Anchor Track")
        for s in (input_songs or [])
    ]

    return PromptPlaylistPlan(
        playlist_title=f"Arc-Stream: {prompt[:24].strip().title()}",
        vibe_summary=f"Algorithmic acoustic trajectory tailored for '{prompt}' anchored by your selected seed profile.",
        seed_queries=seed_names[:5] if len(seed_names) >= 5 else (seed_names + ["The Weeknd", "Daft Punk", "Kavinsky", "RÜFÜS DU SOL", "Fred again.."])[:5],
        energy_curve=[round(float(x), 3) for x in curve],
        target_valence=valence,
        recommended_bpm_range=bpm,
    ).normalize_to_length(track_count, seed_names)


async def plan_playlist_from_prompt(
    prompt: str,
    track_count: int = 10,
    input_songs: Optional[List[Dict[str, Any]]] = None,
) -> PromptPlaylistPlan:
    """
    Translates a natural language DJ prompt + optional user-selected seed tracks
    into a validated `PromptPlaylistPlan` using local Ollama (`qwen2.5:7b` / `llama3.1:8b`).
    Automatically falls back to heuristic trajectory synthesis if Ollama is unreachable.
    """
    track_count = int(np.clip(track_count, 5, 25))
    fallback_seed_names = [
        (s.get("track_name") or s.get("name") or s.get("artist_name") or "")
        for s in (input_songs or [])
        if s
    ]

    # Build rich acoustic context block from input songs
    song_context = ""
    starting_energy_hint = ""
    if input_songs and len(input_songs) > 0:
        formatted_lines = [
            _extract_song_metadata(s, idx) for idx, s in enumerate(input_songs[:5])
        ]
        energies = [float(s["energy"]) for s in input_songs if s.get("energy") is not None]
        if energies:
            avg_e = round(float(np.mean(energies)), 2)
            first_e = round(float(energies[0]), 2)
            starting_energy_hint = (
                f"- Anchor the start of `energy_curve` near {first_e} (mean seed energy is {avg_e}) "
                f"unless the user explicitly asks for an immediate drop or jump.\n"
            )

        song_context = (
            f"\n\n### USER-SELECTED ANCHOR SONGS ({len(input_songs)}):\n"
            + "\n".join(formatted_lines)
            + "\n\n### ANCHOR ANALYSIS RULES:\n"
            "- Analyze the genre, BPM, mood, and energy of the user's selected anchor songs above.\n"
            "- Include or harmonize with these exact songs/artists inside `seed_queries`.\n"
            + starting_energy_hint
        )

    system_prompt = (
        "You are an elite AI DJ, harmonic mixing engineer, and musicologist.\n"
        f"Design a continuous, harmonically cohesive {track_count}-track DJ mix blueprint.\n"
        f"### STRICT OUTPUT REQUIREMENTS:\n"
        f"1. `energy_curve` MUST contain EXACTLY {track_count} floats between 0.05 and 1.0.\n"
        f"2. `seed_queries` MUST contain EXACTLY 5 song titles or artist names.\n"
        f"3. Shape `energy_curve` to reflect natural DJ pacing (e.g., warmup, buildup, peak clunk/drop, or outro cooldown) matching the user's prompt."
        f"{song_context}"
    )

    user_message = (
        f"User Prompt: \"{prompt.strip()}\"\n"
        f"Required Track Count: {track_count}\n"
        "Respond ONLY with valid JSON matching the schema."
    )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(35.0, connect=4.0)) as client:
            response = await client.post(
                f"{OLLAMA_HOST.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    "format": PromptPlaylistPlan.model_json_schema(),
                    "stream": False,
                    "keep_alive": "15m",
                    "options": {
                        "temperature": 0.25,
                        "top_p": 0.9,
                        "num_predict": 512,
                    },
                },
            )
            response.raise_for_status()
            raw_content = response.json().get("message", {}).get("content", "")

            # Strip markdown code fences if an older Ollama version wraps JSON in ```json ... ```
            cleaned_json = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_content.strip(), flags=re.IGNORECASE)

            plan = PromptPlaylistPlan.model_validate_json(cleaned_json)
            return plan.normalize_to_length(track_count, fallback_seed_names)

    except (httpx.RequestError, httpx.HTTPStatusError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "[Arc-Stream Ollama] Local LLM unavailable or returned invalid schema (%s). "
            "Using deterministic acoustic fallback.",
            exc,
        )
        return _build_heuristic_fallback(prompt, track_count, input_songs)