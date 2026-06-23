// client/src/components/Dashboard.jsx
import React from 'react';

const dashboard = ({ token }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <h2 style={{ color: '#1DB954' }}>✅ Authenticated</h2>
      <p>Welcome to the Arc-Stream Control Center.</p>
      
      <div style={{ 
        marginTop: '20px', 
        padding: '20px', 
        backgroundColor: '#282828', 
        borderRadius: '10px',
        maxWidth: '600px'
      }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#b3b3b3' }}>Your Master Key:</h4>
        <p style={{ wordBreak: 'break-all', fontSize: '12px', color: 'gray', margin: 0 }}>
          {token}
        </p>
      </div>
    </div>
  );
};

export default dashboard;