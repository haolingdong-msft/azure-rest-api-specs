import { assert, test } from "vitest";
import {
  attachSemanticChangeFacts,
  deriveSemanticChangeFacts,
  isVersionGovernanceOnly,
} from "../scripts/semantic-change-facts.ts";

type SourceIndex = import("../scripts/runtime-types.ts").SourceIndex;

void test("derives versioning and model-property facts without treating the whole hunk as publication", () => {
  const sourceIndex: SourceIndex = {
    schemaVersion: 1,
    analysis: {
      status: "ready",
      authority: "typespec-compiler",
      blockers: [],
    },
    sourceChanges: [
      {
        id: "source-main",
        path: "specification/widgets/main.tsp",
        status: "modified",
        origins: ["committed"],
        hunks: [
          {
            id: "hunk-version",
            base: { startLine: 1, endLine: 1 },
            current: { startLine: 1, endLine: 2 },
            lines: ['+v2026_01_01: "2026-01-01",'],
          },
          {
            id: "hunk-property",
            base: { startLine: 5, endLine: 5 },
            current: { startLine: 5, endLine: 5 },
            lines: ["-name?: string;", "+name: string;"],
          },
        ],
        declarations: [
          {
            id: "versions-current",
            kind: "enum",
            qualifiedName: "Versions",
            decorators: [],
            versionedMembers: [],
            hunkIds: ["hunk-version"],
            source: { revision: "current", startLine: 1, endLine: 3 },
          },
          {
            id: "property-base",
            kind: "model-property",
            qualifiedName: "Widget.name",
            decorators: [],
            versionedMembers: [],
            hunkIds: ["hunk-property"],
            source: { revision: "base", startLine: 5, endLine: 5 },
          },
          {
            id: "property-current",
            kind: "model-property",
            qualifiedName: "Widget.name",
            decorators: [],
            versionedMembers: [],
            hunkIds: ["hunk-property"],
            source: { revision: "current", startLine: 5, endLine: 5 },
          },
        ],
      },
    ],
  };
  const unit = {
    id: "semantic-main",
    projectId: "widgets",
    sourceChangeIds: ["source-main"],
    hunkIds: ["hunk-version", "hunk-property"],
    declarationIds: ["versions-current", "property-base", "property-current"],
    declarationNames: ["Versions", "Widget.name"],
    ownedOperationIds: [],
    operations: [],
    operationIds: [],
    beforeFactIds: [],
    afterFactIds: [],
    changedAspects: [],
  };

  const facts = deriveSemanticChangeFacts(unit, sourceIndex);

  assert.deepEqual(
    facts
      .map((fact) => ({
        changeType: fact.changeType,
        qualifiedName: fact.qualifiedName,
        action: fact.action,
      }))
      .sort((left, right) => String(left.qualifiedName).localeCompare(String(right.qualifiedName))),
    [
      { changeType: "versioning", qualifiedName: "Versions", action: "add" },
      { changeType: "type", qualifiedName: "Widget.name", action: "modify" },
    ],
  );
  assert.include(
    facts.find((fact) => fact.qualifiedName === "Widget.name")?.facets ?? [],
    "optionality",
  );

  const attached = attachSemanticChangeFacts(unit, sourceIndex);
  assert.equal(attached.classificationVersion, 3);
  assert.deepEqual(attached.changeTypes, ["type", "versioning"]);
});

void test("keeps version-decorated feature subjects primary without leaking neighboring facets", () => {
  const source: SourceIndex["sourceChanges"][number] = {
    id: "source-feature",
    path: "specification/widgets/models.tsp",
    status: "modified",
    origins: ["committed"],
    hunks: [
      {
        id: "hunk-feature",
        base: { startLine: 1, endLine: 1 },
        current: { startLine: 1, endLine: 10 },
        lines: [
          '+@added(Versions.vNext)',
          '+model Allocation {',
          '+  size?: string;',
          '+}',
          '+@removed(Versions.vNext)',
          '+model PreviewOnly {}',
          '+@madeRequired(Versions.vNext)',
          '+name: string;',
          '+@added(Versions.vNext)',
          '+op refresh(): void;',
        ],
      },
    ],
    declarations: [
      { name: "Allocation", kind: "model", start: 1, end: 4 },
      { name: "Allocation.size", kind: "property", start: 3, end: 3 },
      { name: "PreviewOnly", kind: "model", start: 5, end: 6 },
      { name: "Widget.name", kind: "property", start: 7, end: 8 },
      { name: "Widgets.refresh", kind: "operation", start: 9, end: 10 },
    ].map(({ name, kind, start, end }) => ({
      id: name,
      qualifiedName: name,
      kind,
      decorators: [],
      versionedMembers: [],
      hunkIds: ["hunk-feature"],
      source: { revision: "current", startLine: start, endLine: end },
    })),
  };
  const unit = {
    id: "semantic-feature",
    projectId: "widgets",
    sourceChangeIds: [source.id],
    hunkIds: ["hunk-feature"],
    declarationIds: source.declarations.map((declaration) => declaration.id),
    declarationNames: source.declarations.map((declaration) => declaration.qualifiedName),
    ownedOperationIds: [],
    operations: [],
    operationIds: [],
    beforeFactIds: [],
    afterFactIds: [],
    changedAspects: ["responses"],
  };
  const attached = attachSemanticChangeFacts(unit, {
    schemaVersion: 1,
    analysis: { status: "ready", authority: "typespec-compiler", blockers: [] },
    sourceChanges: [source],
  });
  const facts = new Map(attached.changeFacts?.map((fact) => [fact.qualifiedName, fact]));
  assert.equal(facts.get("Allocation")?.changeType, "type");
  assert.equal(facts.get("PreviewOnly")?.changeType, "type");
  assert.equal(facts.get("Widgets.refresh")?.changeType, "operation");
  assert.include(facts.get("Allocation")?.facets ?? [], "version-activation");
  assert.notInclude(facts.get("Allocation.size")?.facets ?? [], "version-activation");
  assert.notInclude(facts.get("Widget.name")?.facets ?? [], "version-activation");
  assert.include(facts.get("Widget.name")?.facets ?? [], "requiredness");
  assert.notInclude(facts.get("Allocation")?.facets ?? [], "responses");
  assert.include(facts.get("Widgets.refresh")?.facets ?? [], "responses");
  assert.equal(isVersionGovernanceOnly(attached), false);
  assert.deepEqual(attached.hunkIds, ["hunk-feature"]);
});

void test("does not accept a versioning label on a feature as publication proof", () => {
  const unit = {
    id: "semantic-feature",
    projectId: "widgets",
    sourceChangeIds: [],
    hunkIds: [],
    declarationIds: [],
    declarationNames: ["Widget.name"],
    ownedOperationIds: [],
    operations: [],
    operationIds: [],
    beforeFactIds: [],
    afterFactIds: [],
    changedAspects: [],
    changeFacts: [
      {
        id: "change-feature",
        sourceChangeId: "source-feature",
        hunkIds: [],
        declarationIds: [],
        beforeDeclarationIds: [],
        afterDeclarationIds: [],
        changeType: "versioning" as const,
        qualifiedName: "Widget.name",
        action: "modify" as const,
        facets: ["version-activation"],
        evidenceRef: {
          artifact: "source/source-index.json" as const,
          sourceChangeId: "source-feature",
          hunkIds: [],
          declarationIds: [],
        },
      },
    ],
  };
  assert.equal(isVersionGovernanceOnly(unit), false);
});
