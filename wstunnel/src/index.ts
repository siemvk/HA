import { randomUUIDv7, type ServerWebSocket } from "bun";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const defaultCooldownMs = Number(process.env.FORCE_STOP_COOLDOWN_MS ?? 60_000);

type Privilege = "ws" | "http" | "forceview" | "admin";
type User = {
  name: string;
  token: string;
  passwordHash?: string;
  privileges: Privilege[];
  blocked: boolean;
  createdAt: number;
};

const usersFile = process.env.USERS_FILE ?? (existsSync("/data") ? "/data/users.json" : "users.json");
const users = new Map<string, User>();
try {
  if (existsSync(usersFile)) {
    for (const u of JSON.parse(readFileSync(usersFile, "utf8")) as User[]) {
      users.set(u.name, u);
    }
  }
} catch {}

function saveUsers() {
  writeFileSync(usersFile, JSON.stringify([...users.values()], null, 2));
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

type PendingHttp = {
  resolve: (res: Response) => void;
  rewritePrefix: string | null;
};

const cooldowns = new Map<string, number>();

const serverConnection: Record<string, {
  id: string;
  owner: string;
  socket: ServerWebSocket<WSData>;
  password?: string;
  clients: Map<string, ServerWebSocket<WSData>>;
  pendingHttp: Map<string, PendingHttp>;
  httpSupport: boolean;
  createdAt: number;
}> = {};

function closeLobby(lobbyId: string, closeHost?: { code: number; reason: string }, cooldownMs = 0) {
  const lobby = serverConnection[lobbyId];
  if (!lobby) return false;
  delete serverConnection[lobbyId];
  if (cooldownMs > 0) cooldowns.set(lobbyId, Date.now() + cooldownMs);
  for (const client of lobby.clients.values()) client.close();
  for (const pending of lobby.pendingHttp.values()) {
    pending.resolve(new Response(NO_SERVER, { status: 502 }));
  }
  if (closeHost) lobby.socket.close(closeHost.code, closeHost.reason);
  return true;
}

function closeUserLobbies(owner: string, reason: string) {
  for (const l of Object.values(serverConnection)) {
    if (l.owner === owner) closeLobby(l.id, { code: 1008, reason }, defaultCooldownMs);
  }
}

function connectClient(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string) {
  const lobby = serverConnection[lobbyId];
  if (!lobby || (lobby.password && (!pass || !safeEqual(pass, lobby.password)))) return false;
  ws.data.connectionId = lobbyId;
  ws.data.connected = true;
  lobby.clients.set(ws.data.id, ws);
  lobby.socket.send(`${ws.data.id}$!TUNNEL;OPEN`);
  return true;
}

type Actor = { name: string; privileges: Set<Privilege>; isRoot: boolean };

function resolveActor(secret?: string): Actor | "blocked" | null {
  if (hostToken && secret && safeEqual(secret, hostToken)) {
    return { name: "root", privileges: new Set<Privilege>(["ws", "http", "admin"]), isRoot: true };
  }
  if (secret) {
    for (const u of users.values()) {
      if (safeEqual(secret, u.token)) {
        return u.blocked ? "blocked" : { name: u.name, privileges: new Set(u.privileges), isRoot: false };
      }
    }
  }
  return null;
}

function resolveBasicUser(basicDecoded?: string): Actor | "blocked" | null {
  if (!basicDecoded) return null;
  const colon = basicDecoded.indexOf(":");
  if (colon === -1) return null;
  const u = users.get(basicDecoded.slice(0, colon));
  if (!u?.passwordHash || !Bun.password.verifySync(basicDecoded.slice(colon + 1), u.passwordHash)) return null;
  return u.blocked ? "blocked" : { name: u.name, privileges: new Set(u.privileges), isRoot: false };
}

function canForceView(secret?: string, basicDecoded?: string): boolean {
  for (const actor of [resolveActor(secret), resolveBasicUser(basicDecoded)]) {
    if (actor && actor !== "blocked" && (actor.isRoot || actor.privileges.has("admin") || actor.privileges.has("forceview"))) {
      return true;
    }
  }
  return false;
}

function authorizeHost(http: boolean, secret?: string): Actor | null {
  const actor = resolveActor(secret);
  if (actor === "blocked") return null;
  if (actor) {
    if (actor.isRoot || actor.privileges.has("admin")) return actor;
    if (http ? actor.privileges.has("http") : actor.privileges.has("ws")) return actor;
    return null;
  }
  if (secret) return null;
  if (protectLevel === "NONE" || (protectLevel === "HTTP" && !http)) {
    return { name: "anonymous", privileges: new Set<Privilege>(["ws", "http"]), isRoot: false };
  }
  return null;
}

function canManage(secret: string | undefined, mode: "view" | "admin"): Actor | null {
  const actor = resolveActor(secret);
  if (actor === "blocked") return null;
  if (actor) {
    if (actor.isRoot || actor.privileges.has("admin")) return actor;
    if (mode === "view" && (actor.privileges.has("ws") || actor.privileges.has("http"))) return actor;
    return null;
  }
  if (!secret && !hostToken && protectLevel === "NONE") {
    return { name: "root", privileges: new Set<Privilege>(["ws", "http", "admin"]), isRoot: true };
  }
  return null;
}

function hostLobby(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string, http = false, secret?: string) {
  const actor = authorizeHost(http, secret ?? ws.data.secret);
  if (!actor) return "unauthorized";
  const until = cooldowns.get(lobbyId);
  if (until && until > Date.now()) return "cooldown";
  cooldowns.delete(lobbyId);
  if (serverConnection[lobbyId]) return "exists";
  ws.data.connectionId = lobbyId;
  ws.data.host = true;
  serverConnection[lobbyId] = {
    id: lobbyId,
    owner: actor.name,
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
    const queryPass = url.searchParams.get("pass") ?? url.searchParams.get("password") ?? undefined;
    const rawCookie = req.headers.get("cookie");
    const cookiePass = rawCookie?.match(/(?:^|;\s*)__tunnel_pass=([^;]+)/)?.[1];
    const cookieSecret = rawCookie?.match(/(?:^|;\s*)__tunnel_secret=([^;]+)/)?.[1];
    const authHeader = req.headers.get("authorization");
    const basicRaw = authHeader?.match(/^Basic\s+(.+)/i)?.[1];
    const basicDecoded = basicRaw ? Buffer.from(basicRaw, "base64").toString("utf8") : undefined;
    const basicPass = basicDecoded?.includes(":") ? basicDecoded.slice(basicDecoded.indexOf(":") + 1) : undefined;
    const pass = queryPass ?? (cookiePass ? decodeURIComponent(cookiePass) : undefined) ?? basicPass;
    const querySecret = url.searchParams.get("secret") ?? url.searchParams.get("token") ?? undefined;
    const secret =
      querySecret ??
      authHeader?.match(/^Bearer\s+(.+)/i)?.[1] ??
      (cookieSecret ? decodeURIComponent(cookieSecret) : undefined);
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
      if (url.pathname === "/_tunnels" && req.method === "GET") {
        if (!canManage(secret, "view")) return new Response("Unauthorized", { status: 401 });
        return Response.json(
          Object.values(serverConnection).map((l) => ({
            id: l.id,
            owner: l.owner,
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
        const target = serverConnection[targetId];
        const actor = canManage(secret, "view");
        if (!actor || (target && !actor.isRoot && !actor.privileges.has("admin") && target.owner !== actor.name)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const cooldownParam = url.searchParams.get("cooldown");
        const cooldownMs = cooldownParam !== null ? Math.max(0, Number(cooldownParam) || 0) * 1000 : defaultCooldownMs;
        if (!closeLobby(targetId, { code: 1000, reason: "Closed by admin" }, cooldownMs)) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({ closed: targetId, cooldownSec: Math.round(cooldownMs / 1000) });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!subdomainLobby && (url.pathname === "/_users" || url.pathname.startsWith("/_users/"))) {
      if (!canManage(secret, "admin")) return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/_users" && req.method === "GET") {
        return Response.json(
          [...users.values()].map(({ name, privileges, blocked, passwordHash, createdAt }) => ({
            name,
            privileges,
            blocked,
            hasPassword: Boolean(passwordHash),
            createdAt,
          })),
        );
      }
      if (url.pathname === "/_users" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as Partial<User> & { password?: string };
        const name = body.name?.trim();
        if (!name) return new Response("Missing name", { status: 400 });
        const user: User = {
          name,
          token: body.token?.trim() || randomBytes(24).toString("hex"),
          passwordHash: body.password ? Bun.password.hashSync(body.password) : users.get(name)?.passwordHash,
          privileges: Array.isArray(body.privileges) ? body.privileges : ["ws", "http"],
          blocked: Boolean(body.blocked),
          createdAt: users.get(name)?.createdAt ?? Date.now(),
        };
        users.set(name, user);
        saveUsers();
        if (user.blocked) closeUserLobbies(name, "User blocked");
        return Response.json(
          { name: user.name, token: user.token, privileges: user.privileges, blocked: user.blocked, hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt },
          { status: 201 },
        );
      }
      if (url.pathname.startsWith("/_users/")) {
        const rest = url.pathname.slice("/_users/".length);
        const isLogout = rest.endsWith("/logout");
        const name = decodeURIComponent(isLogout ? rest.slice(0, -"/logout".length) : rest);
        const user = users.get(name);
        if (!user) return new Response("Not Found", { status: 404 });
        if (isLogout && req.method === "POST") {
          user.token = randomBytes(24).toString("hex");
          saveUsers();
          closeUserLobbies(name, "User logged out");
          return Response.json({ name: user.name, token: user.token, loggedOut: true });
        }
        if (req.method === "PATCH") {
          const body = (await req.json().catch(() => ({}))) as Partial<User> & { password?: string };
          if (Array.isArray(body.privileges)) user.privileges = body.privileges;
          if (typeof body.blocked === "boolean") user.blocked = body.blocked;
          if (typeof body.token === "string" && body.token.trim()) user.token = body.token.trim();
          if (typeof body.password === "string") {
            user.passwordHash = body.password ? Bun.password.hashSync(body.password) : undefined;
          }
          saveUsers();
          if (user.blocked) closeUserLobbies(name, "User blocked");
          return Response.json({ name: user.name, privileges: user.privileges, blocked: user.blocked, hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt });
        }
        if (req.method === "DELETE") {
          users.delete(name);
          saveUsers();
          closeUserLobbies(name, "User deleted");
          return Response.json({ deleted: name });
        }
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    const lobby = serverConnection[lobbyId];
    if (url.pathname === "/_logout" || (lobby?.httpSupport && subPath.split("?")[0] === "/_logout")) {
      const cookiePath = subdomainLobby || !lobby ? "/" : `/${encodeURIComponent(lobbyId)}`;
      const headers = new Headers({ "www-authenticate": 'Basic realm="Tunnel"' });
      headers.append("set-cookie", `__tunnel_pass=; Path=${cookiePath}; Max-Age=0; HttpOnly; SameSite=Lax`);
      headers.append("set-cookie", `__tunnel_secret=; Path=${cookiePath}; Max-Age=0; HttpOnly; SameSite=Lax`);
      return new Response("Logged out", { status: 401, headers });
    }
    if (lobby?.httpSupport) {
      const hasPass = Boolean(pass && lobby.password && safeEqual(pass, lobby.password));
      const forceViewed = Boolean(lobby.password && !hasPass && canForceView(secret, basicDecoded));
      if (lobby.password && !hasPass && !forceViewed) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "www-authenticate": 'Basic realm="Tunnel"' },
        });
      }
      const reqId = randomUUIDv7();
      const body = req.body ? Buffer.from(await req.arrayBuffer()).toString("base64") : undefined;

      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => {
          lobby.pendingHttp.delete(reqId);
          resolve(new Response("Gateway Timeout", { status: 504 }));
        }, 30_000);

        const cookiePath = subdomainLobby ? "/" : `/${encodeURIComponent(lobbyId)}`;
        lobby.pendingHttp.set(reqId, {
          rewritePrefix: subdomainLobby ? null : cookiePath,
          resolve: (res) => {
            clearTimeout(timer);
            if (queryPass || (forceViewed && querySecret)) {
              const headers = new Headers(res.headers);
              if (queryPass) headers.append("set-cookie", `__tunnel_pass=${encodeURIComponent(queryPass)}; Path=${cookiePath}; HttpOnly; SameSite=Lax`);
              if (forceViewed && querySecret) headers.append("set-cookie", `__tunnel_secret=${encodeURIComponent(querySecret)}; Path=${cookiePath}; HttpOnly; SameSite=Lax`);
              resolve(new Response(res.body, { status: res.status, headers }));
            } else {
              resolve(res);
            }
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
        else if (res === "cooldown") ws.close(1008, "Lobby in cooldown after force stop");
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
          const res = hostLobby(ws, lobbyId, pass, command === "HTTPHOST", secret);
          if (res === "unauthorized") ws.close(1008, "Unauthorized");
          else if (res === "cooldown") ws.close(1008, "Lobby in cooldown after force stop");
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
