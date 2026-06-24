import spotifyApi from "./spotifyservice";
import {Router} from 'express';

const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state',
    'playlist-modify-private',
    'playlist-modify-private'
];

const router = Router();

router.get('/login',(req,res)=>{
    const url = spotifyApi.createAuthorizeURL(SCOPES);
    res.redirect(url);
});

router.get('/callback',async(req,res)=>{
    const {error,code} = req.query;
    if(error){
        console.error('oauth error:',error);
        res.send(`Callback Error: ${error}`);
    }

    try{}catch(err){}
});