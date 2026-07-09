import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Auth } from "./auth.js";
import { ScoreboardStore } from "./store.js";
import { FootballApi } from "./football-api.js";
import { FootballPoller } from "./poller.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(here, "..");

const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = process.env.DATA_FILE || "/data/scoreboard.json";
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || "";
const FOOTBALL_SEASON = Number(process.env.FOOTBALL_SEASON) || undefined;
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME || "Tournament Scoreboard";

const auth = new Auth({
  password: process.env.ADMIN_PASSWORD || "",
  secret: process.env.SESSION_SECRET || ""
});

const store = new ScoreboardStore(DATA_FILE);
const footballApi = new FootballApi(FOOTBALL_API_KEY);
const poller = new FootballPoller(store, FOOTBALL_API_KEY);

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }]
]);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

const ALLOWED_STATIC_DIRS = ["/src/"];

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}

async function readBody(req, limit = 1_000_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

function sessionState(req) {
  return {
    authRequired: auth.enabled,
    admin: auth.isAdminRequest(req),
    footballApi: footballApi.enabled,
    tournamentName: TOURNAMENT_NAME
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/data" && req.method === "GET") {
    const data = await store.load();
    return sendJson(res, 200, data);
  }

  if (url.pathname === "/api/data" && req.method === "PUT") {
    if (auth.enabled && !auth.isAdminRequest(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }

    try {
      const saved = await store.save(parsed);
      return sendJson(res, 200, saved);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (url.pathname === "/api/session" && req.method === "GET") {
    return sendJson(res, 200, sessionState(req));
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }

    if (!auth.enabled) {
      return sendJson(res, 400, { error: "Admin editing is not configured" });
    }

    if (!auth.checkPassword(body?.password)) {
      return sendJson(res, 401, { error: "Incorrect password" });
    }

    const cookie = auth.buildSessionCookie(auth.createToken(), { secure: COOKIE_SECURE });
    return sendJson(res, 200, { admin: true }, { "Set-Cookie": cookie });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const cookie = auth.buildClearCookie({ secure: COOKIE_SECURE });
    return sendJson(res, 200, { admin: false }, { "Set-Cookie": cookie });
  }

  if (url.pathname === "/api/football/fixtures" && req.method === "GET") {
    if (auth.enabled && !auth.isAdminRequest(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    if (!footballApi.enabled) {
      return sendJson(res, 400, { error: "Football API is not configured" });
    }
    try {
      const fixtures = await footballApi.listFixtures(FOOTBALL_SEASON, [
        "Quarter-finals",
        "Semi-finals",
        "3rd Place Final",
        "Final"
      ]);
      return sendJson(res, 200, { fixtures });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/football/sync" && req.method === "POST") {
    if (auth.enabled && !auth.isAdminRequest(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    if (!footballApi.enabled) {
      return sendJson(res, 400, { error: "Football API is not configured" });
    }
    try {
      const live = await poller.syncOnce();
      const data = await store.load();
      return sendJson(res, 200, { live, data });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

function resolveStaticPath(pathname) {
  const mapped = STATIC_FILES.get(pathname);
  if (mapped) {
    return join(publicRoot, mapped.file);
  }

  const normalised = normalize(pathname);
  if (!ALLOWED_STATIC_DIRS.some((dir) => normalised.startsWith(dir))) {
    return null;
  }

  const candidate = resolve(publicRoot, `.${normalised}`);
  if (!candidate.startsWith(publicRoot)) {
    return null;
  }

  return candidate;
}

async function handleStatic(req, res, url) {
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error("Not a file");
    }

    const type =
      STATIC_FILES.get(url.pathname)?.type ||
      MIME_TYPES.get(extname(filePath)) ||
      "application/octet-stream";

    const contents = await readFile(filePath);
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=300" });
    res.end(contents);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }

    await handleStatic(req, res, url);
  } catch (error) {
    console.error("Request failed:", error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    }
  }
});

store
  .init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Tournament scoreboard listening on http://0.0.0.0:${PORT}`);
      console.log(`Tournament: ${TOURNAMENT_NAME}`);
      console.log(`Data file: ${DATA_FILE}`);
      console.log(`Admin editing: ${auth.enabled ? "enabled" : "disabled (set ADMIN_PASSWORD)"}`);
      console.log(
        `Football API: ${footballApi.enabled ? "enabled" : "disabled (set FOOTBALL_API_KEY)"}`
      );
      poller.start();
    });
  })
  .catch((error) => {
    console.error("Failed to initialise scoreboard store:", error);
    process.exit(1);
  });
