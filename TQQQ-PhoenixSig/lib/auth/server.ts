import { cookies, headers } from 'next/headers';
import { resolveAuthUser, type AuthUser } from './adapter';

export const getCurrentAuthUser = async (): Promise<AuthUser | null> => {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const forwardedHost = headerStore.get('x-forwarded-host');
  const hostHeader = headerStore.get('host');
  const hostname = (forwardedHost || hostHeader || '').split(',')[0]?.trim().split(':')[0] || undefined;

  return resolveAuthUser({
    headers: { get: (name: string) => headerStore.get(name) },
    cookies: { get: (name: string) => cookieStore.get(name)?.value },
    hostname,
  });
};
