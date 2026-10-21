// Puts validated dashboard markup on the page. The DOM is built from the
// validator's own parse tree with createElement, never with innerHTML, so what
// was validated is exactly what is rendered.
import "./kit.js";
import { exampleRequest, parseMarkup, validateMarkup } from "./validate.js";

export { exampleRequest };

function build(node) {
  if (node.type === "text") return document.createTextNode(node.text);
  const el = document.createElement(node.tag);
  for (const attr of node.attrList) el.setAttribute(attr.name, attr.value);
  for (const child of node.children) el.append(build(child));
  return el;
}

// → { ok, problems, messages, changes, markup, root }. Nothing is rendered unless ok.
export function mountMarkup(host, markup, options = {}) {
  const result = validateMarkup(markup, options);
  if (!result.ok) return { ...result, root: null };
  const { nodes } = parseMarkup(result.markup);
  const root = build(nodes.find((node) => node.type === "el"));
  host.replaceChildren(root);
  return { ...result, root };
}
