/**
 * Trust boundary for model-generated diagrams.
 *
 * A Mermaid definition arrives from the LLM and can be steered by an uploaded
 * document, so it is untrusted input all the way to the DOM. Two independent
 * controls apply, because either one alone has been bypassed before in real
 * products:
 *
 *  1. `checkMermaidDefinition` rejects a definition whose *source* contains
 *     anything that could only be there to reach an active-content sink —
 *     raw HTML tags, `click` interaction directives, script-ish URLs, event
 *     handler attributes, config directives that could re-open the sandbox.
 *     This is a pure string function so it is exhaustively testable.
 *
 *  2. `sanitizeDiagramSvg` runs the *rendered* SVG through DOMPurify with an
 *     explicit deny list on top of its SVG profile, so anything the first
 *     check did not anticipate still cannot execute.
 *
 * Mermaid itself is additionally initialised with `securityLevel: "strict"`
 * and HTML labels disabled (see MERMAID_CONFIG), which is what makes step 2's
 * `foreignObject` ban safe to apply — labels render as SVG <text> instead.
 */

/** Longest accepted diagram source. Real diagrams are far smaller. */
export const MAX_DIAGRAM_LENGTH = 8000;

export interface DiagramCheck {
  ok: boolean;
  /** Why the definition was refused; safe to show a learner. */
  reason?: string;
}

/**
 * Patterns that have no legitimate place in a Mermaid definition. Each is
 * paired with the message shown when it matches, so a rejection is
 * explainable rather than a blank panel.
 */
const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // A raw markup tag by name. Deliberately not "any `<` followed by a
  // letter": Mermaid labels legitimately contain comparisons like `if x<y`,
  // and rejecting those would break ordinary maths diagrams for no gain,
  // since securityLevel:"strict" escapes label markup anyway.
  {
    pattern: /<\s*\/?\s*(script|iframe|object|embed|foreignobject|svg|img|image|a|style|link|meta|base|form|input|animate|set)\b/i,
    reason: "diagram contains raw HTML markup",
  },
  // Mermaid's interaction directives bind JavaScript callbacks or links to
  // nodes. Nothing generated should ever need them.
  { pattern: /(^|[\r\n])\s*click\s+/i, reason: "diagram contains a click interaction" },
  { pattern: /(^|[\r\n])\s*(link|callback)\s+/i, reason: "diagram contains a link directive" },
  // Script-capable URL schemes. The `[^\s]` guard keeps prose such as
  // "JavaScript: a language" in a node label from being treated as a URL,
  // while `javascript:alert(1)` still matches.
  { pattern: /javascript\s*:\S/i, reason: "diagram contains a javascript: URL" },
  { pattern: /vbscript\s*:\S/i, reason: "diagram contains a vbscript: URL" },
  { pattern: /\bdata\s*:[a-z0-9+.-]*[/;]/i, reason: "diagram contains a data: URL" },
  // Inline event handlers. Matched against the real handler names rather
  // than `on\w+=`, which would also catch a label like "only = 3".
  {
    pattern: /\bon(click|error|load|mouse[a-z]+|focus|blur|begin|end|repeat|key[a-z]+|animation[a-z]+|toggle|submit|change|input|wheel|scroll|drag[a-z]*|copy|paste|cut)\s*=/i,
    reason: "diagram contains an event handler",
  },
  // `%%{init: ...}%%` can re-configure Mermaid mid-definition. Even though
  // securityLevel is protected from directive override, htmlLabels and theme
  // CSS are not, so directives are refused outright.
  { pattern: /%%\{/, reason: "diagram contains a configuration directive" },
  // HTML entities are only ever used here to smuggle one of the above past a
  // literal match.
  { pattern: /&#/, reason: "diagram contains escaped markup" },
  // CSS that can fetch or execute.
  { pattern: /expression\s*\(/i, reason: "diagram contains a CSS expression" },
  { pattern: /url\s*\(/i, reason: "diagram contains an external resource reference" },
  { pattern: /@import/i, reason: "diagram contains a stylesheet import" },
];

/**
 * Decides whether a Mermaid definition may be rendered at all.
 * Pure and side-effect free: nothing in `definition` is executed or parsed
 * as markup here.
 */
export function checkMermaidDefinition(definition: unknown): DiagramCheck {
  if (typeof definition !== "string") {
    return { ok: false, reason: "diagram is missing" };
  }
  const trimmed = definition.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "diagram is empty" };
  }
  if (trimmed.length > MAX_DIAGRAM_LENGTH) {
    return { ok: false, reason: `diagram is too large (limit ${MAX_DIAGRAM_LENGTH} characters)` };
  }
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) return { ok: false, reason };
  }
  return { ok: true };
}

/**
 * Mermaid runtime configuration. Exported so a test can assert the sandbox is
 * still closed — these three settings are what make the rendered output safe
 * to insert, and a future "make the diagrams prettier" change must not quietly
 * loosen them.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "neutral",
  /** strict = HTML in labels is escaped and click handlers are disabled. */
  securityLevel: "strict",
  /** Labels render as SVG <text>, so foreignObject can be banned outright. */
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  /** Bounds the work a hostile definition can ask the layout engine for. */
  maxTextSize: MAX_DIAGRAM_LENGTH,
  maxEdges: 200,
} as const;

/**
 * Elements removed from rendered SVG regardless of DOMPurify's SVG profile.
 * `a` and `use`/`image` are here because they navigate or fetch; the
 * animation elements can drive attribute values over time, which has been
 * used to reach otherwise-blocked attributes.
 */
export const FORBIDDEN_SVG_TAGS = Object.freeze([
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "a",
  "use",
  "image",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "handler",
  "listener",
]);

/**
 * Attributes removed regardless of profile. Every link attribute is dropped
 * (no navigation from a generated diagram at all) along with the attributes
 * that name a target for animation or external content.
 */
export const FORBIDDEN_SVG_ATTRS = Object.freeze([
  "href",
  "xlink:href",
  "xlink:show",
  "xlink:actuate",
  "src",
  "formaction",
  "action",
  "target",
  "ping",
  "attributename",
  "attributetype",
  "values",
  "from",
  "to",
  "by",
  "begin",
  "end",
]);

/**
 * Second-line sanitiser for rendered SVG, applied immediately before the
 * string reaches the DOM. Browser-only: it needs a DOM to parse into.
 */
export async function sanitizeDiagramSvg(svg: string): Promise<string> {
  const DOMPurify = (await import("dompurify")).default;
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
    FORBID_ATTR: [...FORBIDDEN_SVG_ATTRS],
    // Keeps `<svg>` as the root of the returned fragment rather than
    // unwrapping it into a document.
    ALLOWED_NAMESPACES: ["http://www.w3.org/2000/svg", "http://www.w3.org/1998/Math/MathML"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOW_DATA_ATTR: false,
  });
}
