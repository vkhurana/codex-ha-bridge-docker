import { getCodexBearerAuth } from "./auth.js";

const FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const MONTHLY_WINDOW_MIN_SECONDS = 28 * DAILY_WINDOW_SECONDS;

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

function windowDurationSeconds(window) {
  if (!window) return null;

  const seconds = Number(window.limit_window_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;

  const minutes = Number(window.window_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
}

function windowLabel(window) {
  const duration = windowDurationSeconds(window);
  if (!duration) return null;
  if (duration === FIVE_HOUR_WINDOW_SECONDS) return "5h";
  if (duration === WEEKLY_WINDOW_SECONDS) return "Weekly";
  if (duration >= MONTHLY_WINDOW_MIN_SECONDS) return "Monthly";

  const hours = duration / (60 * 60);
  if (Number.isInteger(hours) && hours < 24) return `${hours}h`;

  const days = duration / DAILY_WINDOW_SECONDS;
  return Number.isInteger(days) ? `${days}d` : null;
}

function selectUsageWindows(rateLimit) {
  const positionalPrimary = firstSome(
    rateLimit.primary_window,
    rateLimit.primary,
  );
  const positionalSecondary = firstSome(
    rateLimit.secondary_window,
    rateLimit.secondary,
  );
  const windows = [positionalPrimary, positionalSecondary].filter(Boolean);

  const fiveHourWindow = windows.find(
    (window) => windowDurationSeconds(window) === FIVE_HOUR_WINDOW_SECONDS,
  );
  const longerTermWindow = windows.find(
    (window) => windowDurationSeconds(window) >= DAILY_WINDOW_SECONDS,
  );

  return {
    primary:
      fiveHourWindow ??
      (windowDurationSeconds(positionalPrimary) < DAILY_WINDOW_SECONDS
        ? positionalPrimary
        : null),
    secondary:
      longerTermWindow ??
      (windowDurationSeconds(positionalSecondary) !== FIVE_HOUR_WINDOW_SECONDS
        ? positionalSecondary
        : null),
  };
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
  const windows = selectUsageWindows(rateLimit);
  const primary = normalizeWindow(windows.primary);
  const secondary = normalizeWindow(windows.secondary);

  return {
    source: "codex_backend",
    captured_at: new Date().toISOString(),
    plan: payload.plan_type ?? payload.planType ?? null,
    limit_id: "codex",
    primary,
    secondary,
    primary_window_label: windowLabel(windows.primary),
    secondary_window_label: windowLabel(windows.secondary),
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

  const payload = await res.json();
  console.log(`Raw Codex usage JSON: ${JSON.stringify(payload)}`);
  return normalizeSnapshot(payload);
}

export function flattenForMqtt(snapshot) {
  return {
    plan: snapshot.plan,
    captured_at: snapshot.captured_at,
    source: snapshot.source,
    primary_used_percent: snapshot.primary?.used_percent ?? null,
    primary_remaining_percent: snapshot.primary?.remaining_percent ?? null,
    primary_window_minutes: snapshot.primary?.window_minutes ?? null,
    primary_window_label: snapshot.primary_window_label ?? null,
    primary_reset_at: snapshot.primary?.reset_at ?? null,
    primary_reset_time: formatResetTime(snapshot.primary?.reset_at, false),
    primary_reset_after_seconds: snapshot.primary?.reset_after_seconds ?? null,
    secondary_used_percent: snapshot.secondary?.used_percent ?? null,
    secondary_remaining_percent: snapshot.secondary?.remaining_percent ?? null,
    secondary_window_minutes: snapshot.secondary?.window_minutes ?? null,
    secondary_window_label: snapshot.secondary_window_label ?? null,
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
