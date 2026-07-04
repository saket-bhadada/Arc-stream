// client/src/pages/LoginPage.jsx


const LoginPage = () => (
  <div style={s.page}>
    <div style={s.badge}>AI DJ SYSTEM</div>

    <h1 style={s.title}>Arc-Stream</h1>
    <p style={s.sub}>
      An intelligent music engine that mathematically maps your vibe
      and charts smooth transitions across 114,000 tracks.
    </p>

    <a href="http://127.0.0.1:3000/login" style={s.btn}>
      CONNECT WITH SPOTIFY PREMIUM
    </a>

    <p style={s.disclaimer}>Spotify Premium account required for playback.</p>
  </div>
);

const s = {
  page: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', gap: 20,
    background: '#090910', padding: '0 24px',
    boxSizing: 'border-box',
  },
  badge: {
    fontSize: 11, fontWeight: 700, letterSpacing: '3px',
    color: '#1DB954', border: '1px solid #1DB954',
    padding: '4px 12px', borderRadius: 20,
  },
  title: {
    margin: 0, fontSize: 56, fontWeight: 800,
    color: '#f3f4f6', letterSpacing: '-2px', textAlign: 'center',
  },
  sub: {
    margin: 0, color: '#6b7280', fontSize: 15,
    maxWidth: 400, textAlign: 'center', lineHeight: 1.7,
  },
  btn: {
    marginTop: 12, backgroundColor: '#1DB954', color: '#000',
    padding: '16px 40px', borderRadius: 50, textDecoration: 'none',
    fontWeight: 800, letterSpacing: '1.5px', fontSize: 13,
  },
  disclaimer: { margin: 0, color: '#374151', fontSize: 12 },
};

export default LoginPage;