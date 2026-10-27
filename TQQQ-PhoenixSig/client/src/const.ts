export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
const isLocalhostRuntime = () => {
  if (typeof window === "undefined") return false;

  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
};

export const getLoginUrl = (): string | null => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL?.trim();
  const authLoginUrl = import.meta.env.VITE_AUTH_LOGIN_URL?.trim();
  const appId = import.meta.env.VITE_APP_ID?.trim();
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const fallbackUrl = authLoginUrl || oauthPortalUrl || "https://manus.im";
  const localhostFallback = authLoginUrl || fallbackUrl;

  if (!oauthPortalUrl || !appId) {
    return isLocalhostRuntime() ? localhostFallback : authLoginUrl || null;
  }

  try {
    const state = btoa(redirectUri);
    const url = new URL("/app-auth", oauthPortalUrl);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    return url.toString();
  } catch {
    return isLocalhostRuntime() ? localhostFallback : authLoginUrl || null;
  }
};
