import { parseArgs } from "node:util";

export async function handleHttpTunnelRequest(
  ws: WebSocket,
  id: string,
  jsonPayload: string,
  target: string,
): Promise<void> {
  try {
    const { method, path, headers = {}, body, isBase64 } = JSON.parse(jsonPayload);
    delete headers.host;
    delete headers["content-length"];

    const res = await fetch(new URL(path, target), {
      method,
      headers,
      body: body ? (isBase64 ? Buffer.from(body, "base64") : body) : undefined,
      redirect: "manual",
    });

    const resHeaders = Array.from(res.headers.entries()).filter(
      ([k]) => k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding",
    );
    const resBody = Buffer.from(await res.arrayBuffer()).toString("base64");
    ws.send(`${id}$${JSON.stringify({
      status: res.status,
      headers: resHeaders,
      body: resBody,
      isBase64: true,
    })}`);
  } catch (err) {
    ws.send(`${id}$${JSON.stringify({ status: 502, body: `Bad Gateway: ${err}` })}`);
  }
}

export function forwardHttp(target: string, tunnelUrl: string): WebSocket {
  const url = new URL(tunnelUrl);
  if (!url.searchParams.has("httphost") && !url.searchParams.has("host")) {
    url.searchParams.set("httphost", "1");
  }

  const ws = new WebSocket(url.toString());

  ws.onopen = () => console.log(`Forwarding ${url.origin}${url.pathname} -> ${target}`);
  ws.onclose = (e) => console.log(`Tunnel closed (${e.code} ${e.reason})`);
  ws.onerror = (e) => console.error("Tunnel error:", e);

  ws.onmessage = (e) => {
    const raw = String(e.data);
    const sep = raw.indexOf("$");
    if (sep === -1) return;

    const id = raw.slice(0, sep);
    const payload = raw.slice(sep + 1);
    if (!payload.startsWith("!TUNNEL;HTTP;")) return;

    void handleHttpTunnelRequest(ws, id, payload.slice("!TUNNEL;HTTP;".length), target);
  };

  return ws;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "wss://tunnel.siemvk.nl" },
      lobby: { type: "string" },
      local: { type: "string" },
      pass: { type: "string" },
      secret: { type: "string", default: process.env.SECRET },
    },
  });

  if (!values.lobby || !values.local) {
    console.error("Usage: bun run src/http.ts --lobby <name> --local <host:port> [--url <tunnel-ws-url>] [--pass <password>] [--secret <token>]");
    process.exit(1);
  }

  const target = /^https?:\/\//.test(values.local) ? values.local : `http://${values.local}`;
  const tunnel = new URL(values.url);
  tunnel.pathname = `/${encodeURIComponent(values.lobby)}`;
  if (values.pass) tunnel.searchParams.set("pass", values.pass);
  if (values.secret) tunnel.searchParams.set("secret", values.secret);

  forwardHttp(target, tunnel.toString());
}
