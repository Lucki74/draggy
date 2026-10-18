import AppKit

/// Turns a transcript line into styled text: tool steps first, then the message with fenced code blocks, `inline
/// code` and **bold** drawn. Anything else in markdown shows as typed.
@MainActor
enum MessageText {
    private static let body = NSFont.systemFont(ofSize: 14)
    private static let bold = NSFont.boldSystemFont(ofSize: 14)
    private static let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    private static let small = NSFont.systemFont(ofSize: 12)

    private static let inline = try? NSRegularExpression(pattern: "`([^`\\n]+)`|\\*\\*([^*\\n]+)\\*\\*")

    static func attributed(_ line: Transcript.Line) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for step in line.steps {
            let mark = step.isDone ? "\u{2713}" : "\u{2026}"
            let title = step.kind == "thinking" ? String(localized: "Thinking") : step.label
            out.append(NSAttributedString(
                string: "\(mark) \(title)\n",
                attributes: [.font: small, .foregroundColor: NSColor.secondaryLabelColor]
            ))
            guard !step.detail.isEmpty else { continue }
            out.append(NSAttributedString(string: step.detail + "\n", attributes: detailAttributes(for: step)))
        }
        out.append(message(line.text))
        return out
    }

    private static let detailMono = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    private static let italic = NSFontManager.shared.convert(small, toHaveTrait: .italicFontMask)

    private static func detailAttributes(for step: Transcript.Step) -> [NSAttributedString.Key: Any] {
        if step.kind == "thinking" {
            return [.font: italic, .foregroundColor: NSColor.secondaryLabelColor]
        }
        return [
            .font: detailMono,
            .foregroundColor: NSColor.labelColor,
            .backgroundColor: NSColor.quaternaryLabelColor,
        ]
    }

    static func message(_ text: String) -> NSAttributedString {
        let out = NSMutableAttributedString()
        var inFence = false
        let rows = text.components(separatedBy: "\n")
        for (index, row) in rows.enumerated() {
            let end = index == rows.count - 1 ? "" : "\n"
            if row.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            }
            if inFence {
                out.append(NSAttributedString(string: row + end, attributes: [
                    .font: mono,
                    .foregroundColor: NSColor.labelColor,
                    .backgroundColor: NSColor.quaternaryLabelColor,
                ]))
            } else {
                out.append(styled(row))
                out.append(NSAttributedString(string: end, attributes: [.font: body]))
            }
        }
        return out
    }

    /// One prose row, with its inline code and bold marks replaced by styled text.
    private static func styled(_ row: String) -> NSAttributedString {
        let out = NSMutableAttributedString(string: row, attributes: [
            .font: body,
            .foregroundColor: NSColor.labelColor,
        ])
        guard let inline else { return out }
        let range = NSRange(location: 0, length: (row as NSString).length)
        // Last match first, so the ranges of the earlier ones stay valid while the marks are removed.
        for match in inline.matches(in: row, range: range).reversed() {
            let code = match.range(at: 1)
            let strong = match.range(at: 2)
            if code.location != NSNotFound {
                out.replaceCharacters(in: match.range, with: NSAttributedString(
                    string: (row as NSString).substring(with: code),
                    attributes: [
                        .font: mono,
                        .foregroundColor: NSColor.labelColor,
                        .backgroundColor: NSColor.quaternaryLabelColor,
                    ]
                ))
            } else if strong.location != NSNotFound {
                out.replaceCharacters(in: match.range, with: NSAttributedString(
                    string: (row as NSString).substring(with: strong),
                    attributes: [.font: bold, .foregroundColor: NSColor.labelColor]
                ))
            }
        }
        return out
    }
}
