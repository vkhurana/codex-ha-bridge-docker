import assert from "node:assert/strict";
import test from "node:test";

import { publishDiscovery } from "../src/mqttHa.js";

const config = {
  mqtt: {
    baseTopic: "codex/usage",
    discoveryPrefix: "homeassistant",
  },
  device: {
    id: "codex_usage",
    name: "Codex Usage",
  },
};

function recordingClient() {
  const messages = [];
  return {
    messages,
    publish(topic, body, options, callback) {
      messages.push({ topic, body, options });
      callback();
    },
  };
}

test("publishes weekly discovery and clears stale five-hour discovery", async () => {
  const client = recordingClient();

  await publishDiscovery(client, config, {
    primary_used_percent: null,
    secondary_used_percent: 9,
  });

  const fiveHour = client.messages.filter((message) =>
    message.topic.includes("/primary_"),
  );
  const weekly = client.messages.filter((message) =>
    message.topic.includes("/secondary_"),
  );

  assert.equal(fiveHour.length, 3);
  assert.ok(fiveHour.every((message) => message.body === ""));
  assert.ok(fiveHour.every((message) => message.options.retain));

  assert.equal(weekly.length, 3);
  assert.ok(weekly.every((message) => message.body !== ""));
  assert.equal(
    JSON.parse(weekly[0].body).value_template,
    "{{ value_json.secondary_used_percent }}",
  );
});

test("publishes discovery for both windows when both are available", async () => {
  const client = recordingClient();

  await publishDiscovery(client, config, {
    primary_used_percent: 12,
    secondary_used_percent: 34,
  });

  const usageWindows = client.messages.filter(
    (message) =>
      message.topic.includes("/primary_") ||
      message.topic.includes("/secondary_"),
  );

  assert.equal(usageWindows.length, 6);
  assert.ok(usageWindows.every((message) => message.body !== ""));
});
