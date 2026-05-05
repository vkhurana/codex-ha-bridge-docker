import { getCodexBearerAuth } from "./auth.js";

function normalizeWindow(window) {
  if (!window) return null;

  const usedPercent = Number(window.used_percent ?? 0);
  const windowSeconds = Number(window.limit_window_seconds ?? 0);
  const windowMinutes =
    window.window_minutes ??
    (Number.isFinite(windowSeconds) && windowSeconds > 0
      ? Math.ceil(windowSeconds / 60)
      : null);

  return {
    used_percent: usedPercent,
    remaining_percent: Math.max(0, 100 - usedPercent),
    window_minutes: windowMinutes,
    reset_at: window.reset_at ?? null,
    reset_after_seconds: window.reset_after_seconds ?? null,
  };
}

function firstSome(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function formatResetTime(epochSeconds, includeDate) {
  if (!epochSeconds) return null;

  const date = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const time = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (!includeDate) return time;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} - ${time}`;
}

function normalizeLimitStatus(status) {
  if (!status || String(status).toLowerCase() === "unknown") return "OK";
  return status;
}

function normalizeSnapshot(payload) {
  const rateLimit = payload.rate_limit ?? payload.rateLimits ?? {};
  const primary = normalizeWindow(
    firstSome(rateLimit.primary_window, rateLimit.primary),
  );
  const secondary = normalizeWindow(
    firstSome(rateLimit.secondary_window, rateLimit.secondary),
  );

  return {
    source: "codex_backend",
    captured_at: new Date().toISOString(),
    plan: payload.plan_type ?? payload.planType ?? null,
    limit_id: "codex",
    primary,
    secondary,
    credits: payload.credits
      ? {
          has_credits: Boolean(payload.credits.has_credits),
          unlimited: Boolean(payload.credits.unlimited),
          balance: payload.credits.balance ?? null,
        }
      : null,
    additional_rate_limits:
      payload.additional_rate_limits ?? payload.additionalRateLimits ?? [],
    rate_limit_reached_type:
      payload.rate_limit_reached_type?.kind ??
      payload.rate_limit_reached_type ??
      null,
  };
}

export async function fetchCodexUsage(config) {
  const auth = await getCodexBearerAuth(config);
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "User-Agent": "codex-ha-bridge",
  };

  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

  const res = await fetch(config.backendUrl, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codex usage request failed: HTTP ${res.status} ${body}`);
  }

  return normalizeSnapshot(await res.json());
}

export function flattenForMqtt(snapshot) {
  return {
    plan: snapshot.plan,
    captured_at: snapshot.captured_at,
    source: snapshot.source,
    primary_used_percent: snapshot.primary?.used_percent ?? null,
    primary_remaining_percent: snapshot.primary?.remaining_percent ?? null,
    primary_window_minutes: snapshot.primary?.window_minutes ?? null,
    primary_reset_at: snapshot.primary?.reset_at ?? null,
    primary_reset_time: formatResetTime(snapshot.primary?.reset_at, false),
    primary_reset_after_seconds: snapshot.primary?.reset_after_seconds ?? null,
    secondary_used_percent: snapshot.secondary?.used_percent ?? null,
    secondary_remaining_percent: snapshot.secondary?.remaining_percent ?? null,
    secondary_window_minutes: snapshot.secondary?.window_minutes ?? null,
    secondary_reset_at: snapshot.secondary?.reset_at ?? null,
    secondary_reset_time: formatResetTime(snapshot.secondary?.reset_at, true),
    secondary_reset_after_seconds:
      snapshot.secondary?.reset_after_seconds ?? null,
    credits_has_credits: snapshot.credits?.has_credits ?? false,
    credits_unlimited: snapshot.credits?.unlimited ?? false,
    credits_balance: snapshot.credits?.balance ?? null,
    rate_limit_reached_type: normalizeLimitStatus(
      snapshot.rate_limit_reached_type,
    ),
  };
}
