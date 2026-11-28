use super::*;

const SECRET_VALUE: &str = "sk-live-SUPERSECRET123";

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(path, text).expect("write");
}

fn fixture_home() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("import-home")
        .tempdir()
        .expect("tempdir");
    let home = dir.path();
    write(&home.join(".claude/CLAUDE.md"), "# My rules\nBe brief.\n");
    write(
        &home.join(".claude/skills/Release Notes/SKILL.md"),
        "---\nname: Release Notes\ndescription: Write release notes.\n---\n\nBody.\n",
    );
    write(&home.join(".claude/skills/Release Notes/refs/a.md"), "ref");
    write(
        &home.join(".claude/skills/broken/SKILL.md"),
        "no front matter",
    );
    write(&home.join(".claude/commands/deploy.md"), "Deploy it");
    write(&home.join(".claude/agents/reviewer.md"), "Review it");
    write(
        &home.join(".claude.json"),
        &format!(
            r#"{{"mcpServers":{{
              "github":{{"command":"npx","args":["-y","@modelcontextprotocol/server-github@1.2","--token={SECRET_VALUE}"],
                         "env":{{"GITHUB_PERSONAL_ACCESS_TOKEN":"{SECRET_VALUE}","LOG_LEVEL":"debug"}}}},
              "remote":{{"type":"http","url":"https://mcp.example.com/mcp","headers":{{"Authorization":"Bearer {SECRET_VALUE}"}}}},
              "py":{{"command":"python","args":["server.py"]}}
            }}}}"#
        ),
    );
    write(&home.join(".codex/AGENTS.md"), "Codex rules\n");
    write(
        &home.join(".codex/skills/tidy/SKILL.md"),
        "---\nname: tidy\ndescription: Tidy up.\n---\n\nBody.\n",
    );
    write(
        &home.join(".codex/config.toml"),
        &format!(
            "model = \"gpt\"\n[mcp_servers.docs]\ncommand = \"npx\"\nargs = [\"-y\", \"docs-mcp\"] # note\nenv = {{ API_KEY = \"{SECRET_VALUE}\", REGION = \"eu\" }}\n\n[mcp_servers.files]\ncommand = \"cmd\"\nargs = [\n  \"/c\", \"npx\",\n  \"files-mcp\",\n]\n[mcp_servers.files.env]\nROOT = \"C:\\\\data\"\n[mcp_servers.web]\nurl = \"https://web.example.com/mcp\"\nbearer_token_env_var = \"WEB_TOKEN\"\n"
        ),
    );
    dir
}

fn taken(home: &Path) -> Taken {
    Taken {
        skills_root: home.join("draggy-data/skills"),
        mcp_ids: HashSet::new(),
    }
}

fn find<'a>(items: &'a [Item], key: &str) -> &'a Item {
    items
        .iter()
        .find(|item| item.key() == key)
        .unwrap_or_else(|| panic!("no {key}"))
}

#[test]
fn scan_lists_both_tools_and_never_exposes_secrets() {
    let dir = fixture_home();
    let items = scan(dir.path(), &taken(dir.path()));
    let keys: Vec<String> = items.iter().map(Item::key).collect();
    for key in [
        "claude:memory:global",
        "claude:skill:release-notes",
        "claude:command:deploy",
        "claude:agent:reviewer",
        "claude:mcp:github",
        "codex:memory:global",
        "codex:skill:tidy",
        "codex:mcp:docs",
        "codex:mcp:files",
        "codex:mcp:web",
    ] {
        assert!(keys.contains(&key.to_owned()), "{key} in {keys:?}");
    }
    assert!(!find(&items, "claude:skill:broken").supported);
    assert!(!find(&items, "claude:command:deploy").supported);
    assert!(!find(&items, "claude:mcp:py").supported);
    let preview = Value::Array(items.iter().map(Item::preview).collect()).to_string();
    assert!(!preview.contains("SUPERSECRET"), "preview leaked a secret");
    assert!(
        !preview.contains("Be brief"),
        "preview leaked file contents"
    );
}

#[test]
fn secret_env_headers_and_args_are_dropped_and_the_server_needs_a_key() {
    let dir = fixture_home();
    let items = scan(dir.path(), &taken(dir.path()));

    let github = find(&items, "claude:mcp:github");
    assert!(github.needs_key);
    let Payload::Mcp(entry) = &github.payload else {
        panic!("mcp")
    };
    assert_eq!(
        entry["package"],
        json!("@modelcontextprotocol/server-github")
    );
    assert_eq!(entry["args"], json!([]));
    assert_eq!(entry["env"], json!({ "LOG_LEVEL": "debug" }));
    assert_eq!(
        entry["envDeclarations"][0]["key"],
        json!("GITHUB_PERSONAL_ACCESS_TOKEN")
    );
    assert!(!entry.to_string().contains("SUPERSECRET"));

    let remote = find(&items, "claude:mcp:remote");
    assert!(remote.needs_key);
    let Payload::Mcp(entry) = &remote.payload else {
        panic!("mcp")
    };
    assert_eq!(entry["url"], json!("https://mcp.example.com/mcp"));
    assert!(!entry.to_string().contains("SUPERSECRET"));
    assert!(entry.get("headers").is_none());

    let docs = find(&items, "codex:mcp:docs");
    let Payload::Mcp(entry) = &docs.payload else {
        panic!("mcp")
    };
    assert!(docs.needs_key);
    assert_eq!(entry["env"], json!({ "REGION": "eu" }));
    assert_eq!(entry["args"], json!([]));

    let web = find(&items, "codex:mcp:web");
    assert!(web.needs_key, "bearer_token_env_var marks a key");

    let files = find(&items, "codex:mcp:files");
    assert!(!files.needs_key);
    let Payload::Mcp(entry) = &files.payload else {
        panic!("mcp")
    };
    assert_eq!(entry["package"], json!("files-mcp"));
    assert_eq!(entry["env"], json!({ "ROOT": "C:\\data" }));
}

#[test]
fn apply_copies_skills_memory_and_servers_and_keeps_secrets_out() {
    let dir = fixture_home();
    let taken = taken(dir.path());
    let items = scan(dir.path(), &taken);
    let requests: Vec<Request> = [
        "claude:skill:release-notes",
        "claude:memory:global",
        "claude:mcp:github",
        "claude:command:deploy",
        "claude:skill:broken",
    ]
    .iter()
    .map(|key| Request {
        key: (*key).to_owned(),
        rename: (*key == "claude:mcp:github").then(|| "gh-imported".to_owned()),
    })
    .collect();
    let mut config = Map::new();
    let done = apply(&items, &requests, &taken.skills_root, &mut config);

    let status = |key: &str| {
        done.outcomes
            .iter()
            .find(|o| o.key == key)
            .map(|o| (o.status, o.reason))
    };
    assert_eq!(
        status("claude:skill:release-notes"),
        Some(("imported", None))
    );
    assert_eq!(status("claude:mcp:github"), Some(("imported", None)));
    assert_eq!(
        status("claude:command:deploy"),
        Some(("skipped", Some("noCommandFolder")))
    );
    assert_eq!(
        status("claude:skill:broken"),
        Some(("skipped", Some("invalid")))
    );
    assert!(taken.skills_root.join("release-notes/SKILL.md").is_file());
    assert!(taken.skills_root.join("release-notes/refs/a.md").is_file());
    assert_eq!(done.memory, vec!["# My rules\nBe brief.".to_owned()]);
    assert!(config["gh-imported"]["needsKey"] == json!(true));
    assert!(!Value::Object(config).to_string().contains("SUPERSECRET"));
}

#[test]
fn a_clash_is_marked_skipped_without_a_rename_and_imported_with_one() {
    let dir = fixture_home();
    let mut taken = taken(dir.path());
    write(&taken.skills_root.join("release-notes/SKILL.md"), "mine");
    taken.mcp_ids.insert("github".to_owned());
    let items = scan(dir.path(), &taken);
    assert!(find(&items, "claude:skill:release-notes").clash);
    assert!(find(&items, "claude:mcp:github").clash);

    let mut config = Map::new();
    config.insert("github".into(), json!({}));
    let ask = |key: &str, rename: Option<&str>| Request {
        key: key.to_owned(),
        rename: rename.map(str::to_owned),
    };
    let first = apply(
        &items,
        &[
            ask("claude:skill:release-notes", None),
            ask("claude:mcp:github", None),
        ],
        &taken.skills_root,
        &mut config,
    );
    assert!(
        first
            .outcomes
            .iter()
            .all(|o| o.status == "skipped" && o.reason == Some("exists"))
    );
    assert_eq!(
        fs::read_to_string(taken.skills_root.join("release-notes/SKILL.md")).expect("kept"),
        "mine"
    );

    let second = apply(
        &items,
        &[
            ask("claude:skill:release-notes", Some("release-notes-2")),
            ask("claude:mcp:github", Some("github-2")),
        ],
        &taken.skills_root,
        &mut config,
    );
    assert!(second.outcomes.iter().all(|o| o.status == "imported"));
    assert!(taken.skills_root.join("release-notes-2/SKILL.md").is_file());
    assert!(config.contains_key("github-2"));
    let bad = apply(
        &items,
        &[ask("claude:skill:release-notes", Some("../evil"))],
        &taken.skills_root,
        &mut config,
    );
    assert_eq!(bad.outcomes[0].reason, Some("badName"));
    assert!(!dir.path().join("draggy-data/evil").exists());
}

#[test]
fn a_missing_home_scans_empty_and_toml_reads_the_subset() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(scan(dir.path(), &taken(dir.path())).is_empty());
    let parsed = toml_lite::parse(
        "a = 1\n[x.\"y z\"]\nk = [\"a\", 'b']\nflag = true\nt = { u = \"v\", w = 2 }\n",
    );
    assert_eq!(parsed["x"]["y z"]["k"], json!(["a", "b"]));
    assert_eq!(parsed["x"]["y z"]["flag"], json!(true));
    assert_eq!(parsed["x"]["y z"]["t"], json!({ "u": "v", "w": 2 }));
    assert_eq!(parsed["a"], json!(1));
}

#[test]
fn secret_names_are_recognised() {
    for name in [
        "API_KEY",
        "github_token",
        "CLIENT_SECRET",
        "DB_PASSWORD",
        "AUTHORIZATION",
        "X-Bearer",
    ] {
        assert!(looks_secret(name), "{name}");
    }
    assert!(!looks_secret("LOG_LEVEL"));
}
