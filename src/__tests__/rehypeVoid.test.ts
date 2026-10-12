import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { rehypeCaret, rehypeWordFade } from "../chat/streamReveal";
import { VOID_TAGS, rehypeVoidGuard } from "../chat/rehypeVoid";

const voidTree = (tagName: string): Root => ({
  type: "root",
  children: [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: "Hello" }, { type: "element", tagName, properties: {}, children: [{ type: "text", value: "x" }] }],
    },
  ],
});

const voidNodes = (tree: Root | Element): Element[] =>
  "children" in tree
    ? tree.children.flatMap((child) => (child.type === "element" ? [...(VOID_TAGS.has(child.tagName) ? [child] : []), ...voidNodes(child)] : []))
    : [];

describe("void element guard", () => {
  it("covers every HTML void tag, including those React rejects with children", () => {
    for (const tag of ["br", "img", "input", "keygen", "param", "wbr"]) expect(VOID_TAGS.has(tag)).toBe(true);
  });

  it.each([...VOID_TAGS])("empties <%s> and keeps the caret and fade out of it", (tag) => {
    const tree = voidTree(tag);
    rehypeCaret()(tree);
    rehypeWordFade()(tree);
    rehypeVoidGuard()(tree);
    for (const node of voidNodes(tree)) expect(node.children).toHaveLength(0);
  });

  it("leaves non-void elements alone", () => {
    const tree = voidTree("em");
    rehypeVoidGuard()(tree);
    const em = (tree.children[0] as Element).children[1] as Element;
    expect(em.children).toHaveLength(1);
  });
});
