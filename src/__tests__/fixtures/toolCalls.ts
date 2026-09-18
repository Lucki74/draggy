export interface ToolCallFixture {
  label: string;
  raw: string;
  expect: { name: string; args: Record<string, unknown> };
  visible?: string;
}

export const TOOL_CALL_FIXTURES: ToolCallFixture[] = [
  {
    label: "canonical tool tag",
    raw: '<tool>\n{"name": "search_web", "args": {"query": "weather in Paris"}}\n</tool>',
    expect: { name: "search_web", args: { query: "weather in Paris" } },
    visible: "",
  },
  {
    label: "tool_call tag alias",
    raw: '<tool_call>{"name": "read_url", "args": {"url": "https://example.com"}}</tool_call>',
    expect: { name: "read_url", args: { url: "https://example.com" } },
  },
  {
    label: "function tag alias",
    raw: '<function>{"name": "browser_close", "args": {}}</function>',
    expect: { name: "browser_close", args: {} },
  },
  {
    label: "invoke tag alias",
    raw: '<invoke>{"name": "browser_get_text", "args": {}}</invoke>',
    expect: { name: "browser_get_text", args: {} },
  },
  {
    label: "prose before a canonical call",
    raw: 'Let me look that up.\n\n<tool>{"name": "search_web", "args": {"query": "ollama keep_alive"}}</tool>',
    expect: { name: "search_web", args: { query: "ollama keep_alive" } },
    visible: "Let me look that up.",
  },
  {
    label: "shorthand tag with bare text",
    raw: "<search_web>current bitcoin price</search_web>",
    expect: { name: "search_web", args: { query: "current bitcoin price" } },
    visible: "",
  },
  {
    label: "shorthand tag holding JSON",
    raw: '<search_web>{"query": "uk bank holidays"}</search_web>',
    expect: { name: "search_web", args: { query: "uk bank holidays" } },
  },
  {
    label: "shorthand tag for read_url uses the url argument",
    raw: "<read_url>https://news.example/story</read_url>",
    expect: { name: "read_url", args: { url: "https://news.example/story" } },
  },
  {
    label: "shorthand tag for the library tool",
    raw: "<search_library>vendor contract renewal date</search_library>",
    expect: { name: "search_library", args: { query: "vendor contract renewal date" } },
  },
  {
    label: "malformed opener with no closing tag",
    raw: '<search_web {"query": "tomorrow forecast"}',
    expect: { name: "search_web", args: { query: "tomorrow forecast" } },
  },
  {
    label: "malformed opener with stray closing braces",
    raw: '<search_web {"query": "nvidia driver version"}}>',
    expect: { name: "search_web", args: { query: "nvidia driver version" } },
  },
  {
    label: "bare JSON with no wrapper",
    raw: '{"name": "search_web", "args": {"query": "electron 42 release notes"}}',
    expect: { name: "search_web", args: { query: "electron 42 release notes" } },
  },
  {
    label: "bare JSON using arguments instead of args",
    raw: '{"name": "read_url", "arguments": {"url": "https://a.example"}}',
    expect: { name: "read_url", args: { url: "https://a.example" } },
  },
  {
    label: "JSX-flavoured attribute form",
    raw: '<tool search_web={"query": "best local llm 2026"} />',
    expect: { name: "search_web", args: { query: "best local llm 2026" } },
  },
  {
    label: "fenced JSON inside a tool tag",
    raw: '<tool>\n```json\n{"name": "create_file", "args": {"filename": "notes.md", "content": "hi"}}\n```\n</tool>',
    expect: { name: "create_file", args: { filename: "notes.md", content: "hi" } },
  },
  {
    label: "call after a closed think block",
    raw: '<think>The user wants current data, so I should search.</think>\n<tool>{"name": "search_web", "args": {"query": "eur usd rate"}}</tool>',
    expect: { name: "search_web", args: { query: "eur usd rate" } },
    visible: "",
  },
  {
    label: "integer argument survives",
    raw: '<tool>{"name": "browser_click", "args": {"index": 3}}</tool>',
    expect: { name: "browser_click", args: { index: 3 } },
  },
  {
    label: "two arguments survive",
    raw: '<tool>{"name": "browser_type", "args": {"index": 2, "text": "hello world"}}</tool>',
    expect: { name: "browser_type", args: { index: 2, text: "hello world" } },
  },
  {
    label: "run_code with a multi-line program",
    raw: '<tool>{"name": "run_code", "args": {"language": "python", "source": "for i in range(3):\\n    print(i)"}}</tool>',
    expect: {
      name: "run_code",
      args: { language: "python", source: "for i in range(3):\n    print(i)" },
    },
  },
];

export const LEAKED_SYNTAX_FIXTURES: { label: string; raw: string; visible: string }[] = [
  {
    label: "OpenAI-style function envelope echoed after a native tool call",
    raw: "The answer is 788454.\n\n}\n{\"type\":\"function\",\"function\":}}}",
    visible: "The answer is 788454.",
  },
  {
    label: "complete function envelope echoed into content",
    raw: 'Done.\n{"type":"function","function":{"name":"run_code","arguments":{"language":"python"}}}',
    visible: "Done.",
  },
  {
    label: "orphan closing braces on their own line",
    raw: "Here is the result.\n}\n}}}",
    visible: "Here is the result.",
  },
  {
    label: "orphan opening brace",
    raw: "All done.\n{",
    visible: "All done.",
  },
  {
    label: "tool_calls envelope echoed into content",
    raw: 'Result ready.\n{"tool_calls":[{"function":{"name":"run_code"}}]}',
    visible: "Result ready.",
  },
  {
    label: "leaked envelope with nothing else",
    raw: '{"type":"function","function":}}}',
    visible: "",
  },
];

export const PRESERVED_JSON_FIXTURES: { label: string; raw: string; keep: string }[] = [
  {
    label: "a fenced JSON block the user asked about",
    raw: [
      "Here is your config:",
      "",
      "```json",
      '{"type": "function", "name": "handler"}',
      "```",
    ].join("\n"),
    keep: '"type": "function"',
  },
  {
    label: "prose containing braces",
    raw: "Use {} for an empty object in Python.",
    keep: "{}",
  },
  {
    label: "an inline code span with braces",
    raw: "The value `{a: 1}` is an object literal.",
    keep: "{a: 1}",
  },
];

export const NON_TOOL_FIXTURES: { label: string; raw: string }[] = [
  {
    label: "plain prose",
    raw: "The capital of France is Paris. It has about 2.1 million residents.",
  },
  {
    label: "prose that mentions searching the web",
    raw: "I could search the web for that, but I already know the answer.",
  },
  {
    label: "a fenced code block that defines a function",
    raw: '```python\ndef search_web(query):\n    return requests.get(url, params={"q": query})\n```',
  },
  {
    label: "JSON that is not a tool call",
    raw: 'Here is the config:\n\n```json\n{"name": "my-app", "version": "1.0.0"}\n```',
  },
  {
    label: "an unrelated XML-ish tag",
    raw: "<result>42</result>",
  },
  {
    label: "markdown discussing the tool names",
    raw: "The available tools are `search_web`, `read_url` and `create_file`.",
  },
  {
    label: "an unclosed think block mid-stream",
    raw: "<think>Let me consider what the user is really asking",
  },
];

export const THINK_FIXTURES: { label: string; raw: string; thought: string | null }[] = [
  {
    label: "closed think block",
    raw: "<think>Step one, then step two.</think>The answer is 4.",
    thought: "Step one, then step two.",
  },
  {
    label: "unclosed think block while still streaming",
    raw: "<think>I am still working through",
    thought: "I am still working through",
  },
  {
    label: "no think block at all",
    raw: "Just an answer.",
    thought: null,
  },
  {
    label: "think block after some prose",
    raw: "Sure.\n<think>Reasoning here.</think>\nDone.",
    thought: "Reasoning here.",
  },
];
