import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assert, test, type TestContext } from "vitest";
import { applySemanticContextPolicy } from "../scripts/semantic-context-policy.ts";

const tcgc = (version: string) => `
crossLanguagePackageId: Contoso
crossLanguageVersion: "1.0"
metadata:
  apiVersions:
    Contoso: ${version}
clients:
  - kind: client
    name: Widgets
    crossLanguageDefinitionId: Contoso.Widgets
    methods:
      - kind: basic
        name: get
        access: public
        crossLanguageDefinitionId: Contoso.Widgets.get
        parameters:
          - kind: method
            name: apiVersion
            optional: false
            onClient: true
            isApiVersionParam: true
            type:
              kind: constant
              value: ${version}
              valueType: { kind: string }
        response: { kind: string }
        operation:
          kind: http
          path: /widgets/{id}
          verb: get
          parameters: []
`;

type MethodFixture = {
  name: string;
  path: string;
  kind?: "basic" | "paging" | "lro" | "lropaging";
  responseModel?: string;
  paging?: boolean;
};

function tcgcFixture(version: string, methods: MethodFixture[], models: string = "models: []") {
  const methodYaml = methods
    .map(
      ({ name, path: route, kind = "basic", responseModel, paging }) => `
      - kind: ${kind}
        name: ${name}
        access: public
        crossLanguageDefinitionId: Contoso.Widgets.${name}
        parameters:
          - kind: method
            name: apiVersion
            optional: false
            onClient: true
            isApiVersionParam: true
            type:
              kind: constant
              value: ${version}
              valueType: { kind: string }
        response:
          type: ${
            responseModel
              ? `{ kind: model, name: ${responseModel}, crossLanguageDefinitionId: Contoso.${responseModel} }`
              : "{ kind: string }"
          }
        ${
          paging
            ? "pagingMetadata:\n          pageItemsSegments: [value]\n          nextLinkSegments: [nextLink]"
            : ""
        }
        operation:
          kind: http
          path: ${route}
          verb: get
          parameters: []
`,
    )
    .join("");
  return `
crossLanguagePackageId: Contoso
crossLanguageVersion: "1.0"
metadata:
  apiVersions:
    Contoso: ${version}
clients:
  - kind: client
    name: Widgets
    crossLanguageDefinitionId: Contoso.Widgets
    methods:${methodYaml}
${models}
enums: []
unions: []
`;
}

function evaluatePolicy(
  context: TestContext,
  baselineYaml: string,
  targetYaml: string,
  operations: { operationId: string; path: string; restChanged?: boolean }[],
  intentType?: "api-version-wide-change",
) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-context-policy-"));
  context.onTestFinished(() => fs.rmSync(work, { recursive: true, force: true }));
  fs.writeFileSync(path.join(work, "baseline.yaml"), baselineYaml);
  fs.writeFileSync(path.join(work, "target.yaml"), targetYaml);
  const facts = Object.fromEntries(
    operations.flatMap(({ operationId, path: route }, index) => [
      [
        `before-${index}`,
        {
          id: `before-${index}`,
          projectId: "widgets",
          operationId,
          method: "get",
          path: route,
        },
      ],
      [
        `after-${index}`,
        {
          id: `after-${index}`,
          projectId: "widgets",
          operationId,
          method: "get",
          path: route,
        },
      ],
    ]),
  );
  const semantic = {
    schemaVersion: 1,
    status: "ready",
    facts,
    reviewUnits: [
      {
        id: "semantic-version",
        projectId: "widgets",
        intentType,
        sourceChangeIds: ["source-version"],
        hunkIds: ["hunk-version"],
        declarationIds: ["versions"],
        declarationNames: ["Versions"],
        ownedOperationIds: [],
        operations: operations.map(({ operationId }, index) => ({
          operationId,
          beforeFactId: `before-${index}`,
          afterFactId: `after-${index}`,
          restChanged: operations[index].restChanged ?? false,
          matchBasis: "version-transition-change",
          sourceChangeIds: ["source-version"],
          hunkIds: ["hunk-version"],
          declarationIds: ["versions"],
        })),
        operationIds: operations.map((_, index) => `after-${index}`),
        beforeFactIds: operations.map((_, index) => `before-${index}`),
        afterFactIds: operations.map((_, index) => `after-${index}`),
        changedAspects: [],
        changeTypes: ["versioning"],
      },
    ],
    blockers: [],
  };
  applySemanticContextPolicy({
    manifest: {
      projects: [
        {
          id: "widgets",
          artifactComparison: {
            baseline: { apiVersion: "2025-01-01" },
            target: { apiVersion: "2026-01-01" },
          },
          artifacts: {
            baseline: {
              tcgc: {
                status: "succeeded",
                format: "tcgc-yaml",
                files: [{ path: "baseline.yaml" }],
              },
            },
            target: {
              tcgc: {
                status: "succeeded",
                format: "tcgc-yaml",
                files: [{ path: "target.yaml" }],
              },
            },
          },
        },
      ],
    } as never,
    workRoot: work,
    semantic: semantic as never,
  });
  return semantic.reviewUnits[0] as never as {
    carryOverProof: {
      status: string;
      equivalentOperationIds: string[];
      differentOperationIds: string[];
      unknownOperationIds: string[];
    };
    contextPolicy: {
      rest: { mode: string };
      downstream: { mode: string };
      guidelines: { mode: string };
    };
  };
}

void test("proves unchanged operation carry-over while retaining Guidelines judgment", (context) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-context-policy-"));
  context.onTestFinished(() => fs.rmSync(work, { recursive: true, force: true }));
  fs.writeFileSync(path.join(work, "baseline.yaml"), tcgc("2025-01-01"));
  fs.writeFileSync(path.join(work, "target.yaml"), tcgc("2026-01-01"));

  const manifest = {
    projects: [
      {
        id: "widgets",
        path: "specification/widgets",
        sourceChangeIds: ["source-version"],
        artifactComparison: {
          mode: "new-api-version",
          baseline: { apiVersion: "2025-01-01" },
          target: { apiVersion: "2026-01-01" },
        },
        artifacts: {
          baseline: {
            tcgc: {
              status: "succeeded",
              format: "tcgc-yaml",
              files: [{ path: "baseline.yaml" }],
            },
          },
          target: {
            tcgc: {
              status: "succeeded",
              format: "tcgc-yaml",
              files: [{ path: "target.yaml" }],
            },
          },
        },
      },
    ],
  };
  const semantic = {
    schemaVersion: 1,
    status: "ready",
    facts: {
      before: {
        id: "before",
        projectId: "widgets",
        method: "get",
        path: "/widgets/{id}",
      },
      after: {
        id: "after",
        projectId: "widgets",
        method: "get",
        path: "/widgets/{id}",
      },
    },
    reviewUnits: [
      {
        id: "semantic-version",
        projectId: "widgets",
        sourceChangeIds: ["source-version"],
        hunkIds: ["hunk-version"],
        declarationIds: ["versions"],
        declarationNames: ["Versions"],
        ownedOperationIds: [],
        operations: [
          {
            operationId: "Widgets_Get",
            beforeFactId: "before",
            afterFactId: "after",
            restChanged: false,
            matchBasis: "version-transition-change",
            sourceChangeIds: ["source-version"],
            hunkIds: ["hunk-version"],
            declarationIds: ["versions"],
          },
        ],
        operationIds: ["after"],
        beforeFactIds: ["before"],
        afterFactIds: ["after"],
        changedAspects: [],
        changeTypes: ["versioning"],
      },
    ],
    blockers: [],
  };

  applySemanticContextPolicy({
    manifest: manifest as never,
    workRoot: work,
    semantic: semantic as never,
  });

  const unit = semantic.reviewUnits[0] as never as {
    carryOverProof: {
      status: string;
      equivalentOperationIds: string[];
    };
    contextPolicy: {
      rest: { mode: string };
      downstream: { mode: string };
      guidelines: { mode: string };
    };
  };
  assert.equal(unit.carryOverProof.status, "complete");
  assert.deepEqual(unit.carryOverProof.equivalentOperationIds, ["Widgets_Get"]);
  assert.equal(unit.contextPolicy.rest.mode, "deterministic");
  assert.equal(unit.contextPolicy.downstream.mode, "deterministic");
  assert.equal(unit.contextPolicy.guidelines.mode, "agent");
});

void test("keeps downstream context when TCGC proof is unavailable", () => {
  const semantic = {
    schemaVersion: 1,
    status: "ready",
    facts: {
      before: { id: "before", method: "get", path: "/widgets" },
      after: { id: "after", method: "get", path: "/widgets" },
    },
    reviewUnits: [
      {
        id: "semantic-version",
        projectId: "widgets",
        changeTypes: ["versioning"],
        operations: [
          {
            operationId: "Widgets_Get",
            beforeFactId: "before",
            afterFactId: "after",
            restChanged: false,
          },
        ],
      },
    ],
    blockers: [],
  };

  applySemanticContextPolicy({
    manifest: { projects: [] } as never,
    workRoot: process.cwd(),
    semantic: semantic as never,
  });

  const unit = semantic.reviewUnits[0] as never as {
    carryOverProof: { status: string; unknownOperationIds: string[] };
    contextPolicy: { downstream: { mode: string } };
  };
  assert.equal(unit.carryOverProof.status, "partial");
  assert.deepEqual(unit.carryOverProof.unknownOperationIds, ["Widgets_Get"]);
  assert.equal(unit.contextPolicy.downstream.mode, "agent");
});

void test("assesses API-version publication intents when carry-over is unresolved", () => {
  const semantic = {
    schemaVersion: 1,
    status: "ready",
    facts: {
      before: { id: "before", method: "post", path: "/widgets/{id}/start" },
      after: { id: "after", method: "post", path: "/widgets/{id}/start" },
    },
    reviewUnits: [
      {
        id: "semantic-publication",
        projectId: "widgets",
        intentType: "api-version-publication",
        changeTypes: ["versioning"],
        operations: [
          {
            operationId: "Widgets_Start",
            beforeFactId: "before",
            afterFactId: "after",
            restChanged: true,
          },
        ],
      },
    ],
    blockers: [],
  };

  applySemanticContextPolicy({
    manifest: { projects: [] } as never,
    workRoot: process.cwd(),
    semantic: semantic as never,
  });

  const unit = semantic.reviewUnits[0] as never as {
    contextPolicy: {
      rest: { mode: string };
      downstream: { mode: string };
      guidelines: { mode: string };
    };
  };
  assert.equal(unit.contextPolicy.rest.mode, "agent");
  assert.equal(unit.contextPolicy.downstream.mode, "agent");
  assert.equal(unit.contextPolicy.guidelines.mode, "agent");
});

void test("assesses REST but skips downstream for a version-wide REST-only change", (context) => {
  const unit = evaluatePolicy(
    context,
    tcgcFixture("2025-01-01", [{ name: "get", path: "/widgets/{id}" }]),
    tcgcFixture("2026-01-01", [{ name: "get", path: "/widgets/{id}" }]),
    [{ operationId: "Widgets_Get", path: "/widgets/{id}", restChanged: true }],
    "api-version-wide-change",
  );

  assert.equal(unit.carryOverProof.status, "partial");
  assert.deepEqual(unit.carryOverProof.differentOperationIds, ["Widgets_Get"]);
  assert.equal(unit.contextPolicy.rest.mode, "agent");
  assert.equal(unit.contextPolicy.downstream.mode, "deterministic");
  assert.equal(unit.contextPolicy.guidelines.mode, "agent");
});

void test("detects paging and LRO method-shape changes", (context) => {
  for (const kind of ["paging", "lro"] as const) {
    const unit = evaluatePolicy(
      context,
      tcgcFixture("2025-01-01", [{ name: "get", path: "/widgets/{id}" }]),
      tcgcFixture("2026-01-01", [
        {
          name: "get",
          path: "/widgets/{id}",
          kind,
          paging: kind === "paging",
        },
      ]),
      [{ operationId: `Widgets_Get_${kind}`, path: "/widgets/{id}" }],
    );
    assert.equal(unit.carryOverProof.status, "partial");
    assert.deepEqual(unit.carryOverProof.differentOperationIds, [`Widgets_Get_${kind}`]);
    assert.equal(unit.contextPolicy.downstream.mode, "agent");
  }
});

void test("detects reachable model property changes behind an unchanged route", (context) => {
  const baselineModels = `models:
  - kind: model
    name: Widget
    crossLanguageDefinitionId: Contoso.Widget
    properties:
      - kind: property
        name: address
        optional: true
        discriminator: false
        type: { kind: string }`;
  const targetModels = baselineModels.replace("optional: true", "optional: false");
  const unit = evaluatePolicy(
    context,
    tcgcFixture(
      "2025-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Widget" }],
      baselineModels,
    ),
    tcgcFixture(
      "2026-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Widget" }],
      targetModels,
    ),
    [{ operationId: "Widgets_Get", path: "/widgets/{id}" }],
  );
  assert.deepEqual(unit.carryOverProof.differentOperationIds, ["Widgets_Get"]);
});

void test("handles cyclic reachable models conservatively and deterministically", (context) => {
  const cyclicModels = `models:
  - &widget
    kind: model
    name: Widget
    crossLanguageDefinitionId: Contoso.Widget
    properties:
      - kind: property
        name: child
        optional: true
        discriminator: false
        type: *widget`;
  const unit = evaluatePolicy(
    context,
    tcgcFixture(
      "2025-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Widget" }],
      cyclicModels,
    ),
    tcgcFixture(
      "2026-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Widget" }],
      cyclicModels,
    ),
    [{ operationId: "Widgets_Get", path: "/widgets/{id}" }],
  );
  assert.equal(unit.carryOverProof.status, "complete");
  assert.deepEqual(unit.carryOverProof.equivalentOperationIds, ["Widgets_Get"]);
});

void test("leaves ambiguous route matches unresolved", (context) => {
  const methods = [
    { name: "get", path: "/widgets/{id}" },
    { name: "getByName", path: "/widgets/{id}" },
  ];
  const unit = evaluatePolicy(
    context,
    tcgcFixture("2025-01-01", methods),
    tcgcFixture("2026-01-01", methods),
    [{ operationId: "Widgets_Get", path: "/widgets/{id}" }],
  );
  assert.deepEqual(unit.carryOverProof.unknownOperationIds, ["Widgets_Get"]);
  assert.equal(unit.contextPolicy.downstream.mode, "agent");
});

void test("preserves nominal type identity in carry-over proof", (context) => {
  const models = (name: string) => `models:
  - kind: model
    name: ${name}
    crossLanguageDefinitionId: Contoso.${name}
    properties:
      - kind: property
        name: value
        optional: true
        discriminator: false
        type: { kind: string }`;
  const unit = evaluatePolicy(
    context,
    tcgcFixture(
      "2025-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Widget" }],
      models("Widget"),
    ),
    tcgcFixture(
      "2026-01-01",
      [{ name: "get", path: "/widgets/{id}", responseModel: "Gadget" }],
      models("Gadget"),
    ),
    [{ operationId: "Widgets_Get", path: "/widgets/{id}" }],
  );
  assert.deepEqual(unit.carryOverProof.differentOperationIds, ["Widgets_Get"]);
});

void test("reuses shared reachable type evidence across carried operations", (context) => {
  const models = `models:
  - kind: model
    name: Widget
    crossLanguageDefinitionId: Contoso.Widget
    properties:
      - kind: property
        name: value
        optional: true
        discriminator: false
        type: { kind: string }`;
  const methods = [
    { name: "get", path: "/widgets/{id}", responseModel: "Widget" },
    { name: "list", path: "/widgets", responseModel: "Widget" },
  ];
  const unit = evaluatePolicy(
    context,
    tcgcFixture("2025-01-01", methods, models),
    tcgcFixture("2026-01-01", methods, models),
    [
      { operationId: "Widgets_Get", path: "/widgets/{id}" },
      { operationId: "Widgets_List", path: "/widgets" },
    ],
  );
  assert.equal(unit.carryOverProof.status, "complete");
  assert.deepEqual(unit.carryOverProof.equivalentOperationIds, ["Widgets_Get", "Widgets_List"]);
});
