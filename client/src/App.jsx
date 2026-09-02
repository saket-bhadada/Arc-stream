// client/src/App.jsx
import { useEffect, useState } from 'react';
import DashboardPage from './components/dashboard';
import { usePlayerStore } from './store/playerStore';
import LoginPage from './components/login';

const NODE_BASE = import.meta.env.VITE_NODE_BASE ?? 'http://127.0.0.1:3000';

function App() {
  const { accessToken, setTokens } = usePlayerStore();
  const [checkingSession,setCheckingSession] = useState(true);
  useEffect(() => {
    const params        = new URLSearchParams(window.location.search);
    const access_token  = params.get('access_token');
    const expires_in    = params.get('expires_in');

    if (access_token && expires_in) {
      Promise.resolve().then(() => {
        setTokens(access_token, parseInt(expires_in, 10));
        window.history.replaceState({}, document.title, '/');
        setCheckingSession(false);
      });
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
  }, [setTokens]);

  if (checkingSession) return null;
  return accessToken ? <DashboardPage /> : <LoginPage />;
}

export default App;
