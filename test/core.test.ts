import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck, renderReport, VERSION, CLEAN_VERDICT } from "../src/core.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function rules(report: ReturnType<typeof runCheck>): string[] {
  return report.findings.map((f) => f.rule);
}

describe("contract", () => {
  it("exports VERSION and CLEAN_VERDICT", () => {
    assert.equal(VERSION, "0.1.0");
    assert.equal(CLEAN_VERDICT, "IN-SYNC");
  });
});

describe("acceptance fixtures", () => {
  it("repo-insync: code uses A and B, example documents A and B", () => {
    const r = runCheck(join(FIXTURES, "repo-insync"));
    assert.equal(r.tool, "envdoc");
    assert.equal(r.version, "0.1.0");
    assert.equal(r.verdict, "IN-SYNC");
    assert.equal(r.counts.used, 2);
    assert.equal(r.counts.documented, 2);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.counts.stale, 0);
    assert.ok(!rules(r).includes("USED-NOT-DOCUMENTED"));
    assert.ok(!rules(r).includes("DOCUMENTED-NOT-USED"));
    assert.equal(r.findings.filter((f) => f.rule === "VALUES-IGNORED").length, 1);
    assert.equal(r.findings.find((f) => f.rule === "VALUES-IGNORED")?.severity, "info");
  });

  it("repo-missing: code uses C undocumented", () => {
    const r = runCheck(join(FIXTURES, "repo-missing"));
    assert.equal(r.verdict, "DRIFT");
    assert.equal(r.counts.used, 2);
    assert.equal(r.counts.documented, 1);
    assert.equal(r.counts.missing, 1);
    assert.equal(r.counts.stale, 0);
    const missing = r.findings.filter((f) => f.rule === "USED-NOT-DOCUMENTED");
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.severity, "medium");
    assert.match(missing[0]?.message ?? "", /FEATURE_CHARLIE/);
    assert.equal(missing[0]?.file, "app.ts");
    assert.equal(missing[0]?.line, 2);
  });

  it("repo-stale: example documents D unused, NODE_ENV unused is not flagged", () => {
    const r = runCheck(join(FIXTURES, "repo-stale"));
    assert.equal(r.counts.used, 1);
    assert.equal(r.counts.documented, 3);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.counts.stale, 1);
    const stale = r.findings.filter((f) => f.rule === "DOCUMENTED-NOT-USED");
    assert.equal(stale.length, 1);
    assert.equal(stale[0]?.severity, "low");
    assert.match(stale[0]?.message ?? "", /FEATURE_DELTA/);
    assert.ok(!r.findings.some((f) => /NODE_ENV/.test(f.message) && f.rule === "DOCUMENTED-NOT-USED"));
    assert.equal(r.verdict, "IN-SYNC");
  });

  it("repo-noexample: code uses a var, no example file", () => {
    const r = runCheck(join(FIXTURES, "repo-noexample"));
    assert.equal(r.verdict, "DRIFT");
    assert.equal(r.counts.used, 1);
    assert.equal(r.counts.documented, 0);
    assert.equal(r.counts.missing, 1);
    assert.equal(r.counts.stale, 0);
    const noExample = r.findings.find((f) => f.rule === "NO-EXAMPLE");
    assert.ok(noExample, "NO-EXAMPLE must fire");
    assert.equal(noExample.severity, "high");
  });

  it("repo-nousage: no env usage, no example", () => {
    const r = runCheck(join(FIXTURES, "repo-nousage"));
    assert.equal(r.verdict, "IN-SYNC");
    assert.equal(r.counts.used, 0);
    assert.equal(r.counts.documented, 0);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.counts.stale, 0);
    assert.equal(r.summary, "no env usage found");
    assert.ok(r.findings.every((f) => f.severity === "info"), "nousage report must be info-only");
  });
});

describe("usage patterns", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "envdoc-core-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  it("finds bracket, import.meta, and python forms", () => {
    write("a.js", 'const a = process.env["BRACKET_VAR"];\n');
    write("b.ts", "export const b = import.meta.env.META_VAR;\n");
    write("c.py", 'import os\nX = os.environ["PY_BRACKET"]\nY = os.environ.get("PY_GET")\nZ = os.getenv("PY_GETENV")\n');
    write(".env.example", "BRACKET_VAR=\nMETA_VAR=\nPY_BRACKET=\nPY_GET=\nPY_GETENV=\n");
    const r = runCheck(dir);
    assert.equal(r.counts.used, 5);
    assert.equal(r.counts.documented, 5);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.verdict, "IN-SYNC");
  });

  it("ignores lowercase process.env names and dynamic access", () => {
    write("a.ts", "const a = process.env.lowercase_name;\nconst b = process.env[dynamicName];\nconst c = process.env.UPPER_OK;\n");
    write(".env.example", "UPPER_OK=\n");
    const r = runCheck(dir);
    assert.equal(r.counts.used, 1);
    assert.equal(r.counts.missing, 0);
  });

  it("skips node_modules, dist, and fixtures directories", () => {
    write("app.ts", "export const a = process.env.MAIN_VAR;\n");
    write("node_modules/pkg/index.js", "const x = process.env.HIDDEN_ONE;\n");
    write("dist/out.js", "const x = process.env.HIDDEN_TWO;\n");
    write("fixtures/sample/app.ts", "export const x = process.env.HIDDEN_THREE;\n");
    write(".env.example", "MAIN_VAR=\n");
    const r = runCheck(dir);
    assert.equal(r.counts.used, 1);
    assert.equal(r.counts.missing, 0);
  });

  it("parses export prefix and falls back to .env.sample", () => {
    write("app.ts", "export const a = process.env.SAMPLE_VAR;\n");
    write(".env.sample", "export SAMPLE_VAR=placeholder\n");
    const r = runCheck(dir);
    assert.equal(r.counts.documented, 1);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.verdict, "IN-SYNC");
  });

  it("never includes example values in the report", () => {
    write("app.ts", "export const a = process.env.SECRET_CHECK;\n");
    write(".env.example", "SECRET_CHECK=super-secret-value-12345\nOTHER_UNUSED=another-secret-67890\n");
    const r = runCheck(dir);
    const serialized = JSON.stringify(r) + renderReport(r);
    assert.ok(!serialized.includes("super-secret-value-12345"), "example value must never appear in report");
    assert.ok(!serialized.includes("another-secret-67890"), "example value must never appear in report");
    assert.equal(r.counts.stale, 1);
  });

  it("always-ok list is never flagged as stale", () => {
    write("app.ts", "export const a = process.env.USED_ONE;\n");
    write(".env.example", "USED_ONE=\nNODE_ENV=\nPORT=\nHOST=\nCI=\nDEBUG=\n");
    const r = runCheck(dir);
    assert.equal(r.counts.documented, 6);
    assert.equal(r.counts.stale, 0);
    assert.ok(!rules(r).includes("DOCUMENTED-NOT-USED"));
  });

  it("ordering is deterministic by var name", () => {
    write("app.ts", "export const a = process.env.ZULU_VAR;\nexport const b = process.env.ALPHA_VAR;\nexport const c = process.env.MIKE_VAR;\n");
    write(".env.example", "ALPHA_VAR=\n");
    const r = runCheck(dir);
    const missing = r.findings.filter((f) => f.rule === "USED-NOT-DOCUMENTED");
    assert.deepEqual(missing.map((f) => f.evidence), ["MIKE_VAR", "ZULU_VAR"]);
    const rendered = renderReport(r);
    assert.match(rendered, /envdoc check/);
    assert.match(rendered, /DRIFT/);
  });
});
