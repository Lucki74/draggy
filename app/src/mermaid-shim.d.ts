// Stands in for mermaid's own types until the package is installed. Delete this file once
// `mermaid` is in node_modules, so the real types take over.
declare module "mermaid" {
  interface MermaidShim {
    initialize(config: Record<string, unknown>): void;
    parse(source: string): Promise<unknown>;
    render(id: string, source: string): Promise<{ svg: string }>;
  }
  const mermaid: MermaidShim;
  export default mermaid;
}
