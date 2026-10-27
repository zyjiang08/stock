import { afterEach, describe, expect, it } from 'vitest';
import { resolveAuthUser } from '@/lib/auth/adapter';

const restoreEnv = {
  AUTH_BYPASS_LOCAL: process.env.AUTH_BYPASS_LOCAL,
  AUTH_BYPASS_LOCAL_USER_ID: process.env.AUTH_BYPASS_LOCAL_USER_ID,
  AUTH_BYPASS_LOCAL_USER_NAME: process.env.AUTH_BYPASS_LOCAL_USER_NAME,
  AUTH_BYPASS_LOCAL_USER_EMAIL: process.env.AUTH_BYPASS_LOCAL_USER_EMAIL,
  AUTH_USER_ID_HEADER: process.env.AUTH_USER_ID_HEADER,
  AUTH_USER_NAME_HEADER: process.env.AUTH_USER_NAME_HEADER,
  AUTH_USER_EMAIL_HEADER: process.env.AUTH_USER_EMAIL_HEADER,
  AUTH_SESSION_COOKIE: process.env.AUTH_SESSION_COOKIE,
};

const emptyLookup = {
  get: () => undefined,
};

describe('resolveAuthUser', () => {
  afterEach(() => {
    process.env.AUTH_BYPASS_LOCAL = restoreEnv.AUTH_BYPASS_LOCAL;
    process.env.AUTH_BYPASS_LOCAL_USER_ID = restoreEnv.AUTH_BYPASS_LOCAL_USER_ID;
    process.env.AUTH_BYPASS_LOCAL_USER_NAME = restoreEnv.AUTH_BYPASS_LOCAL_USER_NAME;
    process.env.AUTH_BYPASS_LOCAL_USER_EMAIL = restoreEnv.AUTH_BYPASS_LOCAL_USER_EMAIL;
    process.env.AUTH_USER_ID_HEADER = restoreEnv.AUTH_USER_ID_HEADER;
    process.env.AUTH_USER_NAME_HEADER = restoreEnv.AUTH_USER_NAME_HEADER;
    process.env.AUTH_USER_EMAIL_HEADER = restoreEnv.AUTH_USER_EMAIL_HEADER;
    process.env.AUTH_SESSION_COOKIE = restoreEnv.AUTH_SESSION_COOKIE;
  });

  it('prefers generic auth identity headers when present', () => {
    const headers = new Map<string, string>([
      ['x-auth-user-id', 'user-123'],
      ['x-auth-user-name', 'Phoenix User'],
      ['x-auth-user-email', 'user@example.com'],
    ]);

    const user = resolveAuthUser({
      headers: { get: (name) => headers.get(name) },
      cookies: emptyLookup,
      hostname: 'phoenixsig.manus.im',
    });

    expect(user).toEqual({
      id: 'user-123',
      name: 'Phoenix User',
      email: 'user@example.com',
      source: 'auth-header',
    });
  });

  it('falls back to the generic auth session cookie when headers are absent', () => {
    const cookies = new Map<string, string>([['auth_user_id', 'cookie-user']]);

    const user = resolveAuthUser({
      headers: emptyLookup,
      cookies: { get: (name) => cookies.get(name) },
      hostname: 'phoenixsig.manus.im',
    });

    expect(user).toEqual({
      id: 'cookie-user',
      source: 'auth-cookie',
    });
  });

  it('supports an explicit localhost bypass for development', () => {
    process.env.AUTH_BYPASS_LOCAL = 'true';
    process.env.AUTH_BYPASS_LOCAL_USER_ID = 'dev-user';
    process.env.AUTH_BYPASS_LOCAL_USER_NAME = 'Local Dev';
    process.env.AUTH_BYPASS_LOCAL_USER_EMAIL = 'dev@example.com';

    const user = resolveAuthUser({
      headers: emptyLookup,
      cookies: emptyLookup,
      hostname: 'localhost',
    });

    expect(user).toEqual({
      id: 'dev-user',
      name: 'Local Dev',
      email: 'dev@example.com',
      source: 'local-bypass',
    });
  });
});
