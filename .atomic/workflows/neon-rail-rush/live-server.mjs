import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [liveDir, portArg] = process.argv.slice(2);
const root = resolve(liveDir);
const port = Number(portArg ?? 5199);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".ktx2": "image/ktx2",
};

const reloadSnippet = `<script>(() => {
  let current = null;
  setInterval(async () => {
    try {
      const v = await (await fetch("/__version", { cache: "no-store" })).text();
      if (current === null) current = v; else if (v !== current) location.reload();
    } catch {}
  }, 1500);
})();</script>`;

async function liveVersion() {
  try {
    return (await readFile(join(root, "version.txt"), "utf8")).trim();
  } catch {
    return "none";
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/__version") {
    response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    response.end(await liveVersion());
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  let filePath = join(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
    let body = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] ?? "application/octet-stream";
    if (extname(filePath) === ".html") {
      body = Buffer.from(body.toString("utf8").replace("</body>", `${reloadSnippet}</body>`));
    }
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`live preview on http://127.0.0.1:${port} serving ${root}`);
});
