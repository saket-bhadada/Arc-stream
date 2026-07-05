import { Router } from "express";
import db from '../db.js';

const router = Router();
const ML_BASE = process.env.ML_BASE||'http://localhost:8000';
const SPOTIFY_BASE = 'http://api.spotify.com/v1';

const spotifyFetch = async