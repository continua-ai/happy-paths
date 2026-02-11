export type SweBenchVariant = "off" | "on";

export interface SweBenchSessionIdentity {
  sessionId: string;
  prefix: string;
  instanceId: string;
  variant: SweBenchVariant;
  replicate: string;
}

export interface SweBenchSessionPair {
  instanceId: string;
  replicate: string;
  offSessionId: string;
  onSessionId: string;
}

export interface SweBenchSessionPairingDiagnostics {
  totalParsedSessions: number;
  offSessionCount: number;
  onSessionCount: number;
  duplicateVariantAssignments: number;
  unpairedOffSessions: number;
  unpairedOnSessions: number;
  pairedRunCount: number;
  pairedInstanceCount: number;
}

export interface SweBenchSessionPairingResult {
  pairs: SweBenchSessionPair[];
  diagnostics: SweBenchSessionPairingDiagnostics;
}

function normalizeVariant(value: string): SweBenchVariant | null {
  if (value === "off" || value === "on") {
    return value;
  }
  return null;
}

export function parseSweBenchSessionId(
  sessionId: string,
  prefix = "swebench",
): SweBenchSessionIdentity | null {
  const parts = sessionId.split("::");

  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  const maybePrefix = parts[0];
  if (maybePrefix !== prefix) {
    return null;
  }

  const instanceId = parts[1]?.trim() ?? "";
  const variant = normalizeVariant(parts[2]?.trim() ?? "");
  const replicate = (parts[3]?.trim() || "r1").toLowerCase();

  if (!instanceId || !variant || !replicate) {
    return null;
  }

  return {
    sessionId,
    prefix,
    instanceId,
    variant,
    replicate,
  };
}

export function relativeReduction(off: number, on: number): number {
  if (off <= 0) {
    return on <= 0 ? 0 : -1;
  }
  return (off - on) / off;
}

function sessionSortKey(identity: SweBenchSessionIdentity): string {
  return `${identity.replicate}\u0000${identity.sessionId}`;
}

export function pairSweBenchSessions(
  identities: SweBenchSessionIdentity[],
): SweBenchSessionPairingResult {
  const byRun = new Map<
    string,
    {
      instanceId: string;
      replicate: string;
      off: SweBenchSessionIdentity[];
      on: SweBenchSessionIdentity[];
    }
  >();

  for (const identity of identities) {
    const key = `${identity.instanceId}::${identity.replicate}`;
    const entry = byRun.get(key);
    if (entry) {
      if (identity.variant === "off") {
        entry.off.push(identity);
      } else {
        entry.on.push(identity);
      }
      continue;
    }

    byRun.set(key, {
      instanceId: identity.instanceId,
      replicate: identity.replicate,
      off: identity.variant === "off" ? [identity] : [],
      on: identity.variant === "on" ? [identity] : [],
    });
  }

  const pairs: SweBenchSessionPair[] = [];
  let duplicateVariantAssignments = 0;
  let unpairedOffSessions = 0;
  let unpairedOnSessions = 0;
  const pairedInstances = new Set<string>();

  for (const entry of byRun.values()) {
    const off = [...entry.off].sort((left, right) => {
      return sessionSortKey(left).localeCompare(sessionSortKey(right));
    });
    const on = [...entry.on].sort((left, right) => {
      return sessionSortKey(left).localeCompare(sessionSortKey(right));
    });

    if (off.length > 1) {
      duplicateVariantAssignments += off.length - 1;
    }
    if (on.length > 1) {
      duplicateVariantAssignments += on.length - 1;
    }

    const pairCount = Math.min(off.length, on.length);

    for (let index = 0; index < pairCount; index += 1) {
      const offIdentity = off[index];
      const onIdentity = on[index];
      if (!offIdentity || !onIdentity) {
        continue;
      }

      pairs.push({
        instanceId: entry.instanceId,
        replicate: entry.replicate,
        offSessionId: offIdentity.sessionId,
        onSessionId: onIdentity.sessionId,
      });
      pairedInstances.add(entry.instanceId);
    }

    if (off.length > pairCount) {
      unpairedOffSessions += off.length - pairCount;
    }
    if (on.length > pairCount) {
      unpairedOnSessions += on.length - pairCount;
    }
  }

  const diagnostics: SweBenchSessionPairingDiagnostics = {
    totalParsedSessions: identities.length,
    offSessionCount: identities.filter((identity) => identity.variant === "off").length,
    onSessionCount: identities.filter((identity) => identity.variant === "on").length,
    duplicateVariantAssignments,
    unpairedOffSessions,
    unpairedOnSessions,
    pairedRunCount: pairs.length,
    pairedInstanceCount: pairedInstances.size,
  };

  return {
    pairs,
    diagnostics,
  };
}
