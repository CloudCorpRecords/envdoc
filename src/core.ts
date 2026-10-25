/**
 * envdoc core: diff environment variables used in code against
 * .env.example (or .env.sample).
 *
 * Scan model:
 * - Walk the target directory recursively, skipping node_modules,
 *   .git, dist, and any directory named fixtures.
 * - Source files are .ts, .js, .mjs, .cjs, and .py files.
 * - Recognized usages are name patterns only:
 *     process.env.NAME
 *     process.env["NAME"] and process.env['NAME']
 *     import.meta.env.NAME
 *     os.environ["NAME"] and os.environ['NAME']
 *     os.environ.get("NAME") and os.environ.get('NAME')
 *     os.getenv("NAME") and os.getenv('NAME')
 *   NAME is [A-Z][A-Z0-9_]* . Lowercase-start names after process.env
 *   are ignored by design, and dynamic access such as
 *   process.env[someVar] cannot be tracked statically.
 * - The example file is read for names only: for each line the parser
 *   keeps only the left side of the first "=". Values are never read
 *   into the report.
 *
 * Deterministic output only: files are walked in sorted order, var
 * names are sorted, and no timestamps are emitted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Finding, Report } from "./types.js";

export const VERSION = "0.1.0";
export const CLEAN_VERDICT = "IN-SYNC";
export const DRIFT_VERDICT = "DRIFT";

/** Vars that are never flagged as documented-not-used. */
export const ALWAYS_OK: ReadonlySet<string> = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "CI",
  "DEBUG",
]);

const SOURCE_EXTS: ReadonlySet<string> = new Set([".ts", ".js", ".mjs", ".cjs", ".py"]);

const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "fixtures"]);

const NAME = "[A-Z][A-Z0-9_]*";

const USAGE_PATTERNS: RegExp[] = [
  new RegExp(`\\bprocess\\.env\\.(${NAME})\\b`, "g"),
  new RegExp(`\\bprocess\\.env\\s*\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
  new RegExp(`\\bimport\\.meta\\.env\\.(${NAME})\\b`, "g"),
  new RegExp(`\\bos\\.environ\\s*\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
  new RegExp(`\\bos\\.environ\\.get\\s*\\(\\s*["'](${NAME})["']`, "g"),
  new RegExp(`\\bos\\.getenv\\s*\\(\\s*["'](${NAME})["']`, "g"),
];

const EXAMPLE_LINE_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;

interface UsedVar {
  name: string;
  file: string;
  line: number;
}

interface DocumentedVar {
  name: string;
  line: number;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

function collectSourceFiles(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(root, abs, out);
    } else if (entry.isFile()) {
      if (SOURCE_EXTS.has(extOf(entry.name))) out.push(abs);
    }
  }
}

function scanFile(abs: string, root: string, used: Map<string, UsedVar>): void {
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const rel = relative(root, abs).split("\\").join("/");
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    for (const pattern of USAGE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (name && !used.has(name)) {
          used.set(name, { name, file: rel, line: i + 1 });
        }
      }
    }
  }
}

function findExampleFile(root: string): { name: string; abs: string } | null {
  for (const candidate of [".env.example", ".env.sample"]) {
    const abs = join(root, candidate);
    try {
      const st = statSync(abs);
      if (st.isFile()) return { name: candidate, abs };
    } catch {
      continue;
    }
  }
  return null;
}

function parseExample(abs: string): Map<string, DocumentedVar> {
  const documented = new Map<string, DocumentedVar>();
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return documented;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = EXAMPLE_LINE_RE.exec(raw);
    if (!match) continue;
    const name = match[1];
    if (name && !documented.has(name)) {
      documented.set(name, { name, line: i + 1 });
    }
  }
  return documented;
}

export function runCheck(target: string): Report {
  const root = resolve(target);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    throw new Error(`target does not exist: ${target}`);
  }

  const used = new Map<string, UsedVar>();
  let exampleRoot = root;

  if (rootStat.isFile()) {
    exampleRoot = resolve(root, "..");
    if (SOURCE_EXTS.has(extOf(root))) {
      scanFile(root, exampleRoot, used);
    }
  } else if (rootStat.isDirectory()) {
    const files: string[] = [];
    collectSourceFiles(root, root, files);
    files.sort();
    for (const file of files) scanFile(file, root, used);
  } else {
    throw new Error(`target is neither a directory nor a file: ${target}`);
  }

  const example = rootStat.isDirectory() || rootStat.isFile() ? findExampleFile(exampleRoot) : null;
  const documented = example ? parseExample(example.abs) : new Map<string, DocumentedVar>();
  const exampleName = example ? example.name : ".env.example";

  const usedNames = [...used.keys()].sort();
  const documentedNames = [...documented.keys()].sort();

  const missingNames = usedNames.filter((n) => !documented.has(n));
  const staleNames = documentedNames.filter((n) => !used.has(n) && !ALWAYS_OK.has(n));

  const findings: Finding[] = [];

  if (!example && usedNames.length > 0) {
    findings.push({
      rule: "NO-EXAMPLE",
      severity: "high",
      message: `No .env.example or .env.sample found but code uses ${usedNames.length} env var(s): ${usedNames.join(", ")}`,
      evidence: usedNames.join(", "),
    });
  }

  for (const name of missingNames) {
    const first = used.get(name) as UsedVar;
    findings.push({
      rule: "USED-NOT-DOCUMENTED",
      severity: "medium",
      file: first.file,
      line: first.line,
      message: `${name} is used in code but not documented in ${exampleName}`,
      evidence: name,
    });
  }

  for (const name of staleNames) {
    const doc = documented.get(name) as DocumentedVar;
    findings.push({
      rule: "DOCUMENTED-NOT-USED",
      severity: "low",
      file: exampleName,
      line: doc.line,
      message: `${name} is documented in ${exampleName} but never used in code`,
      evidence: name,
    });
  }

  findings.push({
    rule: "VALUES-IGNORED",
    severity: "info",
    message: "Values are ignored: only variable names are compared, values are never read into the report",
  });

  const hasBlocking = findings.some((f) => f.severity === "medium" || f.severity === "high");
  const verdict = hasBlocking ? DRIFT_VERDICT : CLEAN_VERDICT;

  const counts: Record<string, number> = {
    used: usedNames.length,
    documented: documentedNames.length,
    missing: missingNames.length,
    stale: staleNames.length,
  };

  let summary: string;
  if (!example && usedNames.length === 0) {
    summary = "no env usage found";
  } else {
    summary = `${verdict}: ${counts.used} used, ${counts.documented} documented, ${counts.missing} missing, ${counts.stale} stale.`;
  }

  return {
    tool: "envdoc",
    version: VERSION,
    target,
    verdict,
    counts,
    findings,
    summary,
  };
}

export function renderReport(report: Report): string {
  const out: string[] = [];
  out.push(`envdoc check ${report.target}: ${report.verdict}`);
  out.push(`  ${report.summary}`);
  const c = report.counts;
  out.push(
    `  counts: used ${c.used ?? 0}, documented ${c.documented ?? 0}, missing ${c.missing ?? 0}, stale ${c.stale ?? 0}`,
  );
  out.push(`  findings (${report.findings.length}):`);
  if (report.findings.length === 0) {
    out.push("    none");
  } else {
    for (const f of report.findings) {
      const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
      out.push(`    [${f.severity.toUpperCase()}]${loc} ${f.rule} ${f.message}`);
    }
  }
  if (report.verdict === CLEAN_VERDICT) {
    out.push("IN-SYNC: every env var used in code is documented and no blocking drift was found.");
  } else {
    out.push("DRIFT: at least one medium or high finding. Document the missing vars or add an example file.");
  }
  return out.join("\n");
}
