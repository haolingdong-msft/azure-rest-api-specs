# Bounded Agent Judgment

When preparation prints `awaiting-agent-judgment`, continue immediately without
a progress stop or another user turn.

Read `<work-directory>\agent-workspace\agent-index.json` once. It identifies
the single bounded model input, required outputs, drafts, exact coverage IDs,
and completion checklist. Read `model-input.json` exactly once unless guarded
finalization requests the one permitted correction turn.

Use the supplied per-dimension `contextPolicy`. Legacy
`api-version-publication` and `api-version-wide-change` labels do not exclude an
entire intent. Verified unchanged operation pairs are represented by a compact
carry-over count and evidence reference rather than per-operation review.
Summarize the supplied version event once and complete its Azure Guidelines
decision when requested. Judge every supplied candidate exactly once; do not
reconstruct or omit candidates from the carry-over inventory.

Coordinator grouping is frozen and may be coarse at source-file granularity.
Do not split or merge supplied intents, including a broad `main.tsp` group.
Summarize its actual contents without claiming one proven business feature.
Version decorators describe feature applicability; they do not turn a feature
into publication. Only supplied publication-eligible groups may be described
as standalone version publications. A mixed normal group retains its version
declaration and feature facts, with the report's explicit grouping notice.

Also read only:

- [classification guidance](../classification.md), including
  [downstream cases](../downstream-breaking-cases.md) and
  [candidate rules](../downstream-candidate-rules.md);
- the [agentic search procedure](../agentic-search.md);
- the [official document catalog](../reference-document-links.md);
- the [documentation checks](../document-quality.md).

Do not recursively list the work directory, broadly search report artifacts,
inspect raw compiler output, or repeatedly read schemas and canonical inputs.
Use `agent-workspace\agent-decisions.draft.json` only as the structural
template. Its compliance judgments prefill eligible intent-scoped qualified
`declarationNames`; retain only names supporting each judgment. Never copy its
intentionally invalid unresolved placeholders into the completed file.

If `inferenceRequests` is empty, omit `inferenceResults`. Otherwise, analyze
only supplied unknown hunks and write one exact compact result per request to
`agent-workspace\agent-decisions.json`. Each is `candidates`, `no-impact`, or
`blocked`. Inferred candidates may use only the request's source, hunk,
operations, facts, and allowed dimensions. Never modify `model-input.json`.
An unresolved request blocks only its supplied `allowedDimensions`, not every
assessment dimension. A new API version does not exempt substantive REST
candidates from judgment; explain cross-version migration incompatibilities
without claiming an existing-version regression from head-only projections.

The compact decision file must contain one concise result per supplied Semantic
review unit and exact deterministic and inferred REST/downstream candidate
coverage. Write one Azure Guidelines decision per supplied compliance search
request. When there are no compliance search requests, leave catalog scores,
retrieval results, search blockers, and compliance judgments empty. Do not read
raw AutoRest/TCGC output, compiler logs, unrelated unchanged source, prior
answers, or use catalog descriptions as guidance. Candidate and review-unit
evidence omitted from the bounded input is available only through declared
canonical artifact references; do not scan unrelated artifact entries.

Documentation Completeness is assembled deterministically from
`dimensions/document-quality-input.json`. The Agent neither reads that artifact
nor authors documentation decisions.

Continue with the
[Azure Guidelines search and materialization](compliance-and-materialization.md).
