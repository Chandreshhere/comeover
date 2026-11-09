'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Mascot from '@/components/Mascot';
import Icon from '@/components/Icon';
import { ConfigRequired } from '@/components/ui';
import { isConfigured } from '@/lib/config';
import { getSession, homeFor, requestOtp, resendOtp, verifyOtp } from '@/lib/auth';

// Phone OTP sign-in (codes delivered by Slide over WhatsApp or SMS).
// Only accounts with the admin or moderator role can use the console.
export default function LoginPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/admin');
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState('phone'); // phone | code
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [req, setReq] = useState(null); // { requestId, channel, maskedPhone }
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const codeRef = useRef(null);

  useEffect(() => {
    if (!isConfigured) return;
    const p = new URLSearchParams(window.location.search);
    const rt = p.get('returnTo') && p.get('returnTo').startsWith('/admin') ? p.get('returnTo') : '/admin';
    setReturnTo(rt);
    const existing = getSession();
    if (existing?.role) {
      router.replace(rt === '/admin' ? homeFor(existing.role) : rt);
      return;
    }
    setNotice(p.get('signedout') ? 'You have signed out.' : p.get('expired') ? 'Your session expired. Sign in again.' : null);
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!isConfigured) return <ConfigRequired />;

  const normalised = () => {
    const d = phone.replace(/[^\d+]/g, '');
    return /^\d{10}$/.test(d) ? `+91${d}` : d.startsWith('+') ? d : `+${d}`;
  };

  const send = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await requestOtp(normalised());
      setReq(r);
      setStep('code');
      setCooldown(r.retryAfterSec || 30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(err.message);
      if (err.retryAfterSec) setCooldown(err.retryAfterSec);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (channel) => {
    setBusy(true);
    setError(null);
    try {
      const r = await resendOtp(req.requestId, channel);
      setReq((x) => ({ ...x, ...r }));
      setCooldown(r.retryAfterSec || 30);
      if (r.notice) setNotice(r.notice);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    if (code.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const s = await verifyOtp(req.requestId, code);
      if (!s?.role) {
        setError('This number is signed in but has no admin or moderator role. Ask an admin to grant access.');
        setBusy(false);
        return;
      }
      router.replace(returnTo === '/admin' ? homeFor(s.role) : returnTo);
    } catch (err) {
      setError(err.message);
      setCode('');
      setBusy(false);
    }
  };

  const via = req?.channel === 'whatsapp' ? 'on WhatsApp' : req?.channel === 'sms' ? 'by SMS' : '';
  const other = req?.channel === 'whatsapp' ? 'sms' : req?.channel === 'sms' ? 'whatsapp' : null;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Mascot size={150} pose="cheer" />
        </div>
        <h1 className="h1" style={{ textAlign: 'center', marginTop: 8 }}>
          Come Over Admin
        </h1>
        <p className="soft" style={{ textAlign: 'center', marginTop: 4 }}>
          Moderation, safety and operations for Come Over.
        </p>
        {notice ? (
          <div className="notice" style={{ marginTop: 16 }} role="status">
            <Icon name="info" />
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="notice bad" style={{ marginTop: 12 }} role="alert">
            <Icon name="alert" />
            {error}
          </div>
        ) : null}

        {step === 'phone' ? (
          <form onSubmit={send} style={{ marginTop: 18 }}>
            <label className="label" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              className="input"
              style={{ width: '100%', marginTop: 6 }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button className="btn" type="submit" style={{ width: '100%', marginTop: 14 }} disabled={busy || cooldown > 0 || phone.replace(/\D/g, '').length < 10}>
              <Icon name="shield" /> {busy ? 'Sending code…' : cooldown > 0 ? `Try again in ${cooldown}s` : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} style={{ marginTop: 18 }}>
            <label className="label" htmlFor="code">
              Code sent {via} to {req?.maskedPhone || normalised()}
            </label>
            <input
              id="code"
              ref={codeRef}
              className="input mono"
              style={{ width: '100%', marginTop: 6, letterSpacing: 6, fontSize: 20, textAlign: 'center' }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn" type="submit" style={{ width: '100%', marginTop: 14 }} disabled={busy || code.length < 4}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn ghost sm" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>
                Change number
              </button>
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn secondary sm" disabled={busy || cooldown > 0} onClick={() => resend()}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                </button>
                {other && cooldown <= 0 ? (
                  <button type="button" className="btn secondary sm" disabled={busy} onClick={() => resend(other)}>
                    {other === 'sms' ? 'Use SMS' : 'Use WhatsApp'}
                  </button>
                ) : null}
              </span>
            </div>
          </form>
        )}
        <p className="caption soft" style={{ textAlign: 'center', marginTop: 18 }}>
          Requires the <b>admin</b> or <b>moderator</b> role. All actions are audited.
        </p>
      </div>
    </div>
  );
}
