import { useEffect,useRef } from "react";
import {create} from 'zustand';

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

const NODE_BASE = import.meta.env.VITE_API_URL||'http://localhost:3000';
const SPOTIFY_BASE = 'https://api.spotify.com/v1';

const transferPlayback = async(deviceId,accessToken,play=false)=>{
  const res = await fetch(`${SPOTIFY_BASE}/ME/PLAYER`,{
    method:'PUT',
    headers:{'Authorization':'Bearer '+accessToken,
      'content-type':'application/json',
    },
    body:JSON.stringify({device_ids:[deviceId],play}),
  });
  if(!res.ok&&res.status!==204){
    throw new Error(`Transfer Playback failed:${res.status}`);
  }
};

const refreshToken = async (refreshToken)=>{
  const res = await fetch(`${NODE_BASE}/refresh`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:refreshToken}),
  });
  if(!res.ok) throw new Error('Token refresh failed');
  return res.json();
};

const addToQueue = async (trackUri, accessToken) => {
  const res = await fetch(
    `${SPOTIFY_BASE}/me/player/queue?uri=${encodeURIComponent(trackUri)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Add to queue failed: ${res.status}`);
};

const useSpotifyPlayer = ()=>{
  const scriptInjected = useRef(false);

  const {
    accessToken,
    setPlayer,setDeviceId,setIsActive,
    setCurrentTrack, setIsPlaying,setPosition,setDuration,
    addToHistory,
  } = usePlayerStore();

  useEffect(()=>{
    if(!accessToken||scriptInjected.current) return;
    scriptInjected.current = true;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name:'Arc-Stream',
        getOAuthToken:(callback)=>callback(usePlayerStore.getState().accessToken),
        volume: 0.7,
      });
    }
  })
  
}