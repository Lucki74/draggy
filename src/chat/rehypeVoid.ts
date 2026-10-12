import type { Element, Root } from "hast";
import { htmlVoidElements } from "html-void-elements";

/** HTML void elements. React throws error 137 when one is given children. */
export const VOID_TAGS: ReadonlySet<string> = new Set(htmlVoidElements);

/** Runs last in the chain: empties every void element, so no plugin can make React throw error 137. */
export function rehypeVoidGuard() {
  const strip = (node: Root | Element) => {
    if (node.type === "element" && VOID_TAGS.has(node.tagName)) {
      node.children = [];
      return;
    }
    for (const child of node.children) {
      if (child.type === "element") strip(child);
    }
  };
  return (tree: Root) => strip(tree);
}
