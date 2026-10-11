import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";
import { marked } from "marked";
import type { Source } from "./types";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "ul", "ol", "li", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td",
];

/**
 * Renders model output as inert markup: Markdown → sanitized HTML (no attributes), then
 * citation markers become buttons carrying only a numeric data attribute, then KaTeX.
 */
export function renderAnswer(container: HTMLElement, text: string, sources: Source[], label: (source: Source) => string) {
  container.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, async: false }), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
  });
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (!/\[\d+\]/.test(node.textContent ?? "")) continue;
    const fragment = document.createDocumentFragment();
    for (const part of (node.textContent ?? "").split(/(\[\d+\])/g)) {
      const match = /^\[(\d+)\]$/.exec(part);
      const source = match && sources.find((item) => item.id === Number(match[1]));
      if (source) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "citation";
        button.dataset.cite = String(source.id);
        button.textContent = String(source.id);
        button.title = label(source);
        fragment.append(button);
      } else fragment.append(document.createTextNode(part));
    }
    node.replaceWith(fragment);
  }
  renderMathInElement(container, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
  });
}
