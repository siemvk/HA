import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { handleHttpTunnelRequest } from "./http";

function readConfigFile(name: string): string | undefined {
  try {
    return readFileSync(join(homedir(), ".config", "svk-tunnels", name), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function loadDefaultSecret(): string | undefined {
  return process.env.SECRET || readConfigFile("secret");
}

function readDomains(name: string): string[] {
  const raw = readConfigFile(name);
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"))
    .map((s) => s.replace(/^(wss?|https?):\/\//, "").replace(/\/+$/, ""));
}

function getPublicLinks(tunnelBase: string, lobby: string, hasWs: boolean, hasHttp: boolean): string[] {
  const secure = new URL(tunnelBase).protocol === "wss:";
  const protos = [
    hasHttp && (secure ? "https:" : "http:"),
    hasWs && (secure ? "wss:" : "ws:"),
  ].filter(Boolean) as string[];
  const encoded = encodeURIComponent(lobby);

  const subs = readDomains("subdomaineddomains");
  if (subs.length) return subs.flatMap((d) => protos.map((p) => `${p}//${lobby}.${d}`));
  return readDomains("patheddomains").flatMap((d) => protos.map((p) => `${p}//${d}/${encoded}`));
}

function withScheme(raw: string, scheme: "ws" | "http"): string {
  return /^(wss?|https?):\/\//.test(raw) ? raw : `${scheme}://${raw}`;
}

function buildTunnelUrl(
  base: string,
  lobby: string,
  opts: { pass?: string; secret?: string; mode?: "host" | "httphost" },
): string {
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(lobby)}`;
  if (opts.pass) url.searchParams.set("pass", opts.pass);
  if (opts.secret) url.searchParams.set("secret", opts.secret);
  if (opts.mode) url.searchParams.set(opts.mode, "1");
  return url.toString();
}

export function startHostBridge(opts: {
  tunnelUrl: string;
  wsTarget?: string;
  httpTarget?: string;
  links?: string[];
}): WebSocket {
  const tunnel = new WebSocket(opts.tunnelUrl);
  const clients = new Map<string, { ws: WebSocket; queue: string[] }>();

  tunnel.onopen = () => {
    const targets = [
      opts.wsTarget && `ws->${opts.wsTarget}`,
      opts.httpTarget && `http->${opts.httpTarget}`,
    ].filter(Boolean).join(", ");
    console.log(`Host bridge connected (${targets})`);
    for (const link of opts.links ?? []) console.log(`  -> ${link}`);
  };

  tunnel.onmessage = (e) => {
    const raw = String(e.data);
    const sep = raw.indexOf("$");
    if (sep === -1) return;

    const id = raw.slice(0, sep);
    const payload = raw.slice(sep + 1);

    if (opts.httpTarget && payload.startsWith("!TUNNEL;HTTP;")) {
      void handleHttpTunnelRequest(tunnel, id, payload.slice("!TUNNEL;HTTP;".length), opts.httpTarget);
      return;
    }

    if (!opts.wsTarget) return;

    if (payload === "!TUNNEL;OPEN") {
      const local = new WebSocket(opts.wsTarget);
      const entry = { ws: local, queue: [] as string[] };
      clients.set(id, entry);

      local.onopen = () => {
        for (const msg of entry.queue) local.send(msg);
        entry.queue.length = 0;
      };
      local.onmessage = (ev) => {
        if (tunnel.readyState !== WebSocket.OPEN) return;
        const data = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString();
        tunnel.send(`${id}$${data}`);
      };
      local.onclose = () => {
        if (!clients.delete(id)) return;
        if (tunnel.readyState === WebSocket.OPEN) tunnel.send(`${id}$!TUNNEL;CLOSE`);
      };
      local.onerror = () => local.close();
      return;
    }

    const entry = clients.get(id);
    if (!entry) return;

    if (payload === "!TUNNEL;CLOSE") {
      clients.delete(id);
      entry.ws.close();
      return;
    }

    if (entry.ws.readyState === WebSocket.OPEN) entry.ws.send(payload);
    else if (entry.ws.readyState === WebSocket.CONNECTING) entry.queue.push(payload);
  };

  tunnel.onclose = (e) => {
    for (const entry of clients.values()) entry.ws.close();
    clients.clear();
    console.log(`Host tunnel closed (${e.code} ${e.reason})`);
  };
  tunnel.onerror = (e) => console.error("Host tunnel error:", e);

  return tunnel;
}

export function startClientBridge(opts: { tunnelUrl: string; listen: string }) {
  const [hostPart, portPart] = opts.listen.includes(":")
    ? opts.listen.split(":")
    : ["127.0.0.1", opts.listen];
  const hostname = hostPart || "127.0.0.1";
  const port = Number(portPart);

  const server = Bun.serve<{ remote: WebSocket; queue: (string | Buffer)[] }>({
    hostname,
    port,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { remote: null as unknown as WebSocket, queue: [] } })) {
        return undefined;
      }
      return new Response("ws-tunnel client bridge");
    },
    websocket: {
      open(ws) {
        const remote = new WebSocket(opts.tunnelUrl);
        ws.data.remote = remote;

        remote.onopen = () => {
          for (const msg of ws.data.queue) remote.send(msg);
          ws.data.queue.length = 0;
        };
        remote.onmessage = (ev) => {
          if (ws.readyState === 1) ws.send(ev.data);
        };
        remote.onclose = () => ws.close();
        remote.onerror = () => ws.close();
      },
      message(ws, msg) {
        const data = typeof msg === "string" ? msg : Buffer.from(msg);
        if (ws.data.remote.readyState === WebSocket.OPEN) ws.data.remote.send(data);
        else if (ws.data.remote.readyState === WebSocket.CONNECTING) ws.data.queue.push(data);
      },
      close(ws) {
        ws.data.remote.close();
      },
    },
  });

  console.log(`Client bridge listening on ws://${server.hostname}:${server.port} -> ${opts.tunnelUrl}`);
  return server;
}

type BindingInfo = {
  id: string;
  owner: string;
  http: boolean;
  protected: boolean;
  clients: number;
  pendingHttp: number;
  createdAt: number;
};

type UserInfo = {
  name: string;
  privileges: string[];
  blocked: boolean;
  hasPassword?: boolean;
  createdAt: number;
  token?: string;
};

function toHttpUrl(base: string, pathAndQuery: string): string {
  const url = new URL(base);
  url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
  const q = pathAndQuery.indexOf("?");
  url.pathname = q === -1 ? pathAndQuery : pathAndQuery.slice(0, q);
  url.search = q === -1 ? "" : pathAndQuery.slice(q);
  return url.toString();
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

async function manageFetch(base: string, path: string, secret?: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(toHttpUrl(base, path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.error(`${res.status} ${res.statusText}: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

function printBindings(base: string, rows: BindingInfo[]) {
  if (!rows.length) {
    console.log("No active bindings.");
    return;
  }
  const now = Date.now();
  console.table(
    rows.map((r) => ({
      lobby: r.id,
      owner: r.owner,
      type: r.http ? "http+ws" : "ws",
      clients: r.clients,
      pendingHttp: r.pendingHttp,
      auth: r.protected ? "pass" : "open",
      uptime: formatAge(now - r.createdAt),
      link: getPublicLinks(base, r.id, !r.http, r.http)[0] ?? "",
    })),
  );
}

const HELP_TUNNEL = `Usage: bun run src/bridge.ts tunnel --lobby <name> [options]

Options:
  -l, --lobby <name>        Tunnel lobby name (required)
      --ws <host:port>      Bridge a local WebSocket server to the tunnel
      --http <host:port>    Forward HTTP requests from the tunnel to a local server
      --connect <[h:]port>  Listen locally and bridge WS clients to a remote tunnel host
  -u, --url <url>           Tunnel server URL (default: wss://tunnel.siemvk.nl)
  -p, --pass <password>     Lobby password
  -s, --secret <token>      Host secret (default: $SECRET or ~/.config/svk-tunnels/secret)
  -h, --help                Show this help

Examples:
  bun run src/bridge.ts tunnel -l app --http localhost:3000 --ws localhost:3000
  bun run src/bridge.ts tunnel -l app --connect 8080`;

const HELP_MANAGE = `Usage: bun run src/bridge.ts manage <subcommand> [options]

Subcommands:
  list, ls                          List active bindings (default)
  watch                             Live-refresh active bindings
  close <lobby> [--cooldown <s>]    Force-stop a binding (default cooldown: 60s)
  users                             List user accounts
  user add <name> [--priv ws,http] [--token <t>] [--password <pw>]
  user pass <name> <password>       Set/update user password (for Basic Auth)
  user block|unblock <name>         Block/unblock user (closes their tunnels)
  user logout <name>                Rotate user token & close their tunnels
  user priv <name> <ws,http,forceview,admin>  Update user privileges
  user rm <name>                    Delete user

Options:
  -u, --url <url>                   Tunnel server URL (default: wss://tunnel.siemvk.nl)
  -s, --secret <token>              Admin/host secret (default: $SECRET or ~/.config/svk-tunnels/secret)
      --priv <list>                 Comma-separated privileges: ws,http,forceview,admin
      --token <token>               Explicit token for user add
      --password <pw>               Password for user add/pass
      --cooldown <sec>              Re-host cooldown seconds on close (default: 60)
      --json                        Output raw JSON (list/ls/users)
      --interval <ms>               Refresh interval for watch (default: 2000)
  -h, --help                        Show this help`;

const HELP_MAIN = `Usage: bun run src/bridge.ts <command> [options]

Commands:
  tunnel                    Host local WS/HTTP services or connect local clients
  manage                    List, watch, or close active server bindings

Config (~/.config/svk-tunnels/):
  secret                    Default host/admin secret
  subdomaineddomains        Domains formatted as <lobby>.<domain>
  patheddomains             Domains formatted as <domain>/<lobby>

Run "<command> --help" for command options.`;

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP_MAIN);
    process.exit(0);
  }
  if (cmd !== "tunnel" && cmd !== "manage") {
    console.error(`Unknown command: ${cmd}\n\n${HELP_MAIN}`);
    process.exit(1);
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      url: { type: "string", short: "u", default: "wss://tunnel.siemvk.nl" },
      lobby: { type: "string", short: "l" },
      ws: { type: "string" },
      http: { type: "string" },
      connect: { type: "string" },
      pass: { type: "string", short: "p" },
      secret: { type: "string", short: "s" },
      json: { type: "boolean", default: false },
      interval: { type: "string", default: "2000" },
      priv: { type: "string" },
      token: { type: "string" },
      password: { type: "string" },
      cooldown: { type: "string" },
    },
  });

  if (values.help) {
    console.log(cmd === "tunnel" ? HELP_TUNNEL : HELP_MANAGE);
    process.exit(0);
  }

  const secret = values.secret ?? loadDefaultSecret();

  if (cmd === "tunnel") {
    if (!values.lobby || (!values.ws && !values.http && !values.connect)) {
      console.error(HELP_TUNNEL);
      process.exit(1);
    }

    if (values.ws || values.http) {
      const tunnelUrl = buildTunnelUrl(values.url, values.lobby, {
        pass: values.pass,
        secret,
        mode: values.http ? "httphost" : "host",
      });
      startHostBridge({
        tunnelUrl,
        wsTarget: values.ws ? withScheme(values.ws, "ws") : undefined,
        httpTarget: values.http ? withScheme(values.http, "http") : undefined,
        links: getPublicLinks(values.url, values.lobby, Boolean(values.ws), Boolean(values.http)),
      });
    }

    if (values.connect) {
      const tunnelUrl = buildTunnelUrl(values.url, values.lobby, { pass: values.pass });
      startClientBridge({ tunnelUrl, listen: values.connect });
    }
  } else {
    const [sub = "list", arg] = positionals;
    if (sub === "list" || sub === "ls") {
      const rows = (await manageFetch(values.url, "/_tunnels", secret)) as BindingInfo[];
      if (values.json) console.log(JSON.stringify(rows, null, 2));
      else printBindings(values.url, rows);
    } else if (sub === "watch") {
      const ms = Math.max(250, Number(values.interval) || 2000);
      const tick = async () => {
        const rows = (await manageFetch(values.url, "/_tunnels", secret)) as BindingInfo[];
        console.clear();
        console.log(`${new Date().toLocaleTimeString()} — ${values.url}`);
        printBindings(values.url, rows);
      };
      await tick();
      setInterval(() => void tick(), ms);
    } else if (sub === "close") {
      const target = arg ?? values.lobby;
      if (!target) {
        console.error("Usage: bun run src/bridge.ts manage close <lobby> [--cooldown <sec>]");
        process.exit(1);
      }
      const q = values.cooldown !== undefined ? `?cooldown=${encodeURIComponent(values.cooldown)}` : "";
      const res = (await manageFetch(values.url, `/_tunnels/${encodeURIComponent(target)}${q}`, secret, "DELETE")) as {
        closed: string;
        cooldownSec: number;
      };
      console.log(`Closed ${res.closed} (cooldown: ${res.cooldownSec}s)`);
    } else if (sub === "users") {
      const rows = (await manageFetch(values.url, "/_users", secret)) as UserInfo[];
      if (values.json) console.log(JSON.stringify(rows, null, 2));
      else if (!rows.length) console.log("No users.");
      else console.table(rows.map((u) => ({ name: u.name, privileges: u.privileges.join(","), password: Boolean(u.hasPassword), blocked: u.blocked })));
    } else if (sub === "user") {
      const [, action, name, extra] = positionals;
      if (!action || !name) {
        console.error(HELP_MANAGE);
        process.exit(1);
      }
      const enc = encodeURIComponent(name);
      if (action === "add") {
        const privileges = (values.priv ?? "ws,http").split(",").map((s) => s.trim()).filter(Boolean);
        const created = (await manageFetch(values.url, "/_users", secret, "POST", {
          name,
          token: values.token,
          password: values.password,
          privileges,
        })) as UserInfo;
        console.log(JSON.stringify(created, null, 2));
      } else if (action === "pass") {
        const password = extra ?? values.password ?? "";
        const updated = await manageFetch(values.url, `/_users/${enc}`, secret, "PATCH", { password });
        console.log(JSON.stringify(updated));
      } else if (action === "logout") {
        const res = await manageFetch(values.url, `/_users/${enc}/logout`, secret, "POST");
        console.log(JSON.stringify(res, null, 2));
      } else if (action === "block" || action === "unblock") {
        const updated = await manageFetch(values.url, `/_users/${enc}`, secret, "PATCH", { blocked: action === "block" });
        console.log(JSON.stringify(updated));
      } else if (action === "priv") {
        const privileges = (extra ?? values.priv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const updated = await manageFetch(values.url, `/_users/${enc}`, secret, "PATCH", { privileges });
        console.log(JSON.stringify(updated));
      } else if (action === "rm") {
        const res = await manageFetch(values.url, `/_users/${enc}`, secret, "DELETE");
        console.log(JSON.stringify(res));
      } else {
        console.error(HELP_MANAGE);
        process.exit(1);
      }
    } else {
      console.error(HELP_MANAGE);
      process.exit(1);
    }
  }
}
