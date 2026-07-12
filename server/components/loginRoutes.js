import spotifyApi from "../spotifyservice.js";
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
        return res.send(`Callback Error: ${error}`);
    }

    try{
        const data = await spotifyApi.authorizationCodeGrant(code);
        const {access_token,refresh_token,expires_in} = data.body;
        console.log(access_token);

        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            console.error('[Login] FRONTEND_URL not set – cannot build redirect URL');
            return res.status(500).send('Server mis‑configuration');
        }
        const redirect = new URL(frontendUrl);
        redirect.searchParams.set('access_token',access_token);
        redirect.searchParams.set('refresh_token',refresh_token);
        redirect.searchParams.set('expires_in',expires_in);
        res.redirect(redirect.toString());
    }catch(err){
        console.error('Error getting Tokens:',err);
        res.send(`Error getting Tokens: ${err}`);
    }
});

router.post('/refresh_token',async(req,res)=>{
    const {refresh_token} = req.body;
    if(!refresh_token){
        return res.status(400).json({error:'Missing refresh_token in request body'});
    }
    try{
        spotifyApi.setRefreshToken(refresh_token);
        const data = await spotifyApi.refreshAccessToken();
        const {access_token,expires_in} = data.body;
        console.log(access_token);
        res.json({access_token,expires_in});
    }catch(err){
        console.error('Error refreshing access token:',err);
        res.status(500).json({error:'Failed to refresh access token'});
    }
});

export default router;