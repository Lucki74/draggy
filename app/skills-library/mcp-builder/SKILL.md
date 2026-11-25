---
name: mcp-builder
description: Designs and scaffolds a Model Context Protocol server, covering the tool list, input schemas, error handling, transport, configuration and tests, in the language the user picks and checked against the current protocol docs. Use when the user asks to build an MCP server, wrap an API as MCP tools or scaffold a tool server for an assistant.
---

# MCP builder

## Goal

Produce a small, working MCP server whose tools are easy for a model to choose and call correctly. The design comes first: a short tool list with clear names, strict schemas and errors that tell the caller what to do next. Then the scaffold, then tests.

## When to use

- The user wants an assistant to reach an API, database, file area or service through MCP.
- An existing server has too many or unclear tools and needs a redesign.
- For checking an installed server's behaviour, run its tools directly with `run_command`.
- For the instructions that sit around the tools, use `use_skill` with `agent-instructions-writer` if it is on.

## Steps

1. Ask with `ask_user` what the server wraps, who calls it, the language and SDK the user prefers, the transport (local process over stdio, or remote over HTTP), and which operations are read only and which change data.
2. Check the protocol and SDK docs live with `read_url`. SDK names, method signatures and transport options change between releases, so do not scaffold from memory. Note the versions you read.
3. List the user's jobs, then derive tools from jobs and not from endpoints. Aim for a small set: five to ten tools beat fifty. Merge steps that always go together; split tools that mix reading and writing.
4. For each tool write a name (verb plus noun), a description that says when to call it and when not to, and an input schema with typed fields, required flags, enums and short field descriptions. Mark read only tools as such if the SDK supports annotations.
5. Define the output: a compact structured result, not a raw dump of the upstream response. Cap list sizes, add paging with a cursor, and return ids the caller can pass to the next tool.
6. Define errors. Validate input first and return an error result with a plain message and a next step ("no project with that id; list the projects first"), not a stack trace. Keep secrets out of messages.
7. Scaffold with `create_file`: entry point, one module per group of tools, a config loader that reads keys from environment variables, and a README with run and connection instructions. Never hard code keys or write them into the repository.
8. Keep a stdio server's standard output clean for protocol messages. Send logs to standard error or a file.
9. Add tests: one per tool for the happy path, one for invalid input, one for an upstream failure with the upstream mocked. Run them with `run_command`.
10. Start the server and call each tool once, using the SDK's inspector or a small client script, and confirm the schemas and results look right to a model reading them.

## Gotchas

- Tools that mirror every endpoint make the model guess. Design for the task.
- A vague description ("manages items") gets the tool called at the wrong time. Say what it returns and when to use it.
- Write tools without a confirmation step or dry-run option can do damage on a bad guess. Add one for deletes and bulk changes.
- Unbounded outputs fill the caller's context. Truncate, page and say that the result was cut.
- Long calls need timeouts and a clear failure result, or the client hangs.
- Credentials belong in the client's configuration, not in tool arguments the model fills in.

## Output

- The tool table: name, purpose, inputs, outputs, read or write.
- The scaffold file list and how to run and connect it.
- Test results and what was not tested.
- Docs versions consulted and anything to re-check before release.
