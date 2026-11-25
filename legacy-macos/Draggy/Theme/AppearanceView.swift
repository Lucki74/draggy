import SwiftUI

/// Theme, accent, language and text size, as the Windows Appearance step and settings page offer them.
struct AppearanceControls: View {
    @Bindable var appearance: AppearanceSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                ForEach([ThemeChoice.light, .dark, .system]) { choice in
                    ThemeCard(choice: choice, selected: appearance.theme == choice) { appearance.theme = choice }
                }
            }
            VStack(spacing: 0) {
                row(String(localized: "Accent color")) {
                    HStack(spacing: 8) {
                        ForEach(Accent.allCases) { accent in swatch(accent) }
                    }
                }
                divider
                row(String(localized: "Language")) {
                    Picker("Language", selection: $appearance.language) {
                        ForEach(AppLanguage.allCases) { language in
                            Text(verbatim: language.title).tag(language)
                        }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                if appearance.language != appearance.launchLanguage {
                    HStack {
                        Text("Draggy will restart and open in that language.")
                            .font(.ui(12))
                            .foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Button("Restart") { appearance.relaunch() }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
                divider
                row(String(localized: "Text size")) {
                    Picker("Text size", selection: $appearance.textSize) {
                        ForEach(TextSize.allCases) { size in Text(size.title).tag(size) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
            }
            .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.rule))
        }
    }

    private var divider: some View {
        Rectangle().fill(Theme.rule).frame(height: 1).padding(.horizontal, 16)
    }

    private func row<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        HStack {
            Text(label)
                .font(.ui(13))
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 12)
            control()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
    }

    private func swatch(_ accent: Accent) -> some View {
        let selected = appearance.accent == accent
        return Button {
            appearance.accent = accent
        } label: {
            Circle()
                .fill(accent.color(\.base))
                .frame(width: 20, height: 20)
                .padding(3)
                .overlay(Circle().strokeBorder(selected ? Theme.textPrimary : .clear, lineWidth: 2))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(accent.title)
        .accessibilityLabel(accent.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A theme option drawn as a small chat window in that theme. Match system shows both, split corner to corner.
private struct ThemeCard: View {
    let choice: ThemeChoice
    let selected: Bool
    let action: () -> Void

    private struct Palette {
        let canvas, base, raised, text: Color
    }

    private static let light = Palette(canvas: Color(nsColor: NSColor(RGB(hex: 0xF5F7F9))),
                                       base: .white,
                                       raised: Color(nsColor: NSColor(RGB(hex: 0xEAEDF1))),
                                       text: Color(nsColor: NSColor(RGB(hex: 0x1A1E24))))
    private static let dark = Palette(canvas: Color(nsColor: NSColor(RGB(hex: 0x0E1012))),
                                      base: Color(nsColor: NSColor(RGB(hex: 0x15171A))),
                                      raised: Color(nsColor: NSColor(RGB(hex: 0x1F2225))),
                                      text: Color(nsColor: NSColor(RGB(hex: 0xE7EAED))))

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                preview
                    .frame(height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.sm)
                            .strokeBorder(selected ? Theme.textPrimary : Theme.ruleStrong, lineWidth: selected ? 2 : 1)
                    )
                Text(choice.title)
                    .font(.ui(13, selected ? .medium : .regular))
                    .foregroundStyle(Theme.textPrimary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(choice.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var preview: some View {
        switch choice {
        case .light: miniature(Self.light)
        case .dark: miniature(Self.dark)
        case .system:
            ZStack {
                miniature(Self.light)
                miniature(Self.dark)
                    .mask(DiagonalHalf())
            }
        }
    }

    private func miniature(_ palette: Palette) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule().fill(palette.text.opacity(index == 0 ? 0.5 : 0.18)).frame(width: index == 0 ? 22 : 28, height: 3)
                }
                Spacer()
            }
            .padding(8)
            .frame(width: 44)
            .frame(maxHeight: .infinity)
            .background(palette.canvas)
            VStack(alignment: .trailing, spacing: 6) {
                RoundedRectangle(cornerRadius: 4).fill(palette.raised).frame(width: 46, height: 12)
                VStack(alignment: .leading, spacing: 4) {
                    Capsule().fill(palette.text.opacity(0.35)).frame(width: 60, height: 3)
                    Capsule().fill(palette.text.opacity(0.35)).frame(width: 48, height: 3)
                    Capsule().fill(palette.text.opacity(0.35)).frame(width: 54, height: 3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Spacer()
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(palette.text.opacity(0.15))
                    .background(RoundedRectangle(cornerRadius: 5).fill(palette.base))
                    .frame(height: 14)
            }
            .padding(8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.base)
        }
    }
}

/// The lower right half of a rectangle, cut corner to corner.
private struct DiagonalHalf: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}

/// Settings → Appearance.
struct AppearanceView: View {
    @Bindable var appearance: AppearanceSettings

    var body: some View {
        ScrollView {
            AppearanceControls(appearance: appearance)
                .padding(20)
        }
        .background(Theme.surfaceCanvas)
    }
}
