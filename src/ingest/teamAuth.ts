export interface TeamAuth {
  resolveTeamId(token: string): string | null;
}

export interface TeamTokenConfig {
  teamId: string;
  token: string;
}

export function createSingleTeamAuth(config: TeamTokenConfig): TeamAuth {
  return {
    resolveTeamId: (token) => (token === config.token ? config.teamId : null),
  };
}

export function createMultiTeamAuth(configs: TeamTokenConfig[]): TeamAuth {
  const tokenToTeam = new Map<string, string>();
  for (const entry of configs) {
    tokenToTeam.set(entry.token, entry.teamId);
  }

  return {
    resolveTeamId: (token) => tokenToTeam.get(token) ?? null,
  };
}

export interface LoadTeamAuthFromEnvResult {
  auth: TeamAuth;
  teamCount: number;
}

function parseTeamTokensJson(raw: string): TeamTokenConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: not valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: expected an array of {teamId, token}.",
    );
  }

  const configs: TeamTokenConfig[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      throw new Error(
        "Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: expected an array of objects.",
      );
    }

    const teamId = (entry as { teamId?: unknown }).teamId;
    const token = (entry as { token?: unknown }).token;

    if (typeof teamId !== "string" || typeof token !== "string") {
      throw new Error(
        "Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: each entry must have string teamId + token.",
      );
    }

    const trimmedTeamId = teamId.trim();
    const trimmedToken = token.trim();

    if (!trimmedTeamId || !trimmedToken) {
      throw new Error(
        "Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: teamId/token must be non-empty strings.",
      );
    }

    configs.push({ teamId: trimmedTeamId, token: trimmedToken });
  }

  if (configs.length === 0) {
    throw new Error(
      "Invalid HAPPY_PATHS_TEAM_TOKENS_JSON: expected at least one entry.",
    );
  }

  return configs;
}

export function loadTeamAuthFromEnv(env: NodeJS.ProcessEnv): LoadTeamAuthFromEnvResult {
  const multiTenant = env.HAPPY_PATHS_TEAM_TOKENS_JSON;
  if (multiTenant?.trim()) {
    const configs = parseTeamTokensJson(multiTenant);
    return {
      auth: createMultiTeamAuth(configs),
      teamCount: configs.length,
    };
  }

  const rawTeamId = env.HAPPY_PATHS_TEAM_ID ?? "default";
  const rawToken = env.HAPPY_PATHS_TEAM_TOKEN;

  if (!rawToken || !rawToken.trim()) {
    throw new Error(
      "Missing HAPPY_PATHS_TEAM_TOKEN (or HAPPY_PATHS_TEAM_TOKENS_JSON).",
    );
  }

  const teamId = rawTeamId.trim();
  const token = rawToken.trim();

  return {
    auth: createSingleTeamAuth({ teamId, token }),
    teamCount: 1,
  };
}

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const trimmed = authorization.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  if (!token) {
    return null;
  }

  return token;
}
