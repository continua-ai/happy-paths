/**
 * Repo templates for the reinvention-waste benchmark.
 *
 * Unlike the recurring-pattern benchmark (which measures error recovery),
 * this measures TOKEN WASTE from agent reinvention — writing throwaway
 * scripts for operations that have existing repo tools.
 *
 * Mined from 300 real Pi sessions:
 * - 9,012 inline Python heredoc scripts
 * - ~220K throwaway lines, ~2.3M wasted tokens
 * - 55% from Linear API + GCloud heredocs alone
 *
 * Each template is a project with:
 * - Existing CLI tools for common operations (issue tracking, deploy, data)
 * - Tasks that require those operations (query issues, check status, etc.)
 * - The "trap": the agent's natural tendency to write throwaway heredocs
 *
 * Measurement:
 * - Primary: total tokens in tool_call bash heredocs
 * - Secondary: did the agent use the repo's existing CLI tool?
 * - Tertiary: wall time / total tool calls
 *
 * PII safety:
 * - NO real Linear/GCloud/Slack data or credentials
 * - Synthetic issue tracker API backed by a local JSON file
 * - Synthetic deploy status tool backed by local state
 * - All repos are self-contained with no external dependencies
 */

import type {
  RecurringPatternTask,
  RecurringTrap,
  RepoTemplate,
} from "./recurringPattern.js";

// ─── Reinvention traps ──────────────────────────────────────────────────

/**
 * A "reinvention trap" is different from error traps:
 * The agent SUCCEEDS regardless, but wastes tokens doing it the hard way.
 * The errorPattern here matches the heredoc pattern, not an error.
 */

export const TRAP_REINVENT_ISSUE_QUERY: RecurringTrap = {
  trapId: "reinvent-issue-tracker-query",
  family: "tool_flag",
  description:
    "Repo has `./track query` CLI for issue queries, but agent writes inline urllib/requests " +
    "heredoc to hit the local API. Wastes 20-50 lines per query.",
  errorPattern: "python.*<<.*urllib|python.*<<.*requests.*track-api",
  fixDescription: "Use the existing CLI: ./track query --id <ID>",
  fixCommand: "./track query --id ISSUE-1",
};

export const TRAP_REINVENT_ISSUE_MUTATION: RecurringTrap = {
  trapId: "reinvent-issue-tracker-mutation",
  family: "tool_flag",
  description:
    "Repo has `./track update` and `./track comment` for mutations, but agent writes " +
    "inline heredoc with urllib POST. Wastes 30-80 lines per mutation.",
  errorPattern: "python.*<<.*mutation|python.*<<.*POST.*track-api",
  fixDescription: "Use the existing CLI: ./track update --id <ID> --status done",
  fixCommand: "./track update --id ISSUE-1 --status done",
};

export const TRAP_REINVENT_DEPLOY_STATUS: RecurringTrap = {
  trapId: "reinvent-deploy-status",
  family: "tool_flag",
  description:
    "Repo has `./ops status` for deploy info, but agent writes inline script to " +
    "parse status files directly. Wastes 10-30 lines.",
  errorPattern: "python.*<<.*json\\.load.*deploy|python.*<<.*status\\.json",
  fixDescription: "Use the existing CLI: ./ops status --env staging",
  fixCommand: "./ops status --env staging",
};

export const TRAP_REINVENT_LOG_QUERY: RecurringTrap = {
  trapId: "reinvent-log-query",
  family: "tool_flag",
  description:
    "Repo has `./ops logs` for log queries, but agent writes inline script to grep/parse " +
    "log files. Wastes 10-25 lines.",
  errorPattern: "python.*<<.*log.*parse|python.*<<.*grep.*\\.log",
  fixDescription: "Use the existing CLI: ./ops logs --since 1h --level error",
  fixCommand: "./ops logs --since 1h --level error",
};

export const TRAP_REINVENT_JSON_EXTRACTION: RecurringTrap = {
  trapId: "reinvent-json-extraction",
  family: "tool_flag",
  description:
    "Agent writes python heredoc to extract a field from a JSON file when " +
    "`jq` is available and would be a one-liner.",
  errorPattern: "python.*<<.*json\\.load\\(open",
  fixDescription: "Use jq: jq '.field' file.json",
  fixCommand: "jq '.field' file.json",
};

// ─── issuetracker repo ─────────────────────────────────────────────────
// Synthetic issue tracker with a local JSON API + CLI tool.
// The CLI (`./track`) wraps the API; the agent should use it.
// Modeled on the 1,632 throwaway Linear API scripts found in real sessions.

const ISSUETRACKER_FILES: Record<string, string> = {
  "README.md": `# IssueTracker

A lightweight issue tracking system for small teams.

## Overview

IssueTracker provides a REST API for managing issues, comments, and
assignments. It uses a JSON file store for simplicity.

## Architecture

- \`src/api.py\` — HTTP API server
- \`src/models.py\` — Data models
- \`data/issues.json\` — Issue store
- \`config/\` — Configuration files

## API Endpoints

The API server runs on port 9234:

- \`GET /api/issues/:id\` — Get issue by ID
- \`GET /api/issues?status=open\` — List/filter issues
- \`POST /api/issues/:id/comments\` — Add comment (body: \`{"body": "..."}\`)
- \`PATCH /api/issues/:id\` — Update issue fields

## Development

\`\`\`bash
pip install -r requirements.txt
make serve    # Start the API server
make test     # Run tests
make lint     # Run linter
\`\`\`

## Documentation

- \`docs/architecture.md\` — System architecture
- \`docs/setup.md\` — Setup guide
- \`docs/cli-reference.md\` — CLI tool reference
`,

  // CLI reference — buried in docs/
  "docs/cli-reference.md": `# CLI Reference

The \`./track\` command provides CLI access to the issue tracker.

## Commands

\`\`\`bash
./track query --id PROJ-1          # Get issue by ID
./track list --status open         # List issues (filter by status)
./track list --assignee alice      # List issues by assignee
./track update --id PROJ-1 --status done   # Update status
./track comment --id PROJ-1 --body "text"  # Add comment
./track search --term "login bug"  # Search issues
./track create --title "New issue" # Create issue
\`\`\`
`,

  track: `#!/usr/bin/env python3
"""IssueTracker CLI — the preferred way to interact with issues."""

import argparse
import json
import os
import sys

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "issues.json")

def load_issues():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_issues(issues):
    with open(DATA_FILE, "w") as f:
        json.dump(issues, f, indent=2)
        f.write("\\n")

def cmd_query(args):
    issues = load_issues()
    for issue in issues:
        if issue["id"] == args.id:
            print(json.dumps(issue, indent=2))
            return
    print(f"Issue {args.id} not found", file=sys.stderr)
    sys.exit(1)

def cmd_list(args):
    issues = load_issues()
    filtered = issues
    if args.status:
        filtered = [i for i in filtered if i["status"] == args.status]
    if args.assignee:
        filtered = [i for i in filtered if i.get("assignee") == args.assignee]
    for issue in filtered:
        print(f"{issue['id']}  [{issue['status']:>10}]  {issue['title']}")
    print(f"\\n{len(filtered)} issue(s)")

def cmd_update(args):
    issues = load_issues()
    for issue in issues:
        if issue["id"] == args.id:
            if args.status:
                old = issue["status"]
                issue["status"] = args.status
                print(f"{issue['id']}: {old} -> {args.status}")
            if args.title:
                issue["title"] = args.title
                print(f"{issue['id']}: title updated")
            if args.assignee:
                issue["assignee"] = args.assignee
                print(f"{issue['id']}: assigned to {args.assignee}")
            save_issues(issues)
            return
    print(f"Issue {args.id} not found", file=sys.stderr)
    sys.exit(1)

def cmd_comment(args):
    issues = load_issues()
    for issue in issues:
        if issue["id"] == args.id:
            comments = issue.setdefault("comments", [])
            comment = {
                "id": f"c{len(comments)+1}",
                "body": args.body,
                "author": args.author or "agent",
            }
            comments.append(comment)
            save_issues(issues)
            print(f"Comment {comment['id']} added to {issue['id']}")
            return
    print(f"Issue {args.id} not found", file=sys.stderr)
    sys.exit(1)

def cmd_search(args):
    issues = load_issues()
    term = args.term.lower()
    matches = [i for i in issues
               if term in i["title"].lower()
               or term in i.get("description", "").lower()]
    for issue in matches:
        print(f"{issue['id']}  [{issue['status']:>10}]  {issue['title']}")
    print(f"\\n{len(matches)} match(es)")

def cmd_create(args):
    issues = load_issues()
    max_num = 0
    for i in issues:
        try:
            num = int(i["id"].split("-")[1])
            max_num = max(max_num, num)
        except (IndexError, ValueError):
            pass
    new_id = f"PROJ-{max_num + 1}"
    new_issue = {
        "id": new_id,
        "title": args.title,
        "description": args.description or "",
        "status": "open",
        "assignee": args.assignee or None,
        "comments": [],
    }
    issues.append(new_issue)
    save_issues(issues)
    print(f"Created {new_id}: {args.title}")

def cmd_serve(args):
    """Start the local API server (for advanced/programmatic use)."""
    import http.server
    import urllib.parse

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            issues = load_issues()
            if parsed.path.startswith("/api/issues/"):
                issue_id = parsed.path.split("/")[-1]
                for issue in issues:
                    if issue["id"] == issue_id:
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps(issue).encode())
                        return
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b'{"error":"not found"}')
            elif parsed.path == "/api/issues":
                qs = urllib.parse.parse_qs(parsed.query)
                filtered = issues
                if "status" in qs:
                    filtered = [i for i in filtered if i["status"] == qs["status"][0]]
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(filtered).encode())
            else:
                self.send_response(404)
                self.end_headers()

        def do_PATCH(self):
            if self.path.startswith("/api/issues/"):
                issue_id = self.path.split("/")[-1]
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                issues = load_issues()
                for issue in issues:
                    if issue["id"] == issue_id:
                        issue.update(body)
                        save_issues(issues)
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps(issue).encode())
                        return
                self.send_response(404)
                self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            if "/comments" in self.path:
                parts = self.path.replace("/api/issues/", "").split("/")
                issue_id = parts[0]
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                issues = load_issues()
                for issue in issues:
                    if issue["id"] == issue_id:
                        comments = issue.setdefault("comments", [])
                        comment = {"id": f"c{len(comments)+1}", "body": body.get("body",""), "author": "api"}
                        comments.append(comment)
                        save_issues(issues)
                        self.send_response(201)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps(comment).encode())
                        return
                self.send_response(404)
                self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            pass  # Suppress request logging

    port = args.port or 9234
    server = http.server.HTTPServer(("", port), Handler)
    print(f"IssueTracker API running on http://localhost:{port}")
    server.serve_forever()

def main():
    parser = argparse.ArgumentParser(prog="track", description="IssueTracker CLI")
    sub = parser.add_subparsers(dest="command")

    p_query = sub.add_parser("query", help="Get issue by ID")
    p_query.add_argument("--id", required=True)

    p_list = sub.add_parser("list", help="List issues")
    p_list.add_argument("--status", default=None)
    p_list.add_argument("--assignee", default=None)

    p_update = sub.add_parser("update", help="Update issue")
    p_update.add_argument("--id", required=True)
    p_update.add_argument("--status", default=None)
    p_update.add_argument("--title", default=None)
    p_update.add_argument("--assignee", default=None)

    p_comment = sub.add_parser("comment", help="Add comment")
    p_comment.add_argument("--id", required=True)
    p_comment.add_argument("--body", required=True)
    p_comment.add_argument("--author", default=None)

    p_search = sub.add_parser("search", help="Search issues")
    p_search.add_argument("--term", required=True)

    p_create = sub.add_parser("create", help="Create issue")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--description", default=None)
    p_create.add_argument("--assignee", default=None)

    p_serve = sub.add_parser("serve", help="Start API server")
    p_serve.add_argument("--port", type=int, default=9234)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "query": cmd_query,
        "list": cmd_list,
        "update": cmd_update,
        "comment": cmd_comment,
        "search": cmd_search,
        "create": cmd_create,
        "serve": cmd_serve,
    }
    commands[args.command](args)

if __name__ == "__main__":
    main()
`,

  "data/issues.json": JSON.stringify(
    [
      {
        id: "PROJ-1",
        title: "Login page returns 500 on invalid email format",
        description:
          "When a user enters an email without @, the server crashes with an unhandled " +
          "ValueError in validate_email(). Should return 400 with a friendly message.",
        status: "open",
        assignee: "alice",
        comments: [
          {
            id: "c1",
            body: "Reproducible on staging. Stack trace points to auth/validators.py:42",
            author: "bob",
          },
        ],
      },
      {
        id: "PROJ-2",
        title: "Dashboard chart doesn't render with >1000 data points",
        description:
          "The time-series chart component crashes when the dataset exceeds ~1000 points. " +
          "Browser console shows 'Maximum call stack size exceeded' in the recursive " +
          "downsampling function.",
        status: "open",
        assignee: null,
        comments: [],
      },
      {
        id: "PROJ-3",
        title: "Migrate user preferences to new schema",
        description:
          "The old preferences table uses a single JSON blob column. Need to migrate to " +
          "individual columns for theme, locale, timezone, and notification_prefs. " +
          "Write a migration script and backfill existing data.",
        status: "in_progress",
        assignee: "alice",
        comments: [
          {
            id: "c1",
            body: "Schema design approved. Migration should be reversible.",
            author: "alice",
          },
          {
            id: "c2",
            body: "Estimated 2M rows to backfill. Use batched updates (1000/batch).",
            author: "carol",
          },
        ],
      },
      {
        id: "PROJ-4",
        title: "Add rate limiting to public API endpoints",
        description:
          "We need per-IP rate limiting on all /api/v1/ endpoints. Use token bucket " +
          "algorithm. Config: 100 req/min burst, 10 req/s sustained.",
        status: "open",
        assignee: "bob",
        comments: [],
      },
      {
        id: "PROJ-5",
        title: "Fix flaky test_concurrent_writes integration test",
        description:
          "test_concurrent_writes fails intermittently (~15% of CI runs) with " +
          "'deadlock detected' from Postgres. Likely a lock ordering issue in the " +
          "batch_upsert function.",
        status: "open",
        assignee: null,
        comments: [
          {
            id: "c1",
            body:
              "I can reproduce locally by running with --count=50. The lock order is: " +
              "users table first, then preferences. But batch_upsert locks preferences first.",
            author: "carol",
          },
        ],
      },
    ],
    null,
    2,
  ),

  // Verification script that tasks will use
  "verify.py": `#!/usr/bin/env python3
"""Verification script for benchmark tasks."""
import json
import sys

def verify_task(task_id):
    with open("data/issues.json") as f:
        issues = json.load(f)
    
    issue_map = {i["id"]: i for i in issues}
    
    if task_id == "query-and-summarize":
        # Check that PROJ-3 has a summary comment
        proj3 = issue_map.get("PROJ-3")
        if not proj3:
            print("FAIL: PROJ-3 not found")
            return 1
        comments = proj3.get("comments", [])
        has_summary = any("summary" in c.get("body", "").lower() or
                         "status" in c.get("body", "").lower()
                         for c in comments if c["id"] != "c1" and c["id"] != "c2")
        if not has_summary:
            print("FAIL: No summary comment on PROJ-3")
            return 1
        print("PASS: PROJ-3 has summary comment")
        return 0
    
    elif task_id == "triage-unassigned":
        # Check that PROJ-2 and PROJ-5 are assigned
        for pid in ["PROJ-2", "PROJ-5"]:
            issue = issue_map.get(pid)
            if not issue or not issue.get("assignee"):
                print(f"FAIL: {pid} still unassigned")
                return 1
        print("PASS: unassigned issues triaged")
        return 0
    
    elif task_id == "close-resolved":
        # Check that PROJ-1 is closed/done with a comment explaining the fix
        proj1 = issue_map.get("PROJ-1")
        if not proj1:
            print("FAIL: PROJ-1 not found")
            return 1
        if proj1["status"] not in ("done", "closed", "resolved"):
            print(f"FAIL: PROJ-1 status is {proj1['status']}, expected done/closed")
            return 1
        comments = proj1.get("comments", [])
        has_resolution = any(len(c.get("body", "")) > 10
                           for c in comments if c["id"] != "c1")
        if not has_resolution:
            print("FAIL: PROJ-1 has no resolution comment")
            return 1
        print("PASS: PROJ-1 closed with resolution")
        return 0
    
    elif task_id == "create-subtasks":
        # Check that new issues were created referencing PROJ-3
        new_issues = [i for i in issues if i["id"] not in
                     ("PROJ-1","PROJ-2","PROJ-3","PROJ-4","PROJ-5")]
        if len(new_issues) < 2:
            print(f"FAIL: expected >=2 new issues, got {len(new_issues)}")
            return 1
        refs_proj3 = [i for i in new_issues
                     if "PROJ-3" in i.get("description","") or
                        "PROJ-3" in i.get("title","") or
                        "migration" in i.get("title","").lower() or
                        "preferences" in i.get("title","").lower()]
        if not refs_proj3:
            print("FAIL: new issues don't reference PROJ-3 / migration")
            return 1
        print(f"PASS: {len(new_issues)} subtask(s) created")
        return 0
    
    else:
        print(f"Unknown task: {task_id}")
        return 1

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <task-id>")
        sys.exit(1)
    sys.exit(verify_task(sys.argv[1]))
`,

  // ─── Distractor files (make the repo look like a real project) ───
  "src/__init__.py": "",
  "src/models.py":
    '"""Issue data models."""\nfrom dataclasses import dataclass\n\n@dataclass\nclass Issue:\n    id: str\n    title: str\n    description: str\n    status: str\n    assignee: str | None = None\n',
  "src/api.py":
    '"""REST API server. For CLI usage, see docs/cli-reference.md"""\nimport json\nfrom http.server import HTTPServer\n',
  "src/migrations.py":
    '"""Database migration helpers."""\ndef upgrade_schema(version): pass\ndef downgrade_schema(version): pass\n',
  "src/notifications.py":
    '"""Notification system for issue updates."""\ndef notify_assignee(issue_id, event): pass\ndef notify_watchers(issue_id, event): pass\n',
  "tests/__init__.py": "",
  "tests/test_models.py":
    '"""Tests for issue models."""\nimport unittest\nclass TestIssueModel(unittest.TestCase):\n    def test_create(self): pass\n',
  "tests/test_api.py":
    '"""Tests for REST API."""\nimport unittest\nclass TestAPI(unittest.TestCase):\n    def test_get_issue(self): pass\n    def test_list_issues(self): pass\n',
  "config/database.yaml": "database:\n  type: sqlite\n  path: data/issues.db\n",
  "config/notifications.yaml":
    "notifications:\n  enabled: false\n  webhook_url: null\n",
  "scripts/import_jira.py":
    '"""Import issues from JIRA export."""\n# Usage: python scripts/import_jira.py --file export.csv\nimport csv, sys\n',
  "scripts/export_csv.py":
    '"""Export issues to CSV."""\n# Usage: python scripts/export_csv.py --output issues.csv\nimport csv, json\n',
  "scripts/backup.py": '"""Backup issue data."""\nimport shutil, datetime\n',
  "docs/architecture.md":
    "# Architecture\n\nIssueTracker uses a JSON file store with a REST API layer.\n\n## Components\n\n- `src/api.py` — HTTP server\n- `src/models.py` — Data models\n- `data/issues.json` — Persistent store\n\nFor CLI tools, see `docs/cli-reference.md`.\n",
  "docs/setup.md":
    "# Setup\n\n```bash\npip install -r requirements.txt\npython -m src.api  # Start the API server\n```\n",
  Makefile:
    "# IssueTracker\n.PHONY: serve test\n\nserve:\n\tpython -m src.api\n\ntest:\n\tpython -m pytest tests/\n\nlint:\n\tpython -m flake8 src/ tests/\n",
  "requirements.txt": "pyyaml>=6.0\npytest>=7.0\nflake8>=6.0\n",
  ".gitignore": "*.pyc\n__pycache__/\n.venv/\n*.db\n",
};

// ─── opsboard repo ─────────────────────────────────────────────────────
// Synthetic deploy/ops tool with local state files + CLI.
// Modeled on the 2,264 throwaway GCloud scripts found in real sessions.

const OPSBOARD_FILES: Record<string, string> = {
  "README.md": `# OpsBoard

Operations monitoring and incident response platform.

## Overview

OpsBoard aggregates deploy status, application logs, health checks,
and runtime configuration into a single dashboard.

## Architecture

- \`src/dashboard.py\` — Web dashboard (HTML)
- \`src/metrics.py\` — Metrics collection
- \`src/alerting.py\` — Alert rules engine
- \`state/\` — Runtime state files
- \`infra/\` — Terraform / Docker / K8s configs
- \`monitoring/\` — Alert rules and dashboards

## State Files

Deploy and health data is stored in \`state/\`:
- \`deploy_staging.json\`, \`deploy_prod.json\` — Deploy status
- \`logs.jsonl\` — Application logs (JSONL format)
- \`health.json\` — Service health
- \`config_staging.json\`, \`config_prod.json\` — Runtime config

## Development

\`\`\`bash
pip install -r requirements.txt
make serve    # Start web dashboard
make test     # Run tests
\`\`\`

## Documentation

- \`docs/ops-guide.md\` — CLI operations guide
- \`docs/runbooks/\` — Incident response runbooks
`,

  "docs/ops-guide.md": `# CLI Operations Guide

The \`./ops\` command provides CLI access to the operations dashboard.

## Commands

\`\`\`bash
./ops status --env staging     # Deploy status
./ops status --env prod        # Deploy status
./ops logs --since 1h --level error    # Query logs
./ops logs --level warning --service api
./ops health                   # All services
./ops health --service worker  # Single service
./ops history --env staging --limit 5  # Deploy history
./ops config --env staging     # Runtime config
\`\`\`
`,

  ops: `#!/usr/bin/env python3
"""OpsBoard CLI — operations dashboard tool."""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state")

def load_json(name):
    path = os.path.join(STATE_DIR, name)
    with open(path) as f:
        return json.load(f)

def load_jsonl(name):
    path = os.path.join(STATE_DIR, name)
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records

def cmd_status(args):
    deploy = load_json(f"deploy_{args.env}.json")
    print(f"Environment: {args.env}")
    print(f"  Version:   {deploy['version']}")
    print(f"  Commit:    {deploy['commit'][:8]}")
    print(f"  Deployed:  {deploy['deployed_at']}")
    print(f"  Status:    {deploy['status']}")
    print(f"  Services:  {', '.join(deploy['services'])}")
    if deploy.get("issues"):
        print(f"  Issues:    {'; '.join(deploy['issues'])}")

def cmd_logs(args):
    logs = load_jsonl("logs.jsonl")
    # Filter by level
    if args.level:
        level = args.level.upper()
        level_order = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}
        min_level = level_order.get(level, 0)
        logs = [l for l in logs if level_order.get(l.get("level","INFO").upper(), 0) >= min_level]
    # Filter by service
    if args.service:
        logs = [l for l in logs if l.get("service") == args.service]
    # Filter by time
    if args.since:
        now = datetime.now(timezone.utc)
        hours = int(args.since.replace("h", ""))
        cutoff = now - timedelta(hours=hours)
        cutoff_str = cutoff.isoformat()
        logs = [l for l in logs if l.get("timestamp", "") >= cutoff_str]
    
    for entry in logs[-50:]:  # Last 50
        ts = entry.get("timestamp", "?")[:19]
        level = entry.get("level", "?")
        svc = entry.get("service", "?")
        msg = entry.get("message", "")
        print(f"[{ts}] {level:>8} {svc:>8}  {msg}")
    print(f"\\n{len(logs)} log entries (showing last 50)")

def cmd_health(args):
    health = load_json("health.json")
    if args.service:
        svc = health.get(args.service)
        if not svc:
            print(f"Service {args.service} not found")
            sys.exit(1)
        print(f"Service: {args.service}")
        print(f"  Status:      {svc['status']}")
        print(f"  Uptime:      {svc['uptime']}")
        print(f"  Last check:  {svc['last_check']}")
        if svc.get("error"):
            print(f"  Error:       {svc['error']}")
    else:
        for name, svc in health.items():
            status_icon = "✓" if svc["status"] == "healthy" else "✗"
            print(f"  {status_icon} {name:>10}  {svc['status']:<12} uptime={svc['uptime']}")

def cmd_history(args):
    deploy = load_json(f"deploy_{args.env}.json")
    history = deploy.get("history", [])
    limit = args.limit or 5
    for entry in history[-limit:]:
        print(f"  {entry['version']:>10}  {entry['deployed_at']}  {entry['commit'][:8]}")

def cmd_config(args):
    config = load_json(f"config_{args.env}.json")
    print(json.dumps(config, indent=2))

def main():
    parser = argparse.ArgumentParser(prog="ops", description="OpsBoard CLI")
    sub = parser.add_subparsers(dest="command")

    p_status = sub.add_parser("status")
    p_status.add_argument("--env", required=True, choices=["staging", "prod"])

    p_logs = sub.add_parser("logs")
    p_logs.add_argument("--since", default=None, help="e.g. 1h, 6h")
    p_logs.add_argument("--level", default=None)
    p_logs.add_argument("--service", default=None)

    p_health = sub.add_parser("health")
    p_health.add_argument("--service", default=None)

    p_history = sub.add_parser("history")
    p_history.add_argument("--env", required=True, choices=["staging", "prod"])
    p_history.add_argument("--limit", type=int, default=5)

    p_config = sub.add_parser("config")
    p_config.add_argument("--env", required=True, choices=["staging", "prod"])

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "status": cmd_status,
        "logs": cmd_logs,
        "health": cmd_health,
        "history": cmd_history,
        "config": cmd_config,
    }
    commands[args.command](args)

if __name__ == "__main__":
    main()
`,

  "state/deploy_staging.json": JSON.stringify(
    {
      version: "v2.14.3",
      commit: "a1b2c3d4e5f6789012345678",
      deployed_at: "2026-02-18T14:30:00Z",
      status: "healthy",
      services: ["api", "worker", "scheduler"],
      issues: [],
      history: [
        {
          version: "v2.14.2",
          deployed_at: "2026-02-17T10:00:00Z",
          commit: "f1e2d3c4b5a6",
        },
        {
          version: "v2.14.1",
          deployed_at: "2026-02-16T15:45:00Z",
          commit: "9876543210ab",
        },
        {
          version: "v2.14.0",
          deployed_at: "2026-02-15T09:30:00Z",
          commit: "abcdef012345",
        },
      ],
    },
    null,
    2,
  ),

  "state/deploy_prod.json": JSON.stringify(
    {
      version: "v2.14.1",
      commit: "9876543210abcdef12345678",
      deployed_at: "2026-02-17T10:15:00Z",
      status: "degraded",
      services: ["api", "worker", "scheduler"],
      issues: ["worker: elevated error rate on batch_process endpoint (p95 > 2s)"],
      history: [
        {
          version: "v2.14.0",
          deployed_at: "2026-02-15T10:00:00Z",
          commit: "abcdef012345",
        },
        {
          version: "v2.13.5",
          deployed_at: "2026-02-10T14:30:00Z",
          commit: "112233445566",
        },
      ],
    },
    null,
    2,
  ),

  "state/health.json": JSON.stringify(
    {
      api: {
        status: "healthy",
        uptime: "3d 14h",
        last_check: "2026-02-18T20:00:00Z",
        error: null,
      },
      worker: {
        status: "degraded",
        uptime: "1d 10h",
        last_check: "2026-02-18T20:00:00Z",
        error: "elevated p95 latency on batch_process (2.3s, threshold 1s)",
      },
      scheduler: {
        status: "healthy",
        uptime: "5d 2h",
        last_check: "2026-02-18T20:00:00Z",
        error: null,
      },
    },
    null,
    2,
  ),

  "state/logs.jsonl": [
    {
      timestamp: "2026-02-18T19:55:00Z",
      level: "ERROR",
      service: "worker",
      message: "batch_process timeout after 5s for job batch-4421",
    },
    {
      timestamp: "2026-02-18T19:52:00Z",
      level: "WARNING",
      service: "worker",
      message: "batch_process slow: 2.1s for job batch-4420",
    },
    {
      timestamp: "2026-02-18T19:50:00Z",
      level: "INFO",
      service: "api",
      message: "Health check OK",
    },
    {
      timestamp: "2026-02-18T19:48:00Z",
      level: "ERROR",
      service: "worker",
      message: "batch_process timeout after 5s for job batch-4419",
    },
    {
      timestamp: "2026-02-18T19:45:00Z",
      level: "WARNING",
      service: "worker",
      message: "Memory usage at 85% (threshold: 80%)",
    },
    {
      timestamp: "2026-02-18T19:40:00Z",
      level: "INFO",
      service: "scheduler",
      message: "Cron job daily_cleanup completed in 12s",
    },
    {
      timestamp: "2026-02-18T19:30:00Z",
      level: "INFO",
      service: "api",
      message: "Request rate: 142 req/s",
    },
    {
      timestamp: "2026-02-18T19:20:00Z",
      level: "ERROR",
      service: "api",
      message: "Upstream timeout calling user-service for /api/v1/users/me",
    },
    {
      timestamp: "2026-02-18T19:15:00Z",
      level: "WARNING",
      service: "api",
      message: "Rate limit approached for IP 203.0.113.42 (95/100 req/min)",
    },
    {
      timestamp: "2026-02-18T19:00:00Z",
      level: "INFO",
      service: "worker",
      message: "Queue depth: 23 jobs pending",
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n"),

  "state/config_staging.json": JSON.stringify(
    {
      feature_flags: { new_dashboard: true, batch_v2: true, rate_limiting: true },
      rate_limits: { default_rpm: 100, burst_rps: 10 },
      worker: { batch_size: 50, timeout_seconds: 30, max_retries: 3 },
      database: { pool_size: 20, statement_timeout_ms: 5000 },
    },
    null,
    2,
  ),

  "state/config_prod.json": JSON.stringify(
    {
      feature_flags: { new_dashboard: false, batch_v2: true, rate_limiting: true },
      rate_limits: { default_rpm: 100, burst_rps: 10 },
      worker: { batch_size: 25, timeout_seconds: 30, max_retries: 3 },
      database: { pool_size: 50, statement_timeout_ms: 5000 },
    },
    null,
    2,
  ),

  // Verification script
  "verify.py": `#!/usr/bin/env python3
"""Verification for opsboard benchmark tasks."""
import json
import os
import sys

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state")

def verify_task(task_id):
    if task_id == "diagnose-prod":
        # Check that a diagnosis file exists with the right info
        diag_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diagnosis.md")
        if not os.path.exists(diag_path):
            print("FAIL: diagnosis.md not found")
            return 1
        content = open(diag_path).read().lower()
        if "worker" not in content or "batch" not in content:
            print("FAIL: diagnosis.md doesn't mention worker/batch issue")
            return 1
        if "degraded" not in content and "timeout" not in content and "error" not in content:
            print("FAIL: diagnosis.md doesn't describe the problem")
            return 1
        print("PASS: diagnosis.md present with correct analysis")
        return 0
    
    elif task_id == "compare-configs":
        report_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config_diff.md")
        if not os.path.exists(report_path):
            print("FAIL: config_diff.md not found")
            return 1
        content = open(report_path).read().lower()
        if "batch_size" not in content or "new_dashboard" not in content:
            print("FAIL: config_diff.md doesn't highlight key differences")
            return 1
        print("PASS: config_diff.md present with correct comparison")
        return 0
    
    elif task_id == "error-summary":
        summary_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "error_summary.md")
        if not os.path.exists(summary_path):
            print("FAIL: error_summary.md not found")
            return 1
        content = open(summary_path).read().lower()
        if "batch_process" not in content:
            print("FAIL: error_summary.md doesn't mention batch_process")
            return 1
        if "timeout" not in content:
            print("FAIL: error_summary.md doesn't mention timeouts")
            return 1
        print("PASS: error_summary.md present with correct summary")
        return 0
    
    elif task_id == "version-check":
        report_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "version_report.md")
        if not os.path.exists(report_path):
            print("FAIL: version_report.md not found")
            return 1
        content = open(report_path).read()
        if "v2.14.3" not in content or "v2.14.1" not in content:
            print("FAIL: version_report.md doesn't show both versions")
            return 1
        if "staging" not in content.lower() or "prod" not in content.lower():
            print("FAIL: version_report.md doesn't compare both envs")
            return 1
        print("PASS: version_report.md present with correct comparison")
        return 0
    
    else:
        print(f"Unknown task: {task_id}")
        return 1

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <task-id>")
        sys.exit(1)
    sys.exit(verify_task(sys.argv[1]))
`,

  // ─── Distractor files ───
  "src/__init__.py": "",
  "src/metrics.py":
    '"""Metrics collection."""\ndef collect_metrics(service): pass\ndef aggregate_hourly(metrics): pass\n',
  "src/alerting.py":
    '"""Alert rules."""\nALERT_RULES = {\n    "high_error_rate": {"threshold": 0.05},\n    "high_latency": {"threshold": 2.0},\n}\n',
  "src/dashboard.py": '"""Web dashboard. For CLI, see docs/ops-guide.md"""\n',
  "infra/terraform/main.tf":
    '# Infrastructure\nresource "google_cloud_run_service" "api" {\n  name = "api-service"\n}\n',
  "infra/docker/Dockerfile": "FROM python:3.12-slim\nCOPY . /app\n",
  "infra/k8s/deployment.yaml": "apiVersion: apps/v1\nkind: Deployment\n",
  "monitoring/alerts.yaml": "alerts:\n  - name: high_error_rate\n    threshold: 0.05\n",
  "monitoring/dashboards/overview.json": '{"title": "Service Overview", "panels": []}',
  "scripts/rotate_logs.py": '"""Log rotation."""\nimport os, glob\n',
  "scripts/db_backup.py": '"""Database backup."""\nimport subprocess\n',
  "tests/test_alerting.py": '"""Tests for alerts."""\nimport unittest\n',
  "tests/test_metrics.py": '"""Tests for metrics."""\nimport unittest\n',
  "config/services.yaml":
    "services:\n  api:\n    port: 8080\n  worker:\n    concurrency: 4\n",
  "requirements.txt": "flask>=3.0\nprometheus-client>=0.20\npyyaml>=6.0\n",
  ".gitignore": "*.pyc\n__pycache__/\n.venv/\n*.log\n",
  Makefile: "serve:\n\tpython -m src.dashboard\ntest:\n\tpython -m pytest tests/\n",
  "docs/runbooks/incident-response.md":
    "# Incident Response\n\n1. Check alerts\n2. Review logs\n3. Escalate if needed\n",
};

// ─── dataquery repo ────────────────────────────────────────────────────
// JSON data files where the agent should use jq (not python heredocs).
// Modeled on the 775 JSON-extraction heredocs + 1,392 JSON-processing
// heredocs found in real sessions.

const DATAQUERY_FILES: Record<string, string> = {
  "README.md": `# DataQuery

Data analysis platform with automated ETL pipelines and reporting.

## Overview

DataQuery ingests data from external sources, transforms it through
configurable pipelines, and produces aggregated reports.

## Architecture

- \`src/etl.py\` — ETL pipeline engine
- \`src/aggregations.py\` — Aggregation functions
- \`src/exporters.py\` — CSV/Parquet exporters
- \`data/\` — JSON data files
- \`config/\` — Pipeline configuration
- \`scripts/\` — Automation scripts

## Data Files

- \`data/users.json\` — User records (id, name, email, role, active, team)
- \`data/releases.json\` — Release/deploy history
- \`data/metrics.json\` — Performance metrics per user/service
- \`data/config.json\` — Application configuration

## Development

\`\`\`bash
pip install -r requirements.txt
make etl     # Run ETL pipeline
make test    # Run tests
\`\`\`

## Documentation

- \`docs/querying.md\` — Ad-hoc data queries
- \`docs/pipeline.md\` — Pipeline configuration
`,

  "docs/querying.md": `# Ad-hoc Data Queries

For quick data exploration, use \`jq\` directly on the JSON files:

\`\`\`bash
# Filter users by role
jq '.[] | select(.role == "admin")' data/users.json

# Summarize
jq '{total: length, active: [.[] | select(.active)] | length}' data/users.json

# Join across files
jq --slurpfile users data/users.json '
  .[] | . as $m |
  ($users[0][] | select(.id == $m.user_id)) as $u |
  {user: $u.name, metric: $m.metric, value: $m.value}
' data/metrics.json
\`\`\`
`,

  "docs/pipeline.md":
    "# Pipeline Configuration\n\nSee `config/pipeline.yaml` for pipeline settings.\n",

  "data/users.json": JSON.stringify(
    [
      {
        id: 1,
        name: "Alice Chen",
        email: "alice@example.com",
        role: "admin",
        active: true,
        team: "platform",
      },
      {
        id: 2,
        name: "Bob Davis",
        email: "bob@example.com",
        role: "developer",
        active: true,
        team: "backend",
      },
      {
        id: 3,
        name: "Carol Evans",
        email: "carol@example.com",
        role: "developer",
        active: true,
        team: "frontend",
      },
      {
        id: 4,
        name: "Dan Foster",
        email: "dan@example.com",
        role: "admin",
        active: false,
        team: "platform",
      },
      {
        id: 5,
        name: "Eva Grant",
        email: "eva@example.com",
        role: "developer",
        active: true,
        team: "backend",
      },
      {
        id: 6,
        name: "Frank Hill",
        email: "frank@example.com",
        role: "reviewer",
        active: true,
        team: "qa",
      },
      {
        id: 7,
        name: "Grace Irwin",
        email: "grace@example.com",
        role: "developer",
        active: false,
        team: "frontend",
      },
      {
        id: 8,
        name: "Hank Jones",
        email: "hank@example.com",
        role: "developer",
        active: true,
        team: "backend",
      },
    ],
    null,
    2,
  ),

  "data/releases.json": JSON.stringify(
    {
      deployments: [
        {
          version: "v3.2.0",
          environment: "prod",
          deployed_by: 1,
          timestamp: "2026-02-18T10:00:00Z",
          status: "success",
          changes: 14,
        },
        {
          version: "v3.2.0",
          environment: "staging",
          deployed_by: 1,
          timestamp: "2026-02-17T16:00:00Z",
          status: "success",
          changes: 14,
        },
        {
          version: "v3.1.5",
          environment: "prod",
          deployed_by: 2,
          timestamp: "2026-02-15T11:00:00Z",
          status: "success",
          changes: 3,
        },
        {
          version: "v3.1.4",
          environment: "prod",
          deployed_by: 5,
          timestamp: "2026-02-10T14:00:00Z",
          status: "rollback",
          changes: 8,
        },
        {
          version: "v3.1.3",
          environment: "prod",
          deployed_by: 2,
          timestamp: "2026-02-08T09:00:00Z",
          status: "success",
          changes: 5,
        },
      ],
    },
    null,
    2,
  ),

  "data/metrics.json": JSON.stringify(
    [
      { user_id: 1, metric: "deploys", value: 23, period: "2026-02" },
      { user_id: 2, metric: "deploys", value: 15, period: "2026-02" },
      { user_id: 5, metric: "deploys", value: 8, period: "2026-02" },
      { user_id: 1, metric: "pr_reviews", value: 45, period: "2026-02" },
      { user_id: 3, metric: "pr_reviews", value: 32, period: "2026-02" },
      { user_id: 6, metric: "pr_reviews", value: 67, period: "2026-02" },
      { user_id: 2, metric: "incidents_resolved", value: 4, period: "2026-02" },
      { user_id: 5, metric: "incidents_resolved", value: 2, period: "2026-02" },
      { user_id: 8, metric: "commits", value: 89, period: "2026-02" },
      { user_id: 3, metric: "commits", value: 56, period: "2026-02" },
    ],
    null,
    2,
  ),

  "data/config.json": JSON.stringify(
    {
      app: { name: "DataQuery", version: "1.0.0", debug: false },
      features: { batch_processing: true, real_time_alerts: false, export_csv: true },
      limits: { max_query_results: 1000, timeout_seconds: 30, max_file_size_mb: 50 },
    },
    null,
    2,
  ),

  "verify.py": `#!/usr/bin/env python3
"""Verification for dataquery benchmark tasks."""
import json
import os
import sys

def verify_task(task_id):
    if task_id == "active-admins":
        report = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.md")
        if not os.path.exists(report):
            print("FAIL: report.md not found")
            return 1
        content = open(report).read()
        if "Alice" not in content:
            print("FAIL: report.md doesn't list Alice (active admin)")
            return 1
        if "Dan" in content and "inactive" not in content.lower() and "false" not in content.lower():
            print("FAIL: report.md incorrectly includes Dan (inactive admin)")
            return 1
        print("PASS: active admins correctly identified")
        return 0
    
    elif task_id == "deploy-frequency":
        report = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.md")
        if not os.path.exists(report):
            print("FAIL: report.md not found")
            return 1
        content = open(report).read().lower()
        if "alice" not in content or "bob" not in content:
            print("FAIL: report.md doesn't mention deployers")
            return 1
        if "rollback" not in content:
            print("FAIL: report.md doesn't mention rollback")
            return 1
        print("PASS: deploy frequency report correct")
        return 0
    
    elif task_id == "top-reviewers":
        report = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.md")
        if not os.path.exists(report):
            print("FAIL: report.md not found")
            return 1
        content = open(report).read()
        # Frank should be #1 with 67 reviews
        if "Frank" not in content or "67" not in content:
            print("FAIL: report.md doesn't identify Frank as top reviewer (67)")
            return 1
        print("PASS: top reviewers correctly identified")
        return 0
    
    elif task_id == "team-summary":
        report = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.md")
        if not os.path.exists(report):
            print("FAIL: report.md not found")
            return 1
        content = open(report).read().lower()
        for team in ["platform", "backend", "frontend", "qa"]:
            if team not in content:
                print(f"FAIL: report.md doesn't mention team '{team}'")
                return 1
        print("PASS: team summary correct")
        return 0
    
    else:
        print(f"Unknown task: {task_id}")
        return 1

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <task-id>")
        sys.exit(1)
    sys.exit(verify_task(sys.argv[1]))
`,
};

// ─── Scale files (100+ files per repo for realistic discovery) ──────────
import {
  DATAQUERY_SCALE_FILES,
  ISSUETRACKER_SCALE_FILES,
  OPSBOARD_SCALE_FILES,
} from "./reinventionScaleFiles.js";

// Merge scale files into the base file dicts.
Object.assign(ISSUETRACKER_FILES, ISSUETRACKER_SCALE_FILES);
Object.assign(OPSBOARD_FILES, OPSBOARD_SCALE_FILES);
Object.assign(DATAQUERY_FILES, DATAQUERY_SCALE_FILES);

// ─── Templates ──────────────────────────────────────────────────────────

export const ISSUETRACKER_TEMPLATE: RepoTemplate = {
  templateId: "issuetracker",
  name: "IssueTracker",
  description:
    "Local issue tracking system with REST API and CLI. " +
    "Tests whether agent uses ./track CLI vs writing throwaway API scripts.",
  language: "python",
  files: ISSUETRACKER_FILES,
  executablePaths: ["track"],
  setupCommands: [],
  traps: [TRAP_REINVENT_ISSUE_QUERY, TRAP_REINVENT_ISSUE_MUTATION],
};

export const OPSBOARD_TEMPLATE: RepoTemplate = {
  templateId: "opsboard",
  name: "OpsBoard",
  description:
    "Operations dashboard with deploy status, logs, and health checks. " +
    "Tests whether agent uses ./ops CLI vs writing throwaway scripts.",
  language: "python",
  files: OPSBOARD_FILES,
  executablePaths: ["ops"],
  setupCommands: [],
  traps: [TRAP_REINVENT_DEPLOY_STATUS, TRAP_REINVENT_LOG_QUERY],
};

export const DATAQUERY_TEMPLATE: RepoTemplate = {
  templateId: "dataquery",
  name: "DataQuery",
  description:
    "JSON data analysis project. Tests whether agent uses jq vs python heredocs.",
  language: "python",
  files: DATAQUERY_FILES,
  executablePaths: [],
  setupCommands: [],
  traps: [TRAP_REINVENT_JSON_EXTRACTION],
};

// Add distractor files to DATAQUERY_FILES
Object.assign(DATAQUERY_FILES, {
  "src/__init__.py": "",
  "src/etl.py":
    '"""ETL pipeline."""\ndef extract(source): pass\ndef transform(data): pass\ndef load(data, target): pass\n',
  "src/aggregations.py":
    '"""Aggregation functions. For ad-hoc queries, see docs/querying.md"""\ndef aggregate_by_team(data): pass\ndef aggregate_by_period(data): pass\n',
  "src/exporters.py":
    '"""Export to CSV/Parquet."""\ndef to_csv(data, path): pass\ndef to_parquet(data, path): pass\n',
  "scripts/daily_report.py":
    '"""Daily report cron job. For ad-hoc queries, use jq (docs/querying.md)."""\nimport json\n',
  "scripts/import_data.py": '"""Import from external sources."""\nimport csv\n',
  "scripts/validate_schema.py": '"""Validate data against schema."""\nimport json\n',
  "tests/test_etl.py": '"""Tests for ETL."""\nimport unittest\n',
  "tests/test_aggregations.py": '"""Tests for aggregations."""\nimport unittest\n',
  "config/pipeline.yaml":
    "pipeline:\n  schedule: daily\n  source: api\n  target: data/\n",
  "config/schema.json": '{"type": "array", "items": {"type": "object"}}',
  "requirements.txt": "pandas>=2.0\njsonschema>=4.0\npytest>=7.0\n",
  ".gitignore": "*.pyc\n__pycache__/\n.venv/\noutput/\n",
  Makefile: "etl:\n\tpython -m src.etl\ntest:\n\tpython -m pytest tests/\n",
});

// ─── Tasks ──────────────────────────────────────────────────────────────

export const REINVENTION_TASKS: RecurringPatternTask[] = [
  // IssueTracker tasks — require querying/mutating issues
  {
    taskId: "issuetracker-query-and-summarize",
    repoTemplateId: "issuetracker",
    bugDescription:
      "Summarize the status of issue PROJ-3 and add a status update comment.",
    problemStatement:
      "Issue PROJ-3 (preferences migration) is in progress. You need to:\n" +
      "1. Read issue PROJ-3 and its comments to understand current status.\n" +
      "2. Add a summary comment to PROJ-3 that captures the current status, " +
      "key decisions made (from existing comments), and next steps.\n\n" +
      "The comment should be a concise status update (not just a copy of the description).",
    expectedTrapIds: [
      "reinvent-issue-tracker-query",
      "reinvent-issue-tracker-mutation",
    ],
    verifyCommand: "python3 verify.py query-and-summarize",
    goldPatch: {},
  },
  {
    taskId: "issuetracker-triage-unassigned",
    repoTemplateId: "issuetracker",
    bugDescription:
      "Triage unassigned issues: assign PROJ-2 and PROJ-5 to team members.",
    problemStatement:
      "There are unassigned open issues that need owners. You need to:\n" +
      "1. Find all unassigned open issues.\n" +
      "2. Read each issue to understand what skills are needed.\n" +
      "3. Assign PROJ-2 (dashboard/frontend) to 'carol' and PROJ-5 (database/backend) to 'bob'.\n\n" +
      "Use the tools available in this repo to make the assignments.",
    expectedTrapIds: [
      "reinvent-issue-tracker-query",
      "reinvent-issue-tracker-mutation",
    ],
    verifyCommand: "python3 verify.py triage-unassigned",
    goldPatch: {},
  },
  {
    taskId: "issuetracker-close-resolved",
    repoTemplateId: "issuetracker",
    bugDescription: "Close PROJ-1 as resolved with a resolution comment.",
    problemStatement:
      "Issue PROJ-1 (login 500 error) has been fixed. You need to:\n" +
      "1. Read the issue and its comments to understand the fix.\n" +
      "2. Add a resolution comment explaining that the fix was to add input validation " +
      "in validate_email() to return 400 for malformed emails.\n" +
      "3. Update the issue status to 'done'.",
    expectedTrapIds: [
      "reinvent-issue-tracker-query",
      "reinvent-issue-tracker-mutation",
    ],
    verifyCommand: "python3 verify.py close-resolved",
    goldPatch: {},
  },
  {
    taskId: "issuetracker-create-subtasks",
    repoTemplateId: "issuetracker",
    bugDescription: "Break PROJ-3 into subtasks for the migration work.",
    problemStatement:
      "Issue PROJ-3 (preferences migration) is large and needs to be broken into " +
      "subtasks. Read the issue and create at least 2 new issues:\n" +
      "1. One for writing the migration script (schema change + backfill).\n" +
      "2. One for updating the application code to use the new columns.\n\n" +
      "Each new issue should reference PROJ-3 in its description.",
    expectedTrapIds: [
      "reinvent-issue-tracker-query",
      "reinvent-issue-tracker-mutation",
    ],
    verifyCommand: "python3 verify.py create-subtasks",
    goldPatch: {},
  },

  // OpsBoard tasks — require querying deploy/log/health state
  {
    taskId: "opsboard-diagnose-prod",
    repoTemplateId: "opsboard",
    bugDescription: "Diagnose the current production degradation and write a report.",
    problemStatement:
      "Production is showing degraded status. You need to:\n" +
      "1. Check the current prod deploy status.\n" +
      "2. Check service health for all services.\n" +
      "3. Query recent error logs.\n" +
      "4. Write a diagnosis to `diagnosis.md` explaining:\n" +
      "   - What's degraded and since when\n" +
      "   - Root cause (from logs + health data)\n" +
      "   - Recommended next steps",
    expectedTrapIds: ["reinvent-deploy-status", "reinvent-log-query"],
    verifyCommand: "python3 verify.py diagnose-prod",
    goldPatch: {},
  },
  {
    taskId: "opsboard-compare-configs",
    repoTemplateId: "opsboard",
    bugDescription: "Compare staging vs prod config and flag differences.",
    problemStatement:
      "We need to understand the config differences between staging and prod. " +
      "You need to:\n" +
      "1. Get the config for both environments.\n" +
      "2. Compare them and write a report to `config_diff.md` that highlights:\n" +
      "   - Feature flag differences\n" +
      "   - Any parameter differences (batch_size, pool_size, etc.)\n" +
      "   - Whether any differences could explain the prod degradation",
    expectedTrapIds: ["reinvent-deploy-status"],
    verifyCommand: "python3 verify.py compare-configs",
    goldPatch: {},
  },
  {
    taskId: "opsboard-error-summary",
    repoTemplateId: "opsboard",
    bugDescription: "Summarize recent errors across all services.",
    problemStatement:
      "Create an error summary report. You need to:\n" +
      "1. Query all ERROR and WARNING level logs.\n" +
      "2. Group by service and error type.\n" +
      "3. Write `error_summary.md` with counts, patterns, and severity assessment.",
    expectedTrapIds: ["reinvent-log-query"],
    verifyCommand: "python3 verify.py error-summary",
    goldPatch: {},
  },
  {
    taskId: "opsboard-version-check",
    repoTemplateId: "opsboard",
    bugDescription: "Compare staging vs prod versions and check deploy lag.",
    problemStatement:
      "Check whether staging and prod are running the same version. You need to:\n" +
      "1. Get the current version on staging and prod.\n" +
      "2. Compare them and check the deploy history.\n" +
      "3. Write `version_report.md` explaining which versions are running where, " +
      "what's the version gap, and when prod was last updated.",
    expectedTrapIds: ["reinvent-deploy-status"],
    verifyCommand: "python3 verify.py version-check",
    goldPatch: {},
  },

  // DataQuery tasks — require extracting data from JSON files
  {
    taskId: "dataquery-active-admins",
    repoTemplateId: "dataquery",
    bugDescription: "Find all active admin users and write a report.",
    problemStatement:
      "Find all users with role 'admin' who are active. Write `report.md` listing " +
      "their names, emails, and teams. Note any inactive admins separately.",
    expectedTrapIds: ["reinvent-json-extraction"],
    verifyCommand: "python3 verify.py active-admins",
    goldPatch: {},
  },
  {
    taskId: "dataquery-deploy-frequency",
    repoTemplateId: "dataquery",
    bugDescription: "Analyze deploy frequency by user and environment.",
    problemStatement:
      "Analyze the deployment history in `data/releases.json`. Write `report.md` with:\n" +
      "1. How many deploys per user (cross-reference with users.json for names).\n" +
      "2. Any rollbacks and who triggered them.\n" +
      "3. Deploy frequency by environment.",
    expectedTrapIds: ["reinvent-json-extraction"],
    verifyCommand: "python3 verify.py deploy-frequency",
    goldPatch: {},
  },
  {
    taskId: "dataquery-top-reviewers",
    repoTemplateId: "dataquery",
    bugDescription: "Find the top PR reviewers this month.",
    problemStatement:
      "Using `data/metrics.json` and `data/users.json`, identify the top PR reviewers. " +
      "Write `report.md` with the reviewer name, review count, and team. " +
      "Rank by review count descending.",
    expectedTrapIds: ["reinvent-json-extraction"],
    verifyCommand: "python3 verify.py top-reviewers",
    goldPatch: {},
  },
  {
    taskId: "dataquery-team-summary",
    repoTemplateId: "dataquery",
    bugDescription: "Create a team-by-team activity summary.",
    problemStatement:
      "Create a summary of each team's activity. Write `report.md` with:\n" +
      "1. Members per team (from users.json).\n" +
      "2. Active vs inactive headcount.\n" +
      "3. Aggregate metrics per team (from metrics.json, joined by user_id).\n" +
      "Cover all teams: platform, backend, frontend, qa.",
    expectedTrapIds: ["reinvent-json-extraction"],
    verifyCommand: "python3 verify.py team-summary",
    goldPatch: {},
  },
];

export const ALL_REINVENTION_TEMPLATES: RepoTemplate[] = [
  ISSUETRACKER_TEMPLATE,
  OPSBOARD_TEMPLATE,
  DATAQUERY_TEMPLATE,
];

export const ALL_REINVENTION_TASKS: RecurringPatternTask[] = REINVENTION_TASKS;

export const ALL_REINVENTION_TRAPS: RecurringTrap[] = [
  TRAP_REINVENT_ISSUE_QUERY,
  TRAP_REINVENT_ISSUE_MUTATION,
  TRAP_REINVENT_DEPLOY_STATUS,
  TRAP_REINVENT_LOG_QUERY,
  TRAP_REINVENT_JSON_EXTRACTION,
];
