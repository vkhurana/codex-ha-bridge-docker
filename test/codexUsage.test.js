import assert from "node:assert/strict";
import test from "node:test";

import { fetchCodexUsage, flattenForMqtt } from "../src/codexUsage.js";

async function normalizePayload(payload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    return flattenForMqtt(
      await fetchCodexUsage({
        accessToken: "test-token",
        backendUrl: "https://example.test/usage",
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("maps the original primary and secondary windows", async () => {
  const state = await normalizePayload({
    rate_limit: {
      primary_window: {
        used_percent: 12,
        limit_window_seconds: 5 * 60 * 60,
        reset_at: 1_800_000_000,
      },
      secondary_window: {
        used_percent: 34,
        limit_window_seconds: 7 * 24 * 60 * 60,
        reset_at: 1_800_500_000,
      },
    },
  });

  assert.equal(state.primary_used_percent, 12);
  assert.equal(state.primary_window_minutes, 300);
  assert.equal(state.secondary_used_percent, 34);
  assert.equal(state.secondary_window_minutes, 10_080);
});

test("maps a lone seven-day primary_window to weekly usage", async () => {
  const state = await normalizePayload({
    rate_limit: {
      primary_window: {
        used_percent: 8,
        limit_window_seconds: 7 * 24 * 60 * 60,
        reset_at: 1_800_500_000,
      },
      secondary_window: null,
    },
  });

  assert.equal(state.primary_used_percent, null);
  assert.equal(state.primary_window_minutes, null);
  assert.equal(state.secondary_used_percent, 8);
  assert.equal(state.secondary_window_minutes, 10_080);
  assert.equal(state.secondary_window_label, "Weekly");
});

test("maps a lone monthly primary_window to Go's long-term usage", async () => {
  const state = await normalizePayload({
    plan_type: "go",
    rate_limit: {
      primary_window: {
        used_percent: 18,
        limit_window_seconds: 30 * 24 * 60 * 60,
        reset_at: 1_800_500_000,
      },
      secondary_window: null,
    },
  });

  assert.equal(state.plan, "go");
  assert.equal(state.primary_used_percent, null);
  assert.equal(state.secondary_used_percent, 18);
  assert.equal(state.secondary_window_minutes, 43_200);
  assert.equal(state.secondary_window_label, "Monthly");
});

test("uses window duration even when the backend reverses positions", async () => {
  const state = await normalizePayload({
    rate_limit: {
      primary_window: {
        used_percent: 45,
        limit_window_seconds: 7 * 24 * 60 * 60,
      },
      secondary_window: {
        used_percent: 23,
        limit_window_seconds: 5 * 60 * 60,
      },
    },
  });

  assert.equal(state.primary_used_percent, 23);
  assert.equal(state.secondary_used_percent, 45);
  assert.equal(state.primary_window_label, "5h");
  assert.equal(state.secondary_window_label, "Weekly");
});

test("retains positional fallback when duration metadata is absent", async () => {
  const state = await normalizePayload({
    rate_limit: {
      primary_window: { used_percent: 6 },
      secondary_window: { used_percent: 17 },
    },
  });

  assert.equal(state.primary_used_percent, 6);
  assert.equal(state.secondary_used_percent, 17);
});
