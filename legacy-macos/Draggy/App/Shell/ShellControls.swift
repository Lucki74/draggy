import AppKit
import SwiftUI

/// A full-width sidebar row: icon, label and a shortcut hint, as NavRow draws it on Windows.
struct NavRow: View {
    let glyph: Glyph
    let title: String
    var shortcut: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Icon(glyph: glyph, size: 16)
                    .foregroundStyle(Theme.textSecondary)
                Text(title)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let shortcut {
                    Text(shortcut)
                        .font(.ui(11))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
    }
}

/// The hover and press fill every sidebar row shares.
struct RowButtonStyle: ButtonStyle {
    var isSelected = false

    func makeBody(configuration: Configuration) -> some View {
        RowBody(configuration: configuration, isSelected: isSelected)
    }

    private struct RowBody: View {
        let configuration: Configuration
        let isSelected: Bool
        @State private var isHovered = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.ui(13))
                .foregroundStyle(Theme.textPrimary)
                .background(fill, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .opacity(isEnabled ? 1 : 0.5)
                .onHover { isHovered = $0 }
        }

        private var fill: Color {
            if isSelected || configuration.isPressed { return Theme.surfaceRaised }
            return isHovered ? Theme.surfaceRaised.opacity(0.6) : .clear
        }
    }
}

/// A small square icon button with a hover fill, used in the title bar and on sidebar rows.
struct IconButton: View {
    let glyph: Glyph
    let label: String
    var size: CGFloat = 16
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(glyph: glyph, size: size)
                .frame(width: size + 10, height: size + 10)
                .contentShape(Rectangle())
        }
        .buttonStyle(IconButtonStyle())
        .help(label)
        .accessibilityLabel(label)
    }
}

struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        HoverLabel(configuration: configuration)
    }

    private struct HoverLabel: View {
        let configuration: Configuration
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .foregroundStyle(isHovered ? Theme.textPrimary : Theme.textSecondary)
                .background(
                    isHovered || configuration.isPressed ? Theme.surfaceRaised : .clear,
                    in: RoundedRectangle(cornerRadius: Theme.Radius.xs)
                )
                .onHover { isHovered = $0 }
        }
    }
}

/// The pill switch between Chat and Code at the top of the sidebar.
struct ModeSwitch: View {
    let mode: AppMode
    let isEnabled: Bool
    let onChange: (AppMode) -> Void

    var body: some View {
        HStack(spacing: 2) {
            segment(.chat, glyph: .chatCircle, title: String(localized: "Chat"))
            segment(.code, glyph: .code, title: String(localized: "Code"))
        }
        .padding(3)
        .background(Theme.surfaceRaised, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.rule))
        .disabled(!isEnabled)
    }

    private func segment(_ value: AppMode, glyph: Glyph, title: String) -> some View {
        let selected = mode == value
        return Button {
            onChange(value)
        } label: {
            HStack(spacing: 6) {
                Icon(glyph: glyph, size: 14)
                Text(title)
            }
            .font(.ui(13, selected ? .medium : .regular))
            .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .frame(height: 28)
            .background {
                if selected {
                    Capsule()
                        .fill(Theme.surfaceBase)
                        .overlay(Capsule().strokeBorder(Theme.ruleStrong))
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A thin strip on the sidebar's edge that drags its width within the Windows limits.
struct SidebarResizeHandle: View {
    @Binding var width: Double
    @State private var start: Double?
    @State private var isHovered = false

    var body: some View {
        Rectangle()
            .fill(isHovered || start != nil ? Theme.ruleStrong : Theme.rule)
            .frame(width: 1)
            .overlay {
                Color.clear
                    .frame(width: 6)
                    .contentShape(Rectangle())
                    .onHover { hovering in
                        isHovered = hovering
                        if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { drag in
                                let origin = start ?? width
                                start = origin
                                let next = origin + drag.translation.width
                                width = min(max(next, ShellState.sidebarWidths.lowerBound), ShellState.sidebarWidths.upperBound)
                            }
                            .onEnded { _ in start = nil }
                    )
            }
    }
}
