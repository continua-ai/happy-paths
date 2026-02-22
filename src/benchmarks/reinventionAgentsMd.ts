/**
 * AGENTS.md content for reinvention benchmark repos.
 *
 * Two variants:
 * - "none": no AGENTS.md (baseline — agent discovers tools on its own)
 * - "registry": AGENTS.md with a tool registry mapping operations to CLI tools
 *
 * The tool registry is the intervention under test: does making tools
 * discoverable via AGENTS.md reduce throwaway heredoc waste?
 */

export const ISSUETRACKER_AGENTS_MD = `# Agent Guidelines

## Tool Registry

Prefer these existing CLI tools over writing inline scripts:

| Operation | Command | Example |
|---|---|---|
| Get issue by ID | \`./track query\` | \`./track query --id PROJ-1\` |
| List issues | \`./track list\` | \`./track list --status open\` |
| Update issue | \`./track update\` | \`./track update --id PROJ-1 --status done\` |
| Add comment | \`./track comment\` | \`./track comment --id PROJ-1 --body "text"\` |
| Search issues | \`./track search\` | \`./track search --term "login"\` |
| Create issue | \`./track create\` | \`./track create --title "New issue"\` |

## Notes

- Issue data is in \`data/issues.json\` — use the CLI to read/modify it.
- See \`docs/cli-reference.md\` for full CLI documentation.
`;

export const OPSBOARD_AGENTS_MD = `# Agent Guidelines

## Tool Registry

Prefer these existing CLI tools over writing inline scripts:

| Operation | Command | Example |
|---|---|---|
| Deploy status | \`./ops status\` | \`./ops status --env prod\` |
| Query logs | \`./ops logs\` | \`./ops logs --level error --since 1h\` |
| Service health | \`./ops health\` | \`./ops health --service worker\` |
| Deploy history | \`./ops history\` | \`./ops history --env staging --limit 5\` |
| Runtime config | \`./ops config\` | \`./ops config --env staging\` |

## Notes

- State files are in \`state/\` — use the CLI to query them.
- See \`docs/ops-guide.md\` for full CLI documentation.
`;

export const DATAQUERY_AGENTS_MD = `# Agent Guidelines

## Tool Registry

Prefer these tools over writing inline Python scripts:

| Operation | Command | Example |
|---|---|---|
| Filter JSON | \`jq\` | \`jq '.[] | select(.role == "admin")' data/users.json\` |
| Count records | \`jq\` | \`jq 'length' data/users.json\` |
| Extract fields | \`jq\` | \`jq '.[].name' data/users.json\` |
| Join files | \`jq --slurpfile\` | \`jq --slurpfile u data/users.json '.[] as $m | ($u[0][] | select(.id == $m.user_id)) as $u | {user: $u.name, value: $m.value}' data/metrics.json\` |

## Notes

- All data is plain JSON in \`data/\` — use \`jq\` for queries.
- See \`docs/querying.md\` for more examples.
`;
