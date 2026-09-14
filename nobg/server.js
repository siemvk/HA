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

// 3. Request listener with dynamic Home Assistant Ingress URL rewriting
const listener = createRequestListener(async (request) => {
  const ingressPath = request.headers.get("x-ingress-path") || "";
  const response = await handleRequest(request);

  if (
    ingressPath &&
    response.headers.get("content-type")?.includes("text/html")
  ) {
    const cleanIngress = ingressPath.replace(/\/+$/, "");
    const body = await response.text();
    let rewritten = body
      .replaceAll('"/assets/', `"${cleanIngress}/assets/`)
      .replaceAll("'/assets/", `'${cleanIngress}/assets/`)
      .replaceAll('"/favicon.', `"${cleanIngress}/favicon.`)
      .replaceAll("'/favicon.", `'${cleanIngress}/favicon.`);

    const injection = `<base href="${cleanIngress}/">\n    <script>window.__INGRESS_PATH__ = ${JSON.stringify(cleanIngress)};</script>`;
    rewritten = rewritten.replace("<head>", `<head>\n    ${injection}`);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(rewritten, {
      status: response.status,
      headers,
    });
  }

  return response;
});

app.all("/{*splat}", listener);

app.listen(port, host, () => {
  console.log(`NoBG listening on http://${host}:${port}`);
});
