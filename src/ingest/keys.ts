export const TRACE_BUNDLE_STORAGE_VERSION = "v1" as const;

const TEAM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function assertSafeTeamId(teamId: string): void {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error(
      `Invalid teamId '${teamId}'. Expected ${TEAM_ID_PATTERN.toString()}.`,
    );
  }
}

export function assertSafeSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      `Invalid sessionId '${sessionId}'. Expected ${SESSION_ID_PATTERN.toString()}.`,
    );
  }
}

export function assertSafeSha256Hex(value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(
      `Invalid sha256 '${value}'. Expected ${SHA256_PATTERN.toString()}.`,
    );
  }
}

export interface TraceBundleKeyParams {
  teamId: string;
  sessionId: string;
  contentSha256: string;
}

export function canonicalTraceBundleKey(params: TraceBundleKeyParams): string {
  assertSafeTeamId(params.teamId);
  assertSafeSessionId(params.sessionId);
  assertSafeSha256Hex(params.contentSha256);

  return `teams/${params.teamId}/trace-bundles/${TRACE_BUNDLE_STORAGE_VERSION}/sessions/${params.sessionId}/${params.contentSha256}.jsonl.gz`;
}

export function canonicalTraceBundleMetaKey(params: TraceBundleKeyParams): string {
  assertSafeTeamId(params.teamId);
  assertSafeSessionId(params.sessionId);
  assertSafeSha256Hex(params.contentSha256);

  return `teams/${params.teamId}/trace-bundles/${TRACE_BUNDLE_STORAGE_VERSION}/sessions/${params.sessionId}/${params.contentSha256}.meta.json`;
}
