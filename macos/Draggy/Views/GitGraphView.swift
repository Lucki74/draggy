import SwiftUI

/// Every branch's commits drawn as lanes, one row each, with the refs that point at them.
struct GitGraphView: View {
    let commits: [GitCommit]
    let selected: String?
    let onSelect: (GitCommit) -> Void

    static let rowHeight: CGFloat = 24
    static let laneWidth: CGFloat = 14
    static let padding: CGFloat = 10
    private static let palette: [Color] = [.accentColor, .green, .orange, .red, .teal, .purple]

    static func color(_ lane: Int) -> Color { palette[lane % palette.count] }
    static func laneX(_ lane: Int) -> CGFloat { padding + CGFloat(lane) * laneWidth }

    var body: some View {
        let rows = GraphLayout.rows(of: commits)
        let widest = rows.map(\.lanes).max() ?? 1
        let width = Self.padding * 2 + CGFloat(max(0, widest - 1)) * Self.laneWidth
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(commits.indices, id: \.self) { index in
                    let commit = commits[index]
                    HStack(spacing: 6) {
                        LaneColumn(row: rows[index]).frame(width: width, height: Self.rowHeight)
                        ForEach(commit.refs, id: \.name) { ref in
                            RefChip(ref: ref)
                        }
                        Text(commit.message)
                            .font(.caption)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(commit.author)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    .padding(.trailing, 8)
                    .frame(height: Self.rowHeight)
                    .background(selected == commit.id ? Color.accentColor.opacity(0.15) : Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { onSelect(commit) }
                    .help("\(commit.hash) \(commit.message)\n\(commit.author) \(commit.date)")
                }
            }
        }
    }
}

private struct LaneColumn: View {
    let row: GraphRow

    var body: some View {
        Canvas { context, size in
            for line in row.lines {
                let start = CGPoint(x: GitGraphView.laneX(line.fromLane), y: CGFloat(line.fromY) * size.height)
                let end = CGPoint(x: GitGraphView.laneX(line.toLane), y: CGFloat(line.toY) * size.height)
                var path = Path()
                path.move(to: start)
                if start.x == end.x {
                    path.addLine(to: end)
                } else {
                    let middle = (start.y + end.y) / 2
                    path.addCurve(to: end, control1: CGPoint(x: start.x, y: middle), control2: CGPoint(x: end.x, y: middle))
                }
                context.stroke(path, with: .color(GitGraphView.color(line.color)), lineWidth: 1.5)
            }
            let dot = CGRect(x: GitGraphView.laneX(row.lane) - 3.5, y: size.height / 2 - 3.5, width: 7, height: 7)
            context.fill(Path(ellipseIn: dot), with: .color(GitGraphView.color(row.lane)))
        }
    }
}

private struct RefChip: View {
    let ref: GitRef

    private var tint: Color {
        switch ref.kind {
        case .head, .branch: .accentColor
        case .remote: .secondary
        case .tag: .orange
        }
    }

    var body: some View {
        Text(ref.name)
            .font(.system(size: 10, weight: ref.kind == .head ? .semibold : .regular))
            .lineLimit(1)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .overlay(Capsule().stroke(tint, lineWidth: 1))
            .frame(maxWidth: 128)
    }
}
