import AppKit

/// Turns a transcript line into styled text: tool steps first, then the message with fenced code blocks, `inline
/// code`, **bold**, [links](https://example.com), headings and bullet lists drawn. Anything else in markdown
/// shows as typed.
@MainActor
enum MessageText {
    private static let body = NSFont.systemFont(ofSize: 14)
    private static let bold = NSFont.boldSystemFont(ofSize: 14)
    private static let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    private static let small = NSFont.systemFont(ofSize: 12)

    private static let inline = try? NSRegularExpression(pattern: "`([^`\\n]+)`|\\*\\*([^*\\n]+)\\*\\*|\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\)")
    private static let heading = try? NSRegularExpression(pattern: "^(#{1,6})\\s+(.*)$")
    private static let bullet = try? NSRegularExpression(pattern: "^(\\s*)[-*+]\\s+(.*)$")

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
                out.append(prose(row))
                out.append(NSAttributedString(string: end, attributes: [.font: body]))
            }
        }
        return out
    }

    /// One prose row: a heading or bullet loses its marks, then the inline marks are drawn.
    private static func prose(_ row: String) -> NSAttributedString {
        let whole = NSRange(location: 0, length: (row as NSString).length)
        if let match = heading?.firstMatch(in: row, range: whole) {
            let level = match.range(at: 1).length
            let size: CGFloat = level == 1 ? 20 : level == 2 ? 17 : 15
            return styled((row as NSString).substring(with: match.range(at: 2)),
                          font: NSFont.boldSystemFont(ofSize: size))
        }
        if let match = bullet?.firstMatch(in: row, range: whole) {
            let indent = (row as NSString).substring(with: match.range(at: 1))
            return styled(indent + "\u{2022} " + (row as NSString).substring(with: match.range(at: 2)), font: body)
        }
        return styled(row, font: body)
    }

    /// One prose row, with its inline code, bold and link marks replaced by styled text.
    private static func styled(_ row: String, font: NSFont) -> NSAttributedString {
        let out = NSMutableAttributedString(string: row, attributes: [
            .font: font,
            .foregroundColor: NSColor.labelColor,
        ])
        guard let inline else { return out }
        let range = NSRange(location: 0, length: (row as NSString).length)
        // Last match first, so the ranges of the earlier ones stay valid while the marks are removed.
        for match in inline.matches(in: row, range: range).reversed() {
            let code = match.range(at: 1)
            let strong = match.range(at: 2)
            let label = match.range(at: 3)
            if label.location != NSNotFound {
                let text = (row as NSString).substring(with: label)
                var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.linkColor]
                if let url = URL(string: (row as NSString).substring(with: match.range(at: 4))) {
                    attributes[.link] = url
                }
                out.replaceCharacters(in: match.range, with: NSAttributedString(string: text, attributes: attributes))
            } else if code.location != NSNotFound {
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
