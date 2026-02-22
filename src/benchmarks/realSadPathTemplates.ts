/**
 * Benchmark repos based on REAL sad paths mined from Pi sessions.
 *
 * These templates reproduce the TOP recurring agent failures observed
 * across 300 real sessions (~95K tool calls, ~2275 categorized errors):
 *
 * 1. monobuild  — format-before-lint (533x) + build target syntax (368x)
 * 2. toolhub    — hallucinated tool names (92x) + missing modules (88x)
 *
 * Each repo has simple Python bugs (easy to fix) but repo-specific
 * dev workflow traps that waste agent steps. These traps are INTERNAL
 * and COMPANY-SPECIFIC — exactly the kind of knowledge models lack.
 */

import type {
  RecurringPatternTask,
  RecurringTrap,
  RepoTemplate,
} from "./recurringPattern.js";

// ─── Traps from real session analysis ───────────────────────────────────

/**
 * Real sad path: lint fails because files aren't formatted first.
 * Observed 533x across 300 sessions. Agent runs `./mb lint` and gets
 * "style check failed" errors, then tries to fix them manually instead
 * of running `./mb fmt` first.
 */
export const TRAP_FMT_BEFORE_LINT: RecurringTrap = {
  trapId: "fmt-before-lint",
  family: "tool_flag",
  description:
    "This project's linter requires files to be formatted first. " +
    "Running ./mb lint without ./mb fmt produces misleading 'style check failed' " +
    "errors. The fix is to run ./mb fmt THEN ./mb lint.",
  errorPattern:
    "style check failed|formatting check failed|would reformat|format first",
  fixDescription: "Run ./mb fmt first, then ./mb lint",
  fixCommand: "./mb fmt",
};

/**
 * Real sad path: wrong build target syntax.
 * Observed 368x across 300 sessions. Agent uses file paths as targets
 * (e.g., `./mb test src/calc.py`) instead of module targets
 * (e.g., `./mb test calc`). Error says "target not found".
 */
export const TRAP_BUILD_TARGET_SYNTAX: RecurringTrap = {
  trapId: "build-target-syntax",
  family: "tool_flag",
  description:
    "This project's build tool uses module names as targets, not file paths. " +
    "Use './mb test calc' not './mb test src/calc.py'. " +
    "Error says 'target not found' which misdirects to path issues.",
  errorPattern: "target not found|no such target|unknown target|not a valid target",
  fixDescription: "Use module name as target: ./mb test <module_name>",
  fixCommand: "./mb test <module>",
};

/**
 * Real sad path: agent tries a hallucinated tool name.
 * Observed 92x across 300 sessions. Error messages or README mention
 * a tool name that doesn't exist, leading the agent to try it.
 * Actual tool has a different name/invocation.
 */
export const TRAP_HALLUCINATED_TOOL: RecurringTrap = {
  trapId: "hallucinated-tool",
  family: "tool_setup",
  description:
    "Error message references 'toolhub-setup' but the actual command is " +
    "'./th setup'. Agent tries the hallucinated name and gets 'command not found'.",
  errorPattern:
    "command not found.*toolhub|No such file.*toolhub-setup|toolhub.internal",
  fixDescription: "Use ./th setup (not toolhub-setup or toolhub init)",
  fixCommand: "./th setup",
};

/**
 * Real sad path: system Python lacks required modules for test setup.
 * Observed 88x across 300 sessions. Agent writes inline python3 scripts
 * that import yaml/requests/etc. but system Python doesn't have them.
 * The repo has its own venv/install mechanism.
 */
export const TRAP_SYSTEM_PYTHON_MISSING_MODULE: RecurringTrap = {
  trapId: "system-python-missing-module",
  family: "env_dep",
  description:
    "conftest.py's setup imports tomllib (stdlib 3.11+) to parse the project " +
    "config, but test helpers also import 'toml' (third-party) for write support. " +
    "Must install toml: pip install toml, or use ./th setup which handles this.",
  errorPattern: "ModuleNotFoundError.*toml|No module named.*toml",
  fixDescription: "Install toml package or run ./th setup",
  fixCommand: "./th setup",
};

// ─── Repo template: monobuild ───────────────────────────────────────────
// Mimics: format-before-lint (533x) + build target syntax (368x)

const MONOBUILD_FILES: Record<string, string> = {
  "README.md": `# MonoBuild

Internal monorepo build tool example.

## Development

This project uses \`./mb\` (monobuild) for all dev workflows.

\`\`\`bash
# Format code (MUST run before lint):
./mb fmt

# Lint (fails if not formatted):
./mb lint

# Run tests:
./mb test <module_name>

# Run ALL tests:
./mb test all

# Example (test the calc module):
./mb test calc
\`\`\`

### IMPORTANT: target syntax

Targets are MODULE NAMES, not file paths:
- ✅ \`./mb test calc\`
- ❌ \`./mb test src/calc.py\`
- ❌ \`./mb test src/calc_test.py\`
`,

  mb: `#!/usr/bin/env bash
set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJ_DIR"

ensure_venv() {
  if [ ! -d .venv ]; then
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements-dev.txt
    .venv/bin/pip install -q -e .
  fi
}

check_format() {
  # Check if source files are formatted (trailing whitespace, consistent newlines)
  local bad=0
  for f in src/monobuild/*.py; do
    if grep -qP '\\t' "$f" 2>/dev/null; then
      echo "STYLE CHECK FAILED: $f contains tabs (use spaces). Run ./mb fmt first."
      bad=1
    fi
  done
  # Check the format marker file exists (created by ./mb fmt)
  if [ ! -f .format-ok ]; then
    echo ""
    echo "═══════════════════════════════════════════════════"
    echo "  FORMATTING CHECK FAILED"
    echo "  Files must be formatted before lint/test."
    echo "  Run: ./mb fmt"
    echo "═══════════════════════════════════════════════════"
    echo ""
    return 1
  fi
  return $bad
}

case "\${1:-help}" in
  fmt)
    ensure_venv
    # Simple formatter: replace tabs with spaces in source files
    for f in src/monobuild/*.py; do
      if [ -f "$f" ]; then
        # Use python to expand tabs (portable)
        .venv/bin/python3 -c "
import sys
with open(sys.argv[1], 'r') as f: text = f.read()
text = text.expandtabs(4)
with open(sys.argv[1], 'w') as f: f.write(text)
" "$f"
      fi
    done
    touch .format-ok
    echo "Formatted. You can now run ./mb lint or ./mb test."
    ;;
  lint)
    check_format || exit 1
    ensure_venv
    echo "Lint passed."
    ;;
  test)
    shift
    ensure_venv
    check_format || exit 1

    target="\${1:-all}"
    if [ "$target" = "all" ]; then
      shift 2>/dev/null || true
      .venv/bin/pytest tests/ -x -q "\$@"
    elif [ -f "tests/test_\${target}.py" ]; then
      shift
      .venv/bin/pytest "tests/test_\${target}.py" -x -q "\$@"
    else
      echo ""
      echo "ERROR: target not found: '$target'"
      echo ""
      echo "Available targets:"
      for f in tests/test_*.py; do
        name=\$(basename "$f" .py)
        name=\${name#test_}
        echo "  $name"
      done
      echo ""
      echo "Usage: ./mb test <module_name>"
      echo "  Example: ./mb test calc"
      echo "  NOT:     ./mb test src/calc.py"
      exit 1
    fi
    ;;
  *)
    echo "Usage: ./mb {fmt|lint|test}"
    echo ""
    echo "  fmt    Format source files (must run before lint/test)"
    echo "  lint   Check code style (requires fmt first)"
    echo "  test   Run tests: ./mb test <module> or ./mb test all"
    exit 1
    ;;
esac
`,

  "pyproject.toml": `[project]
name = "monobuild"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  "src/monobuild/__init__.py": `"""monobuild: internal monorepo example."""
`,

  // NOTE: uses tabs intentionally so ./mb fmt is required
  "src/monobuild/calc.py":
    '"""Calculator module."""\n\n\ndef add(a: float, b: float) -> float:\n\t"""Add two numbers."""\n\treturn a + b\n\n\ndef subtract(a: float, b: float) -> float:\n\t"""Subtract b from a."""\n\treturn a - b\n\n\ndef multiply(a: float, b: float) -> float:\n\t"""Multiply two numbers.\n\n\tBUG: returns a + b instead of a * b.\n\t"""\n\treturn a + b\n\n\ndef safe_divide(a: float, b: float) -> float:\n\t"""Divide a by b, returning 0.0 on division by zero.\n\n\tBUG: returns a instead of 0.0 when b is 0.\n\t"""\n\tif b == 0:\n\t\treturn a\n\treturn a / b\n',

  "src/monobuild/text.py":
    '"""Text processing module."""\n\n\ndef word_count(text: str) -> int:\n\t"""Count words in text.\n\n\tBUG: splits on spaces only, not all whitespace.\n\t"""\n\tif not text.strip():\n\t\treturn 0\n\treturn len(text.split(" "))\n\n\ndef truncate(text: str, max_len: int) -> str:\n\t"""Truncate text to max_len, adding ... if truncated.\n\n\tBUG: adds ... even when text fits exactly.\n\t"""\n\tif len(text) >= max_len:\n\t\treturn text[: max_len - 3] + "..."\n\treturn text\n\n\ndef title_case(text: str) -> str:\n\t"""Convert to title case.\n\n\tBUG: capitalizes words after apostrophes (e.g., "don\'T").\n\t"""\n\treturn text.title()\n\n\ndef reverse_words(text: str) -> str:\n\t"""Reverse the order of words in text.\n\t"""\n\treturn " ".join(text.split()[::-1])\n',

  "tests/__init__.py": "",

  "tests/test_calc.py": `"""Tests for monobuild.calc."""
from monobuild import calc


def test_add():
    assert calc.add(2, 3) == 5


def test_subtract():
    assert calc.subtract(10, 4) == 6


def test_multiply():
    """BUG: multiply returns a+b instead of a*b."""
    assert calc.multiply(3, 4) == 12


def test_multiply_zero():
    assert calc.multiply(5, 0) == 0


def test_safe_divide():
    assert calc.safe_divide(10, 2) == 5.0


def test_safe_divide_by_zero():
    """BUG: returns a instead of 0.0."""
    assert calc.safe_divide(10, 0) == 0.0
`,

  "tests/test_text.py": `"""Tests for monobuild.text."""
from monobuild import text


def test_word_count_basic():
    assert text.word_count("hello world") == 2


def test_word_count_tabs():
    """BUG: doesn't count tab-separated words correctly."""
    assert text.word_count("hello\\tworld\\there") == 3


def test_word_count_empty():
    assert text.word_count("") == 0
    assert text.word_count("   ") == 0


def test_truncate_long():
    assert text.truncate("hello world", 8) == "hello..."


def test_truncate_exact():
    """BUG: adds ... when text fits exactly."""
    assert text.truncate("hello", 5) == "hello"


def test_truncate_short():
    assert text.truncate("hi", 10) == "hi"


def test_title_case():
    assert text.title_case("hello world") == "Hello World"


def test_title_case_apostrophe():
    \"\"\"BUG: capitalizes letter after apostrophe.\"\"\"
    result = text.title_case("don't stop")
    assert result == "Don't Stop"
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="monobuild", version="0.1.0", package_dir={"": "src"}, packages=find_packages("src"))
`,
};

// ─── Repo template: toolhub ─────────────────────────────────────────────
// Mimics: hallucinated tool names (92x) + missing modules (88x)

const TOOLHUB_FILES: Record<string, string> = {
  "README.md": `# ToolHub

Internal tool orchestration service.

## Development

This project uses \`./th\` for all dev workflows.

\`\`\`bash
# First-time setup (creates venv, installs deps, generates config):
./th setup

# Run tests:
./th test

# Run specific test:
./th test -- tests/test_registry.py::test_register_tool -x
\`\`\`

### Configuration

Tests require a generated config file at \`.config/toolhub.toml\`.
This is created by \`./th setup\`.

> ⚠️ Do NOT create this file manually — the setup script validates
> checksums and generates auth tokens.
`,

  th: `#!/usr/bin/env bash
set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJ_DIR"

case "\${1:-help}" in
  setup)
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
    .venv/bin/pip install -q -r requirements-dev.txt
    .venv/bin/pip install -q -e .
    mkdir -p .config
    cat > .config/toolhub.toml << 'TOML'
[testing]
db_url = "sqlite:///:memory:"
auth_token = "th_test_token_do_not_use_in_prod"
log_level = "DEBUG"
registry_url = "http://localhost:9999/api/tools"

[features]
experimental_search = true
auto_retry = false
TOML
    echo "Setup complete. Run './th test' to run tests."
    ;;
  test)
    if [ ! -d .venv ]; then
      echo "ERROR: Run './th setup' first." >&2
      exit 1
    fi
    if [ ! -f .config/toolhub.toml ]; then
      echo ""
      echo "═══════════════════════════════════════════════════"
      echo "  CONFIG NOT FOUND: .config/toolhub.toml"
      echo ""
      echo "  Test configuration must be generated."
      echo "  For setup instructions, see:"
      echo "    https://toolhub.internal/wiki/dev-setup"
      echo ""
      echo "  Quick fix: run toolhub-setup"
      echo "═══════════════════════════════════════════════════"
      echo ""
      exit 1
    fi
    shift 2>/dev/null || true
    if [ $# -gt 0 ] && [ "$1" = "--" ]; then shift; fi
    .venv/bin/pytest "\${@:-tests/}" -x -q
    ;;
  *)
    echo "Usage: ./th {setup|test}"
    echo ""
    echo "  setup   Create venv, install deps, generate config"
    echo "  test    Run tests (requires setup first)"
    exit 1
    ;;
esac
`,

  "pyproject.toml": `[project]
name = "toolhub"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
toml>=0.10
`,

  "requirements-dev.txt": `pytest>=7.0
toml>=0.10
`,

  "src/toolhub/__init__.py": `"""toolhub: internal tool orchestration."""
`,

  "src/toolhub/config.py": `"""Configuration loader.

Reads from .config/toolhub.toml (generated by ./th setup).
"""
import os

import toml


_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".config",
    "toolhub.toml",
)


def load_config() -> dict:
    """Load the toolhub config.

    Raises FileNotFoundError if config hasn't been generated.
    """
    if not os.path.exists(_CONFIG_PATH):
        raise FileNotFoundError(
            f"Config not found: {_CONFIG_PATH}\\n"
            "Run toolhub-setup to generate it.\\n"
            "See https://toolhub.internal/wiki/dev-setup"
        )
    with open(_CONFIG_PATH) as f:
        return toml.load(f)


def get_auth_token() -> str:
    """Get test auth token from config."""
    cfg = load_config()
    return cfg["testing"]["auth_token"]
`,

  "src/toolhub/registry.py": `"""Tool registry — tracks available tools and their metadata."""
from toolhub import config


def register_tool(name: str, version: str, description: str) -> dict:
    """Register a new tool.

    BUG: doesn't validate that name is non-empty.
    """
    # Touch config to ensure env is set up
    _ = config.get_auth_token()

    return {
        "name": name,
        "version": version,
        "description": description,
        "status": "active",
    }


def list_tools(tools: list[dict], status: str = "active") -> list[dict]:
    """List tools filtered by status.

    BUG: filter comparison uses = instead of == (always returns all tools).
    Actually the bug is: doesn't filter at all, returns all tools.
    """
    return tools


def search_tools(tools: list[dict], query: str) -> list[dict]:
    """Search tools by name or description.

    BUG: only searches name, not description.
    """
    query_lower = query.lower()
    return [t for t in tools if query_lower in t.get("name", "").lower()]


def deprecate_tool(tools: list[dict], name: str) -> list[dict]:
    """Mark a tool as deprecated.

    BUG: removes the tool instead of changing its status.
    """
    return [t for t in tools if t["name"] != name]
`,

  "src/toolhub/executor.py": `"""Tool execution engine."""


def execute_tool(tool: dict, args: dict) -> dict:
    """Execute a tool with given arguments.

    BUG: doesn't check if tool status is 'active' before executing.
    Returns success even for deprecated tools.
    """
    return {
        "tool": tool["name"],
        "args": args,
        "status": "success",
        "output": f"Executed {tool['name']}",
    }


def validate_args(tool: dict, args: dict) -> list[str]:
    """Validate tool arguments against the tool's required fields.

    BUG: treats optional fields as required.
    """
    required = tool.get("required_args", [])
    optional = tool.get("optional_args", [])
    errors = []
    for field in required + optional:
        if field not in args:
            errors.append(f"Missing argument: {field}")
    return errors


def batch_execute(tools: list[dict], args_list: list[dict]) -> list[dict]:
    """Execute multiple tools. Returns results in order.

    BUG: reverses the result order.
    """
    results = []
    for tool, args in zip(tools, args_list):
        results.append(execute_tool(tool, args))
    return list(reversed(results))
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration.

Validates that toolhub config is generated before running tests.
Use ./th test to run tests with proper setup.
"""
from toolhub import config


# Validate config exists at import time
_cfg = config.load_config()
`,

  "tests/test_registry.py": `"""Tests for toolhub.registry."""
from toolhub import registry


def test_register_tool_empty_name():
    """Should reject empty tool names."""
    result = registry.register_tool("", "1.0", "A tool")
    assert result is None or result.get("name") != ""


def test_list_tools_filter():
    """Should only return tools with matching status."""
    tools = [
        {"name": "A", "status": "active"},
        {"name": "B", "status": "deprecated"},
        {"name": "C", "status": "active"},
    ]
    result = registry.list_tools(tools, status="active")
    assert len(result) == 2
    assert all(t["status"] == "active" for t in result)


def test_search_tools_by_description():
    """Should match on description, not just name."""
    tools = [
        {"name": "linter", "description": "Code quality checker"},
        {"name": "formatter", "description": "Code style formatter"},
    ]
    result = registry.search_tools(tools, "quality")
    assert len(result) == 1
    assert result[0]["name"] == "linter"


def test_deprecate_tool_keeps_it():
    """Deprecating should change status, not remove the tool."""
    tools = [
        {"name": "old-tool", "status": "active"},
        {"name": "new-tool", "status": "active"},
    ]
    result = registry.deprecate_tool(tools, "old-tool")
    assert len(result) == 2
    old = [t for t in result if t["name"] == "old-tool"]
    assert len(old) == 1
    assert old[0]["status"] == "deprecated"
`,

  "tests/test_executor.py": `"""Tests for toolhub.executor."""
from toolhub import executor


def test_execute_deprecated_tool():
    """Should refuse to execute deprecated tools."""
    tool = {"name": "old", "status": "deprecated"}
    result = executor.execute_tool(tool, {})
    assert result["status"] == "error" or "deprecated" in result.get("output", "").lower()


def test_validate_args_optional():
    """Optional args should not be required."""
    tool = {
        "name": "test",
        "required_args": ["input"],
        "optional_args": ["verbose"],
    }
    errors = executor.validate_args(tool, {"input": "data"})
    assert errors == [], f"Optional arg 'verbose' should not be required: {errors}"


def test_batch_execute_order():
    """Results should be in the same order as input."""
    tools = [
        {"name": "first", "status": "active"},
        {"name": "second", "status": "active"},
        {"name": "third", "status": "active"},
    ]
    args_list = [{"x": 1}, {"x": 2}, {"x": 3}]
    results = executor.batch_execute(tools, args_list)
    assert results[0]["tool"] == "first"
    assert results[1]["tool"] == "second"
    assert results[2]["tool"] == "third"


def test_validate_args_required():
    """Missing required args should be reported."""
    tool = {"name": "test", "required_args": ["input", "output"], "optional_args": []}
    errors = executor.validate_args(tool, {"input": "data"})
    assert errors == ["Missing argument: output"]
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="toolhub", version="0.1.0", package_dir={"": "src"}, packages=find_packages("src"))
`,
};

// ─── Template definitions ───────────────────────────────────────────────

export const MONOBUILD_TEMPLATE: RepoTemplate = {
  templateId: "monobuild",
  name: "monobuild",
  description:
    "Internal monorepo build tool. Must run ./mb fmt before lint/test. " +
    "Uses module names as targets (not file paths). " +
    "Mimics real sad paths: format-before-lint (533x), build target syntax (368x).",
  language: "python",
  files: MONOBUILD_FILES,
  executablePaths: ["mb"],
  setupCommands: [],
  traps: [TRAP_FMT_BEFORE_LINT, TRAP_BUILD_TARGET_SYNTAX],
};

export const TOOLHUB_TEMPLATE: RepoTemplate = {
  templateId: "toolhub",
  name: "toolhub",
  description:
    "Internal tool orchestration service. Error messages reference 'toolhub-setup' " +
    "(hallucinated name) but actual command is './th setup'. " +
    "Mimics real sad paths: hallucinated tools (92x), missing modules (88x).",
  language: "python",
  files: TOOLHUB_FILES,
  executablePaths: ["th"],
  setupCommands: [],
  traps: [TRAP_HALLUCINATED_TOOL, TRAP_SYSTEM_PYTHON_MISSING_MODULE],
};

// ─── Tasks ──────────────────────────────────────────────────────────────

export const MONOBUILD_TASKS: RecurringPatternTask[] = [
  {
    taskId: "monobuild-001-multiply",
    repoTemplateId: "monobuild",
    bugDescription: "multiply() returns a+b instead of a*b",
    problemStatement: `The \`multiply()\` function in \`src/monobuild/calc.py\` returns \`a + b\` instead of \`a * b\`. Fix it so that \`multiply(3, 4)\` returns 12.

The failing test is \`tests/test_calc.py::test_multiply\`.`,
    expectedTrapIds: ["fmt-before-lint", "build-target-syntax"],
    verifyCommand: "./mb test calc -- -k test_multiply",
    goldPatch: {
      "src/monobuild/calc.py":
        '"""Calculator module."""\n\n\ndef add(a: float, b: float) -> float:\n\t"""Add two numbers."""\n\treturn a + b\n\n\ndef subtract(a: float, b: float) -> float:\n\t"""Subtract b from a."""\n\treturn a - b\n\n\ndef multiply(a: float, b: float) -> float:\n\t"""Multiply two numbers."""\n\treturn a * b\n\n\ndef safe_divide(a: float, b: float) -> float:\n\t"""Divide a by b, returning 0.0 on division by zero.\n\n\tBUG: returns a instead of 0.0 when b is 0.\n\t"""\n\tif b == 0:\n\t\treturn a\n\treturn a / b\n',
    },
  },
  {
    taskId: "monobuild-002-safe-divide",
    repoTemplateId: "monobuild",
    bugDescription: "safe_divide(10, 0) returns 10 instead of 0.0",
    problemStatement: `The \`safe_divide()\` function in \`src/monobuild/calc.py\` returns \`a\` when \`b\` is 0, but it should return 0.0. \`safe_divide(10, 0)\` should return 0.0, not 10.

The failing test is \`tests/test_calc.py::test_safe_divide_by_zero\`.`,
    expectedTrapIds: ["fmt-before-lint", "build-target-syntax"],
    verifyCommand: "./mb test calc -- -k test_safe_divide_by_zero",
    goldPatch: {
      "src/monobuild/calc.py":
        '"""Calculator module."""\n\n\ndef add(a: float, b: float) -> float:\n\t"""Add two numbers."""\n\treturn a + b\n\n\ndef subtract(a: float, b: float) -> float:\n\t"""Subtract b from a."""\n\treturn a - b\n\n\ndef multiply(a: float, b: float) -> float:\n\t"""Multiply two numbers.\n\n\tBUG: returns a + b instead of a * b.\n\t"""\n\treturn a + b\n\n\ndef safe_divide(a: float, b: float) -> float:\n\t"""Divide a by b, returning 0.0 on division by zero."""\n\tif b == 0:\n\t\treturn 0.0\n\treturn a / b\n',
    },
  },
  {
    taskId: "monobuild-003-word-count",
    repoTemplateId: "monobuild",
    bugDescription: "word_count() doesn't count tab-separated words",
    problemStatement: `The \`word_count()\` function in \`src/monobuild/text.py\` splits only on spaces, not on all whitespace. \`word_count("hello\\tworld\\there")\` should return 3, not 1.

The failing test is \`tests/test_text.py::test_word_count_tabs\`.`,
    expectedTrapIds: ["fmt-before-lint", "build-target-syntax"],
    verifyCommand: "./mb test text -- -k test_word_count_tabs",
    goldPatch: {
      "src/monobuild/text.py":
        '"""Text processing module."""\n\n\ndef word_count(text: str) -> int:\n\t"""Count words in text."""\n\tif not text.strip():\n\t\treturn 0\n\treturn len(text.split())\n\n\ndef truncate(text: str, max_len: int) -> str:\n\t"""Truncate text to max_len, adding ... if truncated.\n\n\tBUG: adds ... even when text fits exactly.\n\t"""\n\tif len(text) >= max_len:\n\t\treturn text[: max_len - 3] + "..."\n\treturn text\n\n\ndef title_case(text: str) -> str:\n\t"""Convert to title case.\n\n\tBUG: capitalizes words after apostrophes (e.g., "don\'T").\n\t"""\n\treturn text.title()\n\n\ndef reverse_words(text: str) -> str:\n\t"""Reverse the order of words in text.\n\t"""\n\treturn " ".join(text.split()[::-1])\n',
    },
  },
  {
    taskId: "monobuild-004-truncate-exact",
    repoTemplateId: "monobuild",
    bugDescription: 'truncate("hello", 5) should not add "..."',
    problemStatement: `The \`truncate()\` function in \`src/monobuild/text.py\` adds "..." even when the text length exactly equals max_len. \`truncate("hello", 5)\` should return "hello", not "he...".

The failing test is \`tests/test_text.py::test_truncate_exact\`.`,
    expectedTrapIds: ["fmt-before-lint", "build-target-syntax"],
    verifyCommand: "./mb test text -- -k test_truncate_exact",
    goldPatch: {
      "src/monobuild/text.py":
        '"""Text processing module."""\n\n\ndef word_count(text: str) -> int:\n\t"""Count words in text.\n\n\tBUG: splits on spaces only, not all whitespace.\n\t"""\n\tif not text.strip():\n\t\treturn 0\n\treturn len(text.split(" "))\n\n\ndef truncate(text: str, max_len: int) -> str:\n\t"""Truncate text to max_len, adding ... if truncated."""\n\tif len(text) > max_len:\n\t\treturn text[: max_len - 3] + "..."\n\treturn text\n\n\ndef title_case(text: str) -> str:\n\t"""Convert to title case.\n\n\tBUG: capitalizes words after apostrophes (e.g., "don\'T").\n\t"""\n\treturn text.title()\n\n\ndef reverse_words(text: str) -> str:\n\t"""Reverse the order of words in text.\n\t"""\n\treturn " ".join(text.split()[::-1])\n',
    },
  },
];

export const TOOLHUB_TASKS: RecurringPatternTask[] = [
  {
    taskId: "toolhub-001-register-empty",
    repoTemplateId: "toolhub",
    bugDescription: "register_tool() doesn't reject empty names",
    problemStatement: `The \`register_tool()\` function in \`src/toolhub/registry.py\` accepts empty strings as tool names. It should validate that name is non-empty and return None for invalid names.

The failing test is \`tests/test_registry.py::test_register_tool_empty_name\`.`,
    expectedTrapIds: ["hallucinated-tool", "system-python-missing-module"],
    verifyCommand: "pytest tests/test_registry.py::test_register_tool_empty_name -x",
    goldPatch: {
      "src/toolhub/registry.py": `"""Tool registry — tracks available tools and their metadata."""
from toolhub import config


def register_tool(name: str, version: str, description: str) -> dict | None:
    """Register a new tool. Returns None if name is empty."""
    if not name:
        return None
    _ = config.get_auth_token()
    return {
        "name": name,
        "version": version,
        "description": description,
        "status": "active",
    }


def list_tools(tools: list[dict], status: str = "active") -> list[dict]:
    """List tools filtered by status.

    BUG: filter comparison uses = instead of == (always returns all tools).
    Actually the bug is: doesn't filter at all, returns all tools.
    """
    return tools


def search_tools(tools: list[dict], query: str) -> list[dict]:
    """Search tools by name or description.

    BUG: only searches name, not description.
    """
    query_lower = query.lower()
    return [t for t in tools if query_lower in t.get("name", "").lower()]


def deprecate_tool(tools: list[dict], name: str) -> list[dict]:
    """Mark a tool as deprecated.

    BUG: removes the tool instead of changing its status.
    """
    return [t for t in tools if t["name"] != name]
`,
    },
  },
  {
    taskId: "toolhub-002-list-filter",
    repoTemplateId: "toolhub",
    bugDescription: "list_tools() doesn't filter by status",
    problemStatement: `The \`list_tools()\` function in \`src/toolhub/registry.py\` ignores the status parameter and returns all tools. It should only return tools whose status matches the given parameter.

The failing test is \`tests/test_registry.py::test_list_tools_filter\`.`,
    expectedTrapIds: ["hallucinated-tool", "system-python-missing-module"],
    verifyCommand: "pytest tests/test_registry.py::test_list_tools_filter -x",
    goldPatch: {
      "src/toolhub/registry.py": `"""Tool registry — tracks available tools and their metadata."""
from toolhub import config


def register_tool(name: str, version: str, description: str) -> dict:
    """Register a new tool."""
    _ = config.get_auth_token()
    return {
        "name": name,
        "version": version,
        "description": description,
        "status": "active",
    }


def list_tools(tools: list[dict], status: str = "active") -> list[dict]:
    """List tools filtered by status."""
    return [t for t in tools if t.get("status") == status]


def search_tools(tools: list[dict], query: str) -> list[dict]:
    """Search tools by name or description.

    BUG: only searches name, not description.
    """
    query_lower = query.lower()
    return [t for t in tools if query_lower in t.get("name", "").lower()]


def deprecate_tool(tools: list[dict], name: str) -> list[dict]:
    """Mark a tool as deprecated.

    BUG: removes the tool instead of changing its status.
    """
    return [t for t in tools if t["name"] != name]
`,
    },
  },
  {
    taskId: "toolhub-003-search-desc",
    repoTemplateId: "toolhub",
    bugDescription: "search_tools() doesn't search descriptions",
    problemStatement: `The \`search_tools()\` function in \`src/toolhub/registry.py\` only searches tool names, not descriptions. Searching for "quality" should match a tool with description "Code quality checker".

The failing test is \`tests/test_registry.py::test_search_tools_by_description\`.`,
    expectedTrapIds: ["hallucinated-tool", "system-python-missing-module"],
    verifyCommand: "pytest tests/test_registry.py::test_search_tools_by_description -x",
    goldPatch: {
      "src/toolhub/registry.py": `"""Tool registry — tracks available tools and their metadata."""
from toolhub import config


def register_tool(name: str, version: str, description: str) -> dict:
    """Register a new tool."""
    _ = config.get_auth_token()
    return {
        "name": name,
        "version": version,
        "description": description,
        "status": "active",
    }


def list_tools(tools: list[dict], status: str = "active") -> list[dict]:
    """List tools filtered by status.

    BUG: doesn't filter at all, returns all tools.
    """
    return tools


def search_tools(tools: list[dict], query: str) -> list[dict]:
    """Search tools by name or description."""
    query_lower = query.lower()
    return [
        t
        for t in tools
        if query_lower in t.get("name", "").lower()
        or query_lower in t.get("description", "").lower()
    ]


def deprecate_tool(tools: list[dict], name: str) -> list[dict]:
    """Mark a tool as deprecated.

    BUG: removes the tool instead of changing its status.
    """
    return [t for t in tools if t["name"] != name]
`,
    },
  },
  {
    taskId: "toolhub-004-batch-order",
    repoTemplateId: "toolhub",
    bugDescription: "batch_execute() returns results in wrong order",
    problemStatement: `The \`batch_execute()\` function in \`src/toolhub/executor.py\` reverses the result order. When executing tools [first, second, third], results should be in the same order, not reversed.

The failing test is \`tests/test_executor.py::test_batch_execute_order\`.`,
    expectedTrapIds: ["hallucinated-tool", "system-python-missing-module"],
    verifyCommand: "pytest tests/test_executor.py::test_batch_execute_order -x",
    goldPatch: {
      "src/toolhub/executor.py": `"""Tool execution engine."""


def execute_tool(tool: dict, args: dict) -> dict:
    """Execute a tool with given arguments.

    BUG: doesn't check if tool status is 'active' before executing.
    """
    return {
        "tool": tool["name"],
        "args": args,
        "status": "success",
        "output": f"Executed {tool['name']}",
    }


def validate_args(tool: dict, args: dict) -> list[str]:
    """Validate tool arguments against the tool's required fields.

    BUG: treats optional fields as required.
    """
    required = tool.get("required_args", [])
    optional = tool.get("optional_args", [])
    errors = []
    for field in required + optional:
        if field not in args:
            errors.append(f"Missing argument: {field}")
    return errors


def batch_execute(tools: list[dict], args_list: list[dict]) -> list[dict]:
    """Execute multiple tools. Returns results in order."""
    results = []
    for tool, args in zip(tools, args_list):
        results.append(execute_tool(tool, args))
    return results
`,
    },
  },
];
