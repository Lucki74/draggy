//! Checks GitHub releases for updates, verifies SHA-256 sums, and downloads release assets.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use crate::error::CoreError;

const USER_AGENT: &str = concat!("Draggy/", env!("CARGO_PKG_VERSION"));

/// A release newer than the running build.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct UpdateRecord {
    pub tag: String,
    pub build: u32,
    pub name: String,
    pub notes: String,
    /// The release page to open in the browser.
    pub url: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub asset_size: Option<u64>,
    pub checksums_url: Option<String>,
}

/// Progress reported during an update download and verification.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct UpdateProgressRecord {
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub phase: String,
}

/// Implemented by host shells to receive update progress notifications.
#[uniffi::export(with_foreign)]
pub trait UpdateObserver: Send + Sync {
    fn on_progress(&self, progress: UpdateProgressRecord);
}

/// Parse standard sha256sum lines into a map of filename to lowercase hash.
#[uniffi::export]
pub fn parse_sha256sums(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        if let (Some(hash), Some(filename)) = (parts.next(), parts.next()) {
            let clean_name = filename.strip_prefix('*').unwrap_or(filename);
            let basename = clean_name.rsplit(['/', '\\']).next().unwrap_or(clean_name);
            map.insert(basename.to_string(), hash.to_lowercase());
        }
    }
    map
}

/// Checks whether an asset filename matches the expected target platform.
pub fn matches_platform(asset_name: &str, platform: &str) -> bool {
    match platform {
        "macos" => asset_name.starts_with("Draggy") && asset_name.ends_with(".zip"),
        "windows" => asset_name == "draggy_setup.exe" || asset_name.ends_with(".exe"),
        "linux" => asset_name.ends_with(".deb") || asset_name.ends_with(".rpm"),
        "linux-deb" | "deb" => asset_name.ends_with(".deb"),
        "linux-rpm" | "rpm" => asset_name.ends_with(".rpm"),
        _ => false,
    }
}

/// Current platform identifier for matching update assets.
pub fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "unknown"
    }
}

/// The build number in `tag`, when it is `<prefix><digits>`.
fn build_of(tag: &str, prefix: &str) -> Option<u32> {
    let digits = tag.strip_prefix(prefix)?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Resolves the newest release matching the prefix and platform.
pub fn newest_update_for_platform(
    releases_json: &str,
    tag_prefix: &str,
    current_build: u32,
    include_prereleases: bool,
    platform: Option<&str>,
) -> Result<Option<UpdateRecord>, CoreError> {
    let effective_prefix = if tag_prefix.is_empty() {
        "b-"
    } else {
        tag_prefix
    };
    let target_platform: &str = match platform {
        Some(p) => p,
        None => current_platform(),
    };
    let parsed: Value =
        serde_json::from_str(releases_json).map_err(|error| CoreError::Internal {
            message: format!("could not read the release list: {error}"),
        })?;
    let releases = parsed.as_array().ok_or_else(|| CoreError::Internal {
        message: "could not read the release list: not a list".to_owned(),
    })?;
    let text = |release: &Value, key: &str| {
        release
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let flag = |release: &Value, key: &str| release.get(key).and_then(Value::as_bool) == Some(true);
    let newest = releases
        .iter()
        .filter(|release| {
            !flag(release, "draft") && (include_prereleases || !flag(release, "prerelease"))
        })
        .filter_map(|release| {
            build_of(&text(release, "tag_name"), effective_prefix).map(|build| (build, release))
        })
        .filter(|(build, _)| *build > current_build)
        .max_by_key(|(build, _)| *build);

    Ok(newest.map(|(build, release)| {
        let tag = text(release, "tag_name");
        let name = text(release, "name");
        let mut asset_name = None;
        let mut asset_url = None;
        let mut asset_size = None;
        let mut checksums_url = None;

        if let Some(assets) = release.get("assets").and_then(Value::as_array) {
            for asset in assets {
                let a_name = text(asset, "name");
                let dl_url = text(asset, "browser_download_url");
                let size = asset.get("size").and_then(Value::as_u64);
                if a_name == "SHA256SUMS.txt" || a_name.starts_with("SHA256SUMS") {
                    checksums_url = Some(dl_url.clone());
                }
                if asset_name.is_none() && matches_platform(&a_name, target_platform) {
                    asset_name = Some(a_name);
                    asset_url = Some(dl_url);
                    asset_size = size;
                }
            }
        }

        UpdateRecord {
            name: if name.is_empty() { tag.clone() } else { name },
            notes: text(release, "body"),
            url: text(release, "html_url"),
            tag,
            build,
            asset_name,
            asset_url,
            asset_size,
            checksums_url,
        }
    }))
}

/// The newest release of the line newer than current_build.
pub fn newest_update(
    releases_json: &str,
    tag_prefix: &str,
    current_build: u32,
    include_prereleases: bool,
) -> Result<Option<UpdateRecord>, CoreError> {
    newest_update_for_platform(
        releases_json,
        tag_prefix,
        current_build,
        include_prereleases,
        None,
    )
}

/// Looks for a newer build on GitHub and downloads verified updates.
#[derive(uniffi::Object)]
pub struct UpdateChecker {
    client: reqwest::Client,
    repository: String,
    tag_prefix: String,
}

#[uniffi::export(async_runtime = "tokio")]
impl UpdateChecker {
    /// `repository` is `owner/name`; `tag_prefix` defaults to `b-` if empty or None.
    #[uniffi::constructor]
    pub fn new(repository: String, tag_prefix: Option<String>) -> Result<Self, CoreError> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| CoreError::Internal {
                message: error.to_string(),
            })?;
        let tag_prefix = tag_prefix
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "b-".to_string());
        Ok(Self {
            client,
            repository,
            tag_prefix,
        })
    }

    /// The newest release after `current_build`, or None when this build is current.
    pub async fn check(
        &self,
        current_build: u32,
        include_prereleases: bool,
    ) -> Result<Option<UpdateRecord>, CoreError> {
        self.check_for_platform(current_build, include_prereleases, None)
            .await
    }

    /// Checks for a release matching an explicit platform identifier.
    pub async fn check_for_platform(
        &self,
        current_build: u32,
        include_prereleases: bool,
        platform: Option<String>,
    ) -> Result<Option<UpdateRecord>, CoreError> {
        let url = format!(
            "https://api.github.com/repos/{}/releases?per_page=100",
            self.repository
        );
        let response = self
            .client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| CoreError::Internal {
                message: format!("could not reach GitHub: {error}"),
            })?;
        if !response.status().is_success() {
            return Err(CoreError::Internal {
                message: format!("GitHub answered {}", response.status()),
            });
        }
        let text = response.text().await.map_err(|error| CoreError::Internal {
            message: error.to_string(),
        })?;
        newest_update_for_platform(
            &text,
            &self.tag_prefix,
            current_build,
            include_prereleases,
            platform.as_deref(),
        )
    }

    /// Downloads and verifies an asset file against SHA256SUMS.txt.
    pub async fn download_and_verify(
        &self,
        asset_url: String,
        asset_name: String,
        checksums_url: Option<String>,
        dest_file: String,
        observer: Option<std::sync::Arc<dyn UpdateObserver>>,
    ) -> Result<String, CoreError> {
        let expected_hash = if let Some(cs_url) = checksums_url {
            let resp = self
                .client
                .get(cs_url)
                .send()
                .await
                .map_err(|e| CoreError::Internal {
                    message: format!("failed to fetch checksums: {e}"),
                })?;
            if !resp.status().is_success() {
                return Err(CoreError::Internal {
                    message: format!("checksums download returned status {}", resp.status()),
                });
            }
            let text = resp.text().await.map_err(|e| CoreError::Internal {
                message: format!("failed to read checksums text: {e}"),
            })?;
            let map = parse_sha256sums(&text);
            let hash = map.get(&asset_name).cloned();
            if hash.is_none() {
                return Err(CoreError::Internal {
                    message: format!("asset {asset_name} not found in SHA256SUMS.txt"),
                });
            }
            hash
        } else {
            None
        };

        let mut response =
            self.client
                .get(&asset_url)
                .send()
                .await
                .map_err(|e| CoreError::Internal {
                    message: format!("failed to start download: {e}"),
                })?;
        let status = response.status();
        if !status.is_success() {
            return Err(CoreError::Internal {
                message: format!("download server returned {status}"),
            });
        }
        let total_bytes = response.content_length();

        let dest_path = std::path::PathBuf::from(&dest_file);
        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::Internal {
                message: format!("failed to create dir: {e}"),
            })?;
        }
        let mut file = std::fs::File::create(&dest_path).map_err(|e| CoreError::Internal {
            message: format!("failed to create file {dest_file}: {e}"),
        })?;

        use sha2::Digest;
        use std::io::Write;
        let mut hasher = sha2::Sha256::new();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = response.chunk().await.map_err(|e| CoreError::Internal {
            message: format!("error reading chunk: {e}"),
        })? {
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| CoreError::Internal {
                message: format!("error writing chunk: {e}"),
            })?;
            downloaded += chunk.len() as u64;
            if let Some(ref obs) = observer {
                obs.on_progress(UpdateProgressRecord {
                    bytes: downloaded,
                    total_bytes,
                    phase: "download".to_string(),
                });
            }
        }
        file.flush().map_err(|e| CoreError::Internal {
            message: format!("error flushing file: {e}"),
        })?;
        drop(file);

        if let Some(ref expected) = expected_hash {
            if let Some(ref obs) = observer {
                obs.on_progress(UpdateProgressRecord {
                    bytes: downloaded,
                    total_bytes,
                    phase: "verify".to_string(),
                });
            }
            let actual = hex::encode(hasher.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = std::fs::remove_file(&dest_path);
                return Err(CoreError::Internal {
                    message: format!(
                        "SHA-256 verification failed for {asset_name}: expected {expected}, got {actual}"
                    ),
                });
            }
        }

        if let Some(ref obs) = observer {
            obs.on_progress(UpdateProgressRecord {
                bytes: downloaded,
                total_bytes: Some(downloaded),
                phase: "ready".to_string(),
            });
        }

        Ok(dest_file)
    }

    /// Downloads the asset from `update` into `dest_dir` and verifies SHA-256.
    pub async fn download_update(
        &self,
        update: UpdateRecord,
        dest_dir: String,
        observer: Option<std::sync::Arc<dyn UpdateObserver>>,
    ) -> Result<String, CoreError> {
        let asset_url = update.asset_url.ok_or_else(|| CoreError::Internal {
            message: "no downloadable asset url in update record".to_string(),
        })?;
        let asset_name = update
            .asset_name
            .unwrap_or_else(|| "update.bin".to_string());
        let dest_path = std::path::Path::new(&dest_dir).join(&asset_name);
        self.download_and_verify(
            asset_url,
            asset_name,
            update.checksums_url,
            dest_path.to_string_lossy().to_string(),
            observer,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"[
      {
        "tag_name": "b-210",
        "name": "build-210",
        "html_url": "https://x/b-210",
        "draft": false,
        "prerelease": false,
        "assets": [
          {"name": "Draggy-3.0.210-macos-arm64.zip", "browser_download_url": "https://x/dl/Draggy.zip", "size": 5000},
          {"name": "draggy_setup.exe", "browser_download_url": "https://x/dl/setup.exe", "size": 6000},
          {"name": "draggy_3.0.210_amd64.deb", "browser_download_url": "https://x/dl/draggy.deb", "size": 4000},
          {"name": "SHA256SUMS.txt", "browser_download_url": "https://x/dl/SHA256SUMS.txt", "size": 128}
        ]
      },
      {"tag_name":"macos-b-3","name":"macOS 3","body":"Third","html_url":"https://x/m3","draft":false,"prerelease":false},
      {"tag_name":"macos-b-5","name":"","html_url":"https://x/m5","draft":false,"prerelease":true},
      {"tag_name":"macos-b-4","name":"macOS 4","body":null,"html_url":"https://x/m4","draft":true,"prerelease":false},
      {"tag_name":"macos-b-2","name":"macOS 2","html_url":"https://x/m2","draft":false,"prerelease":false},
      {"tag_name":"macos-b-x","html_url":"https://x/mx"}
    ]"#;

    #[test]
    fn picks_the_newest_published_build_of_the_line() {
        let update = newest_update(LIST, "macos-b-", 2, false).unwrap().unwrap();
        assert_eq!(update.tag, "macos-b-3");
        assert_eq!(update.build, 3);
        assert_eq!(update.notes, "Third");
        assert_eq!(update.url, "https://x/m3");
    }

    #[test]
    fn defaults_to_b_prefix_when_empty() {
        let update = newest_update(LIST, "", 200, false).unwrap().unwrap();
        assert_eq!(update.tag, "b-210");
        assert_eq!(update.build, 210);
    }

    #[test]
    fn a_current_build_has_no_update() {
        assert_eq!(newest_update(LIST, "macos-b-", 3, false).unwrap(), None);
    }

    #[test]
    fn prereleases_count_only_when_asked_and_drafts_never() {
        let update = newest_update(LIST, "macos-b-", 0, true).unwrap().unwrap();
        assert_eq!(update.tag, "macos-b-5");
        assert_eq!(update.name, "macos-b-5");
    }

    #[test]
    fn another_line_is_ignored() {
        assert_eq!(newest_update(LIST, "linux-b-", 0, true).unwrap(), None);
    }

    #[test]
    fn a_broken_list_is_an_error() {
        assert!(newest_update("{", "macos-b-", 0, false).is_err());
    }

    #[test]
    fn matches_platform_assets_correctly() {
        assert!(matches_platform("Draggy-3.0.10-macos-arm64.zip", "macos"));
        assert!(!matches_platform("draggy_setup.exe", "macos"));
        assert!(matches_platform("draggy_setup.exe", "windows"));
        assert!(matches_platform("draggy_3.0.10_amd64.deb", "linux"));
        assert!(matches_platform("draggy-3.0.10-1.x86_64.rpm", "linux"));
        assert!(matches_platform("draggy_3.0.10_amd64.deb", "linux-deb"));
        assert!(!matches_platform("draggy-3.0.10-1.x86_64.rpm", "linux-deb"));
    }

    #[test]
    fn resolves_platform_asset_and_checksum_url() {
        let update = newest_update_for_platform(LIST, "b-", 200, false, Some("macos"))
            .unwrap()
            .unwrap();
        assert_eq!(
            update.asset_name.as_deref(),
            Some("Draggy-3.0.210-macos-arm64.zip")
        );
        assert_eq!(update.asset_url.as_deref(), Some("https://x/dl/Draggy.zip"));
        assert_eq!(update.asset_size, Some(5000));
        assert_eq!(
            update.checksums_url.as_deref(),
            Some("https://x/dl/SHA256SUMS.txt")
        );
    }

    #[test]
    fn parses_sha256sums_lines() {
        let content = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Draggy-3.0.10.zip\n\
                       # comment\n\
                       0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *draggy_setup.exe\n";
        let parsed = parse_sha256sums(content);
        assert_eq!(
            parsed.get("Draggy-3.0.10.zip"),
            Some(&"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string())
        );
        assert_eq!(
            parsed.get("draggy_setup.exe"),
            Some(&"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string())
        );
        assert_eq!(parsed.len(), 2);
    }
}
