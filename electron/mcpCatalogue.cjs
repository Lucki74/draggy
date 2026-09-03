/**
 * The servers offered, each naming the package it fetches. Every one was
 * checked against npm; Python servers need `uvx` and are left out on purpose.
 */

/**
 * Nothing here duplicates a built-in feature. Draggy has Brave, DuckDuckGo and a
 * browser of its own, so those are out; a service it cannot do is not a duplicate.
 */

/**
 * What a server needs before it runs. `secret: true` marks a credential, which
 * the interface masks and never logs.
 */

const CATALOGUE = [
  {
    id: "filesystem",
    name: "Filesystem",
    description:
      "Read, write and search files in folders you choose. The folders are the arguments: nothing outside them is reachable.",
    package: "@modelcontextprotocol/server-filesystem",
    args: [],
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
    description:
      "Search repositories, read issues and pull requests, create branches and commits.",
    package: "@modelcontextprotocol/server-github",
    site: "https://github.com",
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
    description: "Read and write projects, issues and merge requests on GitLab.",
    package: "@modelcontextprotocol/server-gitlab",
    site: "https://gitlab.com",
    args: [],
    env: [
      { key: "GITLAB_PERSONAL_ACCESS_TOKEN", label: "GitLab token", secret: true, required: true },
      { key: "GITLAB_API_URL", label: "GitLab API URL", required: false },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Look up issues, stack traces and releases from Sentry.",
    package: "@sentry/mcp-server",
    site: "https://sentry.io",
    args: [],
    env: [
      { key: "SENTRY_ACCESS_TOKEN", label: "Sentry access token", secret: true, required: true },
      { key: "SENTRY_HOST", label: "Sentry host", required: false },
    ],
  },
  {
    id: "jetbrains",
    name: "JetBrains IDEs",
    description:
      "Drive a running JetBrains IDE — open files, read the project tree, run inspections.",
    package: "@jetbrains/mcp-proxy",
    site: "https://www.jetbrains.com",
    args: [],
    env: [],
    caution: "Needs the MCP Server plugin installed in the IDE and the IDE running.",
  },
  {
    id: "context7",
    name: "Context7 docs",
    description:
      "Up-to-date API documentation for thousands of libraries, fetched per question instead of recalled from training.",
    package: "@upstash/context7-mcp",
    site: "https://context7.com",
    args: [],
    env: [],
  },
  {
    id: "magic-ui",
    name: "21st.dev Magic",
    description: "Generate React interface components from a description.",
    package: "@21st-dev/magic",
    site: "https://21st.dev",
    args: [],
    env: [{ key: "API_KEY", label: "21st.dev API key", secret: true, required: true }],
  },

  {
    id: "perplexity",
    name: "Perplexity",
    description:
      "Ask Perplexity a question and get an answer with its sources, rather than a page of results to read yourself.",
    package: "server-perplexity-ask",
    site: "https://www.perplexity.ai",
    args: [],
    env: [{ key: "PERPLEXITY_API_KEY", label: "Perplexity API key", secret: true, required: true }],
  },
  {
    id: "exa",
    name: "Exa",
    description:
      "Search the web by meaning rather than by keyword, which finds pages that never use the words you typed.",
    package: "exa-mcp-server",
    site: "https://exa.ai",
    args: [],
    env: [{ key: "EXA_API_KEY", label: "Exa API key", secret: true, required: true }],
  },
  {
    id: "tavily",
    name: "Tavily",
    description:
      "A search API built for models: results come back already extracted and trimmed, instead of as pages to scrape.",
    package: "tavily-mcp",
    site: "https://tavily.com",
    args: [],
    env: [{ key: "TAVILY_API_KEY", label: "Tavily API key", secret: true, required: true }],
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description:
      "Crawl a whole site and turn its pages into clean markdown, where the built-in reader takes one page at a time.",
    package: "firecrawl-mcp",
    site: "https://firecrawl.dev",
    args: [],
    env: [{ key: "FIRECRAWL_API_KEY", label: "Firecrawl API key", secret: true, required: true }],
  },

  {
    id: "slack",
    name: "Slack",
    description: "Read channels and messages, post replies, look up users.",
    package: "@modelcontextprotocol/server-slack",
    site: "https://slack.com",
    args: [],
    env: [
      { key: "SLACK_BOT_TOKEN", label: "Slack bot token", secret: true, required: true },
      { key: "SLACK_TEAM_ID", label: "Slack team ID", required: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, read and write Notion pages and databases.",
    package: "@notionhq/notion-mcp-server",
    site: "https://www.notion.so",
    args: [],
    env: [
      { key: "NOTION_TOKEN", label: "Notion integration token", secret: true, required: true },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Read and update Linear issues, projects and cycles.",
    package: "linear-mcp-server",
    site: "https://linear.app",
    args: [],
    env: [{ key: "LINEAR_API_KEY", label: "Linear API key", secret: true, required: true }],
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Create, complete and search tasks in Todoist.",
    package: "@abhiz123/todoist-mcp-server",
    site: "https://todoist.com",
    args: [],
    env: [{ key: "TODOIST_API_TOKEN", label: "Todoist API token", secret: true, required: true }],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Read and search an Obsidian vault on this machine.",
    package: "mcp-obsidian",
    site: "https://obsidian.md",
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
    description: "Search Drive and read the contents of documents.",
    package: "@modelcontextprotocol/server-gdrive",
    site: "https://drive.google.com",
    args: [],
    env: [
      { key: "GDRIVE_CREDENTIALS_PATH", label: "Path to credentials JSON", required: true },
    ],
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Geocoding, directions, places and distance lookups.",
    package: "@modelcontextprotocol/server-google-maps",
    site: "https://developers.google.com/maps",
    args: [],
    env: [{ key: "GOOGLE_MAPS_API_KEY", label: "Google Maps API key", secret: true, required: true }],
  },

  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Run read-only queries against a Postgres database and inspect its schema.",
    package: "@modelcontextprotocol/server-postgres",
    site: "https://www.postgresql.org",
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
    description: "Query collections and inspect schemas in MongoDB or Atlas.",
    package: "mongodb-mcp-server",
    site: "https://www.mongodb.com",
    args: [],
    env: [
      { key: "MDB_MCP_CONNECTION_STRING", label: "Connection string", secret: true, required: true },
    ],
  },
  {
    id: "redis",
    name: "Redis",
    description: "Read and write keys in a Redis instance.",
    package: "@modelcontextprotocol/server-redis",
    site: "https://redis.io",
    args: [],
    arguments: [
      { key: "url", label: "Redis URL", placeholder: "redis://localhost:6379", required: true },
    ],
    env: [],
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    description: "Search indices and inspect mappings in Elasticsearch.",
    package: "@elastic/mcp-server-elasticsearch",
    site: "https://www.elastic.co",
    args: [],
    env: [
      { key: "ES_URL", label: "Elasticsearch URL", required: true },
      { key: "ES_API_KEY", label: "API key", secret: true, required: false },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Manage Supabase projects, run queries and inspect tables.",
    package: "@supabase/mcp-server-supabase",
    site: "https://supabase.com",
    args: [],
    env: [
      { key: "SUPABASE_ACCESS_TOKEN", label: "Supabase access token", secret: true, required: true },
    ],
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Read and write Airtable bases, tables and records.",
    package: "airtable-mcp-server",
    site: "https://airtable.com",
    args: [],
    env: [{ key: "AIRTABLE_API_KEY", label: "Airtable API key", secret: true, required: true }],
  },

  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Inspect and manage a Kubernetes cluster through your current kubeconfig.",
    package: "mcp-server-kubernetes",
    site: "https://kubernetes.io",
    args: [],
    env: [],
    caution: "Acts as whatever your current kubeconfig context is allowed to do.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Manage Workers, KV, R2 and D1 on a Cloudflare account.",
    package: "@cloudflare/mcp-server-cloudflare",
    site: "https://www.cloudflare.com",
    args: [],
    env: [
      { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API token", secret: true, required: true },
    ],
  },
  {
    id: "heroku",
    name: "Heroku",
    description: "Inspect and manage Heroku apps, dynos, add-ons and logs.",
    package: "@heroku/mcp-server",
    site: "https://www.heroku.com",
    args: [],
    env: [{ key: "HEROKU_API_KEY", label: "Heroku API key", secret: true, required: true }],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Look up customers, payments, subscriptions and invoices.",
    package: "@stripe/mcp",
    site: "https://stripe.com",
    args: ["--tools=all"],
    env: [{ key: "STRIPE_SECRET_KEY", label: "Stripe secret key", secret: true, required: true }],
    caution: "A live key can move real money. Use a restricted or test key.",
  },
  {
    id: "aws-kb",
    name: "AWS Knowledge Base",
    description: "Retrieve from an Amazon Bedrock knowledge base.",
    package: "@modelcontextprotocol/server-aws-kb-retrieval",
    site: "https://aws.amazon.com/bedrock/",
    args: [],
    env: [
      { key: "AWS_ACCESS_KEY_ID", label: "AWS access key ID", secret: true, required: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "AWS secret access key", secret: true, required: true },
      { key: "AWS_REGION", label: "AWS region", required: true },
    ],
  },

  {
    id: "memory",
    name: "Memory",
    description:
      "A knowledge graph the model can write to and read back, so facts survive between conversations.",
    package: "@modelcontextprotocol/server-memory",
    args: [],
    env: [],
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    description:
      "A scratchpad for working a hard problem through in numbered steps, revising earlier ones as it goes.",
    package: "@modelcontextprotocol/server-sequential-thinking",
    args: [],
    env: [],
  },
  {
    id: "everything",
    name: "Everything (reference)",
    description:
      "The reference server. Exercises every part of the protocol — useful for checking that MCP works at all.",
    package: "@modelcontextprotocol/server-everything",
    site: "https://modelcontextprotocol.io",
    args: [],
    env: [],
  },

  {
    id: "figma",
    name: "Figma",
    description: "Read Figma files and turn frames into layout and style information.",
    package: "figma-developer-mcp",
    site: "https://www.figma.com",
    args: ["--stdio"],
    env: [{ key: "FIGMA_API_KEY", label: "Figma API key", secret: true, required: true }],
  },
  {
    id: "youtube-transcript",
    name: "YouTube transcripts",
    description:
      "Fetch the transcript of a YouTube video, with its title and available languages, so it can be read or summarised.",
    package: "@sinco-lab/mcp-youtube-transcript",
    site: "https://www.youtube.com",
    args: [],
    env: [],
    caution:
      "YouTube blocks transcript reads for some videos. The server reports the failure rather than returning a partial transcript.",
  },
];

/**
 * The package's page on npm, which renders its README. Derived rather than
 * stored, so the link can never drift out of step with the package name.
 */
function docsUrl(entry) {
  if (!entry) return null;
  return `https://www.npmjs.com/package/${entry.package}`;
}

/** Every catalogue entry, with its documentation link filled in. */
function listCatalogue() {
  return CATALOGUE.map((entry) => ({ ...entry, docs: docsUrl(entry) }));
}

function findEntry(id) {
  const entry = CATALOGUE.find((candidate) => candidate.id === id);
  return entry ? { ...entry, docs: docsUrl(entry) } : null;
}

/** Entries whose name or description matches what was typed. */
function searchCatalogue(term) {
  const wanted = String(term || "").trim().toLowerCase();
  if (!wanted) return listCatalogue();

  return listCatalogue().filter((entry) =>
    [entry.id, entry.name, entry.description].some((field) =>
      String(field).toLowerCase().includes(wanted),
    ),
  );
}

/**
 * What is still missing before a server can start. Returned, not thrown, so the
 * interface can open the setup fields rather than starting something doomed.
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
 * The arguments a server is started with: its own, then anything the user
 * supplied. The package itself is installed separately and run directly.
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
    args: [...(entry.args || []), ...extra],
    env: { ...(config.env || {}) },
  };
}

module.exports = {
  CATALOGUE,
  listCatalogue,
  findEntry,
  searchCatalogue,
  missingRequirements,
  commandFor,
  docsUrl,
};
