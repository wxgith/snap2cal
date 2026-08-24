import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { isInside, isMainModule, parseCliArguments } from "./lib/fs-utils.mjs";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gz", "application/gzip"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function normalizeBase(value) {
  if (!value.startsWith("/") || value.includes("..") || /[?#]/.test(value))
    throw new Error("--base must be an absolute URL pathname.");
  return value === "/" ? "/" : `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

export function createStaticServer({ root, base = "/", host = "127.0.0.1" }) {
  const resolvedRoot = path.resolve(root);
  const normalizedBase = normalizeBase(base);

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      const pathname = decodeURIComponent(requestUrl.pathname);
      if (!pathname.startsWith(normalizedBase)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      let relative = pathname.slice(normalizedBase.length);
      if (!relative) relative = "index.html";
      let filePath = path.resolve(resolvedRoot, relative);
      if (!isInside(resolvedRoot, filePath)) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }

      let details;
      try {
        details = await stat(filePath);
        if (details.isDirectory()) {
          filePath = path.join(filePath, "index.html");
          details = await stat(filePath);
        }
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const contentType =
        MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": details.size,
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Static server failure");
    }
  });
}

if (isMainModule(import.meta.url)) {
  const args = parseCliArguments(process.argv.slice(2));
  const root = args.get("--root");
  const port = Number(args.get("--port"));
  const base = args.get("--base") ?? "/";
  if (!root || !Number.isInteger(port) || port < 1) {
    throw new Error(
      "Usage: node scripts/serve-static.mjs --root <directory> --port <port> [--base /path/]",
    );
  }

  const server = createStaticServer({ root, base });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Static server listening on http://127.0.0.1:${port}${base}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
