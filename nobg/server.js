import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "react-router";
import { createRequestListener } from "@remix-run/node-fetch-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

app.disable("x-powered-by");
app.use(compression());
app.use(morgan("tiny"));

// 1. Serve static assets
app.use(
  "/assets",
  express.static(path.join(__dirname, "build/client/assets"), {
    immutable: true,
    maxAge: "1y",
  })
);
app.use(express.static(path.join(__dirname, "build/client"), { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// 2. Load the server SSR build
const build = await import("./build/server/index.js");
const handleRequest = createRequestHandler(build, process.env.NODE_ENV || "production");

// 3. Request listener with Origin normalization & Ingress asset rewriting
const listener = createRequestListener(async (request) => {
  const ingressPath = request.headers.get("x-ingress-path") || "";
  const cleanIngress = ingressPath ? ingressPath.replace(/\/+$/, "") : "";

  // Normalize host & proto to match the caller's origin (prevents CSRF/Origin mismatch on POST)
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const reqHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || `${host}:${port}`;
  const rawUrl = new URL(request.url);

  // If request URL path starts with ingressPath, strip it so React Router routes correctly on server
  let pathname = rawUrl.pathname;
  if (cleanIngress && pathname.startsWith(cleanIngress)) {
    pathname = pathname.slice(cleanIngress.length) || "/";
  }

  const normalizedUrl = new URL(`${proto}://${reqHost}${pathname}${rawUrl.search}`);
  const headers = new Headers(request.headers);

  // Ensure Host header matches forwarded host for React Router origin verification
  if (request.headers.get("x-forwarded-host")) {
    headers.set("host", request.headers.get("x-forwarded-host"));
  }

  const reqInit = {
    method: request.method,
    headers,
    signal: request.signal,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    reqInit.body = request.body;
    // @ts-ignore
    reqInit.duplex = "half";
  }

  const normalizedRequest = new Request(normalizedUrl.href, reqInit);
  const response = await handleRequest(normalizedRequest);

  // Rewrite asset paths & serialized basename for Ingress HTML responses without breaking React 19 hydration
  if (
    cleanIngress &&
    response.headers.get("content-type")?.includes("text/html")
  ) {
    const body = await response.text();
    const rewritten = body
      .replaceAll('"/assets/', `"${cleanIngress}/assets/`)
      .replaceAll("'/assets/", `'${cleanIngress}/assets/`)
      .replaceAll('"/favicon.', `"${cleanIngress}/favicon.`)
      .replaceAll("'/favicon.", `'${cleanIngress}/favicon.`)
      .replace(/"basename"\s*:\s*"[^"]*"/g, `"basename":${JSON.stringify(cleanIngress)}`);

    const resHeaders = new Headers(response.headers);
    resHeaders.delete("content-length");
    return new Response(rewritten, {
      status: response.status,
      headers: resHeaders,
    });
  }

  return response;
});

app.all("/{*splat}", listener);

app.listen(port, host, () => {
  console.log(`NoBG listening on http://${host}:${port}`);
});
