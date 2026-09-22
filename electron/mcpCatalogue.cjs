/** The servers offered, each naming the package it fetches. Every one was checked against npm;
 * Python servers need `uvx` and are left out on purpose. */

/** Nothing here duplicates a built-in feature. Draggy has Brave, DuckDuckGo and a browser of its
 * own, so those are out; a service it cannot do is not a duplicate. */

/** What a server needs before it runs. `secret: true` marks a credential, which the interface masks
 * and never logs. */

const CATALOGUE = [
  {
    id: "azure-devops",
    name: "Azure DevOps",
    description: "Manage projects, repositories, work items, pipelines and wikis in Azure DevOps.",
    package: "@azure-devops/mcp",
    site: "https://azure.microsoft.com/products/devops",
    args: [],
    arguments: [
      {
        key: "organization",
        label: "Organization name",
        placeholder: "contoso",
        required: true,
      },
    ],
    env: [
      { key: "AZURE_DEVOPS_EXT_PAT", label: "Personal access token", secret: true, required: false },
    ],
  },
  {
    id: "shopify",
    name: "Shopify Dev",
    description: "Search Shopify documentation, validate GraphQL and Liquid templates, and inspect schemas.",
    package: "@shopify/dev-mcp",
    site: "https://shopify.dev",
    args: [],
    env: [],
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
      "Drive a running JetBrains IDE: open files, read the project tree, run inspections.",
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
    id: "jira",
    name: "Jira",
    description: "Search issues, update projects and track tickets across Jira.",
    package: "@aashari/mcp-server-atlassian-jira",
    site: "https://www.atlassian.com/software/jira",
    args: [],
    env: [
      { key: "ATLASSIAN_SITE_NAME", label: "Atlassian site name (e.g. your-company)", required: true },
      { key: "ATLASSIAN_USER_EMAIL", label: "Atlassian user email", required: true },
      { key: "ATLASSIAN_API_TOKEN", label: "Atlassian API token", secret: true, required: true },
    ],
  },
  {
    id: "confluence",
    name: "Confluence",
    description: "Search spaces, read documentation and update pages in Confluence.",
    package: "@aashari/mcp-server-atlassian-confluence",
    site: "https://www.atlassian.com/software/confluence",
    args: [],
    env: [
      { key: "ATLASSIAN_SITE_NAME", label: "Atlassian site name (e.g. your-company)", required: true },
      { key: "ATLASSIAN_USER_EMAIL", label: "Atlassian user email", required: true },
      { key: "ATLASSIAN_API_TOKEN", label: "Atlassian API token", secret: true, required: true },
    ],
  },
  {
    id: "asana",
    name: "Asana",
    description: "Read and manage Asana tasks, projects, workspaces and teams.",
    package: "@roychri/mcp-server-asana",
    site: "https://asana.com",
    args: [],
    env: [{ key: "ASANA_ACCESS_TOKEN", label: "Asana personal access token", secret: true, required: true }],
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Manage ClickUp tasks, lists, spaces and custom fields.",
    package: "@taazkareem/clickup-mcp-server",
    site: "https://clickup.com",
    args: [],
    env: [
      { key: "CLICKUP_API_KEY", label: "ClickUp API key", secret: true, required: true },
      { key: "CLICKUP_TEAM_ID", label: "ClickUp team ID", required: false },
    ],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "List upcoming events, create calendar entries and manage schedules.",
    package: "@cocal/google-calendar-mcp",
    site: "https://calendar.google.com",
    args: [],
    env: [{ key: "GOOGLE_OAUTH_CREDENTIALS", label: "Path to Google OAuth credentials JSON", required: true }],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Manage contacts, companies, deals and CRM objects in HubSpot.",
    package: "@hubspot/mcp-server",
    site: "https://www.hubspot.com",
    args: [],
    env: [{ key: "PRIVATE_APP_ACCESS_TOKEN", label: "HubSpot private app access token", secret: true, required: true }],
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
    id: "mysql",
    name: "MySQL",
    description: "Query tables, inspect schemas and run queries against a MySQL database.",
    package: "@benborla29/mcp-server-mysql",
    site: "https://www.mysql.com",
    args: [],
    env: [
      { key: "MYSQL_HOST", label: "MySQL host", required: true },
      { key: "MYSQL_PORT", label: "MySQL port", required: false },
      { key: "MYSQL_USER", label: "MySQL user", required: true },
      { key: "MYSQL_PASS", label: "MySQL password", secret: true, required: true },
      { key: "MYSQL_DB", label: "Database name", required: true },
    ],
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and inspect SQLite database files on this machine.",
    package: "mcp-server-sqlite-npx",
    site: "https://www.sqlite.org",
    args: [],
    arguments: [
      {
        key: "database",
        label: "Path to SQLite file",
        placeholder: "C:\\Users\\you\\data.db",
        required: true,
      },
    ],
    env: [],
  },
  {
    id: "pinecone",
    name: "Pinecone",
    description: "Search, upsert and query vector records and indexes in Pinecone.",
    package: "@pinecone-database/mcp",
    site: "https://www.pinecone.io",
    args: [],
    env: [{ key: "PINECONE_API_KEY", label: "Pinecone API key", secret: true, required: true }],
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
    id: "netlify",
    name: "Netlify",
    description: "Manage Netlify sites, deployments, build logs and environment variables.",
    package: "@netlify/mcp",
    site: "https://www.netlify.com",
    args: [],
    env: [{ key: "NETLIFY_PERSONAL_ACCESS_TOKEN", label: "Netlify personal access token", secret: true, required: true }],
  },
  {
    id: "datadog",
    name: "Datadog",
    description: "Query metrics, search logs, inspect monitors and view dashboards in Datadog.",
    package: "@winor30/mcp-server-datadog",
    site: "https://www.datadoghq.com",
    args: [],
    env: [
      { key: "DATADOG_API_KEY", label: "Datadog API key", secret: true, required: true },
      { key: "DATADOG_APP_KEY", label: "Datadog application key", secret: true, required: true },
      { key: "DATADOG_SITE", label: "Datadog site (e.g. datadoghq.com)", required: false },
    ],
  },
  {
    id: "contentful",
    name: "Contentful",
    description: "Create, edit and publish content entries, assets and content models in Contentful.",
    package: "@contentful/mcp-server",
    site: "https://www.contentful.com",
    args: [],
    env: [
      { key: "CONTENTFUL_MANAGEMENT_ACCESS_TOKEN", label: "Management access token", secret: true, required: true },
      { key: "SPACE_ID", label: "Space ID", required: true },
      { key: "ENVIRONMENT_ID", label: "Environment ID", required: false },
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
  {
    id: "composio",
    name: "Composio",
    description:
      "Connect to 500+ apps and services including Gmail, GitHub, Slack and Salesforce.",
    transport: "http",
    url: "https://connect.composio.dev/mcp",
    package: "composio-mcp",
    site: "https://composio.dev",
    args: [],
    env: [
      { key: "COMPOSIO_API_KEY", label: "Composio API key", secret: true, required: true },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    description:
      "Send messages, manage channels, and interact with Discord servers.",
    package: "discord-mcp",
    site: "https://discord.com",
    args: [],
    env: [
      { key: "DISCORD_TOKEN", label: "Discord bot token", secret: true, required: true },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    description:
      "Send messages, read channels and interact with Telegram bots.",
    package: "telegram-mcp",
    site: "https://telegram.org",
    args: [],
    env: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", secret: true, required: true },
    ],
  },
  {
    id: "trello",
    name: "Trello",
    description:
      "Manage boards, lists, cards, checklists and comments on Trello.",
    package: "trello-mcp",
    site: "https://trello.com",
    args: [],
    env: [
      { key: "TRELLO_API_KEY", label: "Trello API key", secret: true, required: true },
      { key: "TRELLO_TOKEN", label: "Trello token", secret: true, required: true },
    ],
  },
  {
    id: "strapi",
    name: "Strapi",
    description:
      "Query content types, entries and media in a headless Strapi CMS.",
    package: "strapi-mcp",
    site: "https://strapi.io",
    args: [],
    env: [
      { key: "STRAPI_URL", label: "Strapi server URL", required: true },
      { key: "STRAPI_API_TOKEN", label: "Strapi API token", secret: true, required: true },
    ],
  },
  {
    id: "spotify",
    name: "Spotify",
    description:
      "Search tracks and artists, control playback and manage playlists on Spotify.",
    package: "spotify-mcp",
    site: "https://spotify.com",
    args: [],
    env: [
      { key: "SPOTIFY_CLIENT_ID", label: "Spotify client ID", required: true },
      { key: "SPOTIFY_CLIENT_SECRET", label: "Spotify client secret", secret: true, required: true },
    ],
  },
  {
    id: "resend",
    name: "Resend",
    description:
      "Send transactional emails, manage domains and check deliverability with Resend.",
    package: "resend-mcp-server",
    site: "https://resend.com",
    args: [],
    env: [
      { key: "RESEND_API_KEY", label: "Resend API key", secret: true, required: true },
    ],
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description:
      "Send transactional emails, manage templates and monitor email delivery with SendGrid.",
    package: "sendgrid-mcp",
    site: "https://sendgrid.com",
    args: [],
    env: [
      { key: "SENDGRID_API_KEY", label: "SendGrid API key", secret: true, required: true },
    ],
  },
  {
    id: "mailjet",
    name: "Mailjet",
    description:
      "Send marketing and transactional emails, manage contact lists and parse statistics.",
    package: "@mailjet/mailjet-mcp-server",
    site: "https://www.mailjet.com",
    args: [],
    env: [
      { key: "MJ_APIKEY_PUBLIC", label: "Mailjet public key", required: true },
      { key: "MJ_APIKEY_PRIVATE", label: "Mailjet private key", secret: true, required: true },
    ],
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    description:
      "Run fast analytical queries, inspect tables and examine schemas in ClickHouse.",
    package: "clickhouse-mcp",
    site: "https://clickhouse.com",
    args: [],
    env: [
      { key: "CLICKHOUSE_HOST", label: "ClickHouse host URL", required: true },
      { key: "CLICKHOUSE_USER", label: "Username", required: false },
      { key: "CLICKHOUSE_PASSWORD", label: "Password", secret: true, required: false },
      { key: "CLICKHOUSE_DATABASE", label: "Database name", required: false },
    ],
  },
  {
    id: "snowflake",
    name: "Snowflake",
    description:
      "Execute SQL queries, inspect tables and manage data warehouses in Snowflake.",
    package: "snowflake-mcp-server",
    site: "https://www.snowflake.com",
    args: [],
    env: [
      { key: "SNOWFLAKE_ACCOUNT", label: "Snowflake account identifier", required: true },
      { key: "SNOWFLAKE_USER", label: "Snowflake user", required: true },
      { key: "SNOWFLAKE_PASSWORD", label: "Snowflake password", secret: true, required: true },
    ],
  },
  {
    id: "qdrant",
    name: "Qdrant",
    description:
      "Search vector embeddings, manage collections and query vector payloads in Qdrant.",
    package: "qdrant-mcp-server",
    site: "https://qdrant.tech",
    args: [],
    env: [
      { key: "QDRANT_URL", label: "Qdrant cluster URL", required: true },
      { key: "QDRANT_API_KEY", label: "Qdrant API key", secret: true, required: false },
    ],
  },
  {
    id: "upstash",
    name: "Upstash",
    description:
      "Manage serverless Redis databases, QStash message queues and vector indexes on Upstash.",
    package: "@upstash/mcp-server",
    site: "https://upstash.com",
    args: [],
    env: [
      { key: "UPSTASH_EMAIL", label: "Upstash account email", required: true },
      { key: "UPSTASH_API_KEY", label: "Upstash API key", secret: true, required: true },
    ],
  },
  {
    id: "couchdb",
    name: "Apache CouchDB",
    description:
      "Query documents, manage views and inspect databases in Apache CouchDB.",
    package: "couchdb-mcp",
    site: "https://couchdb.apache.org",
    args: [],
    env: [
      { key: "COUCHDB_URL", label: "CouchDB URL", required: true },
      { key: "COUCHDB_USER", label: "CouchDB username", required: false },
      { key: "COUCHDB_PASSWORD", label: "CouchDB password", secret: true, required: false },
    ],
  },
  {
    id: "meilisearch",
    name: "Meilisearch",
    description:
      "Search documents, manage indexes and configure ranking rules in Meilisearch.",
    package: "meilisearch-mcp",
    site: "https://www.meilisearch.com",
    args: [],
    env: [
      { key: "MEILISEARCH_HOST", label: "Meilisearch host URL", required: true },
      { key: "MEILISEARCH_API_KEY", label: "Master or search API key", secret: true, required: false },
    ],
  },
  {
    id: "typesense",
    name: "Typesense",
    description:
      "Perform typo-tolerant search, manage collections and query documents in Typesense.",
    package: "typesense-mcp",
    site: "https://typesense.org",
    args: [],
    env: [
      { key: "TYPESENSE_HOST", label: "Typesense host", required: true },
      { key: "TYPESENSE_API_KEY", label: "Typesense API key", secret: true, required: true },
    ],
  },
  {
    id: "aws-s3",
    name: "AWS S3",
    description:
      "List S3 buckets, inspect bucket contents and read or write objects in Amazon S3.",
    package: "aws-s3-mcp",
    site: "https://aws.amazon.com/s3",
    args: [],
    env: [
      { key: "AWS_ACCESS_KEY_ID", label: "AWS access key ID", required: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "AWS secret access key", secret: true, required: true },
      { key: "AWS_REGION", label: "AWS region (e.g. us-east-1)", required: true },
    ],
  },
  {
    id: "kafka",
    name: "Apache Kafka",
    description:
      "Inspect topics, consumer groups and stream messages from an Apache Kafka cluster.",
    package: "kafka-mcp",
    site: "https://kafka.apache.org",
    args: [],
    env: [
      { key: "KAFKA_BROKERS", label: "Broker addresses (comma-separated)", required: true },
    ],
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    description:
      "Inspect message queues, exchanges, bindings and consumers on a RabbitMQ broker.",
    package: "rabbitmq-mcp",
    site: "https://www.rabbitmq.com",
    args: [],
    env: [
      { key: "RABBITMQ_URL", label: "RabbitMQ connection URL", required: true },
    ],
  },
  {
    id: "mqtt",
    name: "MQTT",
    description:
      "Publish and subscribe to MQTT topics and inspect telemetry messages across brokers.",
    package: "mqtt-mcp",
    site: "https://mqtt.org",
    args: [],
    env: [
      { key: "MQTT_BROKER_URL", label: "MQTT broker URL (mqtt://...)", required: true },
    ],
  },
  {
    id: "graphql",
    name: "GraphQL",
    description:
      "Introspect GraphQL schemas, execute queries and run mutations against GraphQL endpoints.",
    package: "graphql-mcp",
    site: "https://graphql.org",
    args: [],
    env: [
      { key: "GRAPHQL_ENDPOINT", label: "GraphQL endpoint URL", required: true },
      { key: "GRAPHQL_TOKEN", label: "Authorization bearer token", secret: true, required: false },
    ],
  },
  {
    id: "openapi",
    name: "OpenAPI",
    description:
      "Load an OpenAPI or Swagger specification and make exploratory API requests.",
    package: "openapi-mcp",
    site: "https://www.openapis.org",
    args: [],
    env: [
      { key: "OPENAPI_SPEC_URL", label: "URL to OpenAPI/Swagger specification", required: true },
    ],
  },
  {
    id: "railway",
    name: "Railway",
    description:
      "Deploy projects, inspect services, manage environment variables and read Railway logs.",
    package: "railway-mcp",
    site: "https://railway.com",
    args: [],
    env: [
      { key: "RAILWAY_API_TOKEN", label: "Railway API token", secret: true, required: true },
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    description:
      "List deployments, inspect projects, manage domains and check build logs in Vercel.",
    package: "vercel-mcp",
    site: "https://vercel.com",
    args: [],
    env: [
      { key: "VERCEL_TOKEN", label: "Vercel API token", secret: true, required: true },
    ],
  },
  {
    id: "newrelic",
    name: "New Relic",
    description:
      "Query NRQL metrics, inspect application traces and check alert policies in New Relic.",
    package: "newrelic-mcp",
    site: "https://newrelic.com",
    args: [],
    env: [
      { key: "NEW_RELIC_API_KEY", label: "New Relic user API key", secret: true, required: true },
      { key: "NEW_RELIC_ACCOUNT_ID", label: "Account ID", required: true },
    ],
  },
  {
    id: "coda",
    name: "Coda",
    description:
      "Search documents, read tables and update rows across Coda collaborative workspaces.",
    package: "coda-mcp",
    site: "https://coda.io",
    args: [],
    env: [
      { key: "CODA_API_TOKEN", label: "Coda API token", secret: true, required: true },
    ],
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description:
      "Browse repositories, review pull requests and track branch activity in Bitbucket.",
    package: "bitbucket-mcp",
    site: "https://bitbucket.org",
    args: [],
    env: [
      { key: "BITBUCKET_USERNAME", label: "Bitbucket username", required: true },
      { key: "BITBUCKET_APP_PASSWORD", label: "Bitbucket app password", secret: true, required: true },
    ],
  },
  {
    id: "docker",
    name: "Docker",
    description:
      "Inspect containers, list images, check container status and execute container commands.",
    package: "mcp-server-docker",
    site: "https://www.docker.com",
    args: [],
    env: [],
  },
  {
    id: "postman",
    name: "Postman",
    description:
      "Search workspaces, inspect collections and run API requests through Postman.",
    package: "@postman/postman-mcp-server",
    site: "https://www.postman.com",
    args: [],
    env: [
      { key: "POSTMAN_API_KEY", label: "Postman API key", secret: true, required: true },
    ],
  },
  {
    id: "axiom",
    name: "Axiom",
    description:
      "Query event logs, analyze high-volume streaming datasets and run APL queries in Axiom.",
    package: "mcp-server-axiom",
    site: "https://axiom.co",
    args: [],
    env: [
      { key: "AXIOM_TOKEN", label: "Axiom API token", secret: true, required: true },
      { key: "AXIOM_DATASET", label: "Dataset name", required: true },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description:
      "Search email threads, inspect message contents and send emails through Gmail.",
    package: "@gongrzhe/server-gmail-autoauth-mcp",
    site: "https://mail.google.com",
    args: [],
    env: [
      { key: "GMAIL_CLIENT_ID", label: "Google OAuth client ID", required: true },
      { key: "GMAIL_CLIENT_SECRET", label: "Google OAuth client secret", secret: true, required: true },
    ],
  },
  {
    id: "mastra",
    name: "Mastra Docs",
    description:
      "Search technical documentation, agentic frameworks and reference guides for Mastra.",
    package: "@mastra/mcp-docs-server",
    site: "https://mastra.ai",
    args: [],
    env: [],
  },
  {
    id: "serper",
    name: "Serper Search",
    description:
      "Query Google search results, news, places and images via Serper developer API.",
    package: "serper-search-scrape-mcp-server",
    site: "https://serper.dev",
    args: [],
    env: [
      { key: "SERPER_API_KEY", label: "Serper API key", secret: true, required: true },
    ],
  },
  {
    id: "jamf",
    name: "Jamf Docs",
    description:
      "Search Apple enterprise device management documentation and API references on Jamf.",
    package: "@get-technology-inc/jamf-docs-mcp-server",
    site: "https://learn.jamf.com",
    args: [],
    env: [],
  },
  {
    id: "openweather",
    name: "OpenWeather",
    description:
      "Look up real-time weather forecasts, current conditions and weather history by city.",
    package: "openweather-mcp",
    site: "https://openweathermap.org",
    args: [],
    env: [
      { key: "OPENWEATHER_API_KEY", label: "OpenWeatherMap API key", secret: true, required: true },
    ],
  },
  {
    id: "twilio",
    name: "Twilio SMS",
    description:
      "Send SMS messages, inspect message delivery logs and lookup phone carrier details.",
    package: "twilio-mcp",
    site: "https://www.twilio.com",
    args: [],
    env: [
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio account SID", required: true },
      { key: "TWILIO_AUTH_TOKEN", label: "Twilio auth token", secret: true, required: true },
    ],
  },
  {
    id: "zendesk",
    name: "Zendesk",
    description:
      "Manage support tickets, search help center articles and update customer records.",
    package: "zendesk-mcp",
    site: "https://www.zendesk.com",
    args: [],
    env: [
      { key: "ZENDESK_SUBDOMAIN", label: "Zendesk subdomain (e.g. yourcompany)", required: true },
      { key: "ZENDESK_EMAIL", label: "Admin or agent email", required: true },
      { key: "ZENDESK_API_TOKEN", label: "API token", secret: true, required: true },
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description:
      "Describe Salesforce schemas, query standard and custom sObjects, and inspect fields.",
    package: "salesforce-mcp",
    site: "https://www.salesforce.com",
    args: [],
    env: [
      { key: "SALESFORCE_INSTANCE_URL", label: "Instance URL (https://...)", required: true },
      { key: "SALESFORCE_ACCESS_TOKEN", label: "OAuth access token", secret: true, required: true },
    ],
  },
  {
    id: "transcend",
    name: "Transcend Privacy",
    description:
      "Manage data privacy requests, data inventory and compliance workflows in Transcend.",
    package: "@transcend-io/mcp",
    site: "https://transcend.io",
    args: [],
    env: [
      { key: "TRANSCEND_API_KEY", label: "Transcend API key", secret: true, required: true },
    ],
  },
  {
    id: "postgrest",
    name: "PostgREST",
    description:
      "Query RESTful database endpoints and filter records served by PostgREST.",
    package: "@supabase/mcp-server-postgrest",
    site: "https://postgrest.org",
    args: [],
    env: [
      { key: "POSTGREST_URL", label: "PostgREST endpoint URL", required: true },
      { key: "POSTGREST_TOKEN", label: "JWT authorization token", secret: true, required: false },
    ],
  },
  {
    id: "argocd",
    name: "Argo CD",
    description:
      "Inspect Kubernetes deployments, sync application states and query clusters in Argo CD.",
    package: "argocd-mcp",
    site: "https://argo-cd.readthedocs.io",
    args: [],
    env: [
      { key: "ARGOCD_SERVER", label: "Argo CD server URL", required: true },
      { key: "ARGOCD_AUTH_TOKEN", label: "Auth token", secret: true, required: true },
    ],
  },
  {
    id: "prometheus",
    name: "Prometheus",
    description:
      "Query PromQL metrics, check target health and inspect alerts in Prometheus.",
    package: "prometheus-mcp",
    site: "https://prometheus.io",
    args: [],
    env: [
      { key: "PROMETHEUS_URL", label: "Prometheus server URL", required: true },
    ],
  },
  {
    id: "coinmarketcap",
    name: "CoinMarketCap",
    description:
      "Fetch live cryptocurrency prices, market capitalization and volume rankings.",
    package: "coinmarketcap-mcp",
    site: "https://coinmarketcap.com",
    args: [],
    env: [
      { key: "COINMARKETCAP_API_KEY", label: "CoinMarketCap API key", secret: true, required: true },
    ],
  },
  {
    id: "finnhub",
    name: "Finnhub Financial",
    description:
      "Look up stock market quotes, company profiles, analyst ratings and financial news.",
    package: "finnhub-mcp",
    site: "https://finnhub.io",
    args: [],
    env: [
      { key: "FINNHUB_API_KEY", label: "Finnhub API key", secret: true, required: true },
    ],
  },
  {
    id: "unsplash",
    name: "Unsplash",
    description:
      "Search high-resolution royalty-free photography, photos and image collections.",
    package: "unsplash-mcp",
    site: "https://unsplash.com",
    args: [],
    env: [
      { key: "UNSPLASH_ACCESS_KEY", label: "Unsplash access key", secret: true, required: true },
    ],
  },
  {
    id: "pexels",
    name: "Pexels",
    description:
      "Search free stock photos and videos from photographers and creators on Pexels.",
    package: "pexels-mcp",
    site: "https://www.pexels.com",
    args: [],
    env: [
      { key: "PEXELS_API_KEY", label: "Pexels API key", secret: true, required: true },
    ],
  },
  {
    id: "newsapi",
    name: "NewsAPI",
    description:
      "Search global news articles, track events and read media headlines via Event Registry.",
    package: "newsapi-mcp",
    site: "https://newsapi.ai",
    args: [],
    env: [
      { key: "NEWSAPI_API_KEY", label: "NewsAPI.ai API key", secret: true, required: true },
    ],
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    description:
      "Search articles, read summaries and extract reference sections from Wikipedia.",
    package: "wikipedia-mcp",
    site: "https://www.wikipedia.org",
    args: [],
    env: [],
  },
  {
    id: "polygon-crypto",
    name: "Polygon Crypto",
    description:
      "Query onchain balances, smart contract events and transactions on Polygon network.",
    package: "polygon-mcp",
    site: "https://polygon.technology",
    args: [],
    env: [
      { key: "POLYGON_RPC_URL", label: "Polygon RPC URL", required: false },
    ],
  },
  {
    id: "swagger",
    name: "Swagger API Docs",
    description:
      "Parse and test REST endpoints from Swagger and OpenAPI documentation schemas.",
    package: "swagger-mcp",
    site: "https://swagger.io",
    args: [],
    env: [
      { key: "SWAGGER_URL", label: "Swagger schema URL", required: true },
    ],
  },
  {
    id: "runpod",
    name: "RunPod",
    description:
      "Manage GPU cloud pods, monitor serverless endpoints and check resource billing.",
    package: "@runpod/mcp-server",
    site: "https://runpod.io",
    args: [],
    env: [
      { key: "RUNPOD_API_KEY", label: "RunPod API key", secret: true, required: true },
    ],
  },
  {
    id: "xero",
    name: "Xero Accounting",
    description:
      "Manage invoices, bank transactions, contacts and accounting records in Xero.",
    package: "@xeroapi/xero-mcp-server",
    site: "https://www.xero.com",
    args: [],
    env: [
      { key: "XERO_CLIENT_ID", label: "Xero client ID", required: true },
      { key: "XERO_CLIENT_SECRET", label: "Xero client secret", secret: true, required: true },
    ],
  },
  {
    id: "browserstack",
    name: "BrowserStack",
    description:
      "Run cross-browser tests, automate device sessions and inspect test run logs.",
    package: "@browserstack/mcp-server",
    site: "https://www.browserstack.com",
    args: [],
    env: [
      { key: "BROWSERSTACK_USERNAME", label: "BrowserStack username", required: true },
      { key: "BROWSERSTACK_ACCESS_KEY", label: "BrowserStack access key", secret: true, required: true },
    ],
  },
  {
    id: "qase",
    name: "Qase TestOps",
    description:
      "Create test cases, organize test suites and log manual or automated test runs in Qase.",
    package: "@qase/mcp-server",
    site: "https://qase.io",
    args: [],
    env: [
      { key: "QASE_API_TOKEN", label: "Qase API token", secret: true, required: true },
    ],
  },
  {
    id: "mantine",
    name: "Mantine UI Docs",
    description:
      "Search component specifications, hooks and style guides for Mantine React library.",
    package: "@mantine/mcp-server",
    site: "https://mantine.dev",
    args: [],
    env: [],
  },
  {
    id: "pandacss",
    name: "Panda CSS Docs",
    description:
      "Search build-time CSS-in-JS documentation, recipes and tokens for Panda CSS.",
    package: "@pandacss/mcp",
    site: "https://panda-css.com",
    args: [],
    env: [],
  },
  {
    id: "hostinger",
    name: "Hostinger Cloud",
    description:
      "Manage VPS servers, DNS zones, domain records and cloud hosting via Hostinger API.",
    package: "hostinger-api-mcp",
    site: "https://www.hostinger.com",
    args: [],
    env: [
      { key: "HOSTINGER_API_TOKEN", label: "Hostinger API token", secret: true, required: true },
    ],
  },
  {
    id: "dataforseo",
    name: "DataForSEO",
    description:
      "Query search engine SERPs, keyword search volumes, backlinks and SEO metrics.",
    package: "dataforseo-mcp-server",
    site: "https://dataforseo.com",
    args: [],
    env: [
      { key: "DATAFORSEO_LOGIN", label: "DataForSEO login", required: true },
      { key: "DATAFORSEO_PASSWORD", label: "DataForSEO password", secret: true, required: true },
    ],
  },
  {
    id: "next-devtools",
    name: "Next.js DevTools",
    description:
      "Inspect App Router routes, server components and build output in Next.js projects.",
    package: "next-devtools-mcp",
    site: "https://nextjs.org",
    args: [],
    env: [],
  },
  {
    id: "clarity",
    name: "Microsoft Clarity",
    description:
      "Export user session recordings, heatmaps and behavioural analytics from Microsoft Clarity.",
    package: "@microsoft/clarity-mcp-server",
    site: "https://clarity.microsoft.com",
    args: [],
    env: [
      { key: "CLARITY_API_TOKEN", label: "Clarity API token", secret: true, required: true },
    ],
  },
  {
    id: "phantom",
    name: "Phantom Wallet",
    description:
      "Inspect multichain crypto balances, tokens and account addresses across Solana and Ethereum.",
    package: "@phantom/mcp-server",
    site: "https://phantom.app",
    args: [],
    env: [],
  },
  {
    id: "scryfall",
    name: "Scryfall MTG",
    description:
      "Search Magic: The Gathering cards, rulings, set symbols, printings and market prices.",
    package: "scryfall-mcp-server",
    site: "https://scryfall.com",
    args: [],
    env: [],
  },
];

/** The package's page on npm, which renders its README. Derived rather than stored, so the link can
 * never drift out of step with the package name. */
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

/** What is still missing before a server can start. Returned, not thrown, so the interface can open
 * the setup fields rather than starting something doomed. */
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

/** The arguments a server is started with: its own, then anything the user supplied. The package
 * itself is installed separately and run directly. */
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

/** Whether a field is a credential. The catalogue says for its own servers; otherwise only the name
 * is evidence, so it is read cautiously. */
function isSecretField(id, field) {
  const entry = findEntry(String(id));
  const declared = (entry?.env || []).find((one) => one.key === field);

  if (declared) return Boolean(declared.secret);

  return /token|key|secret|password|credential/i.test(String(field));
}

module.exports = {
  CATALOGUE,
  isSecretField,
  listCatalogue,
  findEntry,
  searchCatalogue,
  missingRequirements,
  commandFor,
  docsUrl,
};
