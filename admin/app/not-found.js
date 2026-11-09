import Link from 'next/link';
import Mascot from '@/components/Mascot';

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card" style={{ textAlign: 'center', maxWidth: 420 }}>
        <Mascot size={140} style={{ margin: '0 auto' }} />
        <h1 className="h1" style={{ marginTop: 12 }}>
          Nothing here
        </h1>
        <p className="soft">That page doesn’t exist in the admin console.</p>
        <Link href="/admin/dashboard" className="btn">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
