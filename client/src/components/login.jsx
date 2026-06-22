import React from 'react';

const Login = () => {
    return(
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh'}}>
            <h1>Arc-Stream</h1>
            <p style={{color:'#b3b3b3',marginBottom:'30px'}}>
                AI powered Generative Muisc Engine
            </p>
            <a
            href='http://127.0.0.1:3000/login'
            style={{
                backgroundColor: '#1DB954', 
                padding: '15px 30px', 
                borderRadius: '50px', 
                color: 'white', 
                textDecoration: 'none', 
                fontWeight: 'bold',
                letterSpacing: '1px'
            }}>
                CONNECT WITH SPOTIFY PREMUIUM
            </a>
        </div>
    )
};

export default Login;