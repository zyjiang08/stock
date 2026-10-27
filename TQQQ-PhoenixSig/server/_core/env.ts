import fs from "fs";
import dotenv from "dotenv";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}

dotenv.config();

const parseBoolean = (value: string | undefined): boolean => {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  authBypassLocal: parseBoolean(process.env.AUTH_BYPASS_LOCAL),
  authBypassLocalUserEmail: process.env.AUTH_BYPASS_LOCAL_USER_EMAIL ?? "",
  authBypassLocalUserId: process.env.AUTH_BYPASS_LOCAL_USER_ID ?? "local-dev",
  authBypassLocalUserName: process.env.AUTH_BYPASS_LOCAL_USER_NAME ?? "Local Developer",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
