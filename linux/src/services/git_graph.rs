//! Lane layout for a commit graph, one row per commit in topological order, newest first.

/// One segment in a row. Lanes are columns; y runs 0 (row top) to 1 (row bottom), the dot at 0.5.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GraphLine {
    pub from_lane: usize,
    pub from_y: f64,
    pub to_lane: usize,
    pub to_y: f64,
    /// The lane whose colour the segment takes.
    pub color: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GraphRow {
    pub lane: usize,
    pub lines: Vec<GraphLine>,
    /// Lanes the row spans, for its width.
    pub lanes: usize,
}

fn free_slot(lanes: &[Option<String>]) -> usize {
    lanes
        .iter()
        .position(Option::is_none)
        .unwrap_or(lanes.len())
}

fn put(lanes: &mut Vec<Option<String>>, at: usize, hash: &str) {
    if at >= lanes.len() {
        lanes.resize(at + 1, None);
    }
    lanes[at] = Some(hash.to_owned());
}

/// Each lane waits for the commit it leads to. A commit takes the first lane waiting for it, the
/// other lanes waiting for it join it, and its parents carry on below.
pub fn layout_graph<'a>(
    commits: impl IntoIterator<Item = (&'a str, &'a [String])>,
) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut rows = Vec::new();
    for (hash, parents) in commits {
        let waiting_at = |lanes: &[Option<String>], wanted: &str| {
            lanes
                .iter()
                .position(|slot| slot.as_deref() == Some(wanted))
        };
        let lane = waiting_at(&lanes, hash).unwrap_or_else(|| free_slot(&lanes));
        let before = lanes.clone();
        let mut lines = Vec::new();
        for (index, waiting) in before.iter().enumerate() {
            let Some(waiting) = waiting else { continue };
            if waiting == hash {
                lines.push(GraphLine {
                    from_lane: index,
                    from_y: 0.0,
                    to_lane: lane,
                    to_y: 0.5,
                    color: index,
                });
                lanes[index] = None;
            } else {
                lines.push(GraphLine {
                    from_lane: index,
                    from_y: 0.0,
                    to_lane: index,
                    to_y: 1.0,
                    color: index,
                });
            }
        }
        if lane < lanes.len() {
            lanes[lane] = None;
        }
        for (order, parent) in parents.iter().enumerate() {
            let mut target = waiting_at(&lanes, parent);
            // The first parent stays in this lane unless a lane further left already waits for it.
            if order == 0 && target.is_none_or(|at| at > lane) {
                target = Some(lane);
            }
            let target = target.unwrap_or_else(|| free_slot(&lanes));
            put(&mut lanes, target, parent);
            let color = if order == 0 { lane } else { target };
            lines.push(GraphLine {
                from_lane: lane,
                from_y: 0.5,
                to_lane: target,
                to_y: 1.0,
                color,
            });
        }
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
        let width = before.len().max(lanes.len()).max(lane + 1);
        rows.push(GraphRow {
            lane,
            lines,
            lanes: width,
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(commits: &[(&str, &[&str])]) -> Vec<GraphRow> {
        let owned: Vec<(String, Vec<String>)> = commits
            .iter()
            .map(|(hash, parents)| {
                (
                    (*hash).to_owned(),
                    parents.iter().map(|p| (*p).to_owned()).collect(),
                )
            })
            .collect();
        layout_graph(
            owned
                .iter()
                .map(|(hash, parents)| (hash.as_str(), parents.as_slice())),
        )
    }

    fn line(from_lane: usize, from_y: f64, to_lane: usize, to_y: f64, color: usize) -> GraphLine {
        GraphLine {
            from_lane,
            from_y,
            to_lane,
            to_y,
            color,
        }
    }

    #[test]
    fn a_straight_history_stays_in_one_lane() {
        let rows = rows(&[("c", &["b"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(rows.iter().map(|r| r.lane).collect::<Vec<_>>(), [0, 0, 0]);
        assert_eq!(rows[0].lines, [line(0, 0.5, 0, 1.0, 0)]);
        assert_eq!(rows[1].lines.len(), 2);
        assert_eq!(rows[2].lines, [line(0, 0.0, 0, 0.5, 0)]);
    }

    #[test]
    fn a_merged_branch_opens_a_lane_and_closes_where_it_started() {
        // m merges s into main; s and b both come from a.
        let rows = rows(&[("m", &["b", "s"]), ("s", &["a"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(
            rows.iter().map(|r| r.lane).collect::<Vec<_>>(),
            [0, 1, 0, 0]
        );
        assert!(rows[0].lines.contains(&line(0, 0.5, 1, 1.0, 1)));
        assert!(rows[1].lines.contains(&line(0, 0.0, 0, 1.0, 0)));
        assert!(rows[3].lines.contains(&line(1, 0.0, 0, 0.5, 1)));
        assert_eq!(rows[3].lanes, 2);
    }

    #[test]
    fn a_second_branch_tip_gets_its_own_lane() {
        let rows = rows(&[("x", &["a"]), ("y", &["a"]), ("a", &[])]);
        assert_eq!(rows.iter().map(|r| r.lane).collect::<Vec<_>>(), [0, 1, 0]);
        assert!(
            !rows[1]
                .lines
                .iter()
                .any(|l| l.from_lane == 1 && l.from_y == 0.0)
        );
    }
}
