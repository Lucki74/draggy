import DraggyCore
import Foundation

/// Who pays for a reply. `billed` is an API key, `account` a plan whose value is shown but not charged, and `local`
/// a model on this machine.
enum CostKind: String, Sendable, Equatable {
    case billed
    case account
    case local
}

/// Where a reply went, as far as pricing and the Stats page are concerned.
struct CostRoute: Sendable, Equatable {
    /// The price table's provider key. Empty when the table has none for this route.
    let priceProvider: String
    /// The name the Stats page groups the reply under.
    let name: String
    let kind: CostKind
}

/// One reply's token split and cost. Money is micro-dollars (1e-6 USD), so totals add up without drift.
struct TurnCostRecord: Identifiable, Sendable, Equatable {
    let id = UUID()
    let date: Date
    let provider: String
    let model: String
    let workspace: String
    let kind: CostKind
    let input: Int
    let cacheRead: Int
    let cacheWrite: Int
    let output: Int
    let reasoning: Int
    /// What the reply cost. Zero for a local reply. Nil when no price is known, which is not the same as free.
    let micros: Int64?
    /// `reported`, `table`, `estimated` or `unknown`, as the core names it. `local` for a local reply.
    let source: String
    let priceUpdatedAt: String?
    /// Local replies only: what they would have cost on the reference model. Nil when that price is unknown.
    let savedMicros: Int64?

    var promptTokens: Int { input + cacheRead + cacheWrite }
    var completionTokens: Int { output + reasoning }
    var isEstimated: Bool { source == "estimated" }
}

/// Prices replies with the core's price table. The arithmetic stays in `draggy-core`; this only picks the route and
/// hands over the token counts.
enum TurnPricer {
    /// The reference model local replies are compared with. Same default as the Windows app.
    static let referenceProvider = "anthropic"
    static let referenceModel = "claude-sonnet-4-5"

    private struct KnownHost: Sendable {
        let provider: String
        let name: String
    }

    private static let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1", "[::1]"]
    private static let cloudHosts: [String: KnownHost] = [
        "api.openai.com": KnownHost(provider: "openai", name: "OpenAI"),
        "api.anthropic.com": KnownHost(provider: "anthropic", name: "Anthropic"),
        "generativelanguage.googleapis.com": KnownHost(provider: "gemini", name: "Google Gemini"),
        "openrouter.ai": KnownHost(provider: "openrouter", name: "OpenRouter"),
        "api.deepseek.com": KnownHost(provider: "deepseek", name: "DeepSeek"),
        "api.mistral.ai": KnownHost(provider: "mistral", name: "Mistral"),
        "api.x.ai": KnownHost(provider: "xai", name: "xAI"),
    ]

    /// The route the next reply takes: a loopback server, or a cloud host.
    static func route(baseURL: String) -> CostRoute {
        let host = URL(string: baseURL)?.host?.lowercased() ?? ""
        if loopbackHosts.contains(host) {
            return CostRoute(priceProvider: "", name: String(localized: "Local model"), kind: .local)
        }
        if let known = cloudHosts[host] {
            return CostRoute(priceProvider: known.provider, name: known.name, kind: .billed)
        }
        // A host with no entry has no price, so its replies show no figure rather than a false $0.
        let name = host.isEmpty ? String(localized: "Unknown provider") : host
        return CostRoute(priceProvider: "", name: name, kind: .billed)
    }

    /// The token split of each request the turn made. A turn that reported only totals is priced as one estimated request.
    static func passes(for metrics: MetricsRecord) -> [PassUsageRecord] {
        if !metrics.passUsage.isEmpty { return metrics.passUsage }
        return [PassUsageRecord(
            input: count(metrics.promptTokens),
            cacheRead: 0,
            cacheWrite: 0,
            output: count(metrics.responseTokens),
            reasoning: 0,
            estimated: true,
            costUsd: nil
        )]
    }

    static func record(
        metrics: MetricsRecord,
        route: CostRoute,
        configuredModel: String,
        workspace: String,
        date: Date = Date()
    ) -> TurnCostRecord {
        let usage = passes(for: metrics)
        let model = metrics.model.isEmpty ? configuredModel : metrics.model

        var input = 0, cacheRead = 0, cacheWrite = 0, output = 0, reasoning = 0
        for pass in usage {
            input += Int(clamping: pass.input)
            cacheRead += Int(clamping: pass.cacheRead)
            cacheWrite += Int(clamping: pass.cacheWrite)
            output += Int(clamping: pass.output)
            reasoning += Int(clamping: pass.reasoning)
        }

        if route.kind == .local {
            let saved = priceReply(provider: referenceProvider, modelId: referenceModel, passes: usage).micros
            return TurnCostRecord(
                date: date, provider: route.name, model: model, workspace: workspace, kind: .local,
                input: input, cacheRead: cacheRead, cacheWrite: cacheWrite, output: output, reasoning: reasoning,
                micros: 0, source: "local", priceUpdatedAt: nil, savedMicros: saved
            )
        }

        let priced = priceReply(provider: route.priceProvider, modelId: model, passes: usage)
        return TurnCostRecord(
            date: date, provider: route.name, model: model, workspace: workspace, kind: route.kind,
            input: input, cacheRead: cacheRead, cacheWrite: cacheWrite, output: output, reasoning: reasoning,
            micros: priced.micros, source: priced.source, priceUpdatedAt: priced.priceUpdatedAt, savedMicros: nil
        )
    }

    private static func count(_ value: Double) -> UInt64 {
        guard value.isFinite, value > 0 else { return 0 }
        return UInt64(min(value.rounded(), 1e15))
    }
}

/// The figure after the tokens in the chat footer, and the text its hover tooltip shows.
struct TurnCostLabel: Sendable, Equatable {
    let text: String
    let help: String
}

extension TurnCostLabel {
    /// The label for a reply, or nil when there is nothing to say: a billed reply with no known price shows no figure.
    init?(_ turn: TurnCostRecord) {
        switch turn.kind {
        case .local:
            // Local replies cost nothing; the figure says what the reference model would have charged instead.
            let zero = CostFormat.money(0)
            var lines = [String(localized: "Local model. Nothing is billed.")]
            if let saved = turn.savedMicros {
                lines.append(String(localized: "Would have cost \(CostFormat.money(saved, estimated: true)) on the reference model."))
            }
            self.init(text: String(localized: "\(zero) / saved"), help: lines.joined(separator: "\n"))
        case .billed, .account:
            guard let micros = turn.micros else { return nil }
            let account = turn.kind == .account
            let money = CostFormat.money(micros, estimated: account || turn.isEstimated)
            var lines = Self.tokenLines(turn)
            if account {
                lines.append(String(localized: "Not billed: covered by your plan. The figure is the API-equivalent cost."))
            }
            if turn.isEstimated { lines.append(String(localized: "Estimated from the token totals")) }
            if let updated = turn.priceUpdatedAt {
                lines.append(String(localized: "Prices as of \(String(updated.prefix(10)))"))
            }
            let text = account ? String(localized: "\(money) equiv.") : money
            self.init(text: text, help: lines.joined(separator: "\n"))
        }
    }

    private static func tokenLines(_ turn: TurnCostRecord) -> [String] {
        let buckets: [(String, Int)] = [
            (String(localized: "Input"), turn.input),
            (String(localized: "Cache read"), turn.cacheRead),
            (String(localized: "Cache write"), turn.cacheWrite),
            (String(localized: "Output"), turn.output),
            (String(localized: "Reasoning"), turn.reasoning),
        ]
        return buckets.enumerated().compactMap { index, bucket in
            // Input and output always show, as the Windows tooltip does. The other buckets show only when used.
            guard bucket.1 > 0 || index == 0 || index == 3 else { return nil }
            return "\(bucket.0): \(CostFormat.compact(bucket.1))"
        }
    }
}

/// Money and token figures as the chat and the Stats page show them.
enum CostFormat {
    /// Dollars from micro-dollars. Under a cent it keeps four decimals, at a cent or more two, and "<$0.0001" is the floor.
    /// A tilde goes in front when the figure is estimated, except for zero, which is exact.
    static func money(_ micros: Int64, estimated: Bool = false, currency: String = "USD") -> String {
        let amount = Double(micros) / 1_000_000
        let mark = estimated && micros != 0 ? "~" : ""
        if amount > 0 && amount < 0.0001 {
            return "\(mark)<" + 0.0001.formatted(.currency(code: currency).precision(.fractionLength(4)))
        }
        let digits = amount == 0 ? 0 : (amount < 0.01 ? 4 : 2)
        return mark + amount.formatted(.currency(code: currency).precision(.fractionLength(digits)))
    }

    /// Token counts the way the Windows app writes them: 1.2k from a thousand up.
    static func compact(_ count: Int) -> String {
        count >= 1000 ? String(format: "%.1fk", Double(count) / 1000) : String(count)
    }
}
