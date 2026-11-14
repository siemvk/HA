import { randomUUIDv7, type ServerWebSocket } from "bun";

type WSData = {
  id: string;
  host: boolean;
  connectionId: string;
  pass?: string;
  connected: boolean;
};

const serverConnection: Record<string, {
  id: string;
  socket: ServerWebSocket<WSData>;
  password?: string;
  clients: Map<string, ServerWebSocket<WSData>>;
}> = {};

function connectClient(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string) {
  const lobby = serverConnection[lobbyId];
  if (!lobby || (lobby.password && lobby.password !== pass)) return false;
  ws.data.connectionId = lobbyId;
  ws.data.connected = true;
  lobby.clients.set(ws.data.id, ws);
  lobby.socket.send(`${ws.data.id}$!TUNNEL;OPEN`);
  return true;
}

function hostLobby(ws: ServerWebSocket<WSData>, lobbyId: string, pass?: string) {
  if (serverConnection[lobbyId]) return false;
  ws.data.connectionId = lobbyId;
  ws.data.host = true;
  serverConnection[lobbyId] = {
    id: lobbyId,
    password: pass || undefined,
    socket: ws,
    clients: new Map(),
  };
  return true;
}

const server = Bun.serve<WSData>({
  port: 8085,
  fetch(req, server) {
    const url = new URL(req.url);
    const lobbyId = decodeURIComponent(url.pathname.slice(1));
    const pass = url.searchParams.get("pass") ?? url.searchParams.get("password") ?? undefined;
    const host = url.searchParams.has("host");

    if (server.upgrade(req, {
      data: {
        id: randomUUIDv7(),
        host,
        connectionId: lobbyId,
        pass,
        connected: false,
      },
    })) {
      return undefined;
    }
    return new Response("Hello world!");
  },
  websocket: {
    open(ws) {
      const { connectionId, pass, host } = ws.data;
      console.log("connection made at", connectionId || "/");
      if (!connectionId) return;

      if (host) {
        if (!hostLobby(ws, connectionId, pass)) {
          ws.close(1008, "Lobby already hosted");
        }
      } else {
        if (!connectClient(ws, connectionId, pass)) {
          ws.close(1008, "Invalid lobby or password");
        }
      }
    },
    message(ws, raw) {
      const msg = raw.toString();

      if (msg.startsWith("!TUNNEL")) {
        const [, command, lobbyId, pass] = msg.split(";");
        if (!lobbyId) return;

        if (command === "CONNECT") {
          connectClient(ws, lobbyId, pass);
        } else if (command === "HOST") {
          hostLobby(ws, lobbyId, pass);
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
        const client = lobby.clients.get(msg.slice(0, sep));
        const payload = msg.slice(sep + 1);
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
        for (const client of lobby.clients.values()) {
          client.close();
        }
        delete serverConnection[ws.data.connectionId];
      } else if (ws.data.connected) {
        if (lobby.clients.delete(ws.data.id)) {
          lobby.socket.send(`${ws.data.id}$!TUNNEL;CLOSE`);
        }
      }
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
