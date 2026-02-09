# Related work: efficiency + agentic coding

This is a curated reading list for the problems Happy Paths targets:

- repeated wrong-turns in agentic coding loops
- cross-session / cross-developer reuse (memory)
- correctness vs cost/time ("thinking budget") tradeoffs
- realistic evaluation of software engineering agents
- developer productivity measurement

Happy Paths is not trying to be a research project, but we *do* want our claims
(and our measurement choices) to be legible to people who have followed this
literature.

## Software engineering agents + benchmarks

- **SWE-bench** (2023): real GitHub issues as a benchmark.
  - Paper: https://arxiv.org/abs/2310.06770
  - Website/viewer: https://www.swebench.com/

- **SWE-bench Verified** (2024): tighter verification harness + public results.
  - Post: https://openai.com/index/introducing-swe-bench-verified/

- **SWE-agent** (NeurIPS 2024): agent-computer interfaces + guardrails for SWE-bench-style tasks.
  - Paper: https://arxiv.org/abs/2405.15793

- **Agentless**: an “agentless” approach to solving software development problems.
  - Repo: https://github.com/OpenAutoCoder/Agentless

- **SWE-SEARCH** (ICLR 2025): using search/retrieval to improve SWE performance.
  - Paper (ICLR proceedings PDF):
    https://proceedings.iclr.cc/paper_files/paper/2025/file/a1e6783e4d739196cad3336f12d402bf-Paper-Conference.pdf

- **SWE-Effi** (2025): re-evaluates SWE agent effectiveness *under resource constraints*.
  - Paper: https://arxiv.org/html/2509.09853v2

### More agentic coding benchmarks

- **RepoBench** (ICLR 2024): repository-level code completion.
  - Repo: https://github.com/Leolty/repobench

- **AgentBench** (ICLR 2024): broader benchmark for LLMs as agents (not coding-only).
  - Repo: https://github.com/THUDM/AgentBench

- **ABC-Bench** (2026): agentic backend coding tasks.
  - Paper: https://arxiv.org/abs/2601.11077

- **ProjDevBench** (2026): end-to-end project development benchmark for coding agents.
  - Paper: https://arxiv.org/html/2602.01655

- **ACE-Bench** (2026): agentic coding in end-to-end development of complex features.
  - OpenReview: https://openreview.net/forum?id=41xrZ3uGuI

## Context engineering + memory for agents

- **Structured Context Engineering for File-Native Agentic Systems** (2026): schema accuracy + multi-file navigation.
  - Paper: https://arxiv.org/abs/2602.05447

- **Reflexion** (2023): language agents that self-improve via verbal feedback.
  - Paper: https://arxiv.org/abs/2303.11366

- **MemGPT** (2023): explicit external memory management for LLM agents.
  - Paper: https://arxiv.org/abs/2310.08560

- **A-Mem: Agentic Memory for LLM Agents** (2025).
  - Paper: https://arxiv.org/pdf/2502.12110

- **Voyager** (2023): lifelong skill library + curriculum in an open-ended environment.
  - Paper: https://arxiv.org/abs/2305.16291

## Inference-time compute / “thinking budget” efficiency

These are relevant because “agentic coding” often fails not for lack of *capability*,
but because the loop burns too much time/tokens getting to the right state.

- **Scaling LLM Test-Time Compute Optimally…** (2024).
  - Paper: https://arxiv.org/abs/2408.03314

- **Token-Budget-Aware LLM Reasoning** (ACL Findings 2025).
  - Paper (PDF): https://aclanthology.org/2025.findings-acl.1274.pdf

- **Steering LLM Thinking with Budget Guidance** (2025).
  - Paper: https://arxiv.org/html/2506.13752v1

- **ThinkPrune**: pruning long chain-of-thought.
  - Paper (PDF): https://openreview.net/pdf/367c67d290b7b9d4fd60db37058f764b39c667b2.pdf

## Developer productivity studies (humans + assistants)

- **The Impact of AI on Developer Productivity: Evidence from GitHub Copilot** (2023).
  - Paper: https://arxiv.org/abs/2302.06590

- GitHub’s own writeup of productivity/happiness study results:
  - https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/

## Human factors: comprehension, review, and mental models

A recurring theme in community discussion is that assistants shift the bottleneck
from *writing* to *reviewing / understanding* (especially for large diffs). We
want our metrics to reflect that reality.

- **Towards Decoding Developer Cognition in the Age of AI Assistants** (2025).
  - Paper: https://arxiv.org/html/2501.02684v1

- **Understanding user mental models in AI-driven code completion tools** (2025).
  - Link: https://www.sciencedirect.com/science/article/pii/S1071581925002058

- **Human-AI Experience in Integrated Development Environments: A systematic literature review** (2025).
  - Paper: https://arxiv.org/html/2503.06195v1

## Community discussion (Hacker News + Reddit)

We also track practitioner discussion to understand what *actually* bottlenecks
engineering teams when they adopt these tools.

### Hacker News threads

- SWE-agent open source (benchmark realism, “bug report quality” debates):
  - https://news.ycombinator.com/item?id=39907468

- Devin announcement (scope limits, “90% correct is not good enough”):
  - https://news.ycombinator.com/item?id=39679787

- Aider thread (API cost, large-task iteration loops):
  - https://news.ycombinator.com/item?id=39995725

- Claude Code (multi-session orchestration, workflow discussion):
  - https://news.ycombinator.com/item?id=43307809

### Reddit threads

- Claude Code velocity discussion: bottleneck shift from *typing* to *understanding/review*.
  - https://www.reddit.com/r/ClaudeAI/comments/1osv7is/using_claude_code_heavily_for_6_months_why_faster/

- AI coding assistant comparisons (Cursor/Aider/Cline/Copilot, etc.):
  - https://www.reddit.com/r/ClaudeAI/comments/1izmyps/claude_cursor_aider_cline_or_github_copilotwhich/

---

If you think a paper/thread belongs here (especially anything that quantifies
cost/time or failure modes), please open a PR adding it.
