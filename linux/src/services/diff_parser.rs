use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineType {
    Add,
    Delete,
    Context,
    Header,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_type: DiffLineType,
    pub old_line_num: Option<usize>,
    pub new_line_num: Option<usize>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: String,
    pub new_path: String,
    pub lines: Vec<DiffLine>,
}

pub fn parse_git_diff(raw: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current_old = String::new();
    let mut current_new = String::new();
    let mut lines = Vec::new();

    let mut old_num = 0;
    let mut new_num = 0;

    for line in raw.lines() {
        if line.starts_with("diff --git") {
            if !lines.is_empty() {
                files.push(FileDiff {
                    old_path: current_old.clone(),
                    new_path: current_new.clone(),
                    lines: lines.clone(),
                });
                lines.clear();
            }
        } else if let Some(stripped) = line.strip_prefix("--- a/") {
            current_old = stripped.to_string();
        } else if let Some(stripped) = line.strip_prefix("+++ b/") {
            current_new = stripped.to_string();
        } else if line.starts_with("@@") {
            lines.push(DiffLine {
                line_type: DiffLineType::Header,
                old_line_num: None,
                new_line_num: None,
                text: line.to_string(),
            });
        } else if let Some(stripped) = line.strip_prefix('+') {
            new_num += 1;
            lines.push(DiffLine {
                line_type: DiffLineType::Add,
                old_line_num: None,
                new_line_num: Some(new_num),
                text: stripped.to_string(),
            });
        } else if let Some(stripped) = line.strip_prefix('-') {
            old_num += 1;
            lines.push(DiffLine {
                line_type: DiffLineType::Delete,
                old_line_num: Some(old_num),
                new_line_num: None,
                text: stripped.to_string(),
            });
        } else if let Some(stripped) = line.strip_prefix(' ') {
            old_num += 1;
            new_num += 1;
            lines.push(DiffLine {
                line_type: DiffLineType::Context,
                old_line_num: Some(old_num),
                new_line_num: Some(new_num),
                text: stripped.to_string(),
            });
        }
    }

    if !lines.is_empty() {
        files.push(FileDiff {
            old_path: current_old,
            new_path: current_new,
            lines,
        });
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_diff() {
        let diff = "diff --git a/foo.txt b/foo.txt\n--- a/foo.txt\n+++ b/foo.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n";
        let parsed = parse_git_diff(diff);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].lines.len(), 3);
    }
}
