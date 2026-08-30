import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { fetchAuthConfig, fetchMe, googleSignIn } from './api.js';

// Wraps the app in authentication. While the server has auth disabled (no
// Google client id configured — the original local single-user mode) it just
// renders the app as an admin. With auth enabled it shows a Google sign-in
// screen until a session exists, then provides the signed-in user via context.

const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

function SignInScreen({ clientId, onSignedIn }) {
  const buttonRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const init = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            onSignedIn(await googleSignIn(credential));
          } catch (err) {
            setError(err.message);
          }
        }
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill'
      });
    };

    // Google Identity Services script; loaded once and reused thereafter.
    if (window.google?.accounts?.id) {
      init();
    } else {
      let script = document.getElementById('gis-script');
      if (!script) {
        script = document.createElement('script');
        script.id = 'gis-script';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', init);
    }
    return () => { cancelled = true; };
  }, [clientId, onSignedIn]);

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <h1>Job Search Tracker</h1>
        <p className="signin-sub">Sign in to see your jobs.</p>
        <div ref={buttonRef} className="signin-button" />
        {error && <div className="error-banner">{error}</div>}
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [config, setConfig] = useState(null); // { auth_enabled, google_client_id }
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false); // initial /api/me attempt done

  useEffect(() => {
    (async () => {
      try {
        const cfg = await fetchAuthConfig();
        setConfig(cfg);
        if (!cfg.auth_enabled) {
          setUser({ id: 0, name: 'Local admin', email: '', picture: '', role: 'admin', person_id: null, auth_enabled: false });
        } else {
          try {
            setUser(await fetchMe());
          } catch { /* no session yet — sign-in screen */ }
        }
      } catch {
        // Server unreachable — render the app shell; its own error banner
        // reports fetch failures with more context.
        setUser({ id: 0, name: 'Local admin', email: '', picture: '', role: 'admin', person_id: null, auth_enabled: false });
      }
      setChecked(true);
    })();
  }, []);

  // Any API call that comes back 401 flips us to the sign-in screen.
  useEffect(() => {
    const onUnauthorized = () => setUser(u => (u?.auth_enabled ? null : u));
    window.addEventListener('jobtracker:unauthorized', onUnauthorized);
    return () => window.removeEventListener('jobtracker:unauthorized', onUnauthorized);
  }, []);

  if (!checked) return <div className="signin-screen"><div className="signin-card">Loading…</div></div>;
  if (!user) return <SignInScreen clientId={config.google_client_id} onSignedIn={setUser} />;
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}
