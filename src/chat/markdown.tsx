import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { visit } from "unist-util-visit";
import type { Node as UnistNode, Parent as UnistParent } from "unist";
import { MarkdownCode } from "./CodeBlock";

/**
 * How a reply is rendered. `rehypeSanitize` sits between `rehypeRaw` and the
 * page, and that order is all that stops HTML a model wrote from running.
 */

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
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
  },
};

export const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeKatex,
] as never;

/** Markdown rendered inside a line of prose, where a paragraph would break it. */
export const INLINE_COMPONENTS = {
  p: (props: React.HTMLAttributes<HTMLElement>) => <span {...props} />,
};

export const MARKDOWN_COMPONENTS = { code: MarkdownCode };
