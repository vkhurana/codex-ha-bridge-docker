import { SimpleMqttClient } from "./simpleMqtt.js";

const SENSOR_DEFS = [
  ["primary_used_percent", "Used", "%", "mdi:timer-sand", "primary"],
  [
    "primary_remaining_percent",
    "Remaining",
    "%",
    "mdi:timer-outline",
    "primary",
  ],
  [
    "primary_reset_time",
    "Reset",
    null,
    "mdi:clock-outline",
    "primary",
  ],
  [
    "secondary_used_percent",
    "Used",
    "%",
    "mdi:calendar-week",
    "secondary",
  ],
  [
    "secondary_remaining_percent",
    "Remaining",
    "%",
    "mdi:calendar-check",
    "secondary",
  ],
  [
    "secondary_reset_time",
    "Reset",
    null,
    "mdi:calendar-clock",
    "secondary",
  ],
  ["credits_balance", "Codex Credits", "credits", "mdi:cash"],
  ["plan", "Codex Plan", null, "mdi:account-badge"],
  ["rate_limit_reached_type", "Codex Limit Status", null, "mdi:alert-circle"],
];

function windowLabel(state, windowName) {
  return state?.[`${windowName}_window_label`] ||
    (windowName === "primary" ? "Primary" : "Secondary");
}

export function createMqttClient(config) {
  return new SimpleMqttClient(config.url, {
    username: config.username,
    password: config.password,
  });
}

function discoveryTopic(config, key) {
  return `${config.mqtt.discoveryPrefix}/sensor/${config.device.id}/${key}/config`;
}

function stateTopic(config) {
  return `${config.mqtt.baseTopic}/state`;
}

function availabilityTopic(config) {
  return `${config.mqtt.baseTopic}/availability`;
}

function hasUsageWindow(state, windowName) {
  if (!windowName) return true;
  return state?.[`${windowName}_used_percent`] != null;
}

export async function publishDiscovery(client, config, state) {
  const device = {
    identifiers: [config.device.id],
    name: config.device.name,
    manufacturer: "OpenAI",
    model: "Codex Usage Bridge",
  };

  for (const [key, suffix, unit, icon, windowName] of SENSOR_DEFS) {
    const topic = discoveryTopic(config, key);
    if (!hasUsageWindow(state, windowName)) {
      await publish(client, topic, "", true);
      continue;
    }

    const payload = {
      name: windowName
        ? `Codex ${windowLabel(state, windowName)} ${suffix}`
        : `Codex ${suffix}`,
      unique_id: `${config.device.id}_${key}`,
      state_topic: stateTopic(config),
      availability_topic: availabilityTopic(config),
      value_template: `{{ value_json.${key} }}`,
      json_attributes_topic: stateTopic(config),
      device,
      icon,
    };

    if (unit) payload.unit_of_measurement = unit;

    await publish(client, topic, payload, true);
  }
}

export async function publishAvailability(client, config, status) {
  await publish(client, availabilityTopic(config), status, true);
}

export async function publishState(client, config, state) {
  await publish(client, stateTopic(config), state, true);
}

function publish(client, topic, payload, retain = false) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    client.publish(topic, body, { qos: 0, retain }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
