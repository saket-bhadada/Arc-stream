import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import SpotifyWebApi from 'spotify-web-api-node';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

app.get("/login", (req, res) => {
    const scopes = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-modify-playback-state',
        'user-read-playback-state',
        'playlist-modify-public',
        'playlist-modify-private',
    ]
    
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    res.redirect(authorizeURL);
});

app.get("/callback", async (req, res) => {
    const error = req.query.error;
    const code = req.query.code;

    if(error){
        console.error("Callback Error:", error);
        res.send('Callback Error: ' + error);
        return;
    }

    try{
        const data = await spotifyApi.authorizationCodeGrant(code);
        const accesstoken = data.body['access_token'];
        const refreshToken = data.body['refresh_token'];
        const expiresIn = data.body['expires_in'];

        res.json({
            message: 'Successfully retrieved access token!',
            accessToken: accesstoken,
            refreshToken: refreshToken,
            expiresIn: expiresIn
        });
    }catch(error){
        console.error("Error getting Tokens:", error);
        res.send('Error getting Tokens: ' + error);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});