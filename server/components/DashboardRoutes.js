import { Router } from "express";
import db from '../db.js';

const router = Router();
const ML_BASE = process.env.ML_BASE||'http://localhost:8000';
const SPOTIFY_BASE = 'http://api.spotify.com/v1';

const spotifyFetch = async(path,accessToken,options={})=>{
  const res = await fetch(`${SPOTIFY_BASE}${path}`,{
    ...options,
    headers:{
      'Authorization':`Bearer${accessToken}`,
      'Content_type':'application/json',
      ...options.headers,
    }
  });
  if(res.status===204) return null;
  if(!res.ok){
    throw new Error(`Spotify ${res.status} on ${path}: ${body}`);
  }

  return res.json();
};

router.post('/buffer',async(req,res)=>{
  const {
    session_id,
    access_token,
    target_energy,
    session_history,
    current_z_sequence,
  } = req.body;
  
  if(!access_token) {
    return res.status(401).json({error:'Missing access token'})
  }

  if(!current_z_sequence||(current_z_sequence.length<5&&current_z_sequence.length>9)) {
    return res.status(400).json({
      error:'current_z_sequence must be an array of 5 to 9 z-vector'
    })
  }
  try{
    const mlRes = await fetch(`${ML_BASE}/predict_buffer`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
      },
      body: JSON.stringify({
        target_energy,
        session_history,
        current_z_sequence,
      }),
    });
    if(!mlRes.ok) {
      const mlErr = await mlRes.text();
      throw new Error(`FastApi /predict_buffer ${mlRes.status}: ${mlErr}`);
    }
    const {tracks} = await mlRes.json();
  }catch(err){}
});