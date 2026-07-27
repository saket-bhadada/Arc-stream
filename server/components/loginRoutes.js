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

const REFRESH_COOKIE_NAME = 'arc_stream_token';
const REFRESH_COOKIE_MAX_AGE = 90*24*60*60*1000;

const cookieOption = () => ({
    httpOnly:true,
    secure:process.env.NODE_ENV==='production',
    sameSite:'lax',
    maxAge:REFRESH_COOKIE_MAX_AGE,
    path:'/',
});

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

        res.cookie(REFRESH_COOKIE_NAME,refresh_token,cookieOption());
        const redirect = new URL(process.env.FRONTEND_URL);
        redirect.searchParams.set('access_token',access_token);
        redirect.searchParams.set('expires_in',expires_in);
        res.redirect(redirect.toString());
    }catch(err){
        console.error('Error getting Tokens:',err);
        res.send(`Error getting Tokens: ${err}`);
    }
});

router.post('/refresh', async (req, res) => {
    const refresh_token = req.cookies[REFRESH_COOKIE_NAME];
    if (!refresh_token) {
        return res.status(401).json({ error: 'Missing refresh token cookie' });
    }
    try {
        spotifyApi.setRefreshToken(refresh_token);
        const data = await spotifyApi.refreshAccessToken();
        const { access_token, expires_in, refresh_token: rotated } = data.body;
        res.cookie(REFRESH_COOKIE_NAME, rotated || refresh_token, cookieOption());
        console.log(access_token);
        res.json({ access_token, expires_in });
    } catch (err) {
        console.error('Error refreshing access token:', err);
        res.status(500).json({ error: 'Failed to refresh access token' });
    }
});

router.post('/logout',(req,res)=>{
    res.clearCookie(REFRESH_COOKIE_NAME,{path:'/'});
    res.json({success:true});
});

export default router;