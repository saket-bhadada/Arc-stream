import { create } from 'zustand';

export const usePlayerStore = create((set) => ({

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  accessToken:  null,
  refreshToken: null,
  expiresAt:    null,

  setTokens: (accessToken, refreshToken, expiresIn) => set({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  updateAccessToken: (accessToken, expiresIn) => set({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  }),

  clearTokens: () => set({ accessToken: null, refreshToken: null, expiresAt: null }),

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

  addToHistory:        (trackId)  => set((s) => ({ sessionHistory: [...s.sessionHistory, trackId] })),
  setCurrentZSequence: (sequence) => set({ currentZSequence: sequence }),
  setTargetEnergy:     (energy)   => set({ targetEnergy: energy }),
  resetSession: () => set({ sessionHistory: [], currentZSequence: [] }),
}));
