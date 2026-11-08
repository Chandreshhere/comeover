'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import Mascot from '@/components/Mascot';
import { ConfigRequired } from '@/components/ui';
import { isConfigured } from '@/lib/config';
import { completeLogin, getSession, homeFor } from '@/lib/auth';

// Cognito redirects here with ?code&state. Exchange the code at /oauth2/token
// using the PKCE verifier stored before the redirect.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!isConfigured || ran.current) return;
    ran.current = true;
    completeLogin(window.location.search)
      .then((returnTo) => {
        const s = getSession();
        router.replace(returnTo && returnTo !== '/admin' ? returnTo : homeFor(s?.role));
      })
      .catch((e) => setError(e.message || 'Sign-in failed'));
  }, [router]);

  if (!isConfigured) return <ConfigRequired />;

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <Mascot size={130} />
        {error ? (
          <>
            <h1 className="h2" style={{ marginTop: 10 }}>
              Sign-in didn’t complete
            </h1>
            <div className="notice bad" style={{ marginTop: 12, textAlign: 'left' }} role="alert">
              <Icon name="alert" />
              {error}
            </div>
            <Link href="/login?error=callback" className="btn" style={{ marginTop: 16 }}>
              Try again
            </Link>
          </>
        ) : (
          <>
            <h1 className="h2" style={{ marginTop: 10 }}>
              Signing you in…
            </h1>
            <p className="soft">Exchanging the authorization code with Cognito.</p>
          </>
        )}
      </div>
    </div>
  );
}
