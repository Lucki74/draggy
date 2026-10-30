import Foundation
import Observation

public struct UsageDataPoint: Identifiable, Sendable {
    public let id = UUID()
    public let label: String
    public let promptTokens: Int
    public let completionTokens: Int
    public var totalTokens: Int { promptTokens + completionTokens }
}

/// One provider, model or workspace on the Stats page. Money is micro-dollars; nil means no reply had a known price.
struct CostRow: Identifiable, Equatable {
    let name: String
    let turns: Int
    let tokens: Int
    let spentMicros: Int64?
    let planValueMicros: Int64?
    let estimated: Bool

    var id: String { name }
    var totalMicros: Int64 { (spentMicros ?? 0) + (planValueMicros ?? 0) }
}

/// The money of one day, split the way the chart draws it.
struct CostDay: Identifiable, Equatable {
    let day: Date
    let spentMicros: Int64
    let planValueMicros: Int64
    let savedMicros: Int64

    var id: Date { day }
}

@MainActor
@Observable
public final class StatsStore {
    /// Every reply of this session that has finished, oldest first.
    private(set) var turns: [TurnCostRecord] = []
    public var recentHistory: [UsageDataPoint] = []
    public var hardware: SystemHardwareMetrics = HardwareMetrics.shared.sample()

    public init() {
        refreshHardware()
    }

    var totalPromptTokens: Int { turns.reduce(0) { $0 + $1.promptTokens } }
    var totalCompletionTokens: Int { turns.reduce(0) { $0 + $1.completionTokens } }

    /// What the API key was charged for, in micro-dollars.
    var spentMicros: Int64 { total(turns, kind: .billed) }
    /// What the plan's tokens would have cost through the API. Not charged, so not in the spend.
    var planValueMicros: Int64 { total(turns, kind: .account) }
    /// What the local replies would have cost on the reference model.
    var savedMicros: Int64 { turns.reduce(into: Int64(0)) { $0 += $1.savedMicros ?? 0 } }
    /// Replies with no known price. They are left out of every total, which is not the same as free.
    var unpricedTurns: Int { turns.filter { $0.micros == nil }.count }

    /// Whether any reply of this kind was estimated from token totals.
    func isEstimated(_ kind: CostKind) -> Bool {
        turns.contains { $0.kind == kind && $0.isEstimated }
    }

    func record(_ turn: TurnCostRecord) {
        turns.append(turn)
        recentHistory.append(UsageDataPoint(
            label: "T\(turns.count)",
            promptTokens: turn.promptTokens,
            completionTokens: turn.completionTokens
        ))
        if recentHistory.count > 30 {
            recentHistory.removeFirst()
        }
    }

    /// The replies grouped by one of their fields, biggest total first.
    func rows(by key: KeyPath<TurnCostRecord, String>) -> [CostRow] {
        Dictionary(grouping: turns) { $0[keyPath: key] }
            .map { (name, group) -> CostRow in
                var spent: Int64?
                var plan: Int64?
                for turn in group {
                    switch turn.kind {
                    case .local:
                        spent = spent ?? 0
                    case .billed:
                        if let micros = turn.micros { spent = (spent ?? 0) + micros }
                    case .account:
                        if let micros = turn.micros { plan = (plan ?? 0) + micros }
                    }
                }
                return CostRow(
                    name: name,
                    turns: group.count,
                    tokens: group.reduce(0) { $0 + $1.promptTokens + $1.completionTokens },
                    spentMicros: spent,
                    planValueMicros: plan,
                    estimated: group.contains { $0.isEstimated }
                )
            }
            .sorted { lhs, rhs in
                lhs.totalMicros != rhs.totalMicros ? lhs.totalMicros > rhs.totalMicros : lhs.name < rhs.name
            }
    }

    /// The money of each day with a reply, oldest first.
    func days(calendar: Calendar = .current) -> [CostDay] {
        Dictionary(grouping: turns) { calendar.startOfDay(for: $0.date) }
            .map { (day, group) -> CostDay in
                CostDay(
                    day: day,
                    spentMicros: total(group, kind: .billed),
                    planValueMicros: total(group, kind: .account),
                    savedMicros: group.reduce(into: Int64(0)) { $0 += $1.savedMicros ?? 0 }
                )
            }
            .sorted { $0.day < $1.day }
    }

    private func total(_ group: [TurnCostRecord], kind: CostKind) -> Int64 {
        group.reduce(into: Int64(0)) { sum, turn in
            if turn.kind == kind, let micros = turn.micros { sum += micros }
        }
    }

    public func refreshHardware() {
        hardware = HardwareMetrics.shared.sample()
    }
}
