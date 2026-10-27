import { redirect } from 'next/navigation';
import { getCurrentAuthUser } from '@/lib/auth/server';

type Props = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function LoginRequiredPage({ searchParams }: Props) {
  const user = await getCurrentAuthUser();
  const params = await searchParams;
  const nextPath = typeof params?.next === 'string' && params.next.startsWith('/') ? params.next : '/';
  const authLoginUrl = process.env.AUTH_LOGIN_URL?.trim() || 'https://manus.im';

  if (user) {
    redirect(nextPath as never);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <h1>Login Required</h1>
        <p className="small">
          The dashboard is public, but sign-in is required before you can connect or manage Telegram alerts.
        </p>
        <div className="card">
          <strong>Expected Auth Adapter</strong>
          <p className="small" style={{ marginTop: '.45rem', marginBottom: 0 }}>
            This scaffold accepts a signed-in user via request headers or a session cookie. That means you can wire it to Manus now and swap to a different host or auth provider later without changing the rest of the Telegram flow.
          </p>
        </div>
        <div className="card">
          <strong>Local Development</strong>
          <p className="small" style={{ marginTop: '.45rem', marginBottom: 0 }}>
            For localhost-only testing, set <code>AUTH_BYPASS_LOCAL=true</code> in <code>.env.local</code> to bypass the blocker with a local dev user.
          </p>
        </div>
        <p className="small" style={{ marginTop: '.25rem' }}>
          Destination after login: <code>{nextPath}</code>
        </p>
        <a href={authLoginUrl} className="cta" target="_blank" rel="noreferrer">
          Open Sign-In
        </a>
      </section>
    </main>
  );
}
