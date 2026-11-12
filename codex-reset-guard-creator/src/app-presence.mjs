import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
let cachedAt = 0, cached = { active: null, processKey: null };
export async function getCodexPresence(force = false) {
  if (!force && Date.now() - cachedAt < 5000) return cached;
  if (process.platform !== 'win32') return { active: false, processKey: null };
  try {
    // PID + process start time survives worker restarts and detects even a quick Codex restart.
    const command = "$p = Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -match 'OpenAI[.\\\\/]Codex' } | Sort-Object StartTime | Select-Object -First 1; if ($p) { $start = $p.StartTime.ToUniversalTime(); @{ active=$true; processKey=([string]$p.Id + ':' + [string]$start.Ticks); startedAt=([DateTimeOffset]$start).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress } else { '{\"active\":false,\"processKey\":null}' }";
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
    const result = JSON.parse(stdout.trim());
    if (typeof result.active !== 'boolean' || (result.active && typeof result.processKey !== 'string')) throw new Error('Invalid presence result');
    cached = result;
  } catch {
    // A timeout is uncertainty, not evidence that Codex closed and opened again.
    cached = { active: null, processKey: null, reason: '暂时无法确认 Codex 是否打开，自动操作已暂停。' };
  }
  cachedAt = Date.now();
  return cached;
}
export async function isCodexOpen(force = false) {
  return (await getCodexPresence(force)).active === true;
}
