// Talks to a Netlify Function (see netlify/functions/kv.js) which reads and
// writes to Netlify Blobs — Netlify's own built-in key-value storage.
// No external service, no extra account: it's all inside Netlify.
const API = "/api/kv";

export const storage = {
  async get(key) {
    const res = await fetch(`${API}?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("Failed to load " + key);
    const data = await res.json();
    if (data.value === null || data.value === undefined) return null;
    return { key, value: data.value };
  },
  async set(key, value) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error("Failed to save " + key);
    return { key, value };
  },
};
