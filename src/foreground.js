// Welk programma staat op de voorgrond? De overlay mag alleen zichtbaar zijn als de game
// zelf vooraan staat (niet bij de client, Discord, de browser of het bureaublad).
// Windows: één PowerShell-proces dat elke 400 ms de naam van het voorgrondproces print
// (GetForegroundWindow via user32). Mac: één shell-lus met lsappinfo (geen extra rechten nodig)
// die naam + bundelpad van de voorste app print; de game is ".../Game/LeagueofLegends.app".

const { spawn } = require("child_process");

let current = "", answered = false, failedAt = 0;
let proc = null;

const PS = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$last = ""
while ($true) {
  $p = 0; [void][Fg]::GetWindowThreadProcessId([Fg]::GetForegroundWindow(), [ref]$p)
  $n = ""; try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  if ($n -ne $last) { [Console]::Out.WriteLine($n); [Console]::Out.Flush(); $last = $n }
  Start-Sleep -Milliseconds 400
}
`;

const MAC = `last=""; while true; do a=$(lsappinfo front 2>/dev/null); l=$(lsappinfo info -only name -only bundlepath "$a" 2>/dev/null | tr '\n' ' '); if [ "$l" != "$last" ]; then echo "$l"; last="$l"; fi; sleep 0.4; done`;

function start() {
  if (proc) return;
  if (process.platform === "win32") proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS], { windowsHide: true });
  else if (process.platform === "darwin") proc = spawn("/bin/sh", ["-c", MAC]);
  else return;
  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    if (lines.length) { current = lines[lines.length - 1].trim(); answered = true; }
  });
  proc.on("error", () => { proc = null; current = ""; answered = false; failedAt = Date.now(); });
  proc.on("exit", () => { proc = null; current = ""; answered = false; });
}

function stop() { if (proc) { try { proc.kill(); } catch { /* al weg */ } proc = null; } }

// Mac: de client heet ook "League of Legends"; de game zelf zit in .../Game/LeagueofLegends.app.
const isGame = (s) => process.platform === "darwin"
  ? /\/Game\/[^"]*\.app/i.test(s) || /"name"="LeagueofLegends"|LSDisplayName"="LeagueofLegends"/i.test(s)
  : s === "League of Legends";

// true = de game staat vooraan. Kan het niet gecontroleerd worden (lus kapot, ander OS), dan true.
function gameInFront() {
  if (process.platform !== "win32" && process.platform !== "darwin") return true;
  if (!proc && Date.now() - failedAt > 10000) { start(); if (!proc) failedAt = Date.now(); }
  if (!proc) return true;
  if (!answered) return true; // nog geen antwoord: liever tonen dan niets
  return isGame(current);
}

module.exports = { start, stop, gameInFront, current: () => current };
