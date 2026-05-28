import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes("--prod");
const port = Number(process.env.PORT || 5173);

loadEnvFile(path.join(__dirname, ".env.local"));

const maasEndpoint = process.env.MAAS_API_URL || "https://api.modelarts-maas.com/v2/chat/completions";
const maasModel = process.env.MAAS_MODEL || "deepseek-v3.2";
const maasApiKey = process.env.MAAS_API_KEY || "";

let vite;
if (!isProd) {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/maas/status" && req.method === "GET") {
      sendJson(res, 200, {
        configured: Boolean(maasApiKey),
        endpoint: safeEndpoint(maasEndpoint),
        model: maasModel,
      });
      return;
    }

    if (req.url === "/api/maas/chat" && req.method === "POST") {
      await handleMaaSChat(req, res);
      return;
    }

    if (req.url === "/api/server/ssh/run" && req.method === "POST") {
      await handleSshRun(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RAIO server running at http://127.0.0.1:${port}/`);
  console.log(`MaaS model: ${maasModel} (${safeEndpoint(maasEndpoint)})`);
});

async function handleMaaSChat(req, res) {
  if (!maasApiKey) {
    sendJson(res, 503, { error: "MAAS_API_KEY is not configured." });
    return;
  }

  const body = await readJson(req);
  const messages = normalizeMessages(body.messages);
  const system = typeof body.system === "string" ? body.system : agentSystemPrompt(body.agent);

  const response = await fetch(maasEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${maasApiKey}`,
    },
    body: JSON.stringify({
      model: process.env.MAAS_MODEL || body.model || maasModel,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: Number(body.temperature ?? 0.7),
      max_tokens: Number(body.max_tokens ?? 1200),
      stream: false,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    sendJson(res, response.status, {
      error: data.error?.message || data.message || `MaaS request failed with ${response.status}`,
      detail: data,
    });
    return;
  }

  const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content || "";
  sendJson(res, 200, { text, model: maasModel, usage: data.usage || null });
}

async function handleSshRun(req, res) {
  const body = await readJson(req);
  const host = String(body.host || "").trim();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const port = Number(body.port || 22);
  const command = String(body.command || "").trim();

  if (!host || !username || !password || !command) {
    sendJson(res, 400, { error: "host, username, password, and command are required." });
    return;
  }

  const safety = validateSshCommand(command);
  if (!safety.ok) {
    sendJson(res, 400, { error: safety.reason });
    return;
  }

  try {
    const result = await runSshCommand({ host, port, username, password, command });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "SSH command failed." });
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content }));
}

function validateSshCommand(command) {
  const blocked = [
    /\brm\s+(-[^\s]*[rf][^\s]*|-rf|-fr)\b/,
    /\bsudo\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    />\s*\/dev\//,
    /\bchmod\s+777\b/,
    /\bchown\s+-R\b/,
    /\bkill\s+-9\b/,
    /\bpkill\b/,
    /\bscancel\b/,
    /\bqdel\b/,
    /\bdocker\s+(rm|rmi|prune|system\s+prune)\b/,
  ];
  if (command.length > 800) return { ok: false, reason: "Command is too long for the safe SSH runner." };
  if (blocked.some((pattern) => pattern.test(command))) {
    return { ok: false, reason: "This command is blocked by RAIO's safety guard. Run destructive commands manually in your own terminal." };
  }
  return { ok: true };
}

function runSshCommand({ host, port, username, password, command }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.end();
        reject(new Error("SSH command timed out after 20 seconds."));
      }
    }, 20_000);

    conn
      .on("ready", () => {
        conn.exec(command, { pty: false }, (error, stream) => {
          if (error) {
            clearTimeout(timer);
            settled = true;
            conn.end();
            reject(error);
            return;
          }
          stream
            .on("close", (code) => {
              clearTimeout(timer);
              if (!settled) {
                settled = true;
                conn.end();
                resolve({ stdout: stdout.slice(0, 12000), stderr: stderr.slice(0, 6000), code });
              }
            })
            .on("data", (data) => {
              stdout += data.toString();
            });
          stream.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        });
      })
      .on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      })
      .connect({
        host,
        port,
        username,
        password,
        readyTimeout: 12_000,
        keepaliveInterval: 5000,
      });
  });
}

function agentSystemPrompt(agent) {
  const base = "你是 RAIO，一个像素风科研助手。回答要中文、具体、短而有用，语气温暖但不装可爱。";
  const prompts = {
    hoot: `${base} 你是中央调度猫头鹰 Hoot，负责判断用户意图，并给出下一步行动建议。`,
    bookworm: `${base} 你是 Paper Agent 书虫，负责论文检索、文献地图、论文摘要和阅读建议。`,
    gears: `${base} 你是 Server Agent 机械师，负责解析服务器/GPU/训练日志并给出运维建议。`,
    scholar: `${base} 你是 Learning Agent 学者，负责生成循序渐进的学习路径。`,
    bloom: `${base} 你是 Life Agent 园丁，负责 Todo、心情和科研节奏建议。`,
  };
  return prompts[agent] || prompts.hoot;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, "dist", safePath);
  if (!filePath.startsWith(path.join(__dirname, "dist"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const finalPath = fs.existsSync(filePath) ? filePath : path.join(__dirname, "dist", "index.html");
  const ext = path.extname(finalPath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(finalPath).pipe(res);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

function safeEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}
