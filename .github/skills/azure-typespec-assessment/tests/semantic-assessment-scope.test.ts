import { assert, test } from "vitest";
import {
  informationalIntentText,
  isApiVersionWideChangeIntent,
  isInformationalIntent,
  isInformationalPublicationIntent,
  partitionSemanticIntents,
  semanticIntentType,
  semanticGroupingPresentation,
} from "../scripts/semantic-assessment-scope.ts";

void test("presents accepted coarse file groups without claiming business coherence", () => {
  const grouping = semanticGroupingPresentation({
    id: "coarse-main",
    intentType: "normal",
    groupingEvidence: { reasons: ["source:main", "governance:api-version", "behavior:lro"] },
    changeTypes: ["operation", "type", "versioning"],
    changeFacts: [{ qualifiedName: "Versions" }, { qualifiedName: "StorageProperties" }],
  });
  assert.equal(grouping.label, "Feature / contract change");
  assert.equal(grouping.basis, "Source-file grouping");
  assert.match(grouping.notice ?? "", /not a standalone API-version publication/);
  assert.equal(
    semanticGroupingPresentation({
      id: "config",
      changeTypes: ["generation-configuration"],
      groupingEvidence: { reasons: ["feature:tspconfig.yaml"] },
    }).label,
    "Supporting change",
  );
  const dependency = semanticGroupingPresentation({
    id: "common-type",
    intentType: "api-version-wide-change",
    changeTypes: ["versioning"],
    changeFacts: [{ qualifiedName: "Versions" }],
  });
  assert.equal(dependency.label, "Shared dependency / version-wide change");
  assert.equal(dependency.notice, undefined);
});

function publicationUnit(operationCount = 20) {
  return {
    id: "semantic-publication",
    groupingEvidence: {
      reasons: ["governance:api-version", "publication"],
    },
    operations: Array.from({ length: operationCount }, (_, index) => ({
      operationId: `Widgets_${index}`,
      matchBasis: "version-transition-change",
    })),
  };
}

void test("does not let publication reasons or versioning labels override feature subjects", () => {
  const feature = {
    ...publicationUnit(0),
    declarationNames: ["Widget.name"],
    changeTypes: ["versioning"],
    changeFacts: [{ qualifiedName: "Widget.name" }],
  };
  assert.equal(semanticIntentType(feature), "normal");
  assert.equal(
    semanticIntentType({
      ...feature,
      declarationNames: ["Versions"],
      changeFacts: [{ qualifiedName: "Versions" }],
    }),
    "api-version-publication",
  );
  assert.equal(
    semanticIntentType({
      ...feature,
      declarationNames: ["Versions", "Widget.name"],
      changeFacts: [{ qualifiedName: "Versions" }, { qualifiedName: "Widget.name" }],
    }),
    "normal",
  );
});

void test("keeps a version publication assessed when Guidelines still require Agent judgment", () => {
  const publication = {
    ...publicationUnit(),
    contextPolicy: {
      rest: { mode: "deterministic" },
      downstream: { mode: "deterministic" },
      guidelines: { mode: "agent" },
      documentation: { mode: "deterministic" },
    },
  };
  const assessed = {
    id: "semantic-model-change",
    groupingEvidence: { reasons: ["feature:Widget"] },
    operations: [
      {
        operationId: "Widgets_Update",
        matchBasis: "compiler-reference",
      },
    ],
  };

  assert.equal(isInformationalPublicationIntent(publication), false);
  assert.deepEqual(partitionSemanticIntents([publication, assessed]), {
    assessed: [publication, assessed],
    informational: [],
  });
  assert.match(
    informationalIntentText(publication).summary,
    /20 verified unchanged operation pairs/,
  );
});

void test("uses dimension-specific policy rather than a version-wide blanket exclusion", () => {
  const versionWide = {
    id: "semantic-version-wide",
    declarationNames: ["Versions"],
    ownedOperationIds: [],
    operations: Array.from({ length: 2 }, (_, index) => ({
      operationId: `Widgets_${index}`,
      matchBasis: "version-transition-change",
    })),
    contextPolicy: {
      rest: { mode: "deterministic" },
      downstream: { mode: "deterministic" },
      guidelines: { mode: "agent" },
      documentation: { mode: "deterministic" },
    },
  };
  const normal = {
    ...versionWide,
    id: "semantic-normal",
    declarationNames: ["Widgets"],
  };

  assert.equal(isInformationalPublicationIntent(versionWide), false);
  assert.equal(isApiVersionWideChangeIntent(versionWide), true);
  assert.equal(isInformationalIntent(versionWide), false);
  assert.equal(semanticIntentType(versionWide), "api-version-wide-change");
  assert.equal(isInformationalIntent(normal), false);
  assert.match(informationalIntentText(versionWide).summary, /2 affected operations/);
});

void test("allows informational presentation only when every dimension is deterministic", () => {
  const publication = {
    ...publicationUnit(3),
    contextPolicy: {
      rest: { mode: "deterministic" },
      downstream: { mode: "deterministic" },
      guidelines: { mode: "not-applicable" },
      documentation: { mode: "deterministic" },
    },
  };

  assert.equal(isInformationalIntent(publication), true);
  assert.equal(isInformationalPublicationIntent(publication), true);
  assert.deepEqual(partitionSemanticIntents([publication]), {
    assessed: [],
    informational: [publication],
  });
});
