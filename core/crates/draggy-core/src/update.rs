//! "A new version is available" for builds that are not signed for Sparkle: reads the GitHub releases list and picks the
//! newest build of this app's own line (`macos-b-N`, `linux-b-N`).
//!
//! The Windows app keeps its own updater and its `b-N` tags; the prefix keeps the lines apart.

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
    /// The release page, to open in the browser.
    pub url: String,
}

/// The build number in `tag`, when it is `<prefix><digits>`.
fn build_of(tag: &str, prefix: &str) -> Option<u32> {
    let digits = tag.strip_prefix(prefix)?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// The newest release of the line that is newer than `current_build`. Drafts never count; pre-releases count only when
/// `include_prereleases` is set.
pub fn newest_update(
    releases_json: &str,
    tag_prefix: &str,
    current_build: u32,
    include_prereleases: bool,
) -> Result<Option<UpdateRecord>, CoreError> {
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
            build_of(&text(release, "tag_name"), tag_prefix).map(|build| (build, release))
        })
        .filter(|(build, _)| *build > current_build)
        .max_by_key(|(build, _)| *build);
    Ok(newest.map(|(build, release)| {
        let tag = text(release, "tag_name");
        let name = text(release, "name");
        UpdateRecord {
            name: if name.is_empty() { tag.clone() } else { name },
            notes: text(release, "body"),
            url: text(release, "html_url"),
            tag,
            build,
        }
    }))
}

/// Looks for a newer build on GitHub.
#[derive(uniffi::Object)]
pub struct UpdateChecker {
    client: reqwest::Client,
    repository: String,
    tag_prefix: String,
}

#[uniffi::export(async_runtime = "tokio")]
impl UpdateChecker {
    /// `repository` is `owner/name`; `tag_prefix` is the line's tag prefix, such as `macos-b-`.
    #[uniffi::constructor]
    pub fn new(repository: String, tag_prefix: String) -> Result<Self, CoreError> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| CoreError::Internal {
                message: error.to_string(),
            })?;
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
        newest_update(&text, &self.tag_prefix, current_build, include_prereleases)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"[
      {"tag_name":"b-210","name":"build-210","html_url":"https://x/b-210","draft":false,"prerelease":false},
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
}
