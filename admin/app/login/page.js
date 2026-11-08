'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Mascot from '@/components/Mascot';
import Icon from '@/components/Icon';
import { ConfigRequired } from '@/components/ui';
import { isConfigured } from '@/lib/config';
import { getSession, homeFor, startLogin } from '@/lib/auth';

// Sends the browser to the Cognito Hosted UI (/oauth2/authorize, code + PKCE).
// Auto-redirects unless the user just signed out, the session expired, or an
// error came back — then it waits for an explicit click.
export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = useState({ ready: false, notice: null, returnTo: '/admin' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    const p = new URLSearchParams(window.location.search);
    const returnTo = p.get('returnTo') && p.get('returnTo').startsWith('/admin') ? p.get('returnTo') : '/admin';
    const existing = getSession();
    if (existing?.role) {
      router.replace(returnTo === '/admin' ? homeFor(existing.role) : returnTo);
      return;
    }
    const notice = p.get('signedout') ? 'You have signed out.' : p.get('expired') ? 'Your session expired. Sign in again.' : p.get('error') ? `Sign-in failed: ${p.get('error')}` : null;
    setState({ ready: true, notice, returnTo });
    if (!notice) {
      setBusy(true);
      startLogin(returnTo).catch(() => setBusy(false));
    }
  }, [router]);

  if (!isConfigured) return <ConfigRequired />;

  const go = async () => {
    setBusy(true);
    try {
      await startLogin(state.returnTo);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Mascot size={150} pose="cheer" />
        </div>
        <h1 className="h1" style={{ textAlign: 'center', marginTop: 8 }}>
          IRL Admin
        </h1>
        <p className="soft" style={{ textAlign: 'center', marginTop: 4 }}>
          Moderation, safety and operations for Project IRL.
        </p>
        {state.notice ? (
          <div className="notice" style={{ marginTop: 16 }} role="status">
            <Icon name="info" />
            {state.notice}
          </div>
        ) : null}
        <button className="btn" style={{ width: '100%', marginTop: 20 }} onClick={go} disabled={busy || !state.ready}>
          <Icon name="shield" /> {busy ? 'Redirecting to sign-in…' : 'Continue with Cognito'}
        </button>
        <p className="caption soft" style={{ textAlign: 'center', marginTop: 18 }}>
          Requires membership of the <b>admin</b> or <b>moderator</b> group. All actions are audited.
        </p>
      </div>
    </div>
  );
}
