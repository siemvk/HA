import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type WebSocket from "ws";
import type { WebSocketServer as WSServer } from "ws";

export class ClientSocket extends EventEmitter implements WebSocket {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSING = 2 as const;
  static readonly CLOSED = 3 as const;

  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;

  binaryType: "nodebuffer" | "arraybuffer" | "fragments" = "nodebuffer";
  readonly bufferedAmount: number = 0;
  readonly extensions: string = "";
  isPaused: boolean = false;
  readonly protocol: string = "";
  readyState: 0 | 1 | 2 | 3 = ClientSocket.OPEN;
  readonly url: string;
  readonly id: string;

  onopen: ((event: WebSocket.Event) => void) | null = null;
  onerror: ((event: WebSocket.ErrorEvent) => void) | null = null;
  onclose: ((event: WebSocket.CloseEvent) => void) | null = null;
  onmessage: ((event: WebSocket.MessageEvent) => void) | null = null;

  constructor(
    id: string,
    url: string,
    private hostSocket: globalThis.WebSocket,
    private onRemove: () => void,
  ) {
    super();
    this.id = id;
    this.url = url;
  }

  send(data: any, optionsOrCb?: any, cb?: (err?: Error) => void): void {
    const callback: ((err?: Error) => void) | undefined =
      typeof optionsOrCb === "function" ? optionsOrCb : cb;
    if (this.readyState !== ClientSocket.OPEN) {
      callback?.(new Error("WebSocket is not open"));
      return;
    }
    const text = typeof data === "string" ? data : Buffer.from(data).toString();
    this.hostSocket.send(`${this.id}$${text}`);
    callback?.();
  }

  close(code = 1000, data: string | Buffer = ""): void {
    if (this.readyState === ClientSocket.CLOSED) return;
    this.readyState = ClientSocket.CLOSED;
    this.onRemove();
    const reason = typeof data === "string" ? data : data.toString();
    if (this.hostSocket.readyState === globalThis.WebSocket.OPEN) {
      this.hostSocket.send(`${this.id}$!TUNNEL;CLOSE`);
    }
    this.onclose?.({ wasClean: true, code, reason, type: "close", target: this });
    this.emit("close", code, Buffer.from(reason));
  }

  terminate(): void {
    this.close(1006, "terminated");
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  ping(_data?: any, _mask?: boolean, cb?: (err: Error) => void): void {
    cb?.(undefined as unknown as Error);
  }

  pong(_data?: any, _mask?: boolean, cb?: (err: Error) => void): void {
    cb?.(undefined as unknown as Error);
  }

  addEventListener<K extends keyof WebSocket.WebSocketEventMap>(
    type: K,
    listener:
      | ((event: WebSocket.WebSocketEventMap[K]) => void)
      | { handleEvent(event: WebSocket.WebSocketEventMap[K]): void },
    options?: WebSocket.EventListenerOptions,
  ): void {
    const fn = typeof listener === "function" ? listener : (e: any) => listener.handleEvent(e);
    if (options?.once) this.once(type, fn);
    else this.on(type, fn);
  }

  removeEventListener<K extends keyof WebSocket.WebSocketEventMap>(
    type: K,
    listener:
      | ((event: WebSocket.WebSocketEventMap[K]) => void)
      | { handleEvent(event: WebSocket.WebSocketEventMap[K]): void },
  ): void {
    if (typeof listener === "function") this.off(type, listener);
  }
}

export type TunnelServerOptions = WebSocket.ServerOptions & {
  url?: string;
  lobby?: string;
  password?: string;
  pass?: string;
};

export class WebSocketServer extends EventEmitter implements WSServer {
  options: TunnelServerOptions;
  path: string;
  readonly clients = new Set<ClientSocket>();
  private clientMap = new Map<string, ClientSocket>();
  readonly socket: globalThis.WebSocket;

  constructor(options: TunnelServerOptions | string = {}, callback?: () => void) {
    super();
    const opts = typeof options === "string" ? { url: options } : options;
    this.options = opts;

    const baseUrl = opts.url ?? `ws://${opts.host ?? "localhost"}:${opts.port ?? 8085}${opts.path ?? "/"}`;
    const parsed = new URL(baseUrl);
    const lobby = opts.lobby ?? opts.path?.replace(/^\//, "") ?? decodeURIComponent(parsed.pathname.slice(1));
    const pass = opts.pass ?? opts.password ?? parsed.searchParams.get("pass") ?? parsed.searchParams.get("password") ?? undefined;

    parsed.pathname = `/${encodeURIComponent(lobby)}`;
    this.path = parsed.pathname;
    if (pass) parsed.searchParams.set("pass", pass);
    parsed.searchParams.set("host", "1");

    if (callback) this.once("listening", callback);

    this.socket = new globalThis.WebSocket(parsed.toString());

    this.socket.onopen = () => {
      this.emit("listening");
    };

    this.socket.onmessage = (e) => {
      const raw = String(e.data);
      const sep = raw.indexOf("$");
      if (sep === -1) return;

      const id = raw.slice(0, sep);
      const payload = raw.slice(sep + 1);

      if (payload === "!TUNNEL;OPEN") {
        const client = new ClientSocket(id, parsed.toString(), this.socket, () => {
          this.clientMap.delete(id);
          this.clients.delete(client);
        });
        this.clientMap.set(id, client);
        this.clients.add(client);
        this.emit("connection", client, { url: this.path, headers: {} } as IncomingMessage);
        return;
      }

      const client = this.clientMap.get(id);
      if (!client || client.isPaused) return;

      if (payload === "!TUNNEL;CLOSE") {
        client.readyState = ClientSocket.CLOSED;
        this.clientMap.delete(id);
        this.clients.delete(client);
        client.onclose?.({ wasClean: true, code: 1000, reason: "", type: "close", target: client });
        client.emit("close", 1000, Buffer.alloc(0));
        return;
      }

      const buf = Buffer.from(payload);
      client.onmessage?.({ data: payload, type: "message", target: client });
      client.emit("message", buf, false);
    };

    this.socket.onclose = () => {
      for (const client of this.clients) {
        client.readyState = ClientSocket.CLOSED;
        client.onclose?.({ wasClean: true, code: 1001, reason: "Server closed", type: "close", target: client });
        client.emit("close", 1001, Buffer.from("Server closed"));
      }
      this.clients.clear();
      this.clientMap.clear();
      this.emit("close");
    };

    this.socket.onerror = (err) => {
      this.emit("error", err);
    };
  }

  address(): WebSocket.AddressInfo | string | null {
    return this.socket.url;
  }

  close(cb?: (err?: Error) => void): void {
    if (cb) this.once("close", () => cb());
    this.socket.close();
  }

  handleUpgrade(
    _request: IncomingMessage,
    _socket: Duplex,
    _upgradeHead: Buffer,
    _callback: (client: WebSocket, request: IncomingMessage) => void,
  ): void {}

  shouldHandle(request: IncomingMessage): boolean {
    return request.url?.startsWith(this.path) ?? true;
  }
}
