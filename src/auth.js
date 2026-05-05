import fs from "node:fs/promises";
import path from "node:path";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

async function readAuthJson(codexHome) {
  const authPath = path.join(codexHome, "auth.json");
  const text = await fs.readFile(authPath, "utf8");
  return { authPath, auth: JSON.parse(text) };
}

function isJwtExpired(token, skewSeconds = 120) {
  const parts = token?.split(".");
  if (!parts || parts.length < 2) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64")
        .toString("utf8"),
    );
    if (!payload.exp) return false;
    return payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds;
  } catch {
    return false;
  }
}

async function refreshAuth(authPath, auth, refreshUrl) {
  const refreshToken = auth?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error("Codex auth token expired, but no refresh_token was found.");
  }

  const res = await fetch(refreshUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codex token refresh failed: HTTP ${res.status} ${body}`);
  }

  const refreshed = await res.json();
  auth.tokens ??= {};
  if (refreshed.access_token) auth.tokens.access_token = refreshed.access_token;
  if (refreshed.refresh_token) auth.tokens.refresh_token = refreshed.refresh_token;
  auth.last_refresh = new Date().toISOString();

  await fs.writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  return auth.tokens.access_token;
}

export async function getCodexBearerAuth(config) {
  if (config.accessToken) {
    return {
      accessToken: config.accessToken,
      accountId: config.accountId,
      source: "CODEX_ACCESS_TOKEN",
    };
  }

  let authPath;
  let auth;
  try {
    ({ authPath, auth } = await readAuthJson(config.home));
  } catch (error) {
    throw new Error(
      `Codex auth.json could not be read from ${config.home}. ` +
        "Run Codex login with file auth, or set CODEX_ACCESS_TOKEN. " +
        `Original error: ${error.message}`,
    );
  }

  if (auth.agent_identity && !auth.tokens?.access_token) {
    throw new Error(
      "This bridge found Codex agent_identity auth, but not bearer tokens. " +
        "Set CODEX_ACCESS_TOKEN or use file-based ChatGPT OAuth auth.json.",
    );
  }

  const accessToken = auth?.tokens?.access_token;
  if (!accessToken) {
    throw new Error("Codex auth.json does not contain tokens.access_token.");
  }

  const freshToken = isJwtExpired(accessToken)
    ? await refreshAuth(authPath, auth, config.refreshUrl)
    : accessToken;

  return {
    accessToken: freshToken,
    accountId: auth?.tokens?.account_id || config.accountId,
    source: authPath,
  };
}
