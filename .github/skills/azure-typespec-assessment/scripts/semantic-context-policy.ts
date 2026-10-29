import { canonicalJson } from "./stable-id.ts";
import { normalizeTcgcContract } from "./tcgc-contract.ts";

type AssessmentFact = import("./runtime-types.ts").AssessmentFact;
type InternalSemanticUnit = import("./runtime-types.ts").InternalSemanticUnit;
type NormalizedTcgcContract = import("./runtime-types.ts").NormalizedTcgcContract;
type NormalizedTcgcMethod = import("./runtime-types.ts").NormalizedTcgcMethod;
type PreparationManifest = import("./runtime-types.ts").PreparationManifest;
type SemanticAnalysis = import("./runtime-types.ts").SemanticAnalysis;
type SemanticCarryOverOperation = import("./runtime-types.ts").SemanticCarryOverOperation;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSelectorValue(value: unknown, selector: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeSelectorValue(item, selector));
  if (!isRecord(value)) return selector && typeof value === "string" ? "<api-version>" : value;
  const isSelector = selector || value.isApiVersionParam === true;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "apiVersions")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [
        key,
        isSelector && ["value", "defaultValue"].includes(key)
          ? "<api-version>"
          : normalizeSelectorValue(item, isSelector),
      ]),
  );
}

function typeIndex(contract: NormalizedTcgcContract) {
  const index = new Map<string, unknown>();
  for (const type of [...contract.models, ...contract.enums, ...contract.unions]) {
    for (const identity of [type.identity, type.crossLanguageDefinitionId, type.name]) {
      if (identity) index.set(identity, type);
    }
  }
  return index;
}

function referencedTypeGraph(method: NormalizedTcgcMethod, contract: NormalizedTcgcContract) {
  const index = typeIndex(contract);
  const visited = new Set<string>();
  const pending: unknown[] = [method];
  const definitions: unknown[] = [];

  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item as unknown);
      continue;
    }
    if (!isRecord(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      if (
        typeof item === "string" &&
        ["id", "identity", "crossLanguageDefinitionId", "name"].includes(key)
      ) {
        const definition = index.get(item);
        if (definition && !visited.has(item)) {
          visited.add(item);
          definitions.push(definition);
          pending.push(definition);
        }
      } else {
        pending.push(item);
      }
    }
  }

  return definitions
    .map((definition) => normalizeSelectorValue(definition, false))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function methodView(method: NormalizedTcgcMethod, contract: NormalizedTcgcContract) {
  return {
    method: normalizeSelectorValue(method, false),
    referencedTypes: referencedTypeGraph(method, contract),
  };
}

function methodsForRoute(
  contract: NormalizedTcgcContract,
  fact: AssessmentFact | undefined,
  apiVersion: string | undefined,
) {
  const method = fact?.method ?? fact?.operation?.method ?? fact?.operation?.verb;
  const route = fact?.path ?? fact?.operation?.path;
  if (!method || !route) return [];
  return contract.methods.filter(
    (candidate) =>
      candidate.operation?.verb?.toLowerCase() === method.toLowerCase() &&
      candidate.operation?.path === route &&
      (!apiVersion ||
        !candidate.apiVersions.length ||
        candidate.apiVersions.some((version) => String(version) === apiVersion)),
  );
}

function compareDownstreamOperation({
  before,
  after,
  baseline,
  target,
  baselineVersion,
  targetVersion,
}: {
  before: AssessmentFact | undefined;
  after: AssessmentFact | undefined;
  baseline: NormalizedTcgcContract | undefined;
  target: NormalizedTcgcContract | undefined;
  baselineVersion: string | undefined;
  targetVersion: string | undefined;
}) {
  if (!before || !after || !baseline || !target) return "unknown" as const;
  const beforeMethods = methodsForRoute(baseline, before, baselineVersion);
  const afterMethods = methodsForRoute(target, after, targetVersion);
  if (beforeMethods.length !== 1 || afterMethods.length !== 1) return "unknown" as const;
  return canonicalJson(methodView(beforeMethods[0], baseline)) ===
    canonicalJson(methodView(afterMethods[0], target))
    ? ("equivalent" as const)
    : ("different" as const);
}

function carryOverOperation(
  operation: InternalSemanticUnit["operations"][number],
  facts: Record<string, AssessmentFact>,
  contracts:
    | {
        baseline: NormalizedTcgcContract;
        target: NormalizedTcgcContract;
        baselineVersion?: string;
        targetVersion?: string;
      }
    | undefined,
): SemanticCarryOverOperation {
  const before = operation.beforeFactId ? facts[operation.beforeFactId] : undefined;
  const after = operation.afterFactId ? facts[operation.afterFactId] : undefined;
  const rest =
    !before || !after ? "unknown" : operation.restChanged === false ? "equivalent" : "different";
  const downstream = compareDownstreamOperation({
    before,
    after,
    baseline: contracts?.baseline,
    target: contracts?.target,
    baselineVersion: contracts?.baselineVersion,
    targetVersion: contracts?.targetVersion,
  });
  return {
    operationId: operation.operationId,
    rest,
    downstream,
    beforeFactId: operation.beforeFactId,
    afterFactId: operation.afterFactId,
    ...(!contracts ? { reason: "tcgc-artifacts-unavailable" } : {}),
  };
}

export function applySemanticContextPolicy({
  manifest,
  workRoot,
  semantic,
}: {
  manifest: PreparationManifest;
  workRoot: string;
  semantic: SemanticAnalysis;
}) {
  const contracts = new Map<
    string,
    {
      baseline: NormalizedTcgcContract;
      target: NormalizedTcgcContract;
      baselineVersion?: string;
      targetVersion?: string;
    }
  >();

  for (const project of manifest.projects ?? []) {
    const baselineArtifact = project.artifacts?.baseline?.tcgc ?? project.artifacts?.base?.tcgc;
    const targetArtifact = project.artifacts?.target?.tcgc ?? project.artifacts?.current?.tcgc;
    if (baselineArtifact?.status !== "succeeded" || targetArtifact?.status !== "succeeded") {
      continue;
    }
    try {
      contracts.set(project.id, {
        baseline: normalizeTcgcContract({ workRoot, artifact: baselineArtifact }),
        target: normalizeTcgcContract({ workRoot, artifact: targetArtifact }),
        baselineVersion: project.artifactComparison?.baseline?.apiVersion,
        targetVersion: project.artifactComparison?.target?.apiVersion,
      });
    } catch {
      // The downstream analyzer reports the concrete artifact blocker. Context policy stays conservative.
    }
  }

  for (const unit of semantic.reviewUnits) {
    const versionOnly = unit.changeTypes?.length === 1 && unit.changeTypes[0] === "versioning";
    const operations = versionOnly
      ? unit.operations.map((operation) =>
          carryOverOperation(operation, semantic.facts, contracts.get(unit.projectId)),
        )
      : [];
    const equivalentOperationIds = operations
      .filter(
        (operation) => operation.rest === "equivalent" && operation.downstream === "equivalent",
      )
      .map((operation) => operation.operationId)
      .sort();
    const restEquivalentOperationIds = operations
      .filter((operation) => operation.rest === "equivalent")
      .map((operation) => operation.operationId)
      .sort();
    const downstreamEquivalentOperationIds = operations
      .filter((operation) => operation.downstream === "equivalent")
      .map((operation) => operation.operationId)
      .sort();
    const differentOperationIds = operations
      .filter((operation) => operation.rest === "different" || operation.downstream === "different")
      .map((operation) => operation.operationId)
      .sort();
    const unknownOperationIds = operations
      .filter((operation) => operation.rest === "unknown" || operation.downstream === "unknown")
      .map((operation) => operation.operationId)
      .sort();
    unit.carryOverProof = {
      schemaVersion: 1,
      status:
        !versionOnly || !operations.length
          ? "not-applicable"
          : differentOperationIds.length || unknownOperationIds.length
            ? "partial"
            : "complete",
      operations,
      equivalentOperationIds,
      differentOperationIds,
      unknownOperationIds,
    };
    const restCarryOverComplete =
      versionOnly && operations.every((operation) => operation.rest === "equivalent");
    const downstreamCarryOverComplete =
      versionOnly && operations.every((operation) => operation.downstream === "equivalent");
    const informationalVersionIntent =
      unit.intentType === "api-version-publication" ||
      unit.intentType === "api-version-wide-change";
    if (informationalVersionIntent && restCarryOverComplete && downstreamCarryOverComplete) {
      unit.contextPolicy = {
        schemaVersion: 1,
        rest: {
          mode: "deterministic",
          reason: "informational-api-version-intent",
          evidenceIds: restEquivalentOperationIds,
        },
        downstream: {
          mode: "deterministic",
          reason: "informational-api-version-intent",
          evidenceIds: downstreamEquivalentOperationIds,
        },
        guidelines: {
          mode: "not-applicable",
          reason: "informational-api-version-intent",
        },
        documentation: {
          mode: "deterministic",
          reason: "compiler-effective-documentation-check",
        },
      };
      continue;
    }
    unit.contextPolicy = {
      schemaVersion: 1,
      rest: {
        mode: restCarryOverComplete ? "deterministic" : "agent",
        reason: restCarryOverComplete
          ? "verified-unchanged-rest-carry-over"
          : "changed-or-unresolved-rest-scope",
        evidenceIds: restEquivalentOperationIds,
      },
      downstream: {
        mode: downstreamCarryOverComplete ? "deterministic" : "agent",
        reason: downstreamCarryOverComplete
          ? "verified-unchanged-neutral-sdk-carry-over"
          : "changed-or-unresolved-downstream-scope",
        evidenceIds: downstreamEquivalentOperationIds,
      },
      guidelines: {
        mode: "agent",
        reason: versionOnly
          ? "version-event-remains-guidelines-eligible"
          : "changed-design-facts-require-guidelines-assessment",
      },
      documentation: {
        mode: "deterministic",
        reason: "compiler-effective-documentation-check",
      },
    };
  }
  return semantic;
}
