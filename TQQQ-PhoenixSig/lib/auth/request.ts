import { NextResponse } from 'next/server';
import { resolveAuthUser, type AuthUser } from './adapter';

const parseCookieHeader = (cookieHeader: string | null): Map<string, string> => {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const rawName = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    if (!rawName) {
      continue;
    }

    cookies.set(decodeURIComponent(rawName), decodeURIComponent(rawValue));
  }

  return cookies;
};

export const getRequestAuthUser = (request: Request): AuthUser | null => {
  const url = new URL(request.url);
  const cookieStore = parseCookieHeader(request.headers.get('cookie'));

  return resolveAuthUser({
    headers: { get: (name: string) => request.headers.get(name) },
    cookies: { get: (name: string) => cookieStore.get(name) },
    hostname: url.hostname,
  });
};

export const createAuthRequiredResponse = () =>
  NextResponse.json(
    { ok: false, error: 'Sign in required to manage Telegram connection.' },
    { status: 401 },
  );
