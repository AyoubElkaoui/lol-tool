// Welk programma staat op de voorgrond? De overlay mag alleen zichtbaar zijn als de game
// zelf vooraan staat (niet bij de client, Discord, de browser of het bureaublad).
// Windows: één PowerShell-proces dat elke 400 ms de naam van het voorgrondproces print
// (GetForegroundWindow via user32). Mac: geen check, de overlay volgt dan alleen de game-fase.

const { spawn } = require("child_process");

let current = "";
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

function start() {
  if (process.platform !== "win32" || proc) return;
  proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS], { windowsHide: true });
  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    if (lines.length) current = lines[lines.length - 1].trim();
  });
  proc.on("exit", () => { proc = null; current = ""; });
}

function stop() { if (proc) { try { proc.kill(); } catch { /* al weg */ } proc = null; } }

// true = de game staat vooraan (of we kunnen het niet controleren, zoals op Mac).
function gameInFront() {
  if (process.platform !== "win32") return true;
  if (!proc) start();
  return current === "League of Legends";
}

module.exports = { start, stop, gameInFront, current: () => current };
