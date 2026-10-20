// Verbinding met de League-client (LCU). Werkt op Windows en Mac zonder extra
// packages: we lezen het lockfile dat de client zelf wegschrijft.
//   Windows: C:\Riot Games\League of Legends\lockfile
//   Mac:     /Applications/League of Legends.app/Contents/LoL/lockfile
// Lukt dat niet, dan zoeken we de procesregel (--app-port / --remoting-auth-token).

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const LOCKFILE_CANDIDATES = [
  "C:\\Riot Games\\League of Legends\\lockfile",
  "D:\\Riot Games\\League of Legends\\lockfile",
  "/Applications/League of Legends.app/Contents/LoL/lockfile",
  path.join(os.homedir(), "Applications/League of Legends.app/Contents/LoL/lockfile"),
];

function parseLockfile(text) {
  // formaat: LeagueClient:PID:PORT:PASSWORD:PROTOCOL
  const [name, pid, port, password, protocol] = text.trim().split(":");
  if (!port || !password) return null;
  return { name, pid: Number(pid), port: Number(port), password, protocol: protocol || "https" };
}

function fromLockfiles() {
  for (const p of LOCKFILE_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        const c = parseLockfile(fs.readFileSync(p, "utf8"));
        if (c) return c;
      }
    } catch { /* volgende */ }
  }
  return null;
}

function fromProcessList() {
  try {
    let out;
    if (process.platform === "win32") {
      out = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'LeagueClientUx.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
        { encoding: "utf8", windowsHide: true, timeout: 8000 },
      );
    } else {
      out = execSync("ps -A -o command | grep LeagueClientUx | grep -v grep", { encoding: "utf8", timeout: 8000 });
    }
    const port = /--app-port=(\d+)/.exec(out)?.[1];
    const password = /--remoting-auth-token=([\w-]+)/.exec(out)?.[1];
    if (port && password) return { port: Number(port), password, protocol: "https" };
  } catch { /* client draait niet */ }
  return null;
}

function findCredentials() {
  return fromLockfiles() || fromProcessList();
}

function request(creds, method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = https.request(
      {
        host: "127.0.0.1",
        port: creds.port,
        path: endpoint,
        method,
        rejectUnauthorized: false, // self-signed cert van Riot
        headers: {
          Authorization: "Basic " + Buffer.from("riot:" + creds.password).toString("base64"),
          Accept: "application/json",
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          let parsed = null;
          try { parsed = buf ? JSON.parse(buf) : null; } catch { parsed = buf; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(Object.assign(new Error(`LCU ${method} ${endpoint} -> ${res.statusCode}`), { status: res.statusCode, body: parsed }));
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("LCU timeout")));
    if (data) req.write(data);
    req.end();
  });
}

class LcuClient {
  constructor() { this.creds = null; }

  async connect() {
    const c = findCredentials();
    if (!c) { this.creds = null; return false; }
    try {
      await request(c, "GET", "/lol-summoner/v1/current-summoner");
      this.creds = c;
      return true;
    } catch {
      this.creds = null;
      return false;
    }
  }

  get connected() { return !!this.creds; }

  async get(endpoint) { return request(this.creds, "GET", endpoint); }
  async post(endpoint, body) { return request(this.creds, "POST", endpoint, body); }
  async put(endpoint, body) { return request(this.creds, "PUT", endpoint, body); }
  async del(endpoint) { return request(this.creds, "DELETE", endpoint); }
  async patch(endpoint, body) { return request(this.creds, "PATCH", endpoint, body); }

  async gameflowPhase() {
    try { return await this.get("/lol-gameflow/v1/gameflow-phase"); } catch { return "None"; }
  }

  async champSelect() {
    try { return await this.get("/lol-champ-select/v1/session"); } catch { return null; }
  }

  async currentSummoner() { return this.get("/lol-summoner/v1/current-summoner"); }
}

module.exports = { LcuClient, findCredentials };
