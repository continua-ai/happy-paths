import { describe, expect, it } from "vitest";
import {
  formatToolCallHint,
  matchToolCallReinvention,
} from "../src/core/toolCallHints.js";

describe("matchToolCallReinvention", () => {
  it("matches Linear API query heredoc", () => {
    const cmd = `python3 - << 'PY'
import json
import os
import urllib.request

API_URL = 'https://api.linear.app/graphql'
API_KEY = os.environ.get('LINEAR_API_KEY')
if not API_KEY:
    raise SystemExit('Missing LINEAR_API_KEY')

query = '''query { issue(id: "xxx") { title description } }'''
req = urllib.request.Request(API_URL, data=json.dumps({'query': query}).encode())
req.add_header('Authorization', API_KEY)
req.add_header('Content-Type', 'application/json')
resp = urllib.request.urlopen(req)
data = json.loads(resp.read())
print(json.dumps(data, indent=2))
PY`;
    const hint = matchToolCallReinvention(cmd);
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("reinvent-linear-query");
    expect(hint?.betterAlternative).toContain("./gravity-cli tool linear");
    expect(hint?.exampleCommand).toContain("--out /tmp/issue.md");
    expect(hint?.policyVersion).toContain("continua-gravity-dev-os");
    expect(hint?.trustBoundary).toContain("team_private");
  });

  it("matches Linear API mutation heredoc", () => {
    const cmd = `python3 - << 'PY'
import json, os, urllib.request

API_URL = 'https://api.linear.app/graphql'
API_KEY = os.environ['LINEAR_API_KEY']

mutation = '''mutation($id:String!,$body:String!) {
  commentCreate(input:{issueId:$id, body:$body}) {
    success comment { id url }
  }
}'''
variables = {'id': 'issue-id', 'body': 'hello'}
data = json.dumps({'query': mutation, 'variables': variables}).encode()
req = urllib.request.Request(API_URL, data=data)
req.add_header('Authorization', API_KEY)
resp = urllib.request.urlopen(req)
print(resp.read().decode())
PY`;
    const hint = matchToolCallReinvention(cmd);
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("reinvent-linear-mutation");
  });

  it("matches cloud logging heredoc with current Gravity stack-log helper", () => {
    const cmd = `python3 - << 'PY'
import json
from google.cloud import logging_v2
project = 'thoughter'
env = 'staging'
client = logging_v2.Client(project=project)
query = f'''resource.type="cloud_run_revision" labels.env="{env}" severity>=WARNING'''
entries = client.list_entries(filter_=query, page_size=50)
for entry in entries:
    print(json.dumps(entry.to_api_repr()))
PY`;
    const hint = matchToolCallReinvention(cmd);
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("reinvent-gcloud-logging");
    expect(hint?.exampleCommand).toContain("./gravity-cli tool stack-log-check");
    expect(hint?.exampleCommand).not.toContain("pants");
  });

  it("matches deploy status heredoc with current Gravity release helper", () => {
    const cmd = `python3 - << 'PY'
import json
import subprocess
import sys
project = 'thoughter'
service_name = 'gravity-runtime-staging'
args = ['gcloud', 'run', 'services', 'describe', service_name, '--project', project, '--format=json']
result = subprocess.run(args, capture_output=True, text=True)
if result.returncode:
    sys.exit(result.stderr)
service = json.loads(result.stdout)
print(service['status']['latestReadyRevisionName'])
PY`;
    const hint = matchToolCallReinvention(cmd);
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("reinvent-gcloud-deploy");
    expect(hint?.exampleCommand).toBe("./gravity-cli release status");
    expect(hint?.betterAlternative).not.toContain("./dx");
  });

  it("matches JSON extraction heredoc", () => {
    const cmd = `python3 - << 'PY'
import json
data = json.load(open('/tmp/manifest.json'))
print('runs:', len(data['runs']))
print('status:', data['runs'][0]['status'])
PY`;
    const hint = matchToolCallReinvention(cmd);
    expect(hint).not.toBeNull();
    expect(hint?.hintId).toBe("reinvent-json-jq");
    expect(hint?.betterAlternative).toContain("jq");
  });

  it("does not match short/non-heredoc commands", () => {
    expect(matchToolCallReinvention("ls -la")).toBeNull();
    expect(matchToolCallReinvention("git status")).toBeNull();
    expect(matchToolCallReinvention("")).toBeNull();
    expect(matchToolCallReinvention("python3 -c 'print(1)'")).toBeNull();
  });

  it("does not match small heredocs below minLines threshold", () => {
    const cmd = `python3 << 'PY'
print("hello")
PY`;
    expect(matchToolCallReinvention(cmd)).toBeNull();
  });
});

describe("formatToolCallHint", () => {
  it("formats a tool call hint", () => {
    const hint = {
      hintId: "reinvent-linear-query",
      detectedPattern: "Inline Linear API query",
      betterAlternative: "Use ./gravity-cli tool linear",
      exampleCommand: "./gravity-cli tool linear -- dump CON-1234 --out /tmp/issue.md",
      policyVersion: "continua-gravity-dev-os-2026-04-27",
      trustBoundary: "team_private trace-derived aggregate",
      confidence: 0.9,
    };
    const text = formatToolCallHint(hint);
    expect(text).toContain("Happy Paths tip");
    expect(text).toContain("./gravity-cli tool linear");
    expect(text).toContain("confidence 90%");
    expect(text).toContain("policy continua-gravity-dev-os-2026-04-27");
    expect(text).toContain("boundary team_private trace-derived aggregate");
  });
});
