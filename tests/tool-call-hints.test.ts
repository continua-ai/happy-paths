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
    expect(hint?.betterAlternative).toContain("linear_consolidation");
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
      betterAlternative: "Use linear_consolidation.py",
      exampleCommand: "pants run scripts:linear_consolidation -- dump --key CON-1234",
      confidence: 0.9,
    };
    const text = formatToolCallHint(hint);
    expect(text).toContain("Happy Paths tip");
    expect(text).toContain("linear_consolidation");
    expect(text).toContain("pants run");
  });
});
