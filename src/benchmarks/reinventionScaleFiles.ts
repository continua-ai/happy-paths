/**
 * Generate additional files for reinvention benchmark repos to bring them
 * to 100-200+ files each. Files are realistic enough that an agent
 * browsing the repo would need to examine them to determine relevance.
 *
 * Strategy per repo:
 * - issuetracker: looks like a Django-ish project with models, views, serializers, migrations, management commands
 * - opsboard: looks like a monitoring platform with collectors, exporters, dashboards, terraform modules
 * - dataquery: looks like a data engineering project with pipelines, schemas, notebooks, dbt models
 */

/** Generate Python module files with realistic content. */
function pyModule(docstring: string, imports: string[], body: string): string {
  const lines: string[] = [];
  lines.push(`"""${docstring}"""`);
  if (imports.length > 0) {
    lines.push("");
    for (const imp of imports) lines.push(imp);
  }
  lines.push("");
  lines.push(body);
  return `${lines.join("\n")}\n`;
}

// ─── issuetracker scale files ────────────────────────────────────────

export const ISSUETRACKER_SCALE_FILES: Record<string, string> = {};

// src/ packages — make it look like a real Python project
const issueModules = [
  [
    "src/auth.py",
    "Authentication and authorization.",
    ["import hashlib", "import hmac"],
    "def verify_token(token: str) -> bool:\n    return len(token) > 0\n\ndef create_token(user_id: str) -> str:\n    return hashlib.sha256(user_id.encode()).hexdigest()",
  ],
  [
    "src/validators.py",
    "Input validation utilities.",
    ["import re"],
    "def validate_email(email: str) -> bool:\n    return bool(re.match(r'^[^@]+@[^@]+\\.[^@]+$', email))\n\ndef validate_issue_id(issue_id: str) -> bool:\n    return bool(re.match(r'^PROJ-\\d+$', issue_id))",
  ],
  [
    "src/serializers.py",
    "Data serialization for API responses.",
    ["import json"],
    "def serialize_issue(issue: dict) -> dict:\n    return {k: v for k, v in issue.items() if v is not None}\n\ndef serialize_comment(comment: dict) -> dict:\n    return comment",
  ],
  [
    "src/webhooks.py",
    "Webhook delivery for integrations.",
    ["import urllib.request", "import json"],
    "WEBHOOK_URLS: list[str] = []\n\ndef deliver_webhook(event: str, payload: dict) -> None:\n    for url in WEBHOOK_URLS:\n        pass  # TODO: implement",
  ],
  [
    "src/search.py",
    "Full-text search implementation.",
    [],
    "def build_index(issues: list[dict]) -> dict:\n    index: dict = {}\n    for issue in issues:\n        for word in issue.get('title', '').lower().split():\n            index.setdefault(word, []).append(issue['id'])\n    return index",
  ],
  [
    "src/permissions.py",
    "Role-based access control.",
    [],
    "ROLES = {'admin': ['read', 'write', 'delete'], 'member': ['read', 'write'], 'viewer': ['read']}\n\ndef check_permission(role: str, action: str) -> bool:\n    return action in ROLES.get(role, [])",
  ],
  [
    "src/export.py",
    "Export issues to various formats.",
    ["import csv", "import io"],
    "def export_csv(issues: list[dict]) -> str:\n    output = io.StringIO()\n    writer = csv.DictWriter(output, fieldnames=['id', 'title', 'status'])\n    writer.writeheader()\n    for issue in issues:\n        writer.writerow({k: issue.get(k) for k in ['id', 'title', 'status']})\n    return output.getvalue()",
  ],
  [
    "src/import_utils.py",
    "Import issues from external sources.",
    ["import json"],
    "def import_from_json(path: str) -> list[dict]:\n    with open(path) as f:\n        return json.load(f)",
  ],
  [
    "src/cache.py",
    "In-memory caching layer.",
    [],
    "class SimpleCache:\n    def __init__(self):\n        self._store: dict = {}\n    def get(self, key: str): return self._store.get(key)\n    def set(self, key: str, value): self._store[key] = value",
  ],
  [
    "src/metrics_collector.py",
    "Collect usage metrics.",
    [],
    "from dataclasses import dataclass, field\n\n@dataclass\nclass MetricsCollector:\n    counters: dict = field(default_factory=dict)\n    def increment(self, name: str) -> None:\n        self.counters[name] = self.counters.get(name, 0) + 1",
  ],
  [
    "src/middleware.py",
    "HTTP middleware for the API server.",
    [],
    "def cors_middleware(handler):\n    def wrapper(*args, **kwargs):\n        return handler(*args, **kwargs)\n    return wrapper",
  ],
  [
    "src/rate_limiter.py",
    "Rate limiting for API endpoints.",
    ["import time"],
    "class RateLimiter:\n    def __init__(self, max_per_minute: int = 60):\n        self.max = max_per_minute\n        self.requests: list[float] = []\n    def allow(self) -> bool:\n        now = time.time()\n        self.requests = [t for t in self.requests if now - t < 60]\n        if len(self.requests) >= self.max:\n            return False\n        self.requests.append(now)\n        return True",
  ],
];

for (const [path, doc, imports, body] of issueModules) {
  ISSUETRACKER_SCALE_FILES[path as string] = pyModule(
    doc as string,
    imports as string[],
    body as string,
  );
}

// tests
const issueTests = [
  "tests/test_auth.py",
  "tests/test_validators.py",
  "tests/test_serializers.py",
  "tests/test_webhooks.py",
  "tests/test_search.py",
  "tests/test_permissions.py",
  "tests/test_export.py",
  "tests/test_cache.py",
  "tests/test_rate_limiter.py",
];
for (const path of issueTests) {
  const mod = path.replace("tests/test_", "").replace(".py", "");
  ISSUETRACKER_SCALE_FILES[path] =
    `"""Tests for ${mod}."""\nimport unittest\n\nclass Test${mod.charAt(0).toUpperCase() + mod.slice(1)}(unittest.TestCase):\n    def test_placeholder(self): pass\n`;
}

// scripts
const issueScripts: [string, string][] = [
  ["scripts/migrate_v2.py", "Migrate issue data from v1 to v2 schema."],
  ["scripts/generate_report.py", "Generate weekly activity report."],
  ["scripts/clean_stale.py", "Archive issues with no activity in 90 days."],
  ["scripts/sync_external.py", "Sync issues with external tracker (Jira/GH)."],
  ["scripts/validate_data.py", "Validate data/issues.json against schema."],
  ["scripts/benchmark_search.py", "Benchmark full-text search performance."],
  ["scripts/seed_demo_data.py", "Create demo issues for testing."],
  ["scripts/health_check.py", "Check API server health."],
];
for (const [path, desc] of issueScripts) {
  ISSUETRACKER_SCALE_FILES[path] =
    `#!/usr/bin/env python3\n"""${desc}"""\nimport sys\n\ndef main():\n    print("${desc}")\n\nif __name__ == "__main__":\n    main()\n`;
}

// config / docs / misc
Object.assign(ISSUETRACKER_SCALE_FILES, {
  "config/api.yaml":
    "api:\n  host: 0.0.0.0\n  port: 9234\n  workers: 4\n  debug: false\n",
  "config/logging.yaml":
    "logging:\n  level: INFO\n  format: json\n  file: /var/log/issuetracker.log\n",
  "config/integrations.yaml":
    "integrations:\n  slack:\n    enabled: false\n    webhook_url: null\n  jira:\n    enabled: false\n    base_url: null\n",
  "docs/api-reference.md":
    "# API Reference\n\nSee `src/api.py` for endpoint implementations.\n\n## Authentication\n\nInclude `Authorization: Bearer <token>` header.\n\n## Endpoints\n\nSee README.md for the list of endpoints.\n",
  "docs/contributing.md":
    "# Contributing\n\n1. Fork the repo\n2. Create a feature branch\n3. Run tests: `make test`\n4. Submit a PR\n",
  "docs/deployment.md":
    "# Deployment\n\n## Docker\n\n```bash\ndocker build -t issuetracker .\ndocker run -p 9234:9234 issuetracker\n```\n\n## Manual\n\n```bash\npip install -r requirements.txt\npython -m src.api\n```\n",
  "docs/data-model.md":
    "# Data Model\n\nIssues are stored in `data/issues.json`.\n\n## Fields\n\n- `id`: Unique identifier (PROJ-N)\n- `title`: Issue title\n- `description`: Detailed description\n- `status`: open, in_progress, done, closed\n- `assignee`: Username or null\n- `comments`: Array of comment objects\n",
  "migrations/001_initial.py":
    '"""Initial schema."""\ndef upgrade():\n    pass\ndef downgrade():\n    pass\n',
  "migrations/002_add_labels.py":
    '"""Add labels field to issues."""\ndef upgrade():\n    pass\ndef downgrade():\n    pass\n',
  "migrations/__init__.py": "",
  ".env.example": "API_PORT=9234\nDEBUG=false\nLOG_LEVEL=INFO\n",
  Dockerfile:
    'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nCMD ["python", "-m", "src.api"]\n',
  "docker-compose.yaml":
    "version: '3.8'\nservices:\n  api:\n    build: .\n    ports:\n      - '9234:9234'\n",
  "pyproject.toml":
    '[project]\nname = "issuetracker"\nversion = "1.0.0"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
});

// ─── opsboard scale files ────────────────────────────────────────────

export const OPSBOARD_SCALE_FILES: Record<string, string> = {};

const opsModules = [
  [
    "src/collectors/cloudwatch.py",
    "CloudWatch metrics collector.",
    [],
    "def collect_cloudwatch(namespace: str) -> list:\n    return []",
  ],
  [
    "src/collectors/prometheus.py",
    "Prometheus metrics scraper.",
    [],
    "def scrape_prometheus(endpoint: str) -> dict:\n    return {}",
  ],
  [
    "src/collectors/statsd.py",
    "StatsD receiver.",
    [],
    "def start_statsd_server(port: int = 8125): pass",
  ],
  ["src/collectors/__init__.py", "Metrics collectors.", [], ""],
  [
    "src/exporters/slack.py",
    "Slack alert notifications.",
    [],
    "def send_slack_alert(webhook: str, message: str): pass",
  ],
  [
    "src/exporters/pagerduty.py",
    "PagerDuty incident creation.",
    [],
    "def create_incident(service_key: str, description: str): pass",
  ],
  [
    "src/exporters/email.py",
    "Email notifications.",
    [],
    "def send_email(to: str, subject: str, body: str): pass",
  ],
  ["src/exporters/__init__.py", "Alert exporters.", [], ""],
  [
    "src/rules_engine.py",
    "Alert rules evaluation engine.",
    [],
    "class RulesEngine:\n    def __init__(self, rules: list): self.rules = rules\n    def evaluate(self, metrics: dict) -> list:\n        return []",
  ],
  [
    "src/aggregator.py",
    "Time-series aggregation.",
    [],
    "def aggregate_1m(data_points: list) -> dict:\n    return {}\ndef aggregate_5m(data_points: list) -> dict:\n    return {}",
  ],
  [
    "src/retention.py",
    "Data retention and cleanup.",
    [],
    "def cleanup_old_data(days: int = 30): pass",
  ],
  [
    "src/config_loader.py",
    "Load and validate configuration.",
    ["import yaml"],
    "def load_config(path: str) -> dict:\n    with open(path) as f:\n        return yaml.safe_load(f)",
  ],
  [
    "src/health_checker.py",
    "Service health check implementation.",
    ["import urllib.request"],
    "def check_http(url: str, timeout: int = 5) -> bool:\n    try:\n        urllib.request.urlopen(url, timeout=timeout)\n        return True\n    except Exception:\n        return False",
  ],
  [
    "src/log_parser.py",
    "Parse structured log files.",
    ["import json"],
    "def parse_jsonl(path: str) -> list[dict]:\n    with open(path) as f:\n        return [json.loads(line) for line in f if line.strip()]",
  ],
];

for (const [path, doc, imports, body] of opsModules) {
  OPSBOARD_SCALE_FILES[path as string] = pyModule(
    doc as string,
    imports as string[],
    body as string,
  );
}

const opsTests = [
  "tests/test_rules_engine.py",
  "tests/test_aggregator.py",
  "tests/test_retention.py",
  "tests/test_config_loader.py",
  "tests/test_health_checker.py",
  "tests/test_log_parser.py",
  "tests/test_collectors.py",
  "tests/test_exporters.py",
];
for (const path of opsTests) {
  const mod = path.replace("tests/test_", "").replace(".py", "");
  OPSBOARD_SCALE_FILES[path] =
    `"""Tests for ${mod}."""\nimport unittest\n\nclass Test${mod.charAt(0).toUpperCase() + mod.slice(1)}(unittest.TestCase):\n    def test_placeholder(self): pass\n`;
}

const opsScripts: [string, string][] = [
  ["scripts/generate_daily_report.py", "Generate daily ops report email."],
  ["scripts/sync_pagerduty.py", "Sync incidents with PagerDuty."],
  ["scripts/audit_permissions.py", "Audit IAM permissions across services."],
  ["scripts/cleanup_old_logs.py", "Delete log files older than retention period."],
  ["scripts/export_metrics_csv.py", "Export metrics to CSV for analysis."],
  ["scripts/validate_alerts.py", "Validate alert rule configurations."],
  ["scripts/simulate_incident.py", "Simulate an incident for testing."],
  ["scripts/check_ssl_certs.py", "Check SSL certificate expiration."],
];
for (const [path, desc] of opsScripts) {
  OPSBOARD_SCALE_FILES[path] =
    `#!/usr/bin/env python3\n"""${desc}"""\nimport sys\n\ndef main():\n    print("${desc}")\n\nif __name__ == "__main__":\n    main()\n`;
}

Object.assign(OPSBOARD_SCALE_FILES, {
  "infra/terraform/variables.tf":
    'variable "project_id" {\n  type = string\n}\nvariable "region" {\n  type    = string\n  default = "us-central1"\n}\n',
  "infra/terraform/outputs.tf":
    'output "service_url" {\n  value = google_cloud_run_service.api.status[0].url\n}\n',
  "infra/terraform/monitoring.tf":
    '# Monitoring resources\nresource "google_monitoring_alert_policy" "high_error_rate" {\n  display_name = "High Error Rate"\n}\n',
  "infra/k8s/service.yaml":
    "apiVersion: v1\nkind: Service\nmetadata:\n  name: opsboard\nspec:\n  type: LoadBalancer\n  ports:\n    - port: 80\n      targetPort: 8080\n",
  "infra/k8s/configmap.yaml":
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: opsboard-config\ndata:\n  LOG_LEVEL: INFO\n",
  "monitoring/dashboards/services.json":
    '{"title": "Services Dashboard", "panels": [{"type": "graph", "title": "Request Rate"}]}',
  "monitoring/dashboards/errors.json":
    '{"title": "Error Dashboard", "panels": [{"type": "table", "title": "Recent Errors"}]}',
  "monitoring/rules/availability.yaml":
    "groups:\n  - name: availability\n    rules:\n      - alert: ServiceDown\n        expr: up == 0\n        for: 5m\n",
  "docs/architecture.md":
    "# Architecture\n\nOpsBoard collects metrics from multiple sources, evaluates alert rules, and sends notifications.\n\n## Components\n\n- Collectors: CloudWatch, Prometheus, StatsD\n- Rules Engine: Evaluates threshold/anomaly alerts\n- Exporters: Slack, PagerDuty, Email\n- Dashboard: Web UI for visualization\n\nFor CLI operations, see `docs/ops-guide.md`.\n",
  "docs/alerting.md":
    "# Alerting\n\nAlert rules are defined in `monitoring/rules/`. See `src/rules_engine.py` for evaluation logic.\n",
  "docs/deployment.md":
    "# Deployment\n\n## Kubernetes\n\nApply manifests from `infra/k8s/`.\n\n## Terraform\n\nRun from `infra/terraform/`.\n",
  "docs/on-call-guide.md":
    "# On-Call Guide\n\n1. Check the dashboard\n2. Review recent alerts\n3. Consult runbooks in `docs/runbooks/`\n4. Escalate if needed\n",
  "docs/runbooks/high-error-rate.md":
    "# High Error Rate Runbook\n\n1. Check logs for error patterns\n2. Identify affected service\n3. Check recent deploys\n4. Rollback if needed\n",
  "docs/runbooks/disk-full.md":
    "# Disk Full Runbook\n\n1. Check disk usage\n2. Clean old log files\n3. Expand volume if needed\n",
  Dockerfile:
    'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nCMD ["python", "-m", "src.dashboard"]\n',
  ".env.example": "LOG_LEVEL=INFO\nSLACK_WEBHOOK=\nPAGERDUTY_KEY=\n",
  "pyproject.toml":
    '[project]\nname = "opsboard"\nversion = "2.14.0"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
});

// ─── dataquery scale files ───────────────────────────────────────────

export const DATAQUERY_SCALE_FILES: Record<string, string> = {};

const dqModules = [
  [
    "src/loaders/csv_loader.py",
    "Load CSV data files.",
    ["import csv"],
    "def load_csv(path: str) -> list[dict]:\n    with open(path) as f:\n        return list(csv.DictReader(f))",
  ],
  [
    "src/loaders/json_loader.py",
    "Load JSON data files.",
    ["import json"],
    "def load_json(path: str):\n    with open(path) as f:\n        return json.load(f)",
  ],
  [
    "src/loaders/parquet_loader.py",
    "Load Parquet files (stub).",
    [],
    "def load_parquet(path: str) -> list[dict]:\n    raise NotImplementedError('parquet support not installed')",
  ],
  ["src/loaders/__init__.py", "Data loaders.", [], ""],
  [
    "src/transforms/filter.py",
    "Filter transforms.",
    [],
    "def filter_by(data: list, field: str, value) -> list:\n    return [r for r in data if r.get(field) == value]",
  ],
  [
    "src/transforms/join.py",
    "Join transforms.",
    [],
    "def inner_join(left: list, right: list, key: str) -> list:\n    right_map = {r[key]: r for r in right}\n    return [{**l, **right_map[l[key]]} for l in left if l[key] in right_map]",
  ],
  [
    "src/transforms/aggregate.py",
    "Aggregation transforms.",
    [],
    "def group_by(data: list, key: str) -> dict:\n    groups: dict = {}\n    for row in data:\n        groups.setdefault(row.get(key), []).append(row)\n    return groups",
  ],
  ["src/transforms/__init__.py", "Data transforms.", [], ""],
  [
    "src/validators/schema.py",
    "JSON schema validation.",
    ["import json"],
    "def validate(data, schema_path: str) -> list[str]:\n    return []  # stub",
  ],
  ["src/validators/__init__.py", "Data validators.", [], ""],
  [
    "src/formatters.py",
    "Output formatting utilities.",
    [],
    "def format_table(data: list[dict]) -> str:\n    if not data: return '(empty)'\n    headers = list(data[0].keys())\n    return '\\t'.join(headers) + '\\n' + '\\n'.join('\\t'.join(str(r.get(h,'')) for h in headers) for r in data)",
  ],
  [
    "src/cli.py",
    "Command-line interface (internal).",
    [],
    "# NOTE: This is the internal CLI for pipeline operations.\n# For ad-hoc data queries, see docs/querying.md\ndef main(): pass",
  ],
];

for (const [path, doc, imports, body] of dqModules) {
  DATAQUERY_SCALE_FILES[path as string] = pyModule(
    doc as string,
    imports as string[],
    body as string,
  );
}

const dqTests = [
  "tests/test_csv_loader.py",
  "tests/test_json_loader.py",
  "tests/test_filter.py",
  "tests/test_join.py",
  "tests/test_aggregate.py",
  "tests/test_schema.py",
  "tests/test_formatters.py",
];
for (const path of dqTests) {
  const mod = path.replace("tests/test_", "").replace(".py", "");
  DATAQUERY_SCALE_FILES[path] =
    `"""Tests for ${mod}."""\nimport unittest\n\nclass Test${mod.charAt(0).toUpperCase() + mod.slice(1)}(unittest.TestCase):\n    def test_placeholder(self): pass\n`;
}

const dqScripts: [string, string][] = [
  ["scripts/run_pipeline.py", "Execute the full ETL pipeline."],
  ["scripts/generate_fixtures.py", "Generate test fixture data."],
  ["scripts/compare_schemas.py", "Compare data schemas across versions."],
  ["scripts/export_report.py", "Export analysis report to PDF."],
  ["scripts/backfill_metrics.py", "Backfill missing metrics data."],
  ["scripts/archive_old_data.py", "Archive data older than retention period."],
  ["scripts/check_data_quality.py", "Run data quality checks."],
];
for (const [path, desc] of dqScripts) {
  DATAQUERY_SCALE_FILES[path] =
    `#!/usr/bin/env python3\n"""${desc}"""\nimport sys\n\ndef main():\n    print("${desc}")\n\nif __name__ == "__main__":\n    main()\n`;
}

Object.assign(DATAQUERY_SCALE_FILES, {
  "config/sources.yaml":
    "sources:\n  - name: users\n    path: data/users.json\n  - name: releases\n    path: data/releases.json\n  - name: metrics\n    path: data/metrics.json\n",
  "config/retention.yaml":
    "retention:\n  raw_data_days: 90\n  aggregated_data_days: 365\n",
  "data/schema/users.json":
    '{"type":"array","items":{"type":"object","properties":{"id":{"type":"integer"},"name":{"type":"string"}}}}',
  "data/schema/metrics.json":
    '{"type":"array","items":{"type":"object","properties":{"user_id":{"type":"integer"},"metric":{"type":"string"},"value":{"type":"number"}}}}',
  "docs/architecture.md":
    "# Architecture\n\nDataQuery has a modular ETL pipeline:\n1. Loaders: CSV, JSON, Parquet\n2. Transforms: filter, join, aggregate\n3. Validators: schema validation\n4. Exporters: CSV, Parquet, PDF\n\nFor ad-hoc queries on data files, see `docs/querying.md`.\n",
  "docs/data-dictionary.md":
    "# Data Dictionary\n\n## users.json\n| Field | Type | Description |\n|---|---|---|\n| id | int | User ID |\n| name | string | Full name |\n| email | string | Email address |\n| role | string | admin/developer/reviewer |\n| active | bool | Is active |\n| team | string | Team name |\n",
  "docs/contributing.md":
    "# Contributing\n\n1. Install deps: `pip install -r requirements.txt`\n2. Run tests: `make test`\n3. Run pipeline: `make etl`\n",
  Dockerfile:
    'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nCMD ["python", "scripts/run_pipeline.py"]\n',
  ".env.example": "DATA_DIR=data/\nOUTPUT_DIR=output/\nLOG_LEVEL=INFO\n",
  "pyproject.toml":
    '[project]\nname = "dataquery"\nversion = "1.0.0"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
});

// Export counts for verification
console.log(
  `issuetracker scale files: ${Object.keys(ISSUETRACKER_SCALE_FILES).length}`,
);
console.log(`opsboard scale files: ${Object.keys(OPSBOARD_SCALE_FILES).length}`);
console.log(`dataquery scale files: ${Object.keys(DATAQUERY_SCALE_FILES).length}`);
