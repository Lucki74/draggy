import AppKit
import Foundation

/// A research run as the core reports it in a research_run step, the same shape as the Windows run view.
struct ResearchRunView: Decodable, Equatable {
    struct Source: Decodable, Equatable {
        let id: String
        let url: String
        var title: String?
        var site: String?
        var published: String?
        let status: String
    }

    struct Note: Decodable, Equatable {
        let id: String
        let sourceId: String
        var quote: String?
        var verified: Bool?
    }

    struct Question: Decodable, Equatable {
        let text: String
        let notes: Int
    }

    let id: String
    var question: String?
    var depth: String?
    var endedAt: Double?
    var questions: [Question] = []
    var sources: [Source] = []
    var notes: [Note] = []
    var hosts: [String] = []

    /// The run in a step, or nil for any other step.
    init?(step: Transcript.Step) {
        guard step.kind == "research_run" else { return nil }
        self.init(json: step.detail)
    }

    /// The run from its view JSON, or nil when the text is not one.
    init?(json: String) {
        guard let data = json.data(using: .utf8),
              let run = try? JSONDecoder().decode(ResearchRunView.self, from: data) else { return nil }
        self = run
    }

    /// The sources that hold at least one note, in list order. A citation's number is its place here.
    var citedSources: [Source] {
        sources.filter { source in notes.contains { $0.sourceId == source.id } }
    }

    /// The number, source and check of a note id such as n3. Nil when no note has that id, so a bare number is no chip.
    func resolve(_ reference: String) -> (number: Int, source: Source, verified: Bool)? {
        guard let note = notes.first(where: { $0.id == reference }),
              let index = citedSources.firstIndex(where: { $0.id == note.sourceId }) else { return nil }
        return (index + 1, citedSources[index], note.verified == true)
    }
}

extension ResearchRunView: Identifiable {}

/// Draws a run as styled text: the card above the reply, citation chips in it and the source list below it.
@MainActor
enum ResearchText {
    private static let small = NSFont.systemFont(ofSize: 12)
    private static let chip = NSFont.systemFont(ofSize: 11, weight: .semibold)
    private static let citation = try? NSRegularExpression(pattern: "\\[(n\\d+)\\]")

    private static func status(_ value: String) -> String {
        switch value {
        case "reading": String(localized: "Reading")
        case "read": String(localized: "Read")
        case "skipped": String(localized: "Skipped")
        case "blocked": String(localized: "Blocked")
        default: String(localized: "Failed")
        }
    }

    private static func depth(_ value: String?) -> String {
        switch value {
        case "quick": String(localized: "Quick")
        case "deep": String(localized: "Deep")
        default: String(localized: "Standard")
        }
    }

    private static func line(_ text: String, color: NSColor = .secondaryLabelColor) -> NSAttributedString {
        NSAttributedString(string: text + "\n", attributes: [.font: small, .foregroundColor: color])
    }

    /// The question, the sub-questions with their notes, the sources and the services contacted.
    static func card(_ run: ResearchRunView) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let read = run.sources.filter { $0.status == "read" }.count
        let header = [
            String(localized: "Research"),
            depth(run.depth),
            String(format: String(localized: "%lld sources read"), read),
            String(format: String(localized: "%lld notes"), run.notes.count),
        ].joined(separator: " \u{00B7} ")
        out.append(line(header))
        if let question = run.question, !question.isEmpty {
            out.append(line(question, color: .labelColor))
        }
        for question in run.questions {
            out.append(line("\(question.notes > 0 ? "\u{2713}" : "\u{25CB}") \(question.text) (\(question.notes))"))
        }
        if run.endedAt != nil, !run.notes.contains(where: { $0.verified != false }) {
            out.append(line(String(localized: "No sourced notes were kept. The answer below is not backed by any source."), color: .systemRed))
        }
        for source in run.sources {
            let name = [source.title, source.url].compactMap { $0 }.first { !$0.isEmpty } ?? source.url
            let site = (source.site ?? "").isEmpty ? "" : " \u{00B7} \(source.site ?? "")"
            out.append(line("[\(status(source.status))] \(name)\(site)"))
        }
        if !run.hosts.isEmpty {
            out.append(line(String(format: String(localized: "Contacted: %@"), run.hosts.joined(separator: ", "))))
        }
        return out
    }

    /// Replaces each note id in brackets, such as [n2], with a numbered chip that opens its source. Unknown ids stay as typed.
    static func linkCitations(_ text: NSAttributedString, run: ResearchRunView) -> NSAttributedString {
        guard let citation else { return text }
        let out = NSMutableAttributedString(attributedString: text)
        let matches = citation.matches(in: out.string, range: NSRange(location: 0, length: out.length))
        for match in matches.reversed() {
            let id = (out.string as NSString).substring(with: match.range(at: 1))
            guard let cite = run.resolve(id) else { continue }
            let note = cite.verified ? String(localized: "Quote found on the page") : String(localized: "Quote not checked")
            var attributes: [NSAttributedString.Key: Any] = [
                .font: chip,
                .backgroundColor: NSColor.quaternaryLabelColor,
                .toolTip: "\(cite.source.title ?? cite.source.url) \u{00B7} \(note)",
            ]
            if let url = URL(string: cite.source.url) { attributes[.link] = url }
            out.replaceCharacters(in: match.range, with: NSAttributedString(string: "\u{200A}\(cite.number)\u{200A}", attributes: attributes))
        }
        return out
    }

    /// The numbered sources the reply cites, each linked. Empty until the run ends.
    static func sourceList(_ run: ResearchRunView) -> NSAttributedString {
        let out = NSMutableAttributedString()
        guard run.endedAt != nil, !run.citedSources.isEmpty else { return out }
        out.append(NSAttributedString(string: "\n" + String(localized: "Sources") + "\n", attributes: [
            .font: NSFont.boldSystemFont(ofSize: 13), .foregroundColor: NSColor.labelColor,
        ]))
        for (index, source) in run.citedSources.enumerated() {
            let name = [source.title, source.url].compactMap { $0 }.first { !$0.isEmpty } ?? source.url
            var attributes: [NSAttributedString.Key: Any] = [.font: small, .foregroundColor: NSColor.labelColor]
            if let url = URL(string: source.url) { attributes[.link] = url }
            out.append(NSAttributedString(string: "\(index + 1). \(name)", attributes: attributes))
            let site = (source.site ?? "").isEmpty ? "" : " \u{00B7} \(source.site ?? "")"
            out.append(line(site))
        }
        return out
    }
}
