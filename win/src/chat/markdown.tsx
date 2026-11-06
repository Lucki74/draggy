/* Shared plugin lists and component maps, not a hot-reloaded component module. */
/* eslint-disable react-refresh/only-export-components */
import React from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { visit } from "unist-util-visit";
import type { Node as UnistNode, Parent as UnistParent } from "unist";
import { MarkdownBlockquote } from "./MarkdownAlert";
import { MarkdownCode } from "./CodeBlock";
import { CiteChip } from "./CiteChip";

/** How a reply is rendered. rehypeSanitize sits between rehypeRaw and the page, and that order
 * is all that stops HTML a model wrote from running. */

interface InlineMathNode extends UnistNode {
  value: string;
}

function remarkFixCurrencyMath() {
  return (tree: UnistNode) => {
    visit(
      tree,
      "inlineMath",
      (node: InlineMathNode, index, parent: UnistParent | undefined) => {
        if (typeof index !== "number" || !parent) return;
        const val = node.value;
        if (
          /^\d/.test(val) &&
          val.includes(" ") &&
          !/[\\^_=+\-*/<>|(){}[\]]/.test(val)
        ) {
          parent.children[index] = {
            type: "text",
            value: `$${val}$`,
          } as UnistNode;
        }
      },
    );
  };
}

export const DOCUMENT_REMARK_PLUGINS = [
  remarkGfm,
  remarkMath,
  remarkFixCurrencyMath,
];

export const REMARK_PLUGINS = [
  remarkGfm,
  remarkMath,
  remarkFixCurrencyMath,
  remarkBreaks,
];

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "style", "align"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data", "blob", "draggy", "app", "https", "http"],
  },
};

interface HastText extends UnistNode {
  value: string;
}
interface HastElement extends UnistParent {
  tagName?: string;
  properties?: { className?: string[] };
}

// Only note ids become chips: a bare [1] may be a footnote or an array index.
const CITE_MARK = /\[(n\d+)\]/g;
const NO_CITE = new Set(["code", "pre", "a"]);

/** Wraps "[n3]" and "[2]" in a draggy-cite element. Without a research run the chip prints the text back. */
function rehypeCitations() {
  return (tree: UnistNode) => {
    visit(tree, "text", (node: HastText, index, parent: UnistParent | undefined) => {
      if (typeof index !== "number" || !parent || !node.value.includes("[")) return;
      const host = parent as HastElement;
      if (host.tagName && (NO_CITE.has(host.tagName) || host.properties?.className?.includes("katex"))) return;
      const pieces: UnistNode[] = [];
      let last = 0;
      for (const match of node.value.matchAll(CITE_MARK)) {
        if (match.index > last) pieces.push({ type: "text", value: node.value.slice(last, match.index) } as HastText);
        pieces.push({
          type: "element",
          tagName: "draggy-cite",
          properties: {},
          children: [{ type: "text", value: match[0] }],
        } as UnistNode);
        last = match.index + match[0].length;
      }
      if (pieces.length === 0) return;
      if (last < node.value.length) pieces.push({ type: "text", value: node.value.slice(last) } as HastText);
      parent.children.splice(index, 1, ...pieces);
      return index + pieces.length;
    });
  };
}

export const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeKatex,
  rehypeCitations,
] as never;

/** Markdown rendered inside a line of prose, where a paragraph would break it. */
export const INLINE_COMPONENTS = {
  p: (props: React.HTMLAttributes<HTMLElement>) => <span {...props} />,
};

export const MARKDOWN_COMPONENTS = {
  code: MarkdownCode,
  blockquote: MarkdownBlockquote,
  "draggy-cite": CiteChip,
};
