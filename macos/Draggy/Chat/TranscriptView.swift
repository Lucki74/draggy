import AppKit
import SwiftUI

/// The transcript on an NSTableView with TextKit 2 text views, as the plan asks. Only the rows that changed are
/// reloaded while a reply streams, and row heights are cached per line and width.
struct TranscriptView: NSViewRepresentable {
    let lines: [Transcript.Line]

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
        table.intercellSpacing = NSSize(width: 0, height: 6)
        table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingColumnStyle
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
        context.coordinator.update(lines, in: scroll)
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
            let height: CGFloat
        }

        weak var table: NSTableView?
        private var lines: [Transcript.Line] = []
        private var measured: [UUID: Measured] = [:]

        private static let sidePadding: CGFloat = 16
        private static let captionHeight: CGFloat = 18

        func update(_ new: [Transcript.Line], in scroll: NSScrollView) {
            guard let table else { return }
            let old = lines
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

        func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
            guard lines.indices.contains(row) else { return 24 }
            let line = lines[row]
            let width = max(tableView.bounds.width - Self.sidePadding * 2, 80)
            if let cached = measured[line.id], cached.width == width, cached.line == line {
                return cached.height
            }
            let text = MessageText.attributed(line)
            let box = text.boundingRect(
                with: NSSize(width: width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading]
            )
            let height = Self.captionHeight + ceil(box.height) + 10
            measured[line.id] = Measured(line: line, width: width, height: height)
            return height
        }

        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard lines.indices.contains(row) else { return nil }
            let identifier = NSUserInterfaceItemIdentifier("messageCell")
            let cell = tableView.makeView(withIdentifier: identifier, owner: nil) as? MessageCell ?? MessageCell()
            cell.identifier = identifier
            cell.show(lines[row], side: Self.sidePadding, captionHeight: Self.captionHeight)
            return cell
        }
    }
}

/// A caption and a selectable TextKit 2 text view, laid out by hand from the top.
private final class MessageCell: NSTableCellView {
    private let caption = NSTextField(labelWithString: "")
    private let text = NSTextView(usingTextLayoutManager: true)
    private var side: CGFloat = 16
    private var captionHeight: CGFloat = 18

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        caption.font = NSFont.systemFont(ofSize: 11)
        caption.textColor = .secondaryLabelColor
        text.isEditable = false
        text.isSelectable = true
        text.drawsBackground = false
        text.textContainerInset = .zero
        text.textContainer?.lineFragmentPadding = 0
        text.isVerticallyResizable = false
        text.isHorizontallyResizable = false
        addSubview(caption)
        addSubview(text)
    }

    convenience init() {
        self.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        fatalError("MessageCell is built in code")
    }

    func show(_ line: Transcript.Line, side: CGFloat, captionHeight: CGFloat) {
        self.side = side
        self.captionHeight = captionHeight
        var title = line.role == .user ? "You" : "Draggy"
        if let speed = line.speed {
            title += String(format: " \u{00B7} %.1f tokens/s", speed)
        }
        caption.stringValue = title
        text.textStorage?.setAttributedString(MessageText.attributed(line))
        needsLayout = true
    }

    override func layout() {
        super.layout()
        let width = max(bounds.width - side * 2, 0)
        caption.frame = NSRect(x: side, y: 0, width: width, height: captionHeight)
        text.frame = NSRect(x: side, y: captionHeight, width: width, height: max(bounds.height - captionHeight, 0))
    }
}
