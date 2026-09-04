import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkMermaidDefinition,
  MERMAID_CONFIG,
  FORBIDDEN_SVG_TAGS,
  FORBIDDEN_SVG_ATTRS,
  MAX_DIAGRAM_LENGTH,
} from "./diagram";

/**
 * Regression tests for H1. Mermaid was initialised with
 * `securityLevel: "loose"` and its rendered SVG was inserted with
 * `dangerouslySetInnerHTML`, so a model-generated (or document-steered)
 * diagram could reach script, navigation and external-resource sinks.
 */

const malicious = [
  ["script tag", 'flowchart TD\n  A["<script>alert(1)</script>"]'],
  ["img onerror", 'flowchart TD\n  A["<img src=x onerror=alert(1)>"]'],
  ["iframe", 'flowchart TD\n  A["<iframe src=https://evil.example></iframe>"]'],
  ["foreignObject", 'flowchart TD\n  A["<foreignObject><body onload=alert(1)>"]'],
  ["anchor", 'flowchart TD\n  A["<a href=javascript:alert(1)>x</a>"]'],
  ["click callback", "flowchart TD\n  A-->B\n  click A callback"],
  ["click href", 'flowchart TD\n  A-->B\n  click A href "https://evil.example"'],
  ["indented click", 'flowchart TD\n  A-->B\n    click A "https://evil.example"'],
  ["link directive", "flowchart TD\n  A-->B\nlink A https://evil.example"],
  ["javascript url", 'flowchart TD\n  A["javascript:alert(1)"]'],
  ["vbscript url", 'flowchart TD\n  A["vbscript:msgbox(1)"]'],
  ["data url", 'flowchart TD\n  A["data:text/html,<script>alert(1)</script>"]'],
  ["base64 data url", 'flowchart TD\n  A["data:;base64,PHN2Zz4="]'],
  ["event handler", 'flowchart TD\n  A["x" onclick="alert(1)"]'],
  ["animation event handler", 'flowchart TD\n  A["x" onbegin="alert(1)"]'],
  ["init directive", '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\n  A-->B'],
  ["html label directive", '%%{init: {"flowchart":{"htmlLabels":true}}}%%\nflowchart TD\n  A-->B'],
  ["html entity smuggling", "flowchart TD\n  A[&#106;avascript]"],
  ["css expression", 'flowchart TD\n  A["expression(alert(1))"]'],
  ["external resource", 'flowchart TD\n  A["url(https://evil.example/x.png)"]'],
  ["stylesheet import", 'flowchart TD\n  A["@import url(x)"]'],
  ["style tag", 'flowchart TD\n  A["<style>@import(1)</style>"]'],
] as const;

for (const [name, definition] of malicious) {
  test(`rejects ${name}`, () => {
    const result = checkMermaidDefinition(definition);
    assert.equal(result.ok, false, `accepted: ${definition}`);
    assert.ok(result.reason, "a rejection must explain itself");
  });
}

test("rejects a non-string or empty definition", () => {
  assert.equal(checkMermaidDefinition(null).ok, false);
  assert.equal(checkMermaidDefinition("").ok, false);
  assert.equal(checkMermaidDefinition("   ").ok, false);
});

test("rejects an oversized definition", () => {
  const huge = "flowchart TD\n" + "  A-->B\n".repeat(MAX_DIAGRAM_LENGTH);
  assert.equal(checkMermaidDefinition(huge).ok, false);
});

// --- Diagrams that must keep working -------------------------------------

const legitimate = [
  ["flowchart", "flowchart TD\n  A[Start] --> B[Process] --> C[End]"],
  ["bidirectional arrow", "flowchart LR\n  A <--> B"],
  ["class arrow", "classDiagram\n  Animal <|-- Duck"],
  ["comparison in a label", "flowchart TD\n  A[if x<y then swap] --> B[done]"],
  ["sequence", "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi"],
  ["mindmap", "mindmap\n  root((photosynthesis))\n    light\n    dark"],
  ["timeline", "timeline\n  title History\n  1969 : Moon landing"],
  ["prose mentioning JavaScript", "flowchart TD\n  A[JavaScript: a language] --> B[Compile]"],
  ["label containing only", "flowchart TD\n  A[only = 3] --> B[done]"],
  ["state diagram", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running"],
] as const;

for (const [name, definition] of legitimate) {
  test(`accepts ${name}`, () => {
    const result = checkMermaidDefinition(definition);
    assert.equal(result.ok, true, `rejected (${result.reason}): ${definition}`);
  });
}

// --- The sandbox settings themselves --------------------------------------

test("mermaid stays in strict mode with HTML labels disabled", () => {
  assert.equal(MERMAID_CONFIG.securityLevel, "strict");
  assert.equal(MERMAID_CONFIG.htmlLabels, false);
  assert.equal(MERMAID_CONFIG.flowchart.htmlLabels, false);
  assert.equal(MERMAID_CONFIG.startOnLoad, false);
});

test("the SVG deny-list covers every active-content sink", () => {
  for (const tag of ["script", "foreignObject", "iframe", "object", "embed", "a", "use", "image"]) {
    assert.ok(FORBIDDEN_SVG_TAGS.includes(tag), `missing tag: ${tag}`);
  }
  for (const attr of ["href", "xlink:href", "src", "formaction", "target"]) {
    assert.ok(FORBIDDEN_SVG_ATTRS.includes(attr), `missing attribute: ${attr}`);
  }
});
