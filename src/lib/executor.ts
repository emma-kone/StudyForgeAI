import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Exécution réelle de code, en processus enfant isolé.
// - Limites de temps (kill after timeout)
// - Limites de sortie (64 Ko par flux)
// - JavaScript : sandbox `vm` dans un processus Node dédié (pas de require,
//   pas d'accès process/fetch/globalThis hôte).
// - Python : interprète `python3 -I` (mode isolé) + rlimits mémoire/CPU
//   appliqués par un wrapper avant exécution du code utilisateur.
// LIMITATION DOCUMENTÉE : sandbox de type OS non disponible dans cet
// environnement (pas de conteneur). L'isolation est celle d'un processus
// enfant à ressources limitées, adaptée à un usage personnel non hostile.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  note?: string;
}

const MAX_OUTPUT = 64 * 1024;
const TIMEOUT_MS = 8000;

export const EXECUTABLE_LANGUAGES: Record<string, { runtime: string; label: string; available: boolean | null }> = {
  javascript: { runtime: "node", label: "JavaScript (Node.js)", available: true },
  typescript: { runtime: "node", label: "JavaScript (TS transpilé côté réponse)", available: true },
  python: { runtime: "python3", label: "Python 3", available: null },
};

export async function checkRuntimes() {
  for (const lang of Object.values(EXECUTABLE_LANGUAGES)) {
    if (lang.available === true) continue;
    lang.available = await new Promise<boolean>((resolve) => {
      const p = spawn(lang.runtime, ["--version"], { stdio: "ignore" });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    });
  }
}

function cap(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + `\n…[sortie tronquée à ${Math.round(MAX_OUTPUT / 1024)} Ko]`;
}

function runProcess(cmd: string, args: string[], code: string, timeoutMs = TIMEOUT_MS): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd: mkdtempSync(path.join(tmpdir(), "sfs-")),
      env: { ...process.env, PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir() },
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT * 2) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT * 2) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: cap(stdout), stderr: cap(stderr + "\n" + err.message), exitCode: -1, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && exitCode === 0,
        stdout: cap(stdout),
        stderr: cap(stderr),
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        note: timedOut ? `Exécution interrompue : dépassement du délai de ${timeoutMs / 1000} s.` : undefined,
      });
    });

    child.stdin.write(code);
    child.stdin.end();
  });
}

// ── JavaScript : processus Node dédié + sandbox vm ───────────────────────────
const JS_RUNNER = `
const vm = require("node:vm");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const logs = [];
  const push = (level) => (...args) => {
    if (logs.length < 2000)
      logs.push(args.map((a) => {
        try {
          if (typeof a === "string") return a;
          return JSON.stringify(a, (_, v) => typeof v === "bigint" ? String(v) : v, 2) ?? String(a);
        } catch { return String(a); }
      }).join(" "));
  };
  const sandbox = {
    console: { log: push("log"), error: push("error"), warn: push("warn"), info: push("info") },
    Math, JSON, Date, Number, String, Boolean, Array, Object, Map, Set, WeakMap, WeakSet,
    Promise, Symbol, Error, TypeError, RangeError, SyntaxError, RegExp, parseInt, parseFloat,
    isNaN, isFinite, encodeURIComponent, decodeURIComponent, structuredClone, BigInt,
    Intl, ArrayBuffer, Uint8Array, Int32Array, Float64Array,
  };
  sandbox.globalThis = sandbox;
  try {
    const script = new vm.Script(input, { filename: "solution.js" });
    script.runInNewContext(sandbox, { timeout: 6000 });
  } catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err));
  }
  process.stdout.write(logs.join("\\n"));
});
`;

// ── Python : wrapper avec rlimits (mémoire 256 Mo, CPU 6 s) ──────────────────
const PY_WRAPPER = `
import resource, sys, os
resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
os.umask(0o077)
code = sys.stdin.buffer.read()
try:
    exec(compile(code, "solution.py", "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
except BaseException as e:
    import traceback
    traceback.print_exc()
`;

export async function executeCode(language: string, code: string): Promise<ExecResult> {
  const lang = language.toLowerCase();
  if (lang === "javascript" || lang === "js" || lang === "typescript" || lang === "ts") {
    // Le TypeScript est transposé sommairement côté réponse avant exécution JS.
    const jsCode = ["typescript", "ts"].includes(lang) ? stripTypes(code) : code;
    return runProcess("node", ["-e", JS_RUNNER], jsCode);
  }
  if (lang === "python" || lang === "py") {
    const available = EXECUTABLE_LANGUAGES.python.available;
    if (available === false) {
      return { ok: false, stdout: "", stderr: "Python n'est pas disponible sur ce serveur. L'exécution est désactivée pour ce langage (la correction par IA reste proposée).", exitCode: null, durationMs: 0, timedOut: false, note: "Exécution Python non configurée." };
    }
    return runProcess("python3", ["-I", "-c", PY_WRAPPER], code);
  }
  return {
    ok: false,
    stdout: "",
    stderr: `L'exécution réelle de ${language} n'est pas disponible dans cet environnement. Les exercices de ce langage sont corrigés par l'IA (analyse de votre code) — aucune simulation n'est effectuée.`,
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    note: `Runtime ${language} non installé.`,
  };
}

/** Transposition TS→JS minimale (annotations, interfaces, génériques simples). */
function stripTypes(code: string): string {
  return code
    .replace(/^\s*import\s+type\s+.*$/gm, "")
    .replace(/^\s*interface\s+\w+\s*\{[\s\S]*?^\s*\}/gm, "")
    .replace(/^\s*type\s+\w+\s*=[\s\S]*?;$/gm, "")
    .replace(/:\s*[A-Za-z_$][\w$<>[\]|&, .]*(?=\s*[=,)\];{])/g, "")
    .replace(/<[A-Za-z_$][\w$,\s]*>(?=\()/g, "")
    .replace(/\bas\s+[A-Za-z_$][\w$<>[\]]*/g, "")
    .replace(/!\./g, ".")
    .replace(/(\bconst\b|\blet\b|\bfunction\b)\s*<[^>]*>/g, "$1");
}
