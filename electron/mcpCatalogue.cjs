/**
 * The servers offered, each naming the package it fetches. Every one was
 * checked against npm; Python servers need `uvx` and are left out on purpose.
 */

/**
 * What a server needs before it runs. `secret: true` marks a credential, which
 * the interface masks and never logs.
 */

const CATEGORIES = [
  { id: "development", label: "Development" },
  { id: "web", label: "Web and search" },
  { id: "productivity", label: "Productivity" },
  { id: "data", label: "Databases" },
  { id: "cloud", label: "Cloud and infrastructure" },
  { id: "knowledge", label: "Knowledge and memory" },
  { id: "design", label: "Design" },
  { id: "media", label: "Media" },
];

const CATALOGUE = [
  // ---------------------------------------------------------------- development
  {
    id: "filesystem",
    name: "Filesystem",
    category: "development",
    description:
      "Read, write and search files in folders you choose. The folders are the arguments: nothing outside them is reachable.",
    package: "@modelcontextprotocol/server-filesystem",
    args: [],
    /** Paths the user has to supply before this can run. */
    arguments: [
      {
        key: "roots",
        label: "Folders to expose",
        placeholder: "C:\\Users\\you\\projects",
        multiple: true,
        required: true,
      },
    ],
    env: [],
    caution:
      "This server can write and delete inside the folders you list. Point it at a project, not at your home directory.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "development",
    description:
      "Search repositories, read issues and pull requests, create branches and commits.",
    package: "@modelcontextprotocol/server-github",
    args: [],
    env: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub personal access token",
        secret: true,
        required: true,
      },
    ],
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "development",
    description: "Read and write projects, issues and merge requests on GitLab.",
    package: "@modelcontextprotocol/server-gitlab",
    args: [],
    env: [
      { key: "GITLAB_PERSONAL_ACCESS_TOKEN", label: "GitLab token", secret: true, required: true },
      { key: "GITLAB_API_URL", label: "GitLab API URL", required: false },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "development",
    description: "Look up issues, stack traces and releases from Sentry.",
    package: "@sentry/mcp-server",
    args: [],
    env: [
      { key: "SENTRY_ACCESS_TOKEN", label: "Sentry access token", secret: true, required: true },
      { key: "SENTRY_HOST", label: "Sentry host", required: false },
    ],
  },
  {
    id: "jetbrains",
    name: "JetBrains IDEs",
    category: "development",
    description:
      "Drive a running JetBrains IDE — open files, read the project tree, run inspections.",
    package: "@jetbrains/mcp-proxy",
    args: [],
    env: [],
    caution: "Needs the MCP Server plugin installed in the IDE and the IDE running.",
  },
  {
    id: "context7",
    name: "Context7 docs",
    category: "development",
    description:
      "Up-to-date API documentation for thousands of libraries, fetched per question instead of recalled from training.",
    package: "@upstash/context7-mcp",
    args: [],
    env: [],
  },
  {
    id: "magic-ui",
    name: "21st.dev Magic",
    category: "development",
    description: "Generate React interface components from a description.",
    package: "@21st-dev/magic",
    args: [],
    env: [{ key: "API_KEY", label: "21st.dev API key", secret: true, required: true }],
  },

  // ------------------------------------------------------------------------ web
  {
    id: "brave-search",
    name: "Brave Search",
    category: "web",
    description: "Web and local search through Brave's API.",
    package: "@modelcontextprotocol/server-brave-search",
    args: [],
    env: [{ key: "BRAVE_API_KEY", label: "Brave Search API key", secret: true, required: true }],
  },
  {
    id: "tavily",
    name: "Tavily",
    category: "web",
    description: "Search and page extraction built for models rather than for people.",
    package: "tavily-mcp",
    args: [],
    env: [{ key: "TAVILY_API_KEY", label: "Tavily API key", secret: true, required: true }],
  },
  {
    id: "exa",
    name: "Exa",
    category: "web",
    description: "Neural search over the web, good at finding pages by what they mean.",
    package: "exa-mcp-server",
    args: [],
    env: [{ key: "EXA_API_KEY", label: "Exa API key", secret: true, required: true }],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    category: "web",
    description: "Ask Perplexity a question and get a sourced answer back.",
    package: "server-perplexity-ask",
    args: [],
    env: [{ key: "PERPLEXITY_API_KEY", label: "Perplexity API key", secret: true, required: true }],
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    category: "web",
    description: "Web search with no API key and no account.",
    package: "duckduckgo-mcp-server",
    args: [],
    env: [],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    category: "web",
    description: "Crawl a site and turn its pages into clean markdown.",
    package: "firecrawl-mcp",
    args: [],
    env: [{ key: "FIRECRAWL_API_KEY", label: "Firecrawl API key", secret: true, required: true }],
  },
  {
    id: "playwright",
    name: "Playwright browser",
    category: "web",
    description:
      "Drive a real browser: navigate, click, fill forms, take snapshots of the page.",
    package: "@playwright/mcp",
    args: [],
    env: [],
    caution: "Downloads a browser the first time it runs.",
  },
  {
    id: "puppeteer",
    name: "Puppeteer browser",
    category: "web",
    description: "Browser automation through Chrome DevTools, with screenshots.",
    package: "@modelcontextprotocol/server-puppeteer",
    args: [],
    env: [],
  },
  {
    id: "browserbase",
    name: "Browserbase",
    category: "web",
    description: "Run a browser session in the cloud rather than on this machine.",
    package: "@browserbasehq/mcp",
    args: [],
    env: [
      { key: "BROWSERBASE_API_KEY", label: "Browserbase API key", secret: true, required: true },
      { key: "BROWSERBASE_PROJECT_ID", label: "Project ID", required: true },
    ],
  },

  // ---------------------------------------------------------------- productivity
  {
    id: "slack",
    name: "Slack",
    category: "productivity",
    description: "Read channels and messages, post replies, look up users.",
    package: "@modelcontextprotocol/server-slack",
    args: [],
    env: [
      { key: "SLACK_BOT_TOKEN", label: "Slack bot token", secret: true, required: true },
      { key: "SLACK_TEAM_ID", label: "Slack team ID", required: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    description: "Search, read and write Notion pages and databases.",
    package: "@notionhq/notion-mcp-server",
    args: [],
    env: [
      { key: "NOTION_TOKEN", label: "Notion integration token", secret: true, required: true },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    category: "productivity",
    description: "Read and update Linear issues, projects and cycles.",
    package: "linear-mcp-server",
    args: [],
    env: [{ key: "LINEAR_API_KEY", label: "Linear API key", secret: true, required: true }],
  },
  {
    id: "todoist",
    name: "Todoist",
    category: "productivity",
    description: "Create, complete and search tasks in Todoist.",
    package: "@abhiz123/todoist-mcp-server",
    args: [],
    env: [{ key: "TODOIST_API_TOKEN", label: "Todoist API token", secret: true, required: true }],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    category: "productivity",
    description: "Read and search an Obsidian vault on this machine.",
    package: "mcp-obsidian",
    args: [],
    arguments: [
      {
        key: "vault",
        label: "Vault folder",
        placeholder: "C:\\Users\\you\\notes",
        required: true,
      },
    ],
    env: [],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "productivity",
    description: "Search Drive and read the contents of documents.",
    package: "@modelcontextprotocol/server-gdrive",
    args: [],
    env: [
      { key: "GDRIVE_CREDENTIALS_PATH", label: "Path to credentials JSON", required: true },
    ],
  },
  {
    id: "google-maps",
    name: "Google Maps",
    category: "productivity",
    description: "Geocoding, directions, places and distance lookups.",
    package: "@modelcontextprotocol/server-google-maps",
    args: [],
    env: [{ key: "GOOGLE_MAPS_API_KEY", label: "Google Maps API key", secret: true, required: true }],
  },

  // ----------------------------------------------------------------------- data
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "data",
    description: "Run read-only queries against a Postgres database and inspect its schema.",
    package: "@modelcontextprotocol/server-postgres",
    args: [],
    arguments: [
      {
        key: "connection",
        label: "Connection string",
        placeholder: "postgresql://user@localhost/dbname",
        required: true,
      },
    ],
    env: [],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "data",
    description: "Query collections and inspect schemas in MongoDB or Atlas.",
    package: "mongodb-mcp-server",
    args: [],
    env: [
      { key: "MDB_MCP_CONNECTION_STRING", label: "Connection string", secret: true, required: true },
    ],
  },
  {
    id: "redis",
    name: "Redis",
    category: "data",
    description: "Read and write keys in a Redis instance.",
    package: "@modelcontextprotocol/server-redis",
    args: [],
    arguments: [
      { key: "url", label: "Redis URL", placeholder: "redis://localhost:6379", required: true },
    ],
    env: [],
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    category: "data",
    description: "Search indices and inspect mappings in Elasticsearch.",
    package: "@elastic/mcp-server-elasticsearch",
    args: [],
    env: [
      { key: "ES_URL", label: "Elasticsearch URL", required: true },
      { key: "ES_API_KEY", label: "API key", secret: true, required: false },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "data",
    description: "Manage Supabase projects, run queries and inspect tables.",
    package: "@supabase/mcp-server-supabase",
    args: [],
    env: [
      { key: "SUPABASE_ACCESS_TOKEN", label: "Supabase access token", secret: true, required: true },
    ],
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "data",
    description: "Read and write Airtable bases, tables and records.",
    package: "airtable-mcp-server",
    args: [],
    env: [{ key: "AIRTABLE_API_KEY", label: "Airtable API key", secret: true, required: true }],
  },

  // ---------------------------------------------------------------------- cloud
  {
    id: "kubernetes",
    name: "Kubernetes",
    category: "cloud",
    description: "Inspect and manage a Kubernetes cluster through your current kubeconfig.",
    package: "mcp-server-kubernetes",
    args: [],
    env: [],
    caution: "Acts as whatever your current kubeconfig context is allowed to do.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cloud",
    description: "Manage Workers, KV, R2 and D1 on a Cloudflare account.",
    package: "@cloudflare/mcp-server-cloudflare",
    args: [],
    env: [
      { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API token", secret: true, required: true },
    ],
  },
  {
    id: "heroku",
    name: "Heroku",
    category: "cloud",
    description: "Inspect and manage Heroku apps, dynos, add-ons and logs.",
    package: "@heroku/mcp-server",
    args: [],
    env: [{ key: "HEROKU_API_KEY", label: "Heroku API key", secret: true, required: true }],
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "cloud",
    description: "Look up customers, payments, subscriptions and invoices.",
    package: "@stripe/mcp",
    args: ["--tools=all"],
    env: [{ key: "STRIPE_SECRET_KEY", label: "Stripe secret key", secret: true, required: true }],
    caution: "A live key can move real money. Use a restricted or test key.",
  },
  {
    id: "aws-kb",
    name: "AWS Knowledge Base",
    category: "cloud",
    description: "Retrieve from an Amazon Bedrock knowledge base.",
    package: "@modelcontextprotocol/server-aws-kb-retrieval",
    args: [],
    env: [
      { key: "AWS_ACCESS_KEY_ID", label: "AWS access key ID", secret: true, required: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "AWS secret access key", secret: true, required: true },
      { key: "AWS_REGION", label: "AWS region", required: true },
    ],
  },

  // ------------------------------------------------------------------ knowledge
  {
    id: "memory",
    name: "Memory",
    category: "knowledge",
    description:
      "A knowledge graph the model can write to and read back, so facts survive between conversations.",
    package: "@modelcontextprotocol/server-memory",
    args: [],
    env: [],
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    category: "knowledge",
    description:
      "A scratchpad for working a hard problem through in numbered steps, revising earlier ones as it goes.",
    package: "@modelcontextprotocol/server-sequential-thinking",
    args: [],
    env: [],
  },
  {
    id: "everything",
    name: "Everything (reference)",
    category: "knowledge",
    description:
      "The reference server. Exercises every part of the protocol — useful for checking that MCP works at all.",
    package: "@modelcontextprotocol/server-everything",
    args: [],
    env: [],
  },

  // --------------------------------------------------------------------- design
  {
    id: "figma",
    name: "Figma",
    category: "design",
    description: "Read Figma files and turn frames into layout and style information.",
    package: "figma-developer-mcp",
    args: ["--stdio"],
    env: [{ key: "FIGMA_API_KEY", label: "Figma API key", secret: true, required: true }],
  },

  // ---------------------------------------------------------------------- media
  {
    id: "youtube-transcript",
    name: "YouTube transcripts",
    category: "media",
    description: "Fetch the transcript of a YouTube video so it can be read or summarised.",
    package: "youtube-transcript-mcp",
    args: [],
    env: [],
  },
];

/** Every catalogue entry, in a stable order. */
function listCatalogue() {
  return CATALOGUE.map((entry) => ({ ...entry }));
}

function categories() {
  return CATEGORIES.map((entry) => ({ ...entry }));
}

function findEntry(id) {
  return CATALOGUE.find((entry) => entry.id === id) || null;
}

/** Entries whose name, description or category matches what was typed. */
function searchCatalogue(term) {
  const wanted = String(term || "").trim().toLowerCase();
  if (!wanted) return listCatalogue();

  return listCatalogue().filter((entry) =>
    [entry.id, entry.name, entry.description, entry.category].some((field) =>
      String(field).toLowerCase().includes(wanted),
    ),
  );
}

/**
 * What is still missing before a server can start. Returned, not thrown, so the
 * interface can grey out the switch and say which field is empty.
 */
function missingRequirements(entry, config = {}) {
  if (!entry) return ["unknown server"];

  const missing = [];
  const env = config.env || {};
  const values = config.arguments || {};

  for (const variable of entry.env || []) {
    if (variable.required && !String(env[variable.key] || "").trim()) {
      missing.push(variable.label || variable.key);
    }
  }

  for (const argument of entry.arguments || []) {
    const value = values[argument.key];
    const empty = argument.multiple
      ? !Array.isArray(value) || value.filter(Boolean).length === 0
      : !String(value || "").trim();

    if (argument.required && empty) missing.push(argument.label || argument.key);
  }

  return missing;
}

/**
 * The command line as it will be spawned. `npx -y` rather than a pinned
 * version, since pinning would ship a stale server with every release.
 */
function commandFor(entry, config = {}) {
  if (!entry) return null;

  const values = config.arguments || {};
  const extra = [];

  for (const argument of entry.arguments || []) {
    const value = values[argument.key];
    if (argument.multiple) {
      for (const item of Array.isArray(value) ? value : []) {
        if (String(item || "").trim()) extra.push(String(item));
      }
    } else if (String(value || "").trim()) {
      extra.push(String(value));
    }
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", entry.package, ...(entry.args || []), ...extra],
    env: { ...(config.env || {}) },
  };
}

module.exports = {
  CATEGORIES,
  CATALOGUE,
  listCatalogue,
  categories,
  findEntry,
  searchCatalogue,
  missingRequirements,
  commandFor,
};
