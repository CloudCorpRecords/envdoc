# envdoc
Environment documentation checker: scans code for actual env var usage (process.env, import.meta.env, os.environ, getenv) and diffs it against .env.example, reporting used-but-undocumented, documented-but-unused, and undocumented-default vars.
