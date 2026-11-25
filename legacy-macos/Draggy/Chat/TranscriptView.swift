import AppKit
import SwiftUI

/// The transcript on an NSTableView with TextKit 2 text views, as the plan asks. Only the rows that changed are
/// reloaded while a reply streams, and row heights are cached per line and width.
struct TranscriptView: NSViewRepresentable {
    let lines: [Transcript.Line]
    /// Passed in so a size change reaches the table, which then measures every row again.
    var textSize: TextSize = .current

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSScrollView {
        let table = TranscriptTable()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("message"))
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.headerView = nil
        table.backgroundColor = .clear
        table.selectionHighlightStyle = .none
        table.allowsColumnSelection = false
        table.intercellSpacing = NSSize(width: 0, height: 24)
        table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        table.setAccessibilityLabel(String(localized: "Conversation"))
        table.dataSource = context.coordinator
        table.delegate = context.coordinator
        table.onWidthChange = { [weak coordinator = context.coordinator] in
            coordinator?.widthChanged()
        }
        context.coordinator.table = table

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = table
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.update(lines, textSize: textSize, in: scroll)
    }

    final class TranscriptTable: NSTableView {
        var onWidthChange: (() -> Void)?

        override func setFrameSize(_ newSize: NSSize) {
            let changed = newSize.width != frame.width
            super.setFrameSize(newSize)
            if changed { onWidthChange?() }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
        private struct Measured {
            let line: Transcript.Line
            let width: CGFloat
            let size: MessageLayout.Size
        }

        weak var table: NSTableView?
        private var lines: [Transcript.Line] = []
        private var measured: [UUID: Measured] = [:]
        private var opened: Set<UUID> = []

        private static let sidePadding: CGFloat = 16
        /// The reading column, matching the Windows and Linux apps.
        private static let column: CGFloat = 720

        private func side(for width: CGFloat) -> CGFloat {
            max(Self.sidePadding, (width - Self.column) / 2)
        }

        private var textSize = TextSize.current

        func update(_ incoming: [Transcript.Line], textSize: TextSize, in scroll: NSScrollView) {
            guard let table else { return }
            if textSize != self.textSize {
                self.textSize = textSize
                measured = [:]
                lines = []
            }
            let old = lines
            let new = incoming.map { line in
                var shown = line
                shown.stepsOpen = opened.contains(line.id)
                return shown
            }
            lines = new
            let stuck = isAtBottom(scroll)

            if old.map(\.id) != new.map(\.id) {
                measured = measured.filter { entry in new.contains { $0.id == entry.key } }
                table.reloadData()
            } else {
                let changed = IndexSet(new.indices.filter { new[$0] != old[$0] })
                if !changed.isEmpty {
                    table.reloadData(forRowIndexes: changed, columnIndexes: IndexSet(integer: 0))
                    table.noteHeightOfRows(withIndexesChanged: changed)
                }
            }
            if stuck, !new.isEmpty {
                table.scrollRowToVisible(new.count - 1)
            }
        }

        func toggleSteps(_ id: UUID) {
            guard let table, let row = lines.firstIndex(where: { $0.id == id }) else { return }
            if opened.contains(id) { opened.remove(id) } else { opened.insert(id) }
            lines[row].stepsOpen = opened.contains(id)
            let rows = IndexSet(integer: row)
            table.reloadData(forRowIndexes: rows, columnIndexes: IndexSet(integer: 0))
            table.noteHeightOfRows(withIndexesChanged: rows)
        }

        func widthChanged() {
            guard let table, !lines.isEmpty else { return }
            table.noteHeightOfRows(withIndexesChanged: IndexSet(integersIn: 0 ..< lines.count))
        }

        private func isAtBottom(_ scroll: NSScrollView) -> Bool {
            guard let document = scroll.documentView else { return true }
            let visible = scroll.contentView.bounds
            return visible.maxY >= document.frame.height - 40
        }

        func numberOfRows(in tableView: NSTableView) -> Int {
            lines.count
        }

        private func size(of line: Transcript.Line, in tableView: NSTableView) -> MessageLayout.Size {
            let width = max(tableView.bounds.width - side(for: tableView.bounds.width) * 2, 80)
            if let cached = measured[line.id], cached.width == width, cached.line == line {
                return cached.size
            }
            let size = MessageLayout.measure(line, column: width)
            measured[line.id] = Measured(line: line, width: width, size: size)
            return size
        }

        func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
            guard lines.indices.contains(row) else { return 24 }
            return size(of: lines[row], in: tableView).height
        }

        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard lines.indices.contains(row) else { return nil }
            let identifier = NSUserInterfaceItemIdentifier("messageCell")
            let cell = tableView.makeView(withIdentifier: identifier, owner: nil) as? MessageCell ?? MessageCell()
            cell.identifier = identifier
            cell.onToggle = { [weak self] id in self?.toggleSteps(id) }
            cell.show(lines[row], side: side(for: tableView.bounds.width), size: size(of: lines[row], in: tableView))
            return cell
        }
    }
}

/// How a message sits in the column, measured once per line and width.
@MainActor
enum MessageLayout {
    struct Size: Equatable {
        let height: CGFloat
        /// The bubble's width for a message of yours. Zero for a reply, which takes the column.
        let bubble: CGFloat
    }

    /// The Windows bubble: px-4 py-2.5 on surface-raised, rounded-md, at most most of the column.
    static let bubblePadding = NSSize(width: 16, height: 10)
    static let bubbleShare: CGFloat = 0.85
    static let bubbleRadius: CGFloat = 16
    static let footerHeight: CGFloat = 20

    static func measure(_ line: Transcript.Line, column: CGFloat) -> Size {
        let text = MessageText.attributed(line)
        if line.role == .user {
            let widest = max(column * bubbleShare - bubblePadding.width * 2, 40)
            let box = bounds(text, width: widest)
            let bubble = min(ceil(box.width) + bubblePadding.width * 2 + 2, column * bubbleShare)
            let wrapped = bounds(text, width: bubble - bubblePadding.width * 2)
            return Size(height: ceil(wrapped.height) + 4 + bubblePadding.height * 2, bubble: bubble)
        }
        let box = bounds(text, width: column)
        // The text view lays out a little taller than the measure, so the last line gets room to land.
        return Size(height: ceil(box.height) + 8 + (footer(line) == nil ? 0 : footerHeight), bubble: 0)
    }

    /// Speed and cost under a reply, the facts Windows shows in its turn footer.
    static func footer(_ line: Transcript.Line) -> String? {
        guard line.role == .assistant else { return nil }
        var parts: [String] = []
        if let speed = line.speed {
            parts.append(String(format: String(localized: "%.1f tokens/s"), speed))
        }
        if let cost = line.cost { parts.append(cost.text) }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    private static func bounds(_ text: NSAttributedString, width: CGFloat) -> NSRect {
        text.boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
    }
}

/// The grey rounded fill behind a message of yours, redrawn when the window turns light or dark.
private final class BubbleView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = MessageLayout.bubbleRadius
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = Theme.NS.surfaceRaised.cgColor
        }
    }
}

/// One message: yours in a bubble on the right, a reply across the column with its footer below.
private final class MessageCell: NSTableCellView, NSTextViewDelegate {
    private let bubble = BubbleView()
    private let footer = NSTextField(labelWithString: "")
    private let text = NSTextView(usingTextLayoutManager: true)
    private var side: CGFloat = 16
    private var size = MessageLayout.Size(height: 0, bubble: 0)
    var onToggle: ((UUID) -> Void)?

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        footer.font = NSFont.ui(12)
        footer.textColor = Theme.NS.textTertiary
        text.delegate = self
        text.isEditable = false
        text.isSelectable = true
        text.drawsBackground = false
        text.textContainerInset = .zero
        text.textContainer?.lineFragmentPadding = 0
        text.isVerticallyResizable = false
        text.isHorizontallyResizable = false
        // Each link carries its own look: web links in the accent, the steps toggle in quiet grey.
        text.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        addSubview(bubble)
        addSubview(footer)
        addSubview(text)
    }

    convenience init() {
        self.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        fatalError("MessageCell is built in code")
    }

    func show(_ line: Transcript.Line, side: CGFloat, size: MessageLayout.Size) {
        self.side = side
        self.size = size
        let speaker = line.role == .user ? String(localized: "You") : "Draggy"
        let facts = MessageLayout.footer(line)
        footer.stringValue = facts ?? ""
        footer.toolTip = line.cost?.help
        footer.isHidden = facts == nil
        bubble.isHidden = line.role != .user
        // VoiceOver reads one element per message: who spoke, then what was said.
        setAccessibilityElement(true)
        setAccessibilityRole(.row)
        setAccessibilityLabel(facts.map { "\(speaker) \u{00B7} \($0)" } ?? speaker)
        setAccessibilityValue(line.text)
        text.setAccessibilityElement(false)
        footer.setAccessibilityElement(false)
        text.textStorage?.setAttributedString(MessageText.attributed(line))
        needsLayout = true
    }

    func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
        if let toggle = link as? StepsToggle {
            onToggle?(toggle.id)
            return true
        }
        guard let preview = link as? HTMLPreview else { return false }
        HTMLPreviewWindow.show(preview)
        return true
    }

    override func layout() {
        super.layout()
        let width = max(bounds.width - side * 2, 0)
        if !bubble.isHidden {
            let pad = MessageLayout.bubblePadding
            let box = NSRect(x: side + width - size.bubble, y: 0, width: size.bubble, height: bounds.height)
            bubble.frame = box
            text.frame = box.insetBy(dx: pad.width, dy: pad.height)
            return
        }
        let footerSpace = footer.isHidden ? 0 : MessageLayout.footerHeight
        text.frame = NSRect(x: side, y: 0, width: width, height: max(bounds.height - footerSpace, 0))
        footer.frame = NSRect(x: side, y: bounds.height - footerSpace, width: width, height: footerSpace)
    }
}
