'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/Shell';
import { homeFor } from '@/lib/auth';

// Role-aware landing: admins -> dashboard, moderators -> reports queue.
export default function AdminIndex() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session?.role) router.replace(homeFor(session.role));
  }, [session, router]);
  return <div className="caption muted">Opening console…</div>;
}
