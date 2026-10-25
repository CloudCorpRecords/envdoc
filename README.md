# envdoc

Diff environment variables used in code against .env.example.

envdoc scans source files for actual env var reads and compares the names it finds with the names documented in .env.example (or .env.sample). It reports vars that are used but not documented, vars that are documented but never used, and whether the repo is in sync or has drifted. Values are never read into the report: only names are compared.

## What it does

- Walks the target directory and scans .ts, .js, .mjs, .cjs, and .py files.
- Skips node_modules, .git, dist, and any directory named fixtures.
- Finds usages of these forms:
  - process.env.NAME
  - process.env["NAME"] and process.env['NAME']
  - import.meta.env.NAME
  - os.environ["NAME"] and os.environ['NAME']
  - os.environ.get("NAME") and os.environ.get('NAME')
  - os.getenv("NAME") and os.getenv('NAME')
- Reads .env.example at the repo root, or .env.sample if .env.example is not present (first found wins). Names come from lines of the form KEY= or export KEY=. Only the left side of = is parsed.
- Emits a deterministic report: findings are ordered by var name, files are walked in sorted order, and no timestamps are included.

Name pattern: NAME is [A-Z][A-Z0-9_]* . Names must start with an uppercase letter and contain only uppercase letters, digits, and underscores. Lowercase-start names after process.env are ignored by design. See Limits for details.

## Install

```bash
npx @reneturcios/envdoc check
```

Or run from a checkout:

```bash
npm install
npm run build
node dist/cli.js check .
```

## CLI

```bash
# Check the current directory (human readable output)
npx @reneturcios/envdoc check

# Check another path
npx @reneturcios/envdoc check path/to/repo

# Machine readable output
npx @reneturcios/envdoc check path/to/repo --json

# Start the MCP server on stdio
npx @reneturcios/envdoc mcp

# Print the version
npx @reneturcios/envdoc --version
```

Exit codes:

- 0 when the verdict is IN-SYNC
- 1 when the verdict is DRIFT
- 2 on usage error
- 141 when the reader closed the output pipe early (the shell-visible equivalent of SIGPIPE)

Example output:

```
envdoc check .: DRIFT
  DRIFT: 2 used, 1 documented, 1 missing, 0 stale.
  counts: used 2, documented 1, missing 1, stale 0
  findings (2):
    [MEDIUM] app.ts:2 USED-NOT-DOCUMENTED FEATURE_CHARLIE is used in code but not documented in .env.example
    [INFO] VALUES-IGNORED Values are ignored: only variable names are compared, values are never read into the report
DRIFT: at least one medium or high finding. Document the missing vars or add an example file.
```

## MCP server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "envdoc": {
      "command": "npx",
      "args": ["-y", "@reneturcios/envdoc", "mcp"]
    }
  }
}
```

Tools:

- check_env_docs: scan a repo path and return the full report as JSON. Input is a single path string. The report contains the verdict, counts (used, documented, missing, stale), findings, and a summary. Values are never included.

Docker:

```bash
docker run -i ghcr.io/cloudcorprecords/envdoc:0.1.0 mcp
```

## Rules

| Rule | Severity | Meaning |
| --- | --- | --- |
| USED-NOT-DOCUMENTED | medium | A var is used in code but not listed in the example file. The finding carries the file and line of first use. One finding per var. |
| DOCUMENTED-NOT-USED | low | A var is listed in the example file but never used in code. One finding per var. Vars on the always-ok list are excluded. |
| NO-EXAMPLE | high | No .env.example or .env.sample was found but code uses at least one var. One finding per report. |
| VALUES-IGNORED | info | Values are never read into the report. Only names are parsed; for the example file only the left side of = is read. Exactly one finding per report. |

Counts in every report:

- used: number of distinct vars found in code
- documented: number of distinct vars listed in the example file
- missing: number of used vars that are not documented (the count of USED-NOT-DOCUMENTED findings)
- stale: number of documented vars that are never used and are not on the always-ok list (the count of DOCUMENTED-NOT-USED findings)

## Always-ok list

These vars are never flagged as documented-not-used, even when no code in the repo reads them. They are commonly set by the platform, the runtime, or CI rather than by application code:

- NODE_ENV
- PORT
- HOST
- CI
- DEBUG

The list applies only to the DOCUMENTED-NOT-USED rule. If code uses one of these vars and it is not documented, it is still reported as USED-NOT-DOCUMENTED like any other var.

## Verdict rules

- IN-SYNC: no medium or high findings. Low and info findings may still be present. Exit code 0.
- DRIFT: at least one medium or high finding. Exit code 1.

Special case: if no example file exists and code uses no vars at all, the verdict is IN-SYNC, all findings are info severity, and the summary is "no env usage found".

If no example file exists and code does use vars, the verdict is DRIFT with a high NO-EXAMPLE finding plus one USED-NOT-DOCUMENTED finding per missing var.

## Limits

- Name patterns only, values never read. envdoc compares names only. It never reads, stores, or prints env values. For the example file it parses only the left side of = on each line. For code it matches only the literal name patterns listed above.
- Only uppercase names are tracked. A name must match [A-Z][A-Z0-9_]* . Lowercase-start names after process.env are ignored. Mixed-case names that start with a lowercase letter are not tracked.
- Dynamic env access cannot be tracked. Code that computes the var name at runtime, such as process.env[someVar], process.env[prefix + suffix], or os.environ[some_var], names no literal var in the source and is not reported. Audit dynamic keys separately.
- Only the listed access forms are recognized. Other forms such as destructuring (const { FOO } = process.env), os.environ.NAME attribute access, or framework helpers are not detected in this version.
- Only .ts, .js, .mjs, .cjs, and .py files are scanned. Other file types are ignored.
- The example file is looked up only at the target root as .env.example, then .env.sample. Nested example files are not merged.
- Static analysis only. Nothing in a scanned repo is executed.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
