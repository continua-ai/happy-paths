/**
 * Repo templates for the recurring-pattern benchmark.
 *
 * Each template is a small Python project with:
 * - Intentional bugs (one per task)
 * - Recurring traps that agents will hit regardless of which bug they fix
 *
 * The traps are the core of the benchmark: they recur across tasks/repos,
 * and Happy Paths should learn to avoid them after the first encounter.
 */

import type {
  RecurringPatternTask,
  RecurringTrap,
  RepoTemplate,
} from "./recurringPattern.js";

// ─── Shared traps (appear across multiple repos) ────────────────────────

export const TRAP_MISSING_PYTEST_COV: RecurringTrap = {
  trapId: "missing-pytest-cov",
  family: "env_dep",
  description:
    "pyproject.toml configures pytest with --cov, but pytest-cov is not in requirements.txt (only in requirements-dev.txt). Running pytest fails with ModuleNotFoundError.",
  errorPattern:
    "ModuleNotFoundError.*pytest_cov|No module named.*pytest.cov|ERRORS.*pytest-cov",
  fixDescription:
    "Install dev dependencies: pip install -r requirements-dev.txt (or pip install pytest-cov)",
  fixCommand: "pip install pytest-cov",
};

export const TRAP_MISSING_PYYAML: RecurringTrap = {
  trapId: "missing-pyyaml",
  family: "env_dep",
  description:
    "Code imports yaml but PyYAML is not in requirements.txt. Fails with ModuleNotFoundError: No module named 'yaml'.",
  errorPattern: "ModuleNotFoundError.*yaml|No module named.*yaml",
  fixDescription: "Install PyYAML: pip install pyyaml",
  fixCommand: "pip install pyyaml",
};

export const TRAP_BROAD_PYTEST: RecurringTrap = {
  trapId: "broad-pytest-suite",
  family: "tool_flag",
  description:
    "Running bare `pytest` executes the entire test suite including slow integration tests. The agent should scope with -k or a specific test file.",
  errorPattern: "FAILED tests/test_integration|tests/test_slow|timeout|Timeout",
  fixDescription:
    "Scope test runs: use `pytest tests/test_<specific>.py` or `pytest -k 'not slow and not integration'`",
  fixCommand: "pytest -k 'not slow and not integration'",
};

export const TRAP_MISSING_CONFIG_YAML: RecurringTrap = {
  trapId: "missing-config-yaml",
  family: "config",
  description:
    "Code reads config.yaml at import time, but only config.yaml.example is in the repo. Tests fail with FileNotFoundError.",
  errorPattern: "FileNotFoundError.*config\\.yaml|No such file.*config\\.yaml",
  fixDescription: "Copy config.yaml.example to config.yaml before running tests.",
  fixCommand: "cp config.yaml.example config.yaml",
};

export const TRAP_MISSING_ENV_SECRET: RecurringTrap = {
  trapId: "missing-env-secret-key",
  family: "config",
  description:
    "App reads SECRET_KEY from environment. Tests fail with KeyError when it's not set.",
  errorPattern: "KeyError.*SECRET_KEY|SECRET_KEY.*not set|environ.*SECRET_KEY",
  fixDescription: "Set the SECRET_KEY env var before running tests.",
  fixCommand: "export SECRET_KEY=test-secret-key-for-dev",
};

export const TRAP_PYTEST_NO_HEADER: RecurringTrap = {
  trapId: "pytest-import-error-conftest",
  family: "env_dep",
  description:
    "conftest.py imports a helper that requires the package to be installed in dev mode. Running pytest from the repo root without `pip install -e .` fails with ImportError.",
  errorPattern: "ImportError|ModuleNotFoundError.*(?:pymath|taskapi|dataproc)",
  fixDescription: "Install the package in editable mode: pip install -e .",
  fixCommand: "pip install -e .",
};

// ─── Repo template: pymath ──────────────────────────────────────────────

const PYMATH_FILES: Record<string, string> = {
  "pyproject.toml": `[project]
name = "pymath"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
addopts = "--cov=pymath --cov-report=term-missing"
testpaths = ["tests"]
markers = [
    "slow: marks tests as slow (deselect with '-m not slow')",
    "integration: marks integration tests",
]
`,

  "requirements.txt": `# Runtime dependencies only
`,

  "requirements-dev.txt": `pytest>=7.0
pytest-cov>=4.0
`,

  "pymath/__init__.py": `"""pymath: small math utilities for benchmarking."""
`,

  "pymath/stats.py": `"""Statistical functions."""


def mean(values: list[float]) -> float:
    """Return the arithmetic mean of values.

    BUG: crashes on empty list instead of returning 0.0.
    """
    return sum(values) / len(values)


def stdev(values: list[float], population: bool = False) -> float:
    """Return standard deviation.

    BUG: always computes population stdev even when population=False.
    Should use (n-1) denominator for sample stdev.
    """
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    variance = sum((x - avg) ** 2 for x in values) / len(values)
    return variance ** 0.5
`,

  "pymath/linalg.py": `"""Linear algebra utilities."""


def transpose(matrix: list[list[float]]) -> list[list[float]]:
    """Transpose a matrix.

    BUG: only works for square matrices. Fails on non-square inputs.
    """
    n = len(matrix)
    result = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            result[j][i] = matrix[i][j]
    return result


def dot_product(a: list[float], b: list[float]) -> float:
    """Compute dot product of two vectors."""
    if len(a) != len(b):
        raise ValueError("Vectors must have same length")
    return sum(x * y for x, y in zip(a, b))
`,

  "pymath/convert.py": `"""Unit conversion utilities."""


def celsius_to_fahrenheit(c: float) -> float:
    """Convert Celsius to Fahrenheit.

    BUG: formula is wrong. Uses c * 9/5 + 30 instead of c * 9/5 + 32.
    """
    return c * 9 / 5 + 30


def kg_to_pounds(kg: float) -> float:
    """Convert kilograms to pounds."""
    return kg * 2.20462
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Shared test configuration."""
import pymath  # noqa: F401 — ensures package is importable
`,

  "tests/test_stats.py": `"""Tests for pymath.stats."""
import pytest
from pymath import stats


def test_mean_basic():
    assert stats.mean([1, 2, 3]) == 2.0


def test_mean_single():
    assert stats.mean([42]) == 42.0


def test_mean_empty():
    """Empty list should return 0.0, not crash."""
    assert stats.mean([]) == 0.0


def test_stdev_sample():
    """Sample stdev of [2, 4, 4, 4, 5, 5, 7, 9] should be ~2.138."""
    values = [2, 4, 4, 4, 5, 5, 7, 9]
    result = stats.stdev(values, population=False)
    assert abs(result - 2.138) < 0.01


def test_stdev_population():
    """Population stdev of [2, 4, 4, 4, 5, 5, 7, 9] should be 2.0."""
    values = [2, 4, 4, 4, 5, 5, 7, 9]
    result = stats.stdev(values, population=True)
    assert abs(result - 2.0) < 0.01
`,

  "tests/test_linalg.py": `"""Tests for pymath.linalg."""
from pymath import linalg


def test_transpose_square():
    m = [[1, 2], [3, 4]]
    assert linalg.transpose(m) == [[1, 3], [2, 4]]


def test_transpose_non_square():
    \"\"\"Non-square matrix transpose. BUG: current impl fails here.\"\"\"
    m = [[1, 2, 3], [4, 5, 6]]
    result = linalg.transpose(m)
    assert result == [[1, 4], [2, 5], [3, 6]]


def test_dot_product():
    assert linalg.dot_product([1, 2, 3], [4, 5, 6]) == 32
`,

  "tests/test_convert.py": `"""Tests for pymath.convert."""
from pymath import convert


def test_celsius_to_fahrenheit_boiling():
    assert convert.celsius_to_fahrenheit(100) == 212.0


def test_celsius_to_fahrenheit_freezing():
    assert convert.celsius_to_fahrenheit(0) == 32.0


def test_celsius_to_fahrenheit_body():
    result = convert.celsius_to_fahrenheit(37)
    assert abs(result - 98.6) < 0.1


def test_kg_to_pounds():
    result = convert.kg_to_pounds(1)
    assert abs(result - 2.205) < 0.01
`,

  "tests/test_integration.py": `"""Integration tests — slow, require external services."""
import pytest
import time


@pytest.mark.slow
@pytest.mark.integration
def test_heavy_computation():
    \"\"\"Simulate a slow integration test.\"\"\"
    time.sleep(30)
    assert True


@pytest.mark.slow
@pytest.mark.integration
def test_another_heavy_computation():
    \"\"\"Another slow integration test.\"\"\"
    time.sleep(30)
    assert True
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="pymath", version="0.1.0", packages=find_packages())
`,
};

// ─── Repo template: dataproc ────────────────────────────────────────────

const DATAPROC_FILES: Record<string, string> = {
  "pyproject.toml": `[project]
name = "dataproc"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = []

[tool.pytest.ini_options]
addopts = "--cov=dataproc --cov-report=term-missing"
testpaths = ["tests"]
markers = [
    "slow: marks tests as slow",
    "integration: marks integration tests",
]
`,

  "requirements.txt": `# Runtime dependencies
`,

  "requirements-dev.txt": `pytest>=7.0
pytest-cov>=4.0
pyyaml>=6.0
`,

  "config.yaml.example": `# Application configuration
database:
  host: localhost
  port: 5432
  name: dataproc_dev

logging:
  level: INFO
  format: "%(asctime)s %(levelname)s %(message)s"

processing:
  batch_size: 100
  max_retries: 3
`,

  "dataproc/__init__.py": `"""dataproc: data processing pipeline utilities."""
`,

  "dataproc/config.py": `"""Configuration loader."""
import os

import yaml


def load_config(path: str = "config.yaml") -> dict:
    """Load configuration from YAML file.

    NOTE: reads config.yaml from the current directory. The file must exist.
    """
    with open(path) as f:
        return yaml.safe_load(f)


def get_secret_key() -> str:
    """Get the application secret key from environment."""
    return os.environ["SECRET_KEY"]
`,

  "dataproc/csv_parser.py": `"""CSV parsing utilities."""


def parse_csv_line(line: str) -> list[str]:
    """Parse a single CSV line, handling quoted fields.

    BUG: doesn't handle commas inside quoted fields.
    """
    return line.strip().split(",")


def parse_csv(text: str) -> list[list[str]]:
    """Parse multi-line CSV text."""
    lines = text.strip().split("\\n")
    return [parse_csv_line(line) for line in lines if line.strip()]
`,

  "dataproc/json_validator.py": `"""JSON schema validation utilities."""


def validate_array(data: list) -> bool:
    """Validate that data is a non-empty array.

    BUG: rejects empty arrays. Should accept [] as valid.
    """
    if not isinstance(data, list):
        return False
    if len(data) == 0:
        return False
    return True


def validate_object(data: dict, required_keys: list[str]) -> list[str]:
    """Return list of missing required keys."""
    return [k for k in required_keys if k not in data]
`,

  "dataproc/date_utils.py": `"""Date utilities."""
from datetime import date, timedelta


def date_range(start: date, end: date) -> list[date]:
    """Return list of dates from start to end (inclusive).

    BUG: end date is exclusive instead of inclusive.
    """
    result = []
    current = start
    while current < end:
        result.append(current)
        current += timedelta(days=1)
    return result
`,

  "dataproc/encoding.py": `"""Text encoding utilities."""


def read_text(content: bytes, encoding: str = "utf-8") -> str:
    """Read text from bytes, handling BOM.

    BUG: doesn't strip UTF-8 BOM (\\xef\\xbb\\xbf).
    """
    return content.decode(encoding)
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Shared test fixtures."""
import dataproc  # noqa: F401
`,

  "tests/test_csv_parser.py": `"""Tests for dataproc.csv_parser."""
from dataproc import csv_parser


def test_parse_simple():
    assert csv_parser.parse_csv_line("a,b,c") == ["a", "b", "c"]


def test_parse_quoted_commas():
    \"\"\"Quoted field containing a comma. BUG: current impl splits it.\"\"\"
    result = csv_parser.parse_csv_line('name,"city, state",zip')
    assert result == ["name", "city, state", "zip"]


def test_parse_csv_multiline():
    text = "a,b\\nc,d"
    result = csv_parser.parse_csv(text)
    assert len(result) == 2
`,

  "tests/test_json_validator.py": `"""Tests for dataproc.json_validator."""
from dataproc import json_validator


def test_validate_array_nonempty():
    assert json_validator.validate_array([1, 2, 3]) is True


def test_validate_array_empty():
    \"\"\"Empty array should be valid. BUG: current impl rejects it.\"\"\"
    assert json_validator.validate_array([]) is True


def test_validate_array_not_list():
    assert json_validator.validate_array("not a list") is False


def test_validate_object_missing_keys():
    result = json_validator.validate_object({"a": 1}, ["a", "b"])
    assert result == ["b"]
`,

  "tests/test_date_utils.py": `"""Tests for dataproc.date_utils."""
from datetime import date
from dataproc import date_utils


def test_date_range_inclusive():
    \"\"\"End date should be inclusive. BUG: current impl is exclusive.\"\"\"
    result = date_utils.date_range(date(2024, 1, 1), date(2024, 1, 3))
    assert len(result) == 3
    assert result[-1] == date(2024, 1, 3)


def test_date_range_single_day():
    result = date_utils.date_range(date(2024, 6, 15), date(2024, 6, 15))
    assert result == [date(2024, 6, 15)]
`,

  "tests/test_encoding.py": `"""Tests for dataproc.encoding."""
from dataproc import encoding


def test_read_text_basic():
    assert encoding.read_text(b"hello") == "hello"


def test_read_text_utf8_bom():
    \"\"\"UTF-8 BOM should be stripped. BUG: current impl includes it.\"\"\"
    content = b"\\xef\\xbb\\xbfhello"
    result = encoding.read_text(content)
    assert result == "hello"
    assert not result.startswith("\\ufeff")
`,

  "tests/test_config_integration.py": `"""Integration tests that need config.yaml and SECRET_KEY."""
import pytest
import time


@pytest.mark.slow
@pytest.mark.integration
def test_load_config():
    \"\"\"Requires config.yaml to exist.\"\"\"
    from dataproc import config as cfg
    data = cfg.load_config()
    assert "database" in data


@pytest.mark.slow
@pytest.mark.integration
def test_secret_key():
    \"\"\"Requires SECRET_KEY env var.\"\"\"
    from dataproc import config as cfg
    key = cfg.get_secret_key()
    assert len(key) > 0


@pytest.mark.slow
@pytest.mark.integration
def test_heavy_processing():
    time.sleep(30)
    assert True
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="dataproc", version="0.1.0", packages=find_packages())
`,
};

// ─── Template definitions ───────────────────────────────────────────────

export const PYMATH_TEMPLATE: RepoTemplate = {
  templateId: "pymath",
  name: "pymath",
  description:
    "Small Python math utilities library. Has pytest-cov configured in pyproject.toml but not installed, slow integration tests, and requires editable install.",
  language: "python",
  files: PYMATH_FILES,
  setupCommands: [],
  traps: [TRAP_MISSING_PYTEST_COV, TRAP_BROAD_PYTEST, TRAP_PYTEST_NO_HEADER],
};

export const DATAPROC_TEMPLATE: RepoTemplate = {
  templateId: "dataproc",
  name: "dataproc",
  description:
    "Data processing pipeline with CSV parsing, JSON validation, date utils, and encoding. Has missing PyYAML dep, missing config.yaml, missing SECRET_KEY, pytest-cov not installed, and slow integration tests.",
  language: "python",
  files: DATAPROC_FILES,
  setupCommands: [],
  traps: [
    TRAP_MISSING_PYTEST_COV,
    TRAP_MISSING_PYYAML,
    TRAP_MISSING_CONFIG_YAML,
    TRAP_MISSING_ENV_SECRET,
    TRAP_BROAD_PYTEST,
    TRAP_PYTEST_NO_HEADER,
  ],
};

// ─── Task definitions ───────────────────────────────────────────────────

export const PYMATH_TASKS: RecurringPatternTask[] = [
  {
    taskId: "pymath-001-mean-empty",
    repoTemplateId: "pymath",
    bugDescription: "mean() crashes on empty list",
    problemStatement: `The \`mean()\` function in \`pymath/stats.py\` raises a ZeroDivisionError when called with an empty list. It should return 0.0 instead.

The failing test is \`tests/test_stats.py::test_mean_empty\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_stats.py::test_mean_empty -x",
    goldPatch: {
      "pymath/stats.py": `"""Statistical functions."""


def mean(values: list[float]) -> float:
    """Return the arithmetic mean of values."""
    if len(values) == 0:
        return 0.0
    return sum(values) / len(values)


def stdev(values: list[float], population: bool = False) -> float:
    """Return standard deviation.

    BUG: always computes population stdev even when population=False.
    Should use (n-1) denominator for sample stdev.
    """
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    variance = sum((x - avg) ** 2 for x in values) / len(values)
    return variance ** 0.5
`,
    },
  },
  {
    taskId: "pymath-002-stdev-sample",
    repoTemplateId: "pymath",
    bugDescription: "stdev() ignores the population parameter",
    problemStatement: `The \`stdev()\` function in \`pymath/stats.py\` always computes population standard deviation (divides by n) even when \`population=False\`. When \`population=False\`, it should use the sample standard deviation formula (divide by n-1).

The failing test is \`tests/test_stats.py::test_stdev_sample\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_stats.py::test_stdev_sample -x",
    goldPatch: {
      "pymath/stats.py": `"""Statistical functions."""


def mean(values: list[float]) -> float:
    """Return the arithmetic mean of values.

    BUG: crashes on empty list instead of returning 0.0.
    """
    return sum(values) / len(values)


def stdev(values: list[float], population: bool = False) -> float:
    """Return standard deviation."""
    if len(values) < 2:
        return 0.0
    avg = mean(values)
    n = len(values) if population else len(values) - 1
    variance = sum((x - avg) ** 2 for x in values) / n
    return variance ** 0.5
`,
    },
  },
  {
    taskId: "pymath-003-transpose-nonsquare",
    repoTemplateId: "pymath",
    bugDescription: "transpose() fails on non-square matrices",
    problemStatement: `The \`transpose()\` function in \`pymath/linalg.py\` only works for square matrices. When given a non-square matrix (e.g., 2x3), it crashes or produces wrong results. It should handle any MxN matrix, producing an NxM result.

The failing test is \`tests/test_linalg.py::test_transpose_non_square\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_linalg.py::test_transpose_non_square -x",
    goldPatch: {
      "pymath/linalg.py": `"""Linear algebra utilities."""


def transpose(matrix: list[list[float]]) -> list[list[float]]:
    """Transpose a matrix. Works for any MxN matrix."""
    if not matrix or not matrix[0]:
        return []
    rows = len(matrix)
    cols = len(matrix[0])
    result = [[0.0] * rows for _ in range(cols)]
    for i in range(rows):
        for j in range(cols):
            result[j][i] = matrix[i][j]
    return result


def dot_product(a: list[float], b: list[float]) -> float:
    """Compute dot product of two vectors."""
    if len(a) != len(b):
        raise ValueError("Vectors must have same length")
    return sum(x * y for x, y in zip(a, b))
`,
    },
  },
  {
    taskId: "pymath-004-celsius-formula",
    repoTemplateId: "pymath",
    bugDescription: "celsius_to_fahrenheit() returns wrong values",
    problemStatement: `The \`celsius_to_fahrenheit()\` function in \`pymath/convert.py\` uses the wrong formula. It computes \`c * 9/5 + 30\` instead of the correct \`c * 9/5 + 32\`.

The failing tests are in \`tests/test_convert.py\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_convert.py -x",
    goldPatch: {
      "pymath/convert.py": `"""Unit conversion utilities."""


def celsius_to_fahrenheit(c: float) -> float:
    """Convert Celsius to Fahrenheit."""
    return c * 9 / 5 + 32


def kg_to_pounds(kg: float) -> float:
    """Convert kilograms to pounds."""
    return kg * 2.20462
`,
    },
  },
];

export const DATAPROC_TASKS: RecurringPatternTask[] = [
  {
    taskId: "dataproc-001-csv-quoted",
    repoTemplateId: "dataproc",
    bugDescription: "CSV parser doesn't handle quoted commas",
    problemStatement: `The \`parse_csv_line()\` function in \`dataproc/csv_parser.py\` doesn't handle commas inside quoted fields. For input \`'name,"city, state",zip'\`, it should return \`["name", "city, state", "zip"]\` but instead splits on every comma.

The failing test is \`tests/test_csv_parser.py::test_parse_quoted_commas\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "missing-pyyaml",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_csv_parser.py::test_parse_quoted_commas -x",
    goldPatch: {
      "dataproc/csv_parser.py": `"""CSV parsing utilities."""
import csv
import io


def parse_csv_line(line: str) -> list[str]:
    """Parse a single CSV line, handling quoted fields."""
    reader = csv.reader(io.StringIO(line))
    for row in reader:
        return row
    return []


def parse_csv(text: str) -> list[list[str]]:
    """Parse multi-line CSV text."""
    lines = text.strip().split("\\n")
    return [parse_csv_line(line) for line in lines if line.strip()]
`,
    },
  },
  {
    taskId: "dataproc-002-json-empty-array",
    repoTemplateId: "dataproc",
    bugDescription: "JSON validator rejects empty arrays",
    problemStatement: `The \`validate_array()\` function in \`dataproc/json_validator.py\` rejects empty arrays (\`[]\`) as invalid. An empty array is valid JSON and should be accepted.

The failing test is \`tests/test_json_validator.py::test_validate_array_empty\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "missing-pyyaml",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_json_validator.py::test_validate_array_empty -x",
    goldPatch: {
      "dataproc/json_validator.py": `"""JSON schema validation utilities."""


def validate_array(data: list) -> bool:
    """Validate that data is a list (empty or non-empty)."""
    return isinstance(data, list)


def validate_object(data: dict, required_keys: list[str]) -> list[str]:
    """Return list of missing required keys."""
    return [k for k in required_keys if k not in data]
`,
    },
  },
  {
    taskId: "dataproc-003-date-range-inclusive",
    repoTemplateId: "dataproc",
    bugDescription: "date_range() end date is exclusive instead of inclusive",
    problemStatement: `The \`date_range()\` function in \`dataproc/date_utils.py\` treats the end date as exclusive (like Python's \`range()\`). It should be inclusive — \`date_range(Jan 1, Jan 3)\` should return [Jan 1, Jan 2, Jan 3], not just [Jan 1, Jan 2].

The failing test is \`tests/test_date_utils.py::test_date_range_inclusive\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "missing-pyyaml",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_date_utils.py::test_date_range_inclusive -x",
    goldPatch: {
      "dataproc/date_utils.py": `"""Date utilities."""
from datetime import date, timedelta


def date_range(start: date, end: date) -> list[date]:
    """Return list of dates from start to end (inclusive)."""
    result = []
    current = start
    while current <= end:
        result.append(current)
        current += timedelta(days=1)
    return result
`,
    },
  },
  {
    taskId: "dataproc-004-utf8-bom",
    repoTemplateId: "dataproc",
    bugDescription: "read_text() doesn't strip UTF-8 BOM",
    problemStatement: `The \`read_text()\` function in \`dataproc/encoding.py\` doesn't handle the UTF-8 BOM (byte order mark, \\\\xef\\\\xbb\\\\xbf). When reading a file that starts with a BOM, the decoded text includes the invisible \\\\ufeff character at the start.

The failing test is \`tests/test_encoding.py::test_read_text_utf8_bom\`.`,
    expectedTrapIds: [
      "missing-pytest-cov",
      "missing-pyyaml",
      "broad-pytest-suite",
      "pytest-import-error-conftest",
    ],
    verifyCommand: "pytest tests/test_encoding.py::test_read_text_utf8_bom -x",
    goldPatch: {
      "dataproc/encoding.py": `"""Text encoding utilities."""


def read_text(content: bytes, encoding: str = "utf-8") -> str:
    """Read text from bytes, handling BOM."""
    text = content.decode(encoding)
    if text.startswith("\\ufeff"):
        text = text[1:]
    return text
`,
    },
  },
];

/** All templates. */
export const ALL_TEMPLATES: RepoTemplate[] = [PYMATH_TEMPLATE, DATAPROC_TEMPLATE];

/** All tasks. */
export const ALL_TASKS: RecurringPatternTask[] = [...PYMATH_TASKS, ...DATAPROC_TASKS];

/** All unique traps. */
export const ALL_TRAPS: RecurringTrap[] = [
  TRAP_MISSING_PYTEST_COV,
  TRAP_MISSING_PYYAML,
  TRAP_BROAD_PYTEST,
  TRAP_MISSING_CONFIG_YAML,
  TRAP_MISSING_ENV_SECRET,
  TRAP_PYTEST_NO_HEADER,
];
