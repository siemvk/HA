import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "@react-router/express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

app.disable("x-powered-by");
app.use(compression());
app.use(morgan("tiny"));

// Serve static assets
app.use(
  "/assets",
  express.static(path.join(__dirname, "build/client/assets"), {
    immutable: true,
    maxAge: "1y",
  })
);
app.use(express.static(path.join(__dirname, "build/client"), { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// Load the server SSR build
const build = await import("./build/server/index.js");

// Ingress rewrite middleware: rewrite asset paths for Home Assistant Ingress
app.use((req, res, next) => {
  const ingressPath = req.headers["x-ingress-path"] || "";

  if (!ingressPath) {
    return next();
  }

  const cleanIngress = String(ingressPath).replace(/\/+$/, "");
  const originalSend = res.send;

  res.send = function (body) {
    if (
      typeof body === "string" &&
      res.getHeader("content-type")?.toString().includes("text/html")
    ) {
      let rewritten = body
        .replaceAll('"/assets/', `"${cleanIngress}/assets/`)
        .replaceAll("'/assets/", `'${cleanIngress}/assets/`)
        .replaceAll('"/favicon.', `"${cleanIngress}/favicon.`)
        .replaceAll("'/favicon.", `'${cleanIngress}/favicon.`);

      const injection = `\n    <base href="${cleanIngress}/">\n    <script>window.__INGRESS_PATH__ = ${JSON.stringify(cleanIngress)};</script>`;
      rewritten = rewritten.replace("<head>", `<head>${injection}`);

      return originalSend.call(this, rewritten);
    }
    return originalSend.call(this, body);
  };

  next();
});

// React Router handler
app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV || "production",
  })
);

app.listen(port, host, () => {
  console.log(`NoBG listening on http://${host}:${port}`);
});
