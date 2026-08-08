import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("wastage_store");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "key is required" }), { status: 400 });
    }
    const value = await store.get(key);
    return new Response(JSON.stringify({ value: value === null ? null : value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
    }
    if (!body.key) {
      return new Response(JSON.stringify({ error: "key is required" }), { status: 400 });
    }
    await store.set(body.key, body.value);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/kv" };
