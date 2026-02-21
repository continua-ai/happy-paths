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

// ─── Hard traps (internal tooling / company-specific) ───────────────────

export const TRAP_INTERNAL_VENDOR_DEP: RecurringTrap = {
  trapId: "internal-vendor-dep",
  family: "env_dep",
  description:
    "The project depends on an internal package (authlib_internal) that is NOT on PyPI. " +
    "It must be installed from the vendor/ directory: pip install vendor/authlib_internal. " +
    "Running pip install authlib-internal will fail with 'No matching distribution found'.",
  errorPattern:
    "ModuleNotFoundError.*authlib_internal|No matching distribution.*authlib.internal",
  fixDescription:
    "Install the internal package from vendor/: pip install vendor/authlib_internal",
  fixCommand: "pip install vendor/authlib_internal",
};

export const TRAP_MISSING_TEST_ENV: RecurringTrap = {
  trapId: "missing-test-env",
  family: "config",
  description:
    "Tests require env vars (TASKAPI_DB_URL etc.) that are defined in .env.test. " +
    "Running pytest directly without sourcing .env.test fails with KeyError.",
  errorPattern: "KeyError.*TASKAPI_DB_URL|TASKAPI_DB_URL.*not set",
  fixDescription: "Source the test env file before running tests: source .env.test",
  fixCommand: "source .env.test",
};

export const TRAP_CUSTOM_DEV_CLI: RecurringTrap = {
  trapId: "custom-dev-cli",
  family: "tool_flag",
  description:
    "This project uses a custom ./dev CLI for all dev workflows. " +
    "Running bare pytest misses env setup, vendor deps, and editable install.",
  errorPattern: "ModuleNotFoundError|KeyError|ImportError",
  fixDescription: "Use the project's dev CLI: ./dev test",
  fixCommand: "./dev test",
};

export const TRAP_BUILD_BEFORE_TEST: RecurringTrap = {
  trapId: "build-before-test",
  family: "tool_flag",
  description:
    "Tests import from buildkit.generated.schema which is auto-generated. " +
    "Running tests without building first fails with ModuleNotFoundError.",
  errorPattern:
    "ModuleNotFoundError.*buildkit\\.generated\\.schema|cannot import name.*from.*buildkit\\.generated",
  fixDescription: "Run the build step first: ./proj build",
  fixCommand: "./proj build",
};

export const TRAP_CUSTOM_BUILD_TOOL: RecurringTrap = {
  trapId: "custom-build-tool",
  family: "tool_flag",
  description:
    "This project uses a custom ./proj CLI for build/test. " +
    "Standard commands (make, npm, python setup.py) won't work.",
  errorPattern: "No rule to make target|npm ERR!|command not found",
  fixDescription: "Use the project's build tool: ./proj build && ./proj test",
  fixCommand: "./proj build && ./proj test",
};

// ─── Repo template: taskapi (internal dev CLI + vendor dep + env vars) ──

const TASKAPI_FILES: Record<string, string> = {
  "README.md": `# TaskAPI

Internal task management microservice.

## Development

This project uses a custom dev CLI. Do NOT run pytest directly.

\`\`\`bash
# First time setup (creates venv, installs deps including internal packages):
./dev setup

# Run tests:
./dev test

# Run a specific test:
./dev test -- tests/test_tasks.py::test_filter_overdue_excludes_cutoff -x

# Lint:
./dev lint
\`\`\`

### Internal dependencies

\`authlib_internal\` is an internal auth library. It is NOT on PyPI.
It is bundled in \`vendor/authlib_internal/\` and installed by \`./dev setup\`.

### Environment

Test env vars are in \`.env.test\`. The \`./dev test\` command sources this automatically.
`,

  dev: `#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

case "\${1:-help}" in
  setup)
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
    .venv/bin/pip install -q -r requirements-dev.txt
    .venv/bin/pip install -q vendor/authlib_internal
    .venv/bin/pip install -q -e .
    echo "Setup complete. Run './dev test' to run tests."
    ;;
  test)
    if [ ! -d .venv ]; then
      echo "Run './dev setup' first." >&2
      exit 1
    fi
    set -a; source .env.test; set +a
    shift
    if [ $# -gt 0 ] && [ "$1" = "--" ]; then shift; fi
    .venv/bin/pytest "\${@:-tests/}" -x -q
    ;;
  lint)
    .venv/bin/ruff check src/ tests/ || true
    ;;
  *)
    echo "Usage: ./dev {setup|test|lint}"
    echo ""
    echo "  setup   Create venv, install all deps (including internal packages)"
    echo "  test    Run tests with proper env vars"
    echo "  lint    Run linter"
    exit 1
    ;;
esac
`,

  "pyproject.toml": `[project]
name = "taskapi"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  ".env.test": `TASKAPI_DB_URL=sqlite:///test.db
TASKAPI_SECRET=test-secret-do-not-use-in-prod
TASKAPI_LOG_LEVEL=DEBUG
`,

  // Internal vendor package
  "vendor/authlib_internal/pyproject.toml": `[build-system]
requires = ["setuptools>=64"]
build-backend = "setuptools.build_meta"

[project]
name = "authlib-internal"
version = "1.0.0"
`,

  "vendor/authlib_internal/authlib_internal/__init__.py": `"""Internal auth library (not on PyPI)."""
from authlib_internal.tokens import verify_token, decode_token

__all__ = ["verify_token", "decode_token"]
`,

  "vendor/authlib_internal/authlib_internal/tokens.py": `"""Token validation for internal services."""

_VALID_PREFIXES = ("tk_test_", "tk_prod_", "tk_staging_")


def verify_token(token: str) -> bool:
    """Check if a token has a valid prefix."""
    return any(token.startswith(p) for p in _VALID_PREFIXES)


def decode_token(token: str) -> dict:
    """Decode a token into its parts."""
    if not verify_token(token):
        raise ValueError(f"Invalid token: {token}")
    parts = token.split("_", 2)
    return {"env": parts[1], "payload": parts[2] if len(parts) > 2 else ""}
`,

  "src/taskapi/__init__.py": `"""TaskAPI: internal task management."""
`,

  "src/taskapi/config.py": `"""Configuration (reads from environment)."""
import os


def get_db_url() -> str:
    """Return database URL from environment."""
    return os.environ["TASKAPI_DB_URL"]


def get_secret() -> str:
    """Return app secret from environment."""
    return os.environ["TASKAPI_SECRET"]
`,

  "src/taskapi/auth.py": `"""Auth helpers using internal authlib."""
from authlib_internal import verify_token, decode_token


def authenticate_request(headers: dict) -> dict | None:
    """Validate the Authorization header and return decoded token, or None."""
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer "):]
    if not verify_token(token):
        return None
    return decode_token(token)
`,

  "src/taskapi/tasks.py": `"""Task management business logic."""
from taskapi import config


def filter_overdue(tasks: list[dict], cutoff_date: str) -> list[dict]:
    """Return tasks whose due_date is strictly before cutoff_date (YYYY-MM-DD).

    BUG: uses <= instead of <, so tasks due ON the cutoff are included.
    """
    # Touch config to ensure env is loaded (used in production for audit logging)
    _ = config.get_db_url()
    return [t for t in tasks if t.get("due_date", "") <= cutoff_date]


def sort_by_priority(tasks: list[dict]) -> list[dict]:
    """Sort tasks by priority: critical > high > medium > low.

    BUG: sorts descending (low first) instead of ascending (critical first).
    """
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(
        tasks,
        key=lambda t: priority_order.get(t.get("priority", "low"), 99),
        reverse=True,
    )


def summarize_by_status(tasks: list[dict]) -> dict[str, int]:
    """Count tasks grouped by status.

    BUG: skips tasks with no 'status' key instead of counting as 'unknown'.
    """
    counts: dict[str, int] = {}
    for t in tasks:
        if "status" not in t:
            continue
        status = t["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts


def merge_duplicates(tasks: list[dict]) -> list[dict]:
    """Merge tasks with same title, keeping the earliest due_date.

    BUG: keeps the latest due_date instead of the earliest.
    """
    seen: dict[str, dict] = {}
    for t in tasks:
        title = t["title"]
        if title not in seen:
            seen[title] = dict(t)
        else:
            existing = seen[title]
            if t.get("due_date", "") > existing.get("due_date", ""):
                existing["due_date"] = t["due_date"]
    return list(seen.values())
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration.

IMPORTANT: Tests require:
1. Internal authlib_internal package (install from vendor/)
2. Environment variables from .env.test
Use ./dev test to run tests with proper setup.
"""
import authlib_internal  # noqa: F401 — validates vendor dep is installed
import os

# Validate test environment is configured
_db_url = os.environ["TASKAPI_DB_URL"]
`,

  "tests/test_tasks.py": `"""Tests for taskapi.tasks."""
from taskapi import tasks


def test_filter_overdue_excludes_cutoff():
    """Tasks due ON the cutoff should NOT be in the overdue list."""
    data = [
        {"title": "A", "due_date": "2024-01-14"},
        {"title": "B", "due_date": "2024-01-15"},
        {"title": "C", "due_date": "2024-01-16"},
    ]
    result = tasks.filter_overdue(data, "2024-01-15")
    titles = [t["title"] for t in result]
    assert titles == ["A"], f"Expected only A, got {titles}"


def test_sort_by_priority_critical_first():
    """Critical tasks should come before low-priority tasks."""
    data = [
        {"title": "Low", "priority": "low"},
        {"title": "Critical", "priority": "critical"},
        {"title": "High", "priority": "high"},
    ]
    result = tasks.sort_by_priority(data)
    assert result[0]["title"] == "Critical"
    assert result[-1]["title"] == "Low"


def test_summarize_missing_status():
    """Tasks with no status key should be counted as 'unknown'."""
    data = [
        {"title": "A", "status": "done"},
        {"title": "B"},
        {"title": "C", "status": "done"},
    ]
    result = tasks.summarize_by_status(data)
    assert result == {"done": 2, "unknown": 1}


def test_merge_keeps_earliest_due_date():
    """When merging duplicates, keep the earliest due_date."""
    data = [
        {"title": "Deploy", "due_date": "2024-03-01"},
        {"title": "Deploy", "due_date": "2024-01-15"},
        {"title": "Deploy", "due_date": "2024-06-01"},
    ]
    result = tasks.merge_duplicates(data)
    assert len(result) == 1
    assert result[0]["due_date"] == "2024-01-15"
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="taskapi", version="0.1.0", package_dir={"": "src"}, packages=find_packages("src"))
`,
};

// ─── Repo template: buildkit (custom build tool + code generation) ──────

const BUILDKIT_FILES: Record<string, string> = {
  "README.md": `# BuildKit

Data pipeline with schema code generation.

## Development

This project uses a custom \`./proj\` CLI for build and test.

\`\`\`bash
# Build (generates code from templates — required before tests):
./proj build

# Run tests (builds first, then runs pytest):
./proj test

# Run a specific test:
./proj test -- tests/test_pipeline.py::test_validate_required_fields -x
\`\`\`

### Code generation

\`src/buildkit/generated/schema.py\` is auto-generated by \`./proj build\`
from \`templates/schema.py.template\`. Do NOT edit it manually.
If it's missing, tests will fail with ModuleNotFoundError.
`,

  proj: `#!/usr/bin/env bash
set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJ_DIR"

ensure_venv() {
  if [ ! -d .venv ]; then
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
    .venv/bin/pip install -q -r requirements-dev.txt
    .venv/bin/pip install -q -e .
  fi
}

case "\${1:-help}" in
  build)
    mkdir -p src/buildkit/generated
    cp templates/schema.py.template src/buildkit/generated/schema.py
    touch src/buildkit/generated/__init__.py
    echo "Build complete. Generated src/buildkit/generated/schema.py"
    ;;
  test)
    ensure_venv
    "$0" build
    shift
    if [ $# -gt 0 ] && [ "$1" = "--" ]; then shift; fi
    .venv/bin/pytest "\${@:-tests/}" -x -q
    ;;
  clean)
    rm -rf src/buildkit/generated/schema.py
    echo "Cleaned generated files."
    ;;
  *)
    echo "Usage: ./proj {build|test|clean}"
    echo ""
    echo "  build   Generate code from templates (required before tests)"
    echo "  test    Build + run tests"
    echo "  clean   Remove generated files"
    exit 1
    ;;
esac
`,

  "pyproject.toml": `[project]
name = "buildkit"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  // Template file that ./proj build copies to generated/
  "templates/schema.py.template": `\"\"\"Auto-generated schema definitions. Do NOT edit manually.
Regenerate with: ./proj build
\"\"\"

TABLES = {
    "tasks": ["id", "title", "status", "priority", "due_date", "assignee"],
    "users": ["id", "name", "email", "role"],
    "comments": ["id", "task_id", "user_id", "body", "created_at"],
}

VALID_STATUSES = ("todo", "in_progress", "review", "done", "archived")
VALID_PRIORITIES = ("critical", "high", "medium", "low")
REQUIRED_TASK_FIELDS = ("title", "status")
MAX_TITLE_LENGTH = 200
`,

  "src/buildkit/__init__.py": `"""BuildKit: data pipeline with code generation."""
`,

  // generated/ exists as a package but schema.py is MISSING until ./proj build
  "src/buildkit/generated/__init__.py": `"""Generated code — run ./proj build to populate."""
`,

  "src/buildkit/pipeline.py": `"""Data pipeline operations."""
from buildkit.generated.schema import (
    REQUIRED_TASK_FIELDS,
    TABLES,
    VALID_PRIORITIES,
    VALID_STATUSES,
)


def validate_record(record: dict, table: str) -> list[str]:
    """Return list of validation errors for a record.

    BUG: checks TABLES keys instead of REQUIRED_TASK_FIELDS for required fields.
    """
    errors = []
    valid_fields = TABLES.get(table, [])
    if not valid_fields:
        errors.append(f"Unknown table: {table}")
        return errors

    # Check required fields (bug: uses TABLES keys instead of REQUIRED_TASK_FIELDS)
    for field in TABLES.keys():
        if field not in record:
            errors.append(f"Missing required field: {field}")

    return errors


def filter_by_status(records: list[dict], status: str) -> list[dict]:
    """Return records matching the given status.

    BUG: uses != instead of == (returns records NOT matching status).
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")
    return [r for r in records if r.get("status") != status]


def compute_summary(records: list[dict]) -> dict:
    """Compute summary stats for a list of records.

    BUG: computes average using total record count instead of
    only records that have the 'score' field.
    """
    total_score = 0
    scored_count = 0
    for r in records:
        if "score" in r:
            total_score += r["score"]
            scored_count += 1

    return {
        "count": len(records),
        "scored_count": scored_count,
        "average_score": total_score / len(records) if records else 0,
    }


def normalize_priorities(records: list[dict]) -> list[dict]:
    """Normalize priority field to lowercase valid values.

    BUG: maps 'urgent' to 'medium' instead of 'critical'.
    """
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "URGENT": "medium",  # BUG: should map to 'critical'
        "P0": "critical",
        "P1": "high",
        "P2": "medium",
        "P3": "low",
    }
    result = []
    for r in records:
        r = dict(r)
        raw = r.get("priority", "").upper()
        r["priority"] = mapping.get(raw, "medium")
        result.append(r)
    return result
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration.

IMPORTANT: Tests require the build step to run first.
Use ./proj test to build and test in one command.
"""
from buildkit.generated import schema  # noqa: F401 — validates build ran
`,

  "tests/test_pipeline.py": `"""Tests for buildkit.pipeline."""
from buildkit import pipeline


def test_validate_required_fields():
    """Only REQUIRED_TASK_FIELDS should be required, not all table names."""
    record = {"title": "Fix bug", "status": "todo"}
    errors = pipeline.validate_record(record, "tasks")
    assert errors == [], f"Valid record got errors: {errors}"


def test_filter_by_status_returns_matching():
    """Should return records WITH the given status, not without."""
    records = [
        {"title": "A", "status": "todo"},
        {"title": "B", "status": "done"},
        {"title": "C", "status": "todo"},
    ]
    result = pipeline.filter_by_status(records, "todo")
    assert len(result) == 2
    assert all(r["status"] == "todo" for r in result)


def test_compute_summary_scored_average():
    """Average should be computed over scored records only."""
    records = [
        {"title": "A", "score": 80},
        {"title": "B", "score": 100},
        {"title": "C"},  # no score
    ]
    result = pipeline.compute_summary(records)
    assert result["average_score"] == 90.0, f"Expected 90.0, got {result['average_score']}"


def test_normalize_urgent_to_critical():
    \"\"\"'urgent' and 'URGENT' should map to 'critical', not 'medium'.\"\"\"
    records = [{"title": "Outage", "priority": "URGENT"}]
    result = pipeline.normalize_priorities(records)
    assert result[0]["priority"] == "critical"
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="buildkit", version="0.1.0", package_dir={"": "src"}, packages=find_packages("src"))
`,
};

// ─── Experience-only traps (misdirecting errors) ────────────────────────

export const TRAP_PHANTOM_PLUGINS_DEP: RecurringTrap = {
  trapId: "phantom-plugins-dep",
  family: "env_dep",
  description:
    "conftest.py checks for calclib_plugins package at collection time and calls " +
    "pytest.exit() if missing. Error says 'pip install calclib-plugins' but the " +
    "package doesn't exist on PyPI. Fix: create a stub package directory.",
  errorPattern:
    "calclib_plugins is not installed|pip install calclib-plugins|calclib\\.internal",
  fixDescription:
    "Create stub: mkdir -p calclib_plugins && touch calclib_plugins/__init__.py",
  fixCommand: "mkdir -p calclib_plugins && touch calclib_plugins/__init__.py",
};

export const TRAP_SESSION_FIXTURE_TIMEOUT: RecurringTrap = {
  trapId: "session-fixture-timeout",
  family: "tool_flag",
  description:
    "pyproject.toml addopts includes --timeout=5 but a session-scoped autouse fixture " +
    "in conftest.py takes 8 seconds for initialization. First test always times out. " +
    "Error says Timeout >5.0s which looks like the test is slow, but it's the fixture. " +
    "Fix: pytest --timeout=30 tests/ -x",
  errorPattern: "Timeout >|Failed: Timeout >|timeout after|FAILED.*Timeout",
  fixDescription:
    "Increase timeout to account for slow session fixture: pytest --timeout=30 tests/ -x",
  fixCommand: "pytest --timeout=30 tests/ -x",
};

export const TRAP_UNDOCUMENTED_FIXTURES_TOOL: RecurringTrap = {
  trapId: "undocumented-fixtures-tool",
  family: "tool_setup",
  description:
    "conftest.py requires .fixtures/testdata.json but repo has no docs about how to " +
    "create it. Custom ./kit tool generates fixtures. Error points to an internal wiki.",
  errorPattern: "test data not found.*\\.fixtures|ledgerkit\\.internal",
  fixDescription: "Run ./kit init to create fixtures, then pytest tests/ -x",
  fixCommand: "./kit init && pytest tests/ -x",
};

export const TRAP_UNDOCUMENTED_TESTDATA_TOOL: RecurringTrap = {
  trapId: "undocumented-testdata-tool",
  family: "tool_setup",
  description:
    "conftest.py requires .testdata/access.log but repo has no docs about how to " +
    "create it. Custom ./qa tool generates test data. Error points to an internal wiki.",
  errorPattern: "test data not found.*\\.testdata|logparse\\.internal",
  fixDescription: "Run ./qa setup to generate test data, then pytest tests/ -x",
  fixCommand: "./qa setup && pytest tests/ -x",
};

// ─── Repo template: calclib (doctest-modules phantom import trap) ───────

const CALCLIB_FILES: Record<string, string> = {
  "pyproject.toml": `[project]
name = "calclib"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  "calclib/__init__.py": `"""calclib: simple calculation library."""
`,

  "calclib/arithmetic.py": `"""Core arithmetic operations."""


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Divide a by b, returning default on division by zero.

    BUG: returns default when b == 0 but ALSO when a == 0.

    >>> safe_divide(10, 2)
    5.0
    >>> safe_divide(0, 5)
    0.0
    """
    if a == 0 or b == 0:
        return default
    return a / b


def percentage(part: float, whole: float) -> float:
    """Calculate what percentage 'part' is of 'whole'.

    BUG: formula is (part / whole) * 10 instead of * 100.

    >>> percentage(1, 4)
    25.0
    """
    if whole == 0:
        return 0.0
    return (part / whole) * 10


def running_average(values: list[float]) -> list[float]:
    """Return the running average at each position.

    BUG: divides cumulative sum by total length instead of position index.

    >>> running_average([2, 4, 6])
    [2.0, 3.0, 4.0]
    """
    if not values:
        return []
    result = []
    cumsum = 0.0
    for val in values:
        cumsum += val
        result.append(cumsum / len(values))
    return result


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi] range.

    BUG: swapped lo/hi comparison — returns hi when value < lo.

    >>> clamp(5, 0, 10)
    5
    """
    if value < lo:
        return hi
    if value > hi:
        return lo
    return value
`,

  // *** THE TRAP: this module has a doctest that imports a non-existent package ***
  "calclib/plugins.py": `"""Optional plugin integration for calclib.

This module provides registration hooks for third-party extensions.
Plugins are optional and loaded lazily at runtime.

Example (requires calclib_plugins package):

>>> from calclib_plugins import registry
>>> registry.list_plugins()
[]
"""


def register_plugin(name: str, func) -> None:
    """Register a named plugin function.

    Raises RuntimeError if calclib_plugins is not installed.
    """
    try:
        from calclib_plugins import registry
        registry.add(name, func)
    except ImportError:
        raise RuntimeError(
            f"calclib_plugins is not installed. Cannot register plugin '{name}'."
        )


def has_plugins() -> bool:
    """Check if the plugins package is available."""
    try:
        import calclib_plugins  # noqa: F401
        return True
    except ImportError:
        return False
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Shared test configuration.

Validates test dependencies before running any tests.
"""
import subprocess
import sys


def pytest_configure(config):
    """Validate test environment at collection time."""
    # Ensure the internal test helpers package is available.
    result = subprocess.run(
        [sys.executable, "-c", "import calclib_plugins"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        import pytest

        pytest.exit(
            "ERROR: calclib_plugins is not installed.\\n"
            "Install it with: pip install calclib-plugins\\n"
            "See https://calclib.internal/wiki/testing for setup.",
            returncode=4,
        )
`,

  "tests/test_arithmetic.py": `"""Tests for calclib.arithmetic."""
from calclib import arithmetic


def test_safe_divide_zero_numerator():
    """0 / 5 should be 0.0, not the default value."""
    assert arithmetic.safe_divide(0, 5) == 0.0


def test_safe_divide_basic():
    assert arithmetic.safe_divide(10, 2) == 5.0


def test_percentage_basic():
    """25% calculation."""
    assert arithmetic.percentage(1, 4) == 25.0


def test_percentage_half():
    assert arithmetic.percentage(1, 2) == 50.0


def test_running_average():
    """Running average of [2, 4, 6] should be [2.0, 3.0, 4.0]."""
    result = arithmetic.running_average([2, 4, 6])
    assert result == [2.0, 3.0, 4.0]


def test_running_average_single():
    assert arithmetic.running_average([10]) == [10.0]


def test_clamp_below():
    """Value below range should be clamped to lo, not hi."""
    assert arithmetic.clamp(-5, 0, 10) == 0


def test_clamp_above():
    assert arithmetic.clamp(15, 0, 10) == 10


def test_clamp_in_range():
    assert arithmetic.clamp(5, 0, 10) == 5
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="calclib", version="0.1.0", packages=find_packages())
`,
};

// ─── Repo template: webutil (session fixture timeout trap) ──────────────

const WEBUTIL_FILES: Record<string, string> = {
  "pyproject.toml": `[project]
name = "webutil"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
addopts = "--timeout=5 -x"
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
pytest-timeout>=2.0
`,

  "webutil/__init__.py": `"""webutil: web utility functions."""
`,

  "webutil/_bootstrap.py": `"""Internal bootstrap for test environment.

This module handles one-time initialization that's expensive but
required for realistic test behavior (connection pools, caches, etc.).
"""
import time


def warmup() -> None:
    """Initialize caches and connection pools.

    This simulates the real startup cost of the production service.
    In production, this runs once at process start. In tests, it runs
    once per session via the conftest fixture.
    """
    # Simulate connection pool initialization + cache warming
    time.sleep(8)
`,

  "webutil/urls.py": `"""URL parsing and manipulation utilities."""
from urllib.parse import urlparse, urlencode, parse_qs


def extract_domain(url: str) -> str:
    """Extract the domain from a URL.

    BUG: includes the port number in the domain.

    >>> extract_domain("https://example.com:8080/path")
    'example.com'
    """
    parsed = urlparse(url)
    return parsed.netloc


def add_query_params(url: str, params: dict) -> str:
    """Add query parameters to a URL.

    BUG: overwrites existing query parameters instead of merging.

    >>> add_query_params("https://example.com?a=1", {"b": "2"})
    'https://example.com?a=1&b=2'
    """
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(params)}"


def normalize_path(path: str) -> str:
    """Normalize URL path by removing double slashes and trailing slash.

    BUG: only removes one pair of double slashes, not all of them.

    >>> normalize_path("/api//v1///users/")
    '/api/v1/users'
    """
    path = path.replace("//", "/")
    return path.rstrip("/") or "/"


def get_query_param(url: str, key: str, default: str = "") -> str:
    """Get a single query parameter value.

    BUG: returns the list of values instead of a single string.

    >>> get_query_param("https://example.com?page=5", "page")
    '5'
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    return params.get(key, [default])
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration and fixtures.

The session fixture handles one-time initialization (connection pools,
caches) that's required for realistic test behavior.
"""
import pytest
from webutil import _bootstrap


@pytest.fixture(autouse=True, scope="session")
def _init_test_environment():
    """One-time test environment setup.

    This mirrors the production startup sequence and must complete
    before any tests run.
    """
    _bootstrap.warmup()
    yield
    # Teardown would go here
`,

  "tests/test_urls.py": `"""Tests for webutil.urls."""
from webutil import urls


def test_extract_domain_no_port():
    """Domain should not include port number."""
    assert urls.extract_domain("https://example.com:8080/path") == "example.com"


def test_extract_domain_simple():
    assert urls.extract_domain("https://example.com/path") == "example.com"


def test_add_query_params_merge():
    """New params should be merged with existing, not replace them."""
    result = urls.add_query_params("https://example.com?a=1", {"b": "2"})
    assert "a=1" in result
    assert "b=2" in result


def test_add_query_params_empty():
    result = urls.add_query_params("https://example.com", {"key": "val"})
    assert "key=val" in result


def test_normalize_path_multiple_slashes():
    """All double slashes should be removed, not just the first."""
    assert urls.normalize_path("/api//v1///users/") == "/api/v1/users"


def test_normalize_path_trailing():
    assert urls.normalize_path("/api/users/") == "/api/users"


def test_get_query_param_string():
    """Should return a string, not a list."""
    result = urls.get_query_param("https://example.com?page=5", "page")
    assert result == "5"
    assert isinstance(result, str)


def test_get_query_param_default():
    result = urls.get_query_param("https://example.com", "missing", "default")
    assert result == "default"
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="webutil", version="0.1.0", packages=find_packages())
`,
};

// ─── Experience-only template definitions ───────────────────────────────

export const CALCLIB_TEMPLATE: RepoTemplate = {
  templateId: "calclib",
  name: "calclib",
  description:
    "Calculation library with --doctest-modules trap. A module has a doctest importing " +
    "a non-existent optional package (calclib_plugins). Error misdirects agent to install " +
    "a package that doesn't exist.",
  language: "python",
  files: CALCLIB_FILES,
  setupCommands: [],
  traps: [TRAP_PHANTOM_PLUGINS_DEP],
};

export const WEBUTIL_TEMPLATE: RepoTemplate = {
  templateId: "webutil",
  name: "webutil",
  description:
    "Web utilities with session fixture timeout trap. A slow session-scoped fixture (8s) " +
    "plus --timeout=5 in addopts causes the first test to always time out. Error misdirects " +
    "agent to optimize the test function.",
  language: "python",
  files: WEBUTIL_FILES,
  setupCommands: [],
  traps: [TRAP_SESSION_FIXTURE_TIMEOUT],
};

// ─── Experience-only tasks ──────────────────────────────────────────────

export const CALCLIB_TASKS: RecurringPatternTask[] = [
  {
    taskId: "calclib-001-safe-divide",
    repoTemplateId: "calclib",
    bugDescription: "safe_divide() returns default when numerator is 0",
    problemStatement: `The \`safe_divide()\` function in \`calclib/arithmetic.py\` returns the default value when the numerator is 0. It should only return default when the denominator is 0. \`safe_divide(0, 5)\` should return 0.0, not the default.

The failing test is \`tests/test_arithmetic.py::test_safe_divide_zero_numerator\`.`,
    expectedTrapIds: ["phantom-plugins-dep"],
    verifyCommand:
      "pytest tests/test_arithmetic.py::test_safe_divide_zero_numerator -x",
    goldPatch: {
      "calclib/arithmetic.py": `"""Core arithmetic operations."""


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Divide a by b, returning default on division by zero.

    >>> safe_divide(10, 2)
    5.0
    >>> safe_divide(0, 5)
    0.0
    """
    if b == 0:
        return default
    return a / b


def percentage(part: float, whole: float) -> float:
    """Calculate what percentage 'part' is of 'whole'.

    BUG: formula is (part / whole) * 10 instead of * 100.

    >>> percentage(1, 4)
    25.0
    """
    if whole == 0:
        return 0.0
    return (part / whole) * 10


def running_average(values: list[float]) -> list[float]:
    """Return the running average at each position.

    BUG: divides cumulative sum by total length instead of position index.

    >>> running_average([2, 4, 6])
    [2.0, 3.0, 4.0]
    """
    if not values:
        return []
    result = []
    cumsum = 0.0
    for val in values:
        cumsum += val
        result.append(cumsum / len(values))
    return result


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi] range.

    BUG: swapped lo/hi comparison — returns hi when value < lo.

    >>> clamp(5, 0, 10)
    5
    """
    if value < lo:
        return hi
    if value > hi:
        return lo
    return value
`,
    },
  },
  {
    taskId: "calclib-002-percentage",
    repoTemplateId: "calclib",
    bugDescription: "percentage() multiplies by 10 instead of 100",
    problemStatement: `The \`percentage()\` function in \`calclib/arithmetic.py\` uses \`* 10\` instead of \`* 100\` in the formula.

The failing test is \`tests/test_arithmetic.py::test_percentage_basic\`.`,
    expectedTrapIds: ["phantom-plugins-dep"],
    verifyCommand: "pytest tests/test_arithmetic.py::test_percentage_basic -x",
    goldPatch: {
      "calclib/arithmetic.py": `"""Core arithmetic operations."""


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Divide a by b, returning default on division by zero.

    BUG: returns default when b == 0 but ALSO when a == 0.

    >>> safe_divide(10, 2)
    5.0
    >>> safe_divide(0, 5)
    0.0
    """
    if a == 0 or b == 0:
        return default
    return a / b


def percentage(part: float, whole: float) -> float:
    """Calculate what percentage 'part' is of 'whole'.

    >>> percentage(1, 4)
    25.0
    """
    if whole == 0:
        return 0.0
    return (part / whole) * 100


def running_average(values: list[float]) -> list[float]:
    """Return the running average at each position.

    BUG: divides cumulative sum by total length instead of position index.

    >>> running_average([2, 4, 6])
    [2.0, 3.0, 4.0]
    """
    if not values:
        return []
    result = []
    cumsum = 0.0
    for val in values:
        cumsum += val
        result.append(cumsum / len(values))
    return result


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi] range.

    BUG: swapped lo/hi comparison — returns hi when value < lo.

    >>> clamp(5, 0, 10)
    5
    """
    if value < lo:
        return hi
    if value > hi:
        return lo
    return value
`,
    },
  },
  {
    taskId: "calclib-003-running-avg",
    repoTemplateId: "calclib",
    bugDescription: "running_average() divides by total length instead of position",
    problemStatement: `The \`running_average()\` function in \`calclib/arithmetic.py\` divides the cumulative sum by \`len(values)\` (total) instead of the current position index. For \`[2, 4, 6]\`, it should return \`[2.0, 3.0, 4.0]\`, not \`[0.67, 2.0, 4.0]\`.

The failing test is \`tests/test_arithmetic.py::test_running_average\`.`,
    expectedTrapIds: ["phantom-plugins-dep"],
    verifyCommand: "pytest tests/test_arithmetic.py::test_running_average -x",
    goldPatch: {
      "calclib/arithmetic.py": `"""Core arithmetic operations."""


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Divide a by b, returning default on division by zero.

    BUG: returns default when b == 0 but ALSO when a == 0.

    >>> safe_divide(10, 2)
    5.0
    >>> safe_divide(0, 5)
    0.0
    """
    if a == 0 or b == 0:
        return default
    return a / b


def percentage(part: float, whole: float) -> float:
    """Calculate what percentage 'part' is of 'whole'.

    BUG: formula is (part / whole) * 10 instead of * 100.

    >>> percentage(1, 4)
    25.0
    """
    if whole == 0:
        return 0.0
    return (part / whole) * 10


def running_average(values: list[float]) -> list[float]:
    """Return the running average at each position.

    >>> running_average([2, 4, 6])
    [2.0, 3.0, 4.0]
    """
    if not values:
        return []
    result = []
    cumsum = 0.0
    for i, val in enumerate(values, 1):
        cumsum += val
        result.append(cumsum / i)
    return result


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi] range.

    BUG: swapped lo/hi comparison — returns hi when value < lo.

    >>> clamp(5, 0, 10)
    5
    """
    if value < lo:
        return hi
    if value > hi:
        return lo
    return value
`,
    },
  },
  {
    taskId: "calclib-004-clamp",
    repoTemplateId: "calclib",
    bugDescription: "clamp() returns hi when value is below lo",
    problemStatement: `The \`clamp()\` function in \`calclib/arithmetic.py\` returns \`hi\` when \`value < lo\` and \`lo\` when \`value > hi\` — the returns are swapped. \`clamp(-5, 0, 10)\` should return 0, not 10.

The failing test is \`tests/test_arithmetic.py::test_clamp_below\`.`,
    expectedTrapIds: ["phantom-plugins-dep"],
    verifyCommand: "pytest tests/test_arithmetic.py::test_clamp_below -x",
    goldPatch: {
      "calclib/arithmetic.py": `"""Core arithmetic operations."""


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Divide a by b, returning default on division by zero.

    BUG: returns default when b == 0 but ALSO when a == 0.

    >>> safe_divide(10, 2)
    5.0
    >>> safe_divide(0, 5)
    0.0
    """
    if a == 0 or b == 0:
        return default
    return a / b


def percentage(part: float, whole: float) -> float:
    """Calculate what percentage 'part' is of 'whole'.

    BUG: formula is (part / whole) * 10 instead of * 100.

    >>> percentage(1, 4)
    25.0
    """
    if whole == 0:
        return 0.0
    return (part / whole) * 10


def running_average(values: list[float]) -> list[float]:
    """Return the running average at each position.

    BUG: divides cumulative sum by total length instead of position index.

    >>> running_average([2, 4, 6])
    [2.0, 3.0, 4.0]
    """
    if not values:
        return []
    result = []
    cumsum = 0.0
    for val in values:
        cumsum += val
        result.append(cumsum / len(values))
    return result


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi] range.

    >>> clamp(5, 0, 10)
    5
    """
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value
`,
    },
  },
];

export const WEBUTIL_TASKS: RecurringPatternTask[] = [
  {
    taskId: "webutil-001-domain-port",
    repoTemplateId: "webutil",
    bugDescription: "extract_domain() includes port number",
    problemStatement: `The \`extract_domain()\` function in \`webutil/urls.py\` returns the full netloc including port. \`extract_domain("https://example.com:8080/path")\` should return \`"example.com"\`, not \`"example.com:8080"\`.

The failing test is \`tests/test_urls.py::test_extract_domain_no_port\`.`,
    expectedTrapIds: ["session-fixture-timeout"],
    verifyCommand: "pytest tests/test_urls.py::test_extract_domain_no_port -x",
    goldPatch: {
      "webutil/urls.py": `"""URL parsing and manipulation utilities."""
from urllib.parse import urlparse, urlencode, parse_qs


def extract_domain(url: str) -> str:
    """Extract the domain from a URL (without port)."""
    parsed = urlparse(url)
    return parsed.hostname or ""


def add_query_params(url: str, params: dict) -> str:
    """Add query parameters to a URL.

    BUG: overwrites existing query parameters instead of merging.
    """
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(params)}"


def normalize_path(path: str) -> str:
    """Normalize URL path by removing double slashes and trailing slash.

    BUG: only removes one pair of double slashes, not all of them.
    """
    path = path.replace("//", "/")
    return path.rstrip("/") or "/"


def get_query_param(url: str, key: str, default: str = "") -> str:
    """Get a single query parameter value.

    BUG: returns the list of values instead of a single string.
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    return params.get(key, [default])
`,
    },
  },
  {
    taskId: "webutil-002-query-merge",
    repoTemplateId: "webutil",
    bugDescription: "add_query_params() overwrites existing params",
    problemStatement: `The \`add_query_params()\` function in \`webutil/urls.py\` replaces existing query parameters instead of merging. For URL \`"https://example.com?a=1"\` with params \`{"b": "2"}\`, the result should contain both \`a=1\` and \`b=2\`.

The failing test is \`tests/test_urls.py::test_add_query_params_merge\`.`,
    expectedTrapIds: ["session-fixture-timeout"],
    verifyCommand: "pytest tests/test_urls.py::test_add_query_params_merge -x",
    goldPatch: {
      "webutil/urls.py": `"""URL parsing and manipulation utilities."""
from urllib.parse import urlparse, urlencode, parse_qs, parse_qsl, urlunparse


def extract_domain(url: str) -> str:
    """Extract the domain from a URL.

    BUG: includes the port number in the domain.
    """
    parsed = urlparse(url)
    return parsed.netloc


def add_query_params(url: str, params: dict) -> str:
    """Add query parameters to a URL, merging with existing."""
    parsed = urlparse(url)
    existing = dict(parse_qsl(parsed.query))
    existing.update(params)
    new_query = urlencode(existing)
    return urlunparse(parsed._replace(query=new_query))


def normalize_path(path: str) -> str:
    """Normalize URL path by removing double slashes and trailing slash.

    BUG: only removes one pair of double slashes, not all of them.
    """
    path = path.replace("//", "/")
    return path.rstrip("/") or "/"


def get_query_param(url: str, key: str, default: str = "") -> str:
    """Get a single query parameter value.

    BUG: returns the list of values instead of a single string.
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    return params.get(key, [default])
`,
    },
  },
  {
    taskId: "webutil-003-normalize-slashes",
    repoTemplateId: "webutil",
    bugDescription: "normalize_path() only removes one pair of double slashes",
    problemStatement: `The \`normalize_path()\` function in \`webutil/urls.py\` uses \`.replace("//", "/")\` which only handles one pair. For \`"/api//v1///users/"\`, it should return \`"/api/v1/users"\` but it leaves some double slashes.

The failing test is \`tests/test_urls.py::test_normalize_path_multiple_slashes\`.`,
    expectedTrapIds: ["session-fixture-timeout"],
    verifyCommand: "pytest tests/test_urls.py::test_normalize_path_multiple_slashes -x",
    goldPatch: {
      "webutil/urls.py": `"""URL parsing and manipulation utilities."""
from urllib.parse import urlparse, urlencode, parse_qs
import re


def extract_domain(url: str) -> str:
    """Extract the domain from a URL.

    BUG: includes the port number in the domain.
    """
    parsed = urlparse(url)
    return parsed.netloc


def add_query_params(url: str, params: dict) -> str:
    """Add query parameters to a URL.

    BUG: overwrites existing query parameters instead of merging.
    """
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(params)}"


def normalize_path(path: str) -> str:
    """Normalize URL path by removing double slashes and trailing slash."""
    path = re.sub(r"/+", "/", path)
    return path.rstrip("/") or "/"


def get_query_param(url: str, key: str, default: str = "") -> str:
    """Get a single query parameter value.

    BUG: returns the list of values instead of a single string.
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    return params.get(key, [default])
`,
    },
  },
  {
    taskId: "webutil-004-query-param-type",
    repoTemplateId: "webutil",
    bugDescription: "get_query_param() returns a list instead of string",
    problemStatement: `The \`get_query_param()\` function in \`webutil/urls.py\` returns the raw \`parse_qs\` list instead of extracting the first value. For URL \`"https://example.com?page=5"\`, it should return \`"5"\` (str), not \`["5"]\` (list).

The failing test is \`tests/test_urls.py::test_get_query_param_string\`.`,
    expectedTrapIds: ["session-fixture-timeout"],
    verifyCommand: "pytest tests/test_urls.py::test_get_query_param_string -x",
    goldPatch: {
      "webutil/urls.py": `"""URL parsing and manipulation utilities."""
from urllib.parse import urlparse, urlencode, parse_qs


def extract_domain(url: str) -> str:
    """Extract the domain from a URL.

    BUG: includes the port number in the domain.
    """
    parsed = urlparse(url)
    return parsed.netloc


def add_query_params(url: str, params: dict) -> str:
    """Add query parameters to a URL.

    BUG: overwrites existing query parameters instead of merging.
    """
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(params)}"


def normalize_path(path: str) -> str:
    """Normalize URL path by removing double slashes and trailing slash.

    BUG: only removes one pair of double slashes, not all of them.
    """
    path = path.replace("//", "/")
    return path.rstrip("/") or "/"


def get_query_param(url: str, key: str, default: str = "") -> str:
    """Get a single query parameter value."""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    values = params.get(key, [default])
    return values[0] if values else default
`,
    },
  },
];

// ─── Undocumented-tool repos (custom tools, no README) ──────────────────

const LEDGERKIT_FILES: Record<string, string> = {
  "README.md": `# ledgerkit

Internal ledger processing library.
`,

  "pyproject.toml": `[project]
name = "ledgerkit"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  ".gitignore": `.fixtures/
__pycache__/
*.egg-info/
`,

  kit: `#!/usr/bin/env bash
set -e
CMD="\${1:-help}"
case "\$CMD" in
  init)
    mkdir -p .fixtures
    python3 -c "
import json
data = {
    'accounts': {
        'checking': 1000.0,
        'savings': 5000.0,
        'credit_card': -500.0
    },
    'transactions': [
        {'date': '2024-01-15', 'amount': 50.0, 'category': 'Food', 'type': 'debit'},
        {'date': '2024-01-20', 'amount': 200.0, 'category': 'income', 'type': 'credit'},
        {'date': '2024-02-01', 'amount': 30.0, 'category': 'food', 'type': 'debit'},
        {'date': '2024-02-15', 'amount': 100.0, 'category': 'Food', 'type': 'debit'},
        {'date': '2024-01-25', 'amount': 75.0, 'category': 'utilities', 'type': 'debit'}
    ]
}
with open('.fixtures/testdata.json', 'w') as f:
    json.dump(data, f, indent=2)
print('Fixtures written to .fixtures/')
"
    ;;
  check)
    python3 -m pytest tests/ -x --tb=short
    ;;
  clean)
    rm -rf .fixtures
    echo "Cleaned."
    ;;
  *)
    echo "kit: ledgerkit project tool"
    echo ""
    echo "Commands:"
    echo "  init    Set up test fixtures"
    echo "  check   Run verification suite"
    echo "  clean   Remove generated files"
    ;;
esac
`,

  "ledgerkit/__init__.py": `"""ledgerkit: internal ledger processing."""
`,

  "ledgerkit/ledger.py": `"""Ledger processing operations."""


def calculate_balance(accounts: dict[str, float]) -> float:
    """Calculate total balance across all accounts.

    BUG: uses abs() on values — treats negative balances as positive.
    """
    return sum(abs(v) for v in accounts.values())


def apply_transaction(balance: float, amount: float, txn_type: str) -> float:
    """Apply a transaction to a balance.

    BUG: debit adds and credit subtracts (swapped).
    """
    if txn_type == "debit":
        return balance + amount
    elif txn_type == "credit":
        return balance - amount
    return balance


def filter_by_category(
    transactions: list[dict], category: str
) -> list[dict]:
    """Filter transactions matching a category.

    BUG: case-sensitive comparison — 'Food' != 'food'.
    """
    return [t for t in transactions if t["category"] == category]


def monthly_totals(transactions: list[dict]) -> dict[str, float]:
    """Sum transaction amounts by month (YYYY-MM).

    BUG: uses full date as key instead of YYYY-MM prefix.
    """
    totals: dict[str, float] = {}
    for t in transactions:
        key = t["date"]
        totals[key] = totals.get(key, 0) + t["amount"]
    return totals
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration for ledgerkit."""
import json
import os
import pytest


def _fixtures_path():
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", ".fixtures", "testdata.json"
    )


def pytest_configure(config):
    """Verify test fixtures exist."""
    if not os.path.exists(_fixtures_path()):
        pytest.exit(
            "Error: test data not found (.fixtures/testdata.json).\\n"
            "See https://ledgerkit.internal/docs/testing for setup.",
            returncode=4,
        )


@pytest.fixture(scope="session")
def test_data():
    """Load test fixture data."""
    with open(_fixtures_path()) as f:
        return json.load(f)
`,

  "tests/test_ledger.py": `"""Tests for ledgerkit.ledger."""
from ledgerkit import ledger


def test_calculate_balance(test_data):
    """Total: 1000 + 5000 + (-500) = 5500."""
    result = ledger.calculate_balance(test_data["accounts"])
    assert result == 5500.0


def test_calculate_balance_simple():
    assert ledger.calculate_balance({"a": 100, "b": -50}) == 50.0


def test_apply_debit():
    """Debit 50 from 1000 = 950."""
    result = ledger.apply_transaction(1000.0, 50.0, "debit")
    assert result == 950.0


def test_apply_credit():
    result = ledger.apply_transaction(1000.0, 200.0, "credit")
    assert result == 1200.0


def test_filter_by_category(test_data):
    """'food' should match both 'Food' and 'food' (case-insensitive)."""
    result = ledger.filter_by_category(test_data["transactions"], "food")
    assert len(result) == 3


def test_filter_by_category_exact():
    txns = [{"category": "Food"}, {"category": "food"}, {"category": "drink"}]
    result = ledger.filter_by_category(txns, "food")
    assert len(result) == 2


def test_monthly_totals(test_data):
    """January: 50+200+75=325, February: 30+100=130."""
    result = ledger.monthly_totals(test_data["transactions"])
    assert "2024-01" in result
    assert result["2024-01"] == 325.0
    assert result["2024-02"] == 130.0


def test_monthly_totals_keys(test_data):
    result = ledger.monthly_totals(test_data["transactions"])
    assert set(result.keys()) == {"2024-01", "2024-02"}
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="ledgerkit", version="0.1.0", packages=find_packages())
`,
};

const LOGPARSE_FILES: Record<string, string> = {
  "README.md": `# logparse

Internal log analysis tools.
`,

  "pyproject.toml": `[project]
name = "logparse"
version = "0.1.0"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,

  "requirements.txt": `# Runtime deps
`,

  "requirements-dev.txt": `pytest>=7.0
`,

  ".gitignore": `.testdata/
__pycache__/
*.egg-info/
`,

  qa: `#!/usr/bin/env bash
set -e
CMD="\${1:-help}"
case "\$CMD" in
  setup)
    mkdir -p .testdata
    cat > .testdata/access.log << 'LOG'
2024-01-15T10:30:00Z 192.168.1.1:8080 GET /api/users 200 45ms
2024-01-15T10:30:01Z 192.168.1.2:9090 POST /api/login 401 12ms
2024-01-15T10:30:02Z 10.0.0.1:80 GET /health 200 2ms
2024-01-15T10:30:03Z 192.168.1.1:8080 DELETE /api/users/5 403 8ms
2024-01-15T10:30:04Z 10.0.0.1:80 GET /api/data 500 120ms
LOG
    echo "Test data written to .testdata/"
    ;;
  test)
    python3 -m pytest tests/ -x --tb=short
    ;;
  clean)
    rm -rf .testdata
    echo "Cleaned."
    ;;
  *)
    echo "qa: logparse quality assurance"
    echo ""
    echo "Commands:"
    echo "  setup   Generate test data"
    echo "  test    Run test suite"
    echo "  clean   Remove test data"
    ;;
esac
`,

  "logparse/__init__.py": `"""logparse: internal log analysis tools."""
`,

  "logparse/parser.py": `"""Log file parser utilities."""


def parse_log_entry(line: str) -> dict:
    """Parse a log line into a structured entry.

    Format: 'timestamp ip:port method path status duration'
    """
    parts = line.strip().split()
    ip_port = parts[1]
    ip, port = ip_port.rsplit(":", 1)
    return {
        "timestamp": parts[0],
        "ip": ip,
        "port": int(port),
        "method": parts[2],
        "path": parts[3],
        "status": int(parts[4]),
        "duration_ms": int(parts[5].replace("ms", "")),
    }


def filter_by_status(entries: list[dict], status: int) -> list[dict]:
    """Filter entries by HTTP status code.

    BUG: compares int status to string — never matches.
    """
    return [e for e in entries if e["status"] == str(status)]


def unique_ips(entries: list[dict]) -> set[str]:
    """Get set of unique IP addresses from entries.

    BUG: includes port number in the IP string.
    """
    return {f"{e['ip']}:{e['port']}" for e in entries}


def average_duration(entries: list[dict]) -> float:
    """Calculate average response time in milliseconds.

    BUG: uses integer division (//) instead of true division (/).
    """
    if not entries:
        return 0.0
    total = sum(e["duration_ms"] for e in entries)
    return total // len(entries)


def error_rate(entries: list[dict]) -> float:
    """Calculate fraction of entries with error status (>= 400).

    BUG: only counts server errors (>= 500), not all errors (>= 400).
    """
    if not entries:
        return 0.0
    errors = sum(1 for e in entries if e["status"] >= 500)
    return errors / len(entries)
`,

  "tests/__init__.py": "",

  "tests/conftest.py": `"""Test configuration for logparse."""
import os
import pytest


def _test_log_path():
    return os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", ".testdata", "access.log"
    )


def pytest_configure(config):
    """Verify test data exists."""
    if not os.path.exists(_test_log_path()):
        pytest.exit(
            "Error: test data not found (.testdata/access.log).\\n"
            "See https://logparse.internal/wiki/qa-setup for instructions.",
            returncode=4,
        )


@pytest.fixture(scope="session")
def log_entries():
    """Parse test access log into entries."""
    from logparse import parser

    entries = []
    with open(_test_log_path()) as f:
        for line in f:
            if line.strip():
                entries.append(parser.parse_log_entry(line))
    return entries
`,

  "tests/test_parser.py": `"""Tests for logparse.parser."""
import pytest
from logparse import parser


def test_filter_by_status_200(log_entries):
    """Should find entries with status 200."""
    result = parser.filter_by_status(log_entries, 200)
    assert len(result) == 2


def test_filter_by_status_401(log_entries):
    result = parser.filter_by_status(log_entries, 401)
    assert len(result) == 1


def test_unique_ips(log_entries):
    """Should return IPs without port numbers."""
    result = parser.unique_ips(log_entries)
    assert result == {"192.168.1.1", "192.168.1.2", "10.0.0.1"}


def test_unique_ips_count(log_entries):
    result = parser.unique_ips(log_entries)
    assert len(result) == 3


def test_average_duration(log_entries):
    """Average of [45, 12, 2, 8, 120] = 37.4."""
    result = parser.average_duration(log_entries)
    assert result == pytest.approx(37.4)


def test_average_duration_type(log_entries):
    result = parser.average_duration(log_entries)
    assert isinstance(result, float)


def test_error_rate(log_entries):
    """3 errors (401, 403, 500) out of 5 = 0.6."""
    result = parser.error_rate(log_entries)
    assert result == pytest.approx(0.6)


def test_error_rate_includes_client_errors(log_entries):
    """Should count both 4xx and 5xx as errors."""
    result = parser.error_rate(log_entries)
    assert result == pytest.approx(0.6)
`,

  "setup.py": `from setuptools import setup, find_packages
setup(name="logparse", version="0.1.0", packages=find_packages())
`,
};

// ─── Undocumented-tool template definitions ─────────────────────────────

export const LEDGERKIT_TEMPLATE: RepoTemplate = {
  templateId: "ledgerkit",
  name: "ledgerkit",
  description:
    "Ledger processing library with undocumented custom ./kit tool. " +
    "Tests require fixture data that only ./kit init creates. " +
    "No README explains the tool. Error points to an internal wiki URL.",
  language: "python",
  files: LEDGERKIT_FILES,
  setupCommands: [],
  executablePaths: ["kit"],
  traps: [TRAP_UNDOCUMENTED_FIXTURES_TOOL],
};

export const LOGPARSE_TEMPLATE: RepoTemplate = {
  templateId: "logparse",
  name: "logparse",
  description:
    "Log analysis library with undocumented custom ./qa tool. " +
    "Tests require test data that only ./qa setup creates. " +
    "No README explains the tool. Error points to an internal wiki URL.",
  language: "python",
  files: LOGPARSE_FILES,
  setupCommands: [],
  executablePaths: ["qa"],
  traps: [TRAP_UNDOCUMENTED_TESTDATA_TOOL],
};

// ─── Undocumented-tool tasks ────────────────────────────────────────────

const LEDGERKIT_BUGGY = LEDGERKIT_FILES["ledgerkit/ledger.py"];

export const LEDGERKIT_TASKS: RecurringPatternTask[] = [
  {
    taskId: "ledgerkit-001-balance",
    repoTemplateId: "ledgerkit",
    bugDescription: "calculate_balance() uses abs() on account values",
    problemStatement: `The \`calculate_balance()\` function in \`ledgerkit/ledger.py\` uses \`abs()\` on all values, treating negative balances (like credit cards) as positive. For accounts \`{checking: 1000, savings: 5000, credit_card: -500}\`, it should return 5500.0, not 6500.0.

The failing test is \`tests/test_ledger.py::test_calculate_balance\`.`,
    expectedTrapIds: ["undocumented-fixtures-tool"],
    verifyCommand: "pytest tests/test_ledger.py::test_calculate_balance -x",
    goldPatch: {
      "ledgerkit/ledger.py": `"""Ledger processing operations."""


def calculate_balance(accounts: dict[str, float]) -> float:
    """Calculate total balance across all accounts."""
    return sum(accounts.values())


def apply_transaction(balance: float, amount: float, txn_type: str) -> float:
    """Apply a transaction to a balance.

    BUG: debit adds and credit subtracts (swapped).
    """
    if txn_type == "debit":
        return balance + amount
    elif txn_type == "credit":
        return balance - amount
    return balance


def filter_by_category(
    transactions: list[dict], category: str
) -> list[dict]:
    """Filter transactions matching a category.

    BUG: case-sensitive comparison — 'Food' != 'food'.
    """
    return [t for t in transactions if t["category"] == category]


def monthly_totals(transactions: list[dict]) -> dict[str, float]:
    """Sum transaction amounts by month (YYYY-MM).

    BUG: uses full date as key instead of YYYY-MM prefix.
    """
    totals: dict[str, float] = {}
    for t in transactions:
        key = t["date"]
        totals[key] = totals.get(key, 0) + t["amount"]
    return totals
`,
    },
  },
  {
    taskId: "ledgerkit-002-transaction",
    repoTemplateId: "ledgerkit",
    bugDescription: "apply_transaction() swaps debit and credit",
    problemStatement: `The \`apply_transaction()\` function in \`ledgerkit/ledger.py\` adds for debits and subtracts for credits — the logic is reversed. \`apply_transaction(1000.0, 50.0, "debit")\` should return 950.0, not 1050.0.

The failing test is \`tests/test_ledger.py::test_apply_debit\`.`,
    expectedTrapIds: ["undocumented-fixtures-tool"],
    verifyCommand: "pytest tests/test_ledger.py::test_apply_debit -x",
    goldPatch: {
      "ledgerkit/ledger.py": `"""Ledger processing operations."""


def calculate_balance(accounts: dict[str, float]) -> float:
    """Calculate total balance across all accounts.

    BUG: uses abs() on values — treats negative balances as positive.
    """
    return sum(abs(v) for v in accounts.values())


def apply_transaction(balance: float, amount: float, txn_type: str) -> float:
    """Apply a transaction to a balance."""
    if txn_type == "debit":
        return balance - amount
    elif txn_type == "credit":
        return balance + amount
    return balance


def filter_by_category(
    transactions: list[dict], category: str
) -> list[dict]:
    """Filter transactions matching a category.

    BUG: case-sensitive comparison — 'Food' != 'food'.
    """
    return [t for t in transactions if t["category"] == category]


def monthly_totals(transactions: list[dict]) -> dict[str, float]:
    """Sum transaction amounts by month (YYYY-MM).

    BUG: uses full date as key instead of YYYY-MM prefix.
    """
    totals: dict[str, float] = {}
    for t in transactions:
        key = t["date"]
        totals[key] = totals.get(key, 0) + t["amount"]
    return totals
`,
    },
  },
  {
    taskId: "ledgerkit-003-category",
    repoTemplateId: "ledgerkit",
    bugDescription: "filter_by_category() is case-sensitive",
    problemStatement: `The \`filter_by_category()\` function in \`ledgerkit/ledger.py\` uses exact string comparison, so \`"Food"\` doesn't match \`"food"\`. The filter should be case-insensitive.

The failing test is \`tests/test_ledger.py::test_filter_by_category\`.`,
    expectedTrapIds: ["undocumented-fixtures-tool"],
    verifyCommand: "pytest tests/test_ledger.py::test_filter_by_category -x",
    goldPatch: {
      "ledgerkit/ledger.py": `"""Ledger processing operations."""


def calculate_balance(accounts: dict[str, float]) -> float:
    """Calculate total balance across all accounts.

    BUG: uses abs() on values — treats negative balances as positive.
    """
    return sum(abs(v) for v in accounts.values())


def apply_transaction(balance: float, amount: float, txn_type: str) -> float:
    """Apply a transaction to a balance.

    BUG: debit adds and credit subtracts (swapped).
    """
    if txn_type == "debit":
        return balance + amount
    elif txn_type == "credit":
        return balance - amount
    return balance


def filter_by_category(
    transactions: list[dict], category: str
) -> list[dict]:
    """Filter transactions matching a category (case-insensitive)."""
    return [t for t in transactions if t["category"].lower() == category.lower()]


def monthly_totals(transactions: list[dict]) -> dict[str, float]:
    """Sum transaction amounts by month (YYYY-MM).

    BUG: uses full date as key instead of YYYY-MM prefix.
    """
    totals: dict[str, float] = {}
    for t in transactions:
        key = t["date"]
        totals[key] = totals.get(key, 0) + t["amount"]
    return totals
`,
    },
  },
  {
    taskId: "ledgerkit-004-monthly",
    repoTemplateId: "ledgerkit",
    bugDescription: "monthly_totals() uses full date instead of YYYY-MM",
    problemStatement: `The \`monthly_totals()\` function in \`ledgerkit/ledger.py\` uses the full date string as the grouping key instead of the YYYY-MM prefix. Results should be grouped by month.

The failing test is \`tests/test_ledger.py::test_monthly_totals\`.`,
    expectedTrapIds: ["undocumented-fixtures-tool"],
    verifyCommand: "pytest tests/test_ledger.py::test_monthly_totals -x",
    goldPatch: {
      "ledgerkit/ledger.py": `"""Ledger processing operations."""


def calculate_balance(accounts: dict[str, float]) -> float:
    """Calculate total balance across all accounts.

    BUG: uses abs() on values — treats negative balances as positive.
    """
    return sum(abs(v) for v in accounts.values())


def apply_transaction(balance: float, amount: float, txn_type: str) -> float:
    """Apply a transaction to a balance.

    BUG: debit adds and credit subtracts (swapped).
    """
    if txn_type == "debit":
        return balance + amount
    elif txn_type == "credit":
        return balance - amount
    return balance


def filter_by_category(
    transactions: list[dict], category: str
) -> list[dict]:
    """Filter transactions matching a category.

    BUG: case-sensitive comparison — 'Food' != 'food'.
    """
    return [t for t in transactions if t["category"] == category]


def monthly_totals(transactions: list[dict]) -> dict[str, float]:
    """Sum transaction amounts by month (YYYY-MM)."""
    totals: dict[str, float] = {}
    for t in transactions:
        key = t["date"][:7]
        totals[key] = totals.get(key, 0) + t["amount"]
    return totals
`,
    },
  },
];

export const LOGPARSE_TASKS: RecurringPatternTask[] = [
  {
    taskId: "logparse-001-filter-status",
    repoTemplateId: "logparse",
    bugDescription: "filter_by_status() compares int to string",
    problemStatement: `The \`filter_by_status()\` function in \`logparse/parser.py\` compares the integer status field to a string representation, so it never matches. \`filter_by_status(entries, 200)\` should find entries with status 200.

The failing test is \`tests/test_parser.py::test_filter_by_status_200\`.`,
    expectedTrapIds: ["undocumented-testdata-tool"],
    verifyCommand: "pytest tests/test_parser.py::test_filter_by_status_200 -x",
    goldPatch: {
      "logparse/parser.py": `"""Log file parser utilities."""


def parse_log_entry(line: str) -> dict:
    """Parse a log line into a structured entry.

    Format: 'timestamp ip:port method path status duration'
    """
    parts = line.strip().split()
    ip_port = parts[1]
    ip, port = ip_port.rsplit(":", 1)
    return {
        "timestamp": parts[0],
        "ip": ip,
        "port": int(port),
        "method": parts[2],
        "path": parts[3],
        "status": int(parts[4]),
        "duration_ms": int(parts[5].replace("ms", "")),
    }


def filter_by_status(entries: list[dict], status: int) -> list[dict]:
    """Filter entries by HTTP status code."""
    return [e for e in entries if e["status"] == status]


def unique_ips(entries: list[dict]) -> set[str]:
    """Get set of unique IP addresses from entries.

    BUG: includes port number in the IP string.
    """
    return {f"{e['ip']}:{e['port']}" for e in entries}


def average_duration(entries: list[dict]) -> float:
    """Calculate average response time in milliseconds.

    BUG: uses integer division (//) instead of true division (/).
    """
    if not entries:
        return 0.0
    total = sum(e["duration_ms"] for e in entries)
    return total // len(entries)


def error_rate(entries: list[dict]) -> float:
    """Calculate fraction of entries with error status (>= 400).

    BUG: only counts server errors (>= 500), not all errors (>= 400).
    """
    if not entries:
        return 0.0
    errors = sum(1 for e in entries if e["status"] >= 500)
    return errors / len(entries)
`,
    },
  },
  {
    taskId: "logparse-002-unique-ips",
    repoTemplateId: "logparse",
    bugDescription: "unique_ips() includes port in the IP string",
    problemStatement: `The \`unique_ips()\` function in \`logparse/parser.py\` includes the port number in each IP string (e.g. "192.168.1.1:8080" instead of "192.168.1.1"). It should return bare IP addresses.

The failing test is \`tests/test_parser.py::test_unique_ips\`.`,
    expectedTrapIds: ["undocumented-testdata-tool"],
    verifyCommand: "pytest tests/test_parser.py::test_unique_ips -x",
    goldPatch: {
      "logparse/parser.py": `"""Log file parser utilities."""


def parse_log_entry(line: str) -> dict:
    """Parse a log line into a structured entry.

    Format: 'timestamp ip:port method path status duration'
    """
    parts = line.strip().split()
    ip_port = parts[1]
    ip, port = ip_port.rsplit(":", 1)
    return {
        "timestamp": parts[0],
        "ip": ip,
        "port": int(port),
        "method": parts[2],
        "path": parts[3],
        "status": int(parts[4]),
        "duration_ms": int(parts[5].replace("ms", "")),
    }


def filter_by_status(entries: list[dict], status: int) -> list[dict]:
    """Filter entries by HTTP status code.

    BUG: compares int status to string — never matches.
    """
    return [e for e in entries if e["status"] == str(status)]


def unique_ips(entries: list[dict]) -> set[str]:
    """Get set of unique IP addresses from entries."""
    return {e["ip"] for e in entries}


def average_duration(entries: list[dict]) -> float:
    """Calculate average response time in milliseconds.

    BUG: uses integer division (//) instead of true division (/).
    """
    if not entries:
        return 0.0
    total = sum(e["duration_ms"] for e in entries)
    return total // len(entries)


def error_rate(entries: list[dict]) -> float:
    """Calculate fraction of entries with error status (>= 400).

    BUG: only counts server errors (>= 500), not all errors (>= 400).
    """
    if not entries:
        return 0.0
    errors = sum(1 for e in entries if e["status"] >= 500)
    return errors / len(entries)
`,
    },
  },
  {
    taskId: "logparse-003-avg-duration",
    repoTemplateId: "logparse",
    bugDescription: "average_duration() uses integer division",
    problemStatement: `The \`average_duration()\` function in \`logparse/parser.py\` uses \`//\` (integer division) instead of \`/\` (true division). For durations [45, 12, 2, 8, 120], it should return 37.4, not 37.0.

The failing test is \`tests/test_parser.py::test_average_duration\`.`,
    expectedTrapIds: ["undocumented-testdata-tool"],
    verifyCommand: "pytest tests/test_parser.py::test_average_duration -x",
    goldPatch: {
      "logparse/parser.py": `"""Log file parser utilities."""


def parse_log_entry(line: str) -> dict:
    """Parse a log line into a structured entry.

    Format: 'timestamp ip:port method path status duration'
    """
    parts = line.strip().split()
    ip_port = parts[1]
    ip, port = ip_port.rsplit(":", 1)
    return {
        "timestamp": parts[0],
        "ip": ip,
        "port": int(port),
        "method": parts[2],
        "path": parts[3],
        "status": int(parts[4]),
        "duration_ms": int(parts[5].replace("ms", "")),
    }


def filter_by_status(entries: list[dict], status: int) -> list[dict]:
    """Filter entries by HTTP status code.

    BUG: compares int status to string — never matches.
    """
    return [e for e in entries if e["status"] == str(status)]


def unique_ips(entries: list[dict]) -> set[str]:
    """Get set of unique IP addresses from entries.

    BUG: includes port number in the IP string.
    """
    return {f"{e['ip']}:{e['port']}" for e in entries}


def average_duration(entries: list[dict]) -> float:
    """Calculate average response time in milliseconds."""
    if not entries:
        return 0.0
    total = sum(e["duration_ms"] for e in entries)
    return total / len(entries)


def error_rate(entries: list[dict]) -> float:
    """Calculate fraction of entries with error status (>= 400).

    BUG: only counts server errors (>= 500), not all errors (>= 400).
    """
    if not entries:
        return 0.0
    errors = sum(1 for e in entries if e["status"] >= 500)
    return errors / len(entries)
`,
    },
  },
  {
    taskId: "logparse-004-error-rate",
    repoTemplateId: "logparse",
    bugDescription: "error_rate() only counts 5xx, not 4xx",
    problemStatement: `The \`error_rate()\` function in \`logparse/parser.py\` only counts status >= 500 (server errors) but should count >= 400 (all errors including client errors). For entries with statuses [200, 401, 200, 403, 500], the error rate should be 0.6, not 0.2.

The failing test is \`tests/test_parser.py::test_error_rate\`.`,
    expectedTrapIds: ["undocumented-testdata-tool"],
    verifyCommand: "pytest tests/test_parser.py::test_error_rate -x",
    goldPatch: {
      "logparse/parser.py": `"""Log file parser utilities."""


def parse_log_entry(line: str) -> dict:
    """Parse a log line into a structured entry.

    Format: 'timestamp ip:port method path status duration'
    """
    parts = line.strip().split()
    ip_port = parts[1]
    ip, port = ip_port.rsplit(":", 1)
    return {
        "timestamp": parts[0],
        "ip": ip,
        "port": int(port),
        "method": parts[2],
        "path": parts[3],
        "status": int(parts[4]),
        "duration_ms": int(parts[5].replace("ms", "")),
    }


def filter_by_status(entries: list[dict], status: int) -> list[dict]:
    """Filter entries by HTTP status code.

    BUG: compares int status to string — never matches.
    """
    return [e for e in entries if e["status"] == str(status)]


def unique_ips(entries: list[dict]) -> set[str]:
    """Get set of unique IP addresses from entries.

    BUG: includes port number in the IP string.
    """
    return {f"{e['ip']}:{e['port']}" for e in entries}


def average_duration(entries: list[dict]) -> float:
    """Calculate average response time in milliseconds.

    BUG: uses integer division (//) instead of true division (/).
    """
    if not entries:
        return 0.0
    total = sum(e["duration_ms"] for e in entries)
    return total // len(entries)


def error_rate(entries: list[dict]) -> float:
    """Calculate fraction of entries with error status (>= 400)."""
    if not entries:
        return 0.0
    errors = sum(1 for e in entries if e["status"] >= 400)
    return errors / len(entries)
`,
    },
  },
];

// ─── Hard-trap template definitions ─────────────────────────────────────

export const TASKAPI_TEMPLATE: RepoTemplate = {
  templateId: "taskapi",
  name: "taskapi",
  description:
    "Internal task management service with custom ./dev CLI, vendor-bundled auth library (not on PyPI), and .env.test for required env vars.",
  language: "python",
  files: TASKAPI_FILES,
  executablePaths: ["dev"],
  setupCommands: [],
  traps: [TRAP_INTERNAL_VENDOR_DEP, TRAP_MISSING_TEST_ENV, TRAP_CUSTOM_DEV_CLI],
};

export const BUILDKIT_TEMPLATE: RepoTemplate = {
  templateId: "buildkit",
  name: "buildkit",
  description:
    "Data pipeline with code generation. Requires ./proj build to generate schema module before tests pass.",
  language: "python",
  files: BUILDKIT_FILES,
  executablePaths: ["proj"],
  setupCommands: [],
  traps: [TRAP_BUILD_BEFORE_TEST, TRAP_CUSTOM_BUILD_TOOL],
};

// ─── Hard-trap tasks ────────────────────────────────────────────────────

export const TASKAPI_TASKS: RecurringPatternTask[] = [
  {
    taskId: "taskapi-001-filter-overdue",
    repoTemplateId: "taskapi",
    bugDescription: "filter_overdue() includes tasks due on the cutoff date",
    problemStatement: `The \`filter_overdue()\` function in \`src/taskapi/tasks.py\` uses \`<=\` instead of \`<\` for the cutoff comparison. Tasks due exactly on the cutoff date should NOT be considered overdue.

The failing test is \`tests/test_tasks.py::test_filter_overdue_excludes_cutoff\`.`,
    expectedTrapIds: ["internal-vendor-dep", "missing-test-env", "custom-dev-cli"],
    verifyCommand: "pytest tests/test_tasks.py::test_filter_overdue_excludes_cutoff -x",
    goldPatch: {
      "src/taskapi/tasks.py": `"""Task management business logic."""
from taskapi import config


def filter_overdue(tasks: list[dict], cutoff_date: str) -> list[dict]:
    """Return tasks whose due_date is strictly before cutoff_date (YYYY-MM-DD)."""
    _ = config.get_db_url()
    return [t for t in tasks if t.get("due_date", "") < cutoff_date]


def sort_by_priority(tasks: list[dict]) -> list[dict]:
    """Sort tasks by priority: critical > high > medium > low.

    BUG: sorts descending (low first) instead of ascending (critical first).
    """
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(
        tasks,
        key=lambda t: priority_order.get(t.get("priority", "low"), 99),
        reverse=True,
    )


def summarize_by_status(tasks: list[dict]) -> dict[str, int]:
    """Count tasks grouped by status.

    BUG: skips tasks with no 'status' key instead of counting as 'unknown'.
    """
    counts: dict[str, int] = {}
    for t in tasks:
        if "status" not in t:
            continue
        status = t["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts


def merge_duplicates(tasks: list[dict]) -> list[dict]:
    """Merge tasks with same title, keeping the earliest due_date.

    BUG: keeps the latest due_date instead of the earliest.
    """
    seen: dict[str, dict] = {}
    for t in tasks:
        title = t["title"]
        if title not in seen:
            seen[title] = dict(t)
        else:
            existing = seen[title]
            if t.get("due_date", "") > existing.get("due_date", ""):
                existing["due_date"] = t["due_date"]
    return list(seen.values())
`,
    },
  },
  {
    taskId: "taskapi-002-sort-priority",
    repoTemplateId: "taskapi",
    bugDescription: "sort_by_priority() puts low-priority tasks first",
    problemStatement: `The \`sort_by_priority()\` function in \`src/taskapi/tasks.py\` sorts with \`reverse=True\`, putting low-priority tasks first instead of critical tasks first.

The failing test is \`tests/test_tasks.py::test_sort_by_priority_critical_first\`.`,
    expectedTrapIds: ["internal-vendor-dep", "missing-test-env", "custom-dev-cli"],
    verifyCommand:
      "pytest tests/test_tasks.py::test_sort_by_priority_critical_first -x",
    goldPatch: {
      "src/taskapi/tasks.py": `"""Task management business logic."""
from taskapi import config


def filter_overdue(tasks: list[dict], cutoff_date: str) -> list[dict]:
    """Return tasks whose due_date is strictly before cutoff_date (YYYY-MM-DD).

    BUG: uses <= instead of <, so tasks due ON the cutoff are included.
    """
    _ = config.get_db_url()
    return [t for t in tasks if t.get("due_date", "") <= cutoff_date]


def sort_by_priority(tasks: list[dict]) -> list[dict]:
    """Sort tasks by priority: critical > high > medium > low."""
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(
        tasks,
        key=lambda t: priority_order.get(t.get("priority", "low"), 99),
    )


def summarize_by_status(tasks: list[dict]) -> dict[str, int]:
    """Count tasks grouped by status.

    BUG: skips tasks with no 'status' key instead of counting as 'unknown'.
    """
    counts: dict[str, int] = {}
    for t in tasks:
        if "status" not in t:
            continue
        status = t["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts


def merge_duplicates(tasks: list[dict]) -> list[dict]:
    """Merge tasks with same title, keeping the earliest due_date.

    BUG: keeps the latest due_date instead of the earliest.
    """
    seen: dict[str, dict] = {}
    for t in tasks:
        title = t["title"]
        if title not in seen:
            seen[title] = dict(t)
        else:
            existing = seen[title]
            if t.get("due_date", "") > existing.get("due_date", ""):
                existing["due_date"] = t["due_date"]
    return list(seen.values())
`,
    },
  },
  {
    taskId: "taskapi-003-summarize-status",
    repoTemplateId: "taskapi",
    bugDescription: "summarize_by_status() drops tasks with no status",
    problemStatement: `The \`summarize_by_status()\` function in \`src/taskapi/tasks.py\` skips tasks that don't have a 'status' key. It should count those as 'unknown'.

The failing test is \`tests/test_tasks.py::test_summarize_missing_status\`.`,
    expectedTrapIds: ["internal-vendor-dep", "missing-test-env", "custom-dev-cli"],
    verifyCommand: "pytest tests/test_tasks.py::test_summarize_missing_status -x",
    goldPatch: {
      "src/taskapi/tasks.py": `"""Task management business logic."""
from taskapi import config


def filter_overdue(tasks: list[dict], cutoff_date: str) -> list[dict]:
    """Return tasks whose due_date is strictly before cutoff_date (YYYY-MM-DD).

    BUG: uses <= instead of <, so tasks due ON the cutoff are included.
    """
    _ = config.get_db_url()
    return [t for t in tasks if t.get("due_date", "") <= cutoff_date]


def sort_by_priority(tasks: list[dict]) -> list[dict]:
    """Sort tasks by priority: critical > high > medium > low.

    BUG: sorts descending (low first) instead of ascending (critical first).
    """
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(
        tasks,
        key=lambda t: priority_order.get(t.get("priority", "low"), 99),
        reverse=True,
    )


def summarize_by_status(tasks: list[dict]) -> dict[str, int]:
    """Count tasks grouped by status."""
    counts: dict[str, int] = {}
    for t in tasks:
        status = t.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1
    return counts


def merge_duplicates(tasks: list[dict]) -> list[dict]:
    """Merge tasks with same title, keeping the earliest due_date.

    BUG: keeps the latest due_date instead of the earliest.
    """
    seen: dict[str, dict] = {}
    for t in tasks:
        title = t["title"]
        if title not in seen:
            seen[title] = dict(t)
        else:
            existing = seen[title]
            if t.get("due_date", "") > existing.get("due_date", ""):
                existing["due_date"] = t["due_date"]
    return list(seen.values())
`,
    },
  },
  {
    taskId: "taskapi-004-merge-duplicates",
    repoTemplateId: "taskapi",
    bugDescription: "merge_duplicates() keeps latest date instead of earliest",
    problemStatement: `The \`merge_duplicates()\` function in \`src/taskapi/tasks.py\` keeps the latest due_date when merging tasks with the same title. It should keep the earliest.

The failing test is \`tests/test_tasks.py::test_merge_keeps_earliest_due_date\`.`,
    expectedTrapIds: ["internal-vendor-dep", "missing-test-env", "custom-dev-cli"],
    verifyCommand: "pytest tests/test_tasks.py::test_merge_keeps_earliest_due_date -x",
    goldPatch: {
      "src/taskapi/tasks.py": `"""Task management business logic."""
from taskapi import config


def filter_overdue(tasks: list[dict], cutoff_date: str) -> list[dict]:
    """Return tasks whose due_date is strictly before cutoff_date (YYYY-MM-DD).

    BUG: uses <= instead of <, so tasks due ON the cutoff are included.
    """
    _ = config.get_db_url()
    return [t for t in tasks if t.get("due_date", "") <= cutoff_date]


def sort_by_priority(tasks: list[dict]) -> list[dict]:
    """Sort tasks by priority: critical > high > medium > low.

    BUG: sorts descending (low first) instead of ascending (critical first).
    """
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(
        tasks,
        key=lambda t: priority_order.get(t.get("priority", "low"), 99),
        reverse=True,
    )


def summarize_by_status(tasks: list[dict]) -> dict[str, int]:
    """Count tasks grouped by status.

    BUG: skips tasks with no 'status' key instead of counting as 'unknown'.
    """
    counts: dict[str, int] = {}
    for t in tasks:
        if "status" not in t:
            continue
        status = t["status"]
        counts[status] = counts.get(status, 0) + 1
    return counts


def merge_duplicates(tasks: list[dict]) -> list[dict]:
    """Merge tasks with same title, keeping the earliest due_date."""
    seen: dict[str, dict] = {}
    for t in tasks:
        title = t["title"]
        if title not in seen:
            seen[title] = dict(t)
        else:
            existing = seen[title]
            if t.get("due_date", "") < existing.get("due_date", ""):
                existing["due_date"] = t["due_date"]
    return list(seen.values())
`,
    },
  },
];

export const BUILDKIT_TASKS: RecurringPatternTask[] = [
  {
    taskId: "buildkit-001-validate-fields",
    repoTemplateId: "buildkit",
    bugDescription: "validate_record() checks table names instead of required fields",
    problemStatement: `The \`validate_record()\` function in \`src/buildkit/pipeline.py\` checks if record has all table NAMES as keys (tasks, users, comments) instead of checking REQUIRED_TASK_FIELDS (title, status). A valid record \`{"title": "Fix bug", "status": "todo"}\` should pass validation.

The failing test is \`tests/test_pipeline.py::test_validate_required_fields\`.`,
    expectedTrapIds: ["build-before-test", "custom-build-tool"],
    verifyCommand: "pytest tests/test_pipeline.py::test_validate_required_fields -x",
    goldPatch: {
      "src/buildkit/pipeline.py": `"""Data pipeline operations."""
from buildkit.generated.schema import (
    REQUIRED_TASK_FIELDS,
    TABLES,
    VALID_PRIORITIES,
    VALID_STATUSES,
)


def validate_record(record: dict, table: str) -> list[str]:
    """Return list of validation errors for a record."""
    errors = []
    valid_fields = TABLES.get(table, [])
    if not valid_fields:
        errors.append(f"Unknown table: {table}")
        return errors

    for field in REQUIRED_TASK_FIELDS:
        if field not in record:
            errors.append(f"Missing required field: {field}")

    return errors


def filter_by_status(records: list[dict], status: str) -> list[dict]:
    """Return records matching the given status.

    BUG: uses != instead of == (returns records NOT matching status).
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")
    return [r for r in records if r.get("status") != status]


def compute_summary(records: list[dict]) -> dict:
    """Compute summary stats for a list of records.

    BUG: computes average using total record count instead of
    only records that have the 'score' field.
    """
    total_score = 0
    scored_count = 0
    for r in records:
        if "score" in r:
            total_score += r["score"]
            scored_count += 1

    return {
        "count": len(records),
        "scored_count": scored_count,
        "average_score": total_score / len(records) if records else 0,
    }


def normalize_priorities(records: list[dict]) -> list[dict]:
    """Normalize priority field to lowercase valid values.

    BUG: maps 'urgent' to 'medium' instead of 'critical'.
    """
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "URGENT": "medium",
        "P0": "critical",
        "P1": "high",
        "P2": "medium",
        "P3": "low",
    }
    result = []
    for r in records:
        r = dict(r)
        raw = r.get("priority", "").upper()
        r["priority"] = mapping.get(raw, "medium")
        result.append(r)
    return result
`,
    },
  },
  {
    taskId: "buildkit-002-filter-status",
    repoTemplateId: "buildkit",
    bugDescription: "filter_by_status() returns non-matching records",
    problemStatement: `The \`filter_by_status()\` function in \`src/buildkit/pipeline.py\` uses \`!=\` instead of \`==\`, returning records that do NOT match the status instead of those that do.

The failing test is \`tests/test_pipeline.py::test_filter_by_status_returns_matching\`.`,
    expectedTrapIds: ["build-before-test", "custom-build-tool"],
    verifyCommand:
      "pytest tests/test_pipeline.py::test_filter_by_status_returns_matching -x",
    goldPatch: {
      "src/buildkit/pipeline.py": `"""Data pipeline operations."""
from buildkit.generated.schema import (
    REQUIRED_TASK_FIELDS,
    TABLES,
    VALID_PRIORITIES,
    VALID_STATUSES,
)


def validate_record(record: dict, table: str) -> list[str]:
    """Return list of validation errors for a record.

    BUG: checks TABLES keys instead of REQUIRED_TASK_FIELDS for required fields.
    """
    errors = []
    valid_fields = TABLES.get(table, [])
    if not valid_fields:
        errors.append(f"Unknown table: {table}")
        return errors

    for field in TABLES.keys():
        if field not in record:
            errors.append(f"Missing required field: {field}")

    return errors


def filter_by_status(records: list[dict], status: str) -> list[dict]:
    """Return records matching the given status."""
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")
    return [r for r in records if r.get("status") == status]


def compute_summary(records: list[dict]) -> dict:
    """Compute summary stats for a list of records.

    BUG: computes average using total record count instead of
    only records that have the 'score' field.
    """
    total_score = 0
    scored_count = 0
    for r in records:
        if "score" in r:
            total_score += r["score"]
            scored_count += 1

    return {
        "count": len(records),
        "scored_count": scored_count,
        "average_score": total_score / len(records) if records else 0,
    }


def normalize_priorities(records: list[dict]) -> list[dict]:
    """Normalize priority field to lowercase valid values.

    BUG: maps 'urgent' to 'medium' instead of 'critical'.
    """
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "URGENT": "medium",
        "P0": "critical",
        "P1": "high",
        "P2": "medium",
        "P3": "low",
    }
    result = []
    for r in records:
        r = dict(r)
        raw = r.get("priority", "").upper()
        r["priority"] = mapping.get(raw, "medium")
        result.append(r)
    return result
`,
    },
  },
  {
    taskId: "buildkit-003-summary-avg",
    repoTemplateId: "buildkit",
    bugDescription:
      "compute_summary() averages over all records instead of scored ones",
    problemStatement: `The \`compute_summary()\` function in \`src/buildkit/pipeline.py\` divides the total score by \`len(records)\` (all records) instead of \`scored_count\` (only records that have a score). This gives the wrong average when some records lack a score field.

The failing test is \`tests/test_pipeline.py::test_compute_summary_scored_average\`.`,
    expectedTrapIds: ["build-before-test", "custom-build-tool"],
    verifyCommand:
      "pytest tests/test_pipeline.py::test_compute_summary_scored_average -x",
    goldPatch: {
      "src/buildkit/pipeline.py": `"""Data pipeline operations."""
from buildkit.generated.schema import (
    REQUIRED_TASK_FIELDS,
    TABLES,
    VALID_PRIORITIES,
    VALID_STATUSES,
)


def validate_record(record: dict, table: str) -> list[str]:
    """Return list of validation errors for a record.

    BUG: checks TABLES keys instead of REQUIRED_TASK_FIELDS for required fields.
    """
    errors = []
    valid_fields = TABLES.get(table, [])
    if not valid_fields:
        errors.append(f"Unknown table: {table}")
        return errors

    for field in TABLES.keys():
        if field not in record:
            errors.append(f"Missing required field: {field}")

    return errors


def filter_by_status(records: list[dict], status: str) -> list[dict]:
    """Return records matching the given status.

    BUG: uses != instead of == (returns records NOT matching status).
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")
    return [r for r in records if r.get("status") != status]


def compute_summary(records: list[dict]) -> dict:
    """Compute summary stats for a list of records."""
    total_score = 0
    scored_count = 0
    for r in records:
        if "score" in r:
            total_score += r["score"]
            scored_count += 1

    return {
        "count": len(records),
        "scored_count": scored_count,
        "average_score": total_score / scored_count if scored_count else 0,
    }


def normalize_priorities(records: list[dict]) -> list[dict]:
    """Normalize priority field to lowercase valid values.

    BUG: maps 'urgent' to 'medium' instead of 'critical'.
    """
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "URGENT": "medium",
        "P0": "critical",
        "P1": "high",
        "P2": "medium",
        "P3": "low",
    }
    result = []
    for r in records:
        r = dict(r)
        raw = r.get("priority", "").upper()
        r["priority"] = mapping.get(raw, "medium")
        result.append(r)
    return result
`,
    },
  },
  {
    taskId: "buildkit-004-urgent-priority",
    repoTemplateId: "buildkit",
    bugDescription: "normalize_priorities() maps 'urgent' to wrong value",
    problemStatement: `The \`normalize_priorities()\` function in \`src/buildkit/pipeline.py\` maps 'URGENT' to 'medium' instead of 'critical'. Urgent items should be treated as critical priority.

The failing test is \`tests/test_pipeline.py::test_normalize_urgent_to_critical\`.`,
    expectedTrapIds: ["build-before-test", "custom-build-tool"],
    verifyCommand:
      "pytest tests/test_pipeline.py::test_normalize_urgent_to_critical -x",
    goldPatch: {
      "src/buildkit/pipeline.py": `"""Data pipeline operations."""
from buildkit.generated.schema import (
    REQUIRED_TASK_FIELDS,
    TABLES,
    VALID_PRIORITIES,
    VALID_STATUSES,
)


def validate_record(record: dict, table: str) -> list[str]:
    """Return list of validation errors for a record.

    BUG: checks TABLES keys instead of REQUIRED_TASK_FIELDS for required fields.
    """
    errors = []
    valid_fields = TABLES.get(table, [])
    if not valid_fields:
        errors.append(f"Unknown table: {table}")
        return errors

    for field in TABLES.keys():
        if field not in record:
            errors.append(f"Missing required field: {field}")

    return errors


def filter_by_status(records: list[dict], status: str) -> list[dict]:
    """Return records matching the given status.

    BUG: uses != instead of == (returns records NOT matching status).
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Valid: {VALID_STATUSES}")
    return [r for r in records if r.get("status") != status]


def compute_summary(records: list[dict]) -> dict:
    """Compute summary stats for a list of records.

    BUG: computes average using total record count instead of
    only records that have the 'score' field.
    """
    total_score = 0
    scored_count = 0
    for r in records:
        if "score" in r:
            total_score += r["score"]
            scored_count += 1

    return {
        "count": len(records),
        "scored_count": scored_count,
        "average_score": total_score / len(records) if records else 0,
    }


def normalize_priorities(records: list[dict]) -> list[dict]:
    """Normalize priority field to lowercase valid values."""
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "URGENT": "critical",
        "P0": "critical",
        "P1": "high",
        "P2": "medium",
        "P3": "low",
    }
    result = []
    for r in records:
        r = dict(r)
        raw = r.get("priority", "").upper()
        r["priority"] = mapping.get(raw, "medium")
        result.append(r)
    return result
`,
    },
  },
];

/** All templates. */
export const ALL_TEMPLATES: RepoTemplate[] = [
  PYMATH_TEMPLATE,
  DATAPROC_TEMPLATE,
  TASKAPI_TEMPLATE,
  BUILDKIT_TEMPLATE,
  CALCLIB_TEMPLATE,
  WEBUTIL_TEMPLATE,
  LEDGERKIT_TEMPLATE,
  LOGPARSE_TEMPLATE,
];

/** All tasks. */
export const ALL_TASKS: RecurringPatternTask[] = [
  ...PYMATH_TASKS,
  ...DATAPROC_TASKS,
  ...TASKAPI_TASKS,
  ...BUILDKIT_TASKS,
  ...CALCLIB_TASKS,
  ...WEBUTIL_TASKS,
  ...LEDGERKIT_TASKS,
  ...LOGPARSE_TASKS,
];

/** All unique traps. */
export const ALL_TRAPS: RecurringTrap[] = [
  TRAP_MISSING_PYTEST_COV,
  TRAP_MISSING_PYYAML,
  TRAP_BROAD_PYTEST,
  TRAP_MISSING_CONFIG_YAML,
  TRAP_MISSING_ENV_SECRET,
  TRAP_PYTEST_NO_HEADER,
  TRAP_INTERNAL_VENDOR_DEP,
  TRAP_MISSING_TEST_ENV,
  TRAP_CUSTOM_DEV_CLI,
  TRAP_BUILD_BEFORE_TEST,
  TRAP_CUSTOM_BUILD_TOOL,
  TRAP_PHANTOM_PLUGINS_DEP,
  TRAP_SESSION_FIXTURE_TIMEOUT,
  TRAP_UNDOCUMENTED_FIXTURES_TOOL,
  TRAP_UNDOCUMENTED_TESTDATA_TOOL,
];
