import { create } from 'zustand';

export const usePlayerStore = create((set) => ({

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  accessToken:  null,
  expiresAt:    null,

  setTokens: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  updateAccessToken: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  clearTokens: () => set({ accessToken: null, expiresAt: null }),

  // ─── SPOTIFY WEB PLAYBACK SDK ─────────────────────────────────────────────
  player:   null,
  deviceId: null,
  isActive: false,

  setPlayer:   (player)   => set({ player }),
  setDeviceId: (deviceId) => set({ deviceId }),
  setIsActive: (isActive) => set({ isActive }),

  // ─── PLAYBACK STATE ───────────────────────────────────────────────────────
  currentTrack: null,
  isPlaying:    false,
  position:     0,
  duration:     0,

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setIsPlaying:    (isPlaying)    => set({ isPlaying }),
  setPosition:     (position)     => set({ position }),
  setDuration:     (duration)     => set({ duration }),

  // ─── ARC-STREAM AI STATE (written by Phase 4) ─────────────────────────────
  sessionHistory:   [],
  currentZSequence: [],
  targetEnergy:     0.5,
  sessionId:        null,

  appendDatasetTrack: (trackId, vector) => set((state) => {
    if (state.sessionHistory.at(-1) === trackId) return state;
    return {
      sessionHistory: [...state.sessionHistory, trackId].slice(-200),
      currentZSequence: [...state.currentZSequence, vector].slice(-9),
    };
  }),
  setSessionId: (sessionId) => set({ sessionId }),
  setCurrentZSequence: (sequence) => set({ currentZSequence: sequence }),
  setTargetEnergy:     (energy)   => set({ targetEnergy: energy }),
  resetSession: () => set({ sessionId: null, sessionHistory: [], currentZSequence: [] }),
}));
