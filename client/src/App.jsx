import {useState, useEffect} from 'react';
import Login from './components/login';
import dashboard from './components/dashboard';

function App(){
  const [token,setToken] = useState(null);

  useEffect(()=>{
    const hash = window.location.hash;
    const urlparams = new URLSearchParams(window.location.search);
    const accessToken = urlparams.get('access_token');

    if(accessToken){
      setToken(accessToken);
      window.history.pushState({},null,'/dashboard');
    }
  },[]);
  return (
    <div style={{ 
      backgroundColor: '#121212', 
      color: 'white', 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      fontFamily: 'sans-serif'
    }}>
      {/* Conditional Rendering: If there is no token, show Login. Otherwise, show Dashboard. */}
      {!token ? <Login /> : <Dashboard token={token} />}
    </div>
  );
}

export default App;