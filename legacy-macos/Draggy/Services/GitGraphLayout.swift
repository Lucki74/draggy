import Foundation

/// One segment in a row. Lanes are columns; y runs 0 (row top) to 1 (row bottom), the dot at 0.5.
struct GraphLine: Equatable {
    let fromLane: Int
    let fromY: Double
    let toLane: Int
    let toY: Double
    /// The lane whose colour the segment takes.
    let color: Int
}

struct GraphRow: Equatable {
    let hash: String
    let lane: Int
    let lines: [GraphLine]
    /// Lanes the row spans, for its width.
    let lanes: Int
}

/// Lane layout for a commit graph, one row per commit in topological order, newest first. The same as Windows.
enum GraphLayout {
    /// Each lane waits for the commit it leads to. A commit takes the first lane waiting for it, the other lanes
    /// waiting for it join it, and its parents carry on below.
    static func rows(of commits: [GitCommit]) -> [GraphRow] {
        var lanes: [String?] = []
        var rows: [GraphRow] = []

        func freeSlot() -> Int { lanes.firstIndex(where: { $0 == nil }) ?? lanes.count }
        func place(_ hash: String?, at index: Int) {
            while lanes.count <= index { lanes.append(nil) }
            lanes[index] = hash
        }

        for commit in commits {
            let lane = lanes.firstIndex(of: commit.id) ?? freeSlot()
            let before = lanes
            var lines: [GraphLine] = []

            for (index, waiting) in before.enumerated() {
                guard let waiting else { continue }
                if waiting == commit.id {
                    lines.append(GraphLine(fromLane: index, fromY: 0, toLane: lane, toY: 0.5, color: index))
                    lanes[index] = nil
                } else {
                    lines.append(GraphLine(fromLane: index, fromY: 0, toLane: index, toY: 1, color: index))
                }
            }

            place(nil, at: lane)
            for (order, parent) in commit.parents.enumerated() {
                var target = lanes.firstIndex(of: parent) ?? -1
                // The first parent stays in this lane unless a lane further left already waits for it.
                if order == 0 && (target == -1 || target > lane) {
                    target = lane
                } else if target == -1 {
                    target = freeSlot()
                }
                place(parent, at: target)
                lines.append(GraphLine(fromLane: lane, fromY: 0.5, toLane: target, toY: 1, color: order == 0 ? lane : target))
            }

            while let last = lanes.last, last == nil { lanes.removeLast() }
            rows.append(GraphRow(hash: commit.id, lane: lane, lines: lines, lanes: max(before.count, lanes.count, lane + 1)))
        }
        return rows
    }
}
