export type AuthUser = {
  id: string;
  name?: string;
  email?: string;
  source: 'auth-header' | 'auth-cookie' | 'local-bypass';
};

type Lookup = {
  get(name: string): string | null | undefined;
};

type ResolveAuthInput = {
  headers: Lookup;
  cookies: Lookup;
  hostname?: string | null;
};

const envOr = (name: string): string | undefined => process.env[name]?.trim() || undefined;
const firstDefined = (...values: Array<string | undefined>): string | undefined => values.find(Boolean);
const unique = (values: Array<string | undefined>): string[] => [...new Set(values.filter((value): value is string => Boolean(value)))];

const AUTH_USER_ID_HEADERS = (): string[] =>
  unique([envOr('AUTH_USER_ID_HEADER'), 'x-auth-user-id']);
const AUTH_USER_NAME_HEADERS = (): string[] =>
  unique([envOr('AUTH_USER_NAME_HEADER'), 'x-auth-user-name']);
const AUTH_USER_EMAIL_HEADERS = (): string[] =>
  unique([envOr('AUTH_USER_EMAIL_HEADER'), 'x-auth-user-email']);
const AUTH_SESSION_COOKIES = (): string[] =>
  unique([envOr('AUTH_SESSION_COOKIE'), 'auth_user_id']);

export const isLocalHostname = (hostname?: string | null): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const resolveAuthUser = ({ headers, cookies, hostname }: ResolveAuthInput): AuthUser | null => {
  const headerUserId = firstDefined(...AUTH_USER_ID_HEADERS().map((name) => headers.get(name)?.trim()));
  if (headerUserId) {
    const headerName = firstDefined(...AUTH_USER_NAME_HEADERS().map((name) => headers.get(name)?.trim()));
    const headerEmail = firstDefined(...AUTH_USER_EMAIL_HEADERS().map((name) => headers.get(name)?.trim()));
    return {
      id: headerUserId,
      name: headerName,
      email: headerEmail,
      source: 'auth-header',
    };
  }

  const cookieUserId = firstDefined(...AUTH_SESSION_COOKIES().map((name) => cookies.get(name)?.trim()));
  if (cookieUserId) {
    return {
      id: cookieUserId,
      source: 'auth-cookie',
    };
  }

  if (process.env.AUTH_BYPASS_LOCAL === 'true' && isLocalHostname(hostname)) {
    return {
      id: firstDefined(envOr('AUTH_BYPASS_LOCAL_USER_ID'), 'local-dev') as string,
      name: process.env.AUTH_BYPASS_LOCAL_USER_NAME?.trim() || 'Local Developer',
      email: process.env.AUTH_BYPASS_LOCAL_USER_EMAIL?.trim() || undefined,
      source: 'local-bypass',
    };
  }

  return null;
};
