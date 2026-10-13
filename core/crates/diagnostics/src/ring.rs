//! The last `size` lines, oldest dropped first. The writer keeps its recent events here, and a child's stderr tail can use it too.

use std::collections::VecDeque;

#[derive(Debug)]
pub struct Ring {
    size: usize,
    lines: VecDeque<String>,
}

impl Ring {
    pub fn new(size: usize) -> Self {
        Self {
            size,
            lines: VecDeque::new(),
        }
    }

    pub fn push(&mut self, line: impl Into<String>) {
        self.lines.push_back(line.into());
        while self.lines.len() > self.size {
            self.lines.pop_front();
        }
    }

    /// The most recent `count` lines, oldest first. TS quirk: zero means all, because `slice(-0)` returns everything.
    pub fn tail(&self, count: usize) -> Vec<String> {
        let take = if count == 0 {
            self.lines.len()
        } else {
            count.min(self.lines.len())
        };
        self.lines
            .iter()
            .skip(self.lines.len() - take)
            .cloned()
            .collect()
    }

    /// Every line joined with newlines.
    pub fn dump(&self) -> String {
        self.lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::Ring;

    #[test]
    fn keeps_the_newest_lines_and_tails_them() {
        let mut ring = Ring::new(3);
        for line in ["a", "b", "c", "d"] {
            ring.push(line);
        }
        assert_eq!(ring.len(), 3);
        assert_eq!(ring.tail(2), ["c", "d"]);
        assert_eq!(ring.tail(0), ["b", "c", "d"]);
        assert_eq!(ring.dump(), "b\nc\nd");
    }
}
