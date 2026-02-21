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
];

/** All tasks. */
export const ALL_TASKS: RecurringPatternTask[] = [
  ...PYMATH_TASKS,
  ...DATAPROC_TASKS,
  ...TASKAPI_TASKS,
  ...BUILDKIT_TASKS,
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
];
