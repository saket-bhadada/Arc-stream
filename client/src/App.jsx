// client/src/App.jsx
import { useEffect } from 'react';
import DashboardPage from './components/dashboard';
import { usePlayerStore } from './store/playerStore';
import LoginPage from './components/login';
import { useState } from 'react';

function App() {
  const { accessToken, setTokens } = usePlayerStore();
  const [checkingSession,setCheckingSession] = useState(true);
  useEffect(() => {
    const params        = new URLSearchParams(window.location.search);
    const access_token  = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const expires_in    = params.get('expires_in');

    if (access_token) {
      setTokens(access_token, refresh_token, parseInt(expires_in, 10));
      window.history.replaceState({}, document.title, '/');
      setCheckingSession(false);
      return;
    }
    fetch(`${NODE_BASE}/refresh`,{
      method:'POST',
      credentials:'include'
    }).then((res)=>(res.ok?res.json():Promise.reject()))
      .then(({access_token,expires_in})=>{
        setTokens(access_token,expires_in);
      })
      .catch(()=>{

      }).finally(()=>setCheckingSession(false));
  }, []);

  return accessToken ? <DashboardPage /> : <LoginPage />;
}

export default App;