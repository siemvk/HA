import { randomUUIDv7, type ServerWebSocket } from "bun";
import { timingSafeEqual } from "node:crypto";
import { ABOUT_STRING, NO_SERVER } from "./about";

type WSData = {
  id: string;
  host: boolean;
  http: boolean;
  connectionId: string;
  pass?: string;
  secret?: string;
  connected: boolean;
};

const subdomainDomains = (process.env.SUBDOMAIN_DOMAINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// none < http < socket
// socket is veiligst
type ProtectLevel = "NONE" | "HTTP" | "SOCKET";
const rawProtect = (process.env.PROTECT_LEVEL ?? "NONE").toUpperCase();
const protectLevel: ProtectLevel =
  rawProtect === "HTTP" || rawProtect === "SOCKET" ? rawProtect : "NONE";

const hostToken = process.env.SECRET;

type PendingHttp = {
  resolve: (res: Response) => void;
  rewritePrefix: string | null;
};

const serverConnection: Record<string, {
  id: string;
  socket: ServerWebSocket<WSData>;
  password?: string;
  clients: Map<string, ServerWebSocket<WSData>>;
  pendingHttp: Map<string, PendingHttp>;
  httpSupport: boolean;
  createdAt: number;
}> = {};

function closeLobby(lobbyId: string, closeHost?: { code: number; reason: string }) {
  const lobby = serverConnection[lobbyId];
  if (!lobby) return false;
  delete serverConnection[lobbyId];
  for (const client of lobby.clients.values()) client.close();
  for (const pending of lobby.pendingHttp.values()) {
    pending.resolve(new Response(NO_SERVER, { status: 502 }));
  }
  if (closeHost) lobby.socket.close(closeHost.code, closeHost.reason);
  return true;
}

function connectClient(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string) {
  const lobby = serverConnection[lobbyId];
  if (!lobby || (lobby.password && lobby.password !== pass)) return false;
  ws.data.connectionId = lobbyId;
  ws.data.connected = true;
  lobby.clients.set(ws.data.id, ws);
  lobby.socket.send(`${ws.data.id}$!TUNNEL;OPEN`);
  return true;
}

function isAuthorizedToHost(http: boolean, secret?: string): boolean {
  if (protectLevel === "NONE") return true;
  if (protectLevel === "HTTP" && !http) return true;
  if (!hostToken || !secret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(hostToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hostLobby(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string, http = false, secret?: string) {
  if (!isAuthorizedToHost(http, secret ?? ws.data.secret)) return "unauthorized";
  if (serverConnection[lobbyId]) return "exists";
  ws.data.connectionId = lobbyId;
  ws.data.host = true;
  serverConnection[lobbyId] = {
    id: lobbyId,
    password: pass || undefined,
    socket: ws,
    clients: new Map(),
    pendingHttp: new Map(),
    httpSupport: http,
    createdAt: Date.now(),
  };
  return "ok";
}

const server = Bun.serve<WSData>({
  port: Number(process.env.PORT ?? 8085),
  tls: process.env.TLS_CERT && process.env.TLS_KEY
    ? { cert: Bun.file(process.env.TLS_CERT), key: Bun.file(process.env.TLS_KEY) }
    : undefined,
  async fetch(req, server) {
    const url = new URL(req.url);
    const hostname = (req.headers.get("host") ?? url.hostname).split(":")[0]!.toLowerCase();
    const matchedBase = subdomainDomains.find((d) => hostname.endsWith(`.${d}`));
    const subdomainLobby = matchedBase ? hostname.slice(0, -(matchedBase.length + 1)) : undefined;

    const slash = url.pathname.indexOf("/", 1);
    const lobbyId = subdomainLobby ?? decodeURIComponent(slash === -1 ? url.pathname.slice(1) : url.pathname.slice(1, slash));
    const subPath = subdomainLobby
      ? url.pathname + url.search
      : (slash === -1 ? "/" : url.pathname.slice(slash)) + url.search;
    const pass = url.searchParams.get("pass") ?? url.searchParams.get("password") ?? undefined;
    const secret =
      url.searchParams.get("secret") ??
      url.searchParams.get("token") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      undefined;
    const host = url.searchParams.has("host") || url.searchParams.has("httphost");
    const http = url.searchParams.has("http") || url.searchParams.has("httphost");

    if (server.upgrade(req, {
      data: {
        id: randomUUIDv7(),
        host,
        http,
        connectionId: lobbyId,
        pass,
        secret,
        connected: false,
      },
    })) {
      return undefined;
    }

    if (!subdomainLobby && url.pathname === "/") return new Response(ABOUT_STRING);

    if (!subdomainLobby && (url.pathname === "/_tunnels" || url.pathname.startsWith("/_tunnels/"))) {
      if (!isAuthorizedToHost(true, secret)) return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/_tunnels" && req.method === "GET") {
        return Response.json(
          Object.values(serverConnection).map((l) => ({
            id: l.id,
            http: l.httpSupport,
            protected: Boolean(l.password),
            clients: l.clients.size,
            pendingHttp: l.pendingHttp.size,
            createdAt: l.createdAt,
          })),
        );
      }
      if (url.pathname.startsWith("/_tunnels/") && req.method === "DELETE") {
        const targetId = decodeURIComponent(url.pathname.slice("/_tunnels/".length));
        if (!closeLobby(targetId, { code: 1000, reason: "Closed by admin" })) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({ closed: targetId });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    const lobby = serverConnection[lobbyId];
    if (lobby?.httpSupport) {
      if (lobby.password && lobby.password !== pass) {
        return new Response("Unauthorized", { status: 401 });
      }
      const reqId = randomUUIDv7();
      const body = req.body ? Buffer.from(await req.arrayBuffer()).toString("base64") : undefined;

      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          lobby.pendingHttp.delete(reqId);
          resolve(new Response("Gateway Timeout", { status: 504 }));
        }, 30_000);

        lobby.pendingHttp.set(reqId, {
          rewritePrefix: subdomainLobby ? null : `/${encodeURIComponent(lobbyId)}`,
          resolve: (res) => {
            clearTimeout(timer);
            resolve(res);
          },
        });

        lobby.socket.send(
          `${reqId}$!TUNNEL;HTTP;${JSON.stringify({
            method: req.method,
            path: subPath,
            headers: Object.fromEntries(req.headers),
            body,
            isBase64: body !== undefined,
          })}`,
        );
      });
    }

    return new Response(NO_SERVER, { status: 404 });
  },
  websocket: {
    open(ws) {
      const { connectionId, pass, host, http } = ws.data;
      console.log("connection made at", connectionId || "/");
      if (!connectionId) return;

      if (host) {
        const res = hostLobby(ws, connectionId, pass, http);
        if (res === "unauthorized") ws.close(1008, "Unauthorized");
        else if (res === "exists") ws.close(1008, "Lobby already hosted");
      } else {
        if (!connectClient(ws, connectionId, pass)) {
          ws.close(1008, "Invalid lobby or password");
        }
      }
    },
    message(ws, raw) {
      const msg = raw.toString();

      if (msg.startsWith("!TUNNEL")) {
        const [, command, lobbyId, pass, secret] = msg.split(";");
        if (!lobbyId) return;

        if (command === "CONNECT") {
          connectClient(ws, lobbyId, pass);
        } else if (command === "HOST" || command === "HTTPHOST") {
          if (hostLobby(ws, lobbyId, pass, command === "HTTPHOST", secret) === "unauthorized") {
            ws.close(1008, "Unauthorized");
          }
        }
        return;
      }

      const lobby = serverConnection[ws.data.connectionId];
      if (!lobby) {
        ws.close();
        return;
      }

      if (ws.data.host) {
        const sep = msg.indexOf("$");
        if (sep === -1) return;
        const id = msg.slice(0, sep);
        const payload = msg.slice(sep + 1);

        const pending = lobby.pendingHttp.get(id);
        if (pending) {
          lobby.pendingHttp.delete(id);
          const { resolve: resolveHttp, rewritePrefix: prefix } = pending;
          try {
            const { status = 200, headers, body = "", isBase64 } = JSON.parse(payload);
            const resHeaders = new Headers(headers);

            if (prefix) {
              const loc = resHeaders.get("location");
              if (loc && loc.startsWith("/") && !loc.startsWith("//")) {
                resHeaders.set("location", `${prefix}${loc}`);
              }

              const cookies = resHeaders.getSetCookie();
              if (cookies.length) {
                resHeaders.delete("set-cookie");
                for (const c of cookies) {
                  const cleaned = c.replace(/;\s*Domain=[^;]*/gi, "");
                  const scoped = /;\s*Path=/i.test(cleaned)
                    ? cleaned.replace(/(;\s*Path=)\/?/i, `$1${prefix}/`)
                    : `${cleaned}; Path=${prefix}`;
                  resHeaders.append("set-cookie", scoped);
                }
              }

              const ct = resHeaders.get("content-type") ?? "";
              if (ct.includes("text/html") || ct.includes("text/css")) {
                let text = isBase64 ? Buffer.from(body, "base64").toString("utf8") : String(body);
                if (ct.includes("text/html")) {
                  text = text.replace(/\b(href|src|action|poster)=(["'])\/(?!\/)/gi, `$1=$2${prefix}/`);
                }
                text = text.replace(/url\((["']?)\/(?!\/)/gi, `url($1${prefix}/`);
                resHeaders.delete("content-length");
                resolveHttp(new Response(text, { status, headers: resHeaders }));
                return;
              }
            }

            resolveHttp(new Response(isBase64 ? Buffer.from(body, "base64") : body, { status, headers: resHeaders }));
          } catch {
            resolveHttp(new Response(payload));
          }
          return;
        }

        const client = lobby.clients.get(id);
        if (!client) return;
        if (payload === "!TUNNEL;CLOSE") {
          lobby.clients.delete(client.data.id);
          client.close();
          return;
        }
        client.send(payload);
      } else if (ws.data.connected) {
        lobby.socket.send(`${ws.data.id}$${msg}`);
      }
    },
    close(ws) {
      const lobby = serverConnection[ws.data.connectionId];
      if (!lobby) return;
      if (ws.data.host) {
        closeLobby(ws.data.connectionId);
      } else if (ws.data.connected) {
        if (lobby.clients.delete(ws.data.id)) {
          lobby.socket.send(`${ws.data.id}$!TUNNEL;CLOSE`);
        }
      }
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
