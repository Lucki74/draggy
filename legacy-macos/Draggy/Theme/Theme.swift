import AppKit
import CoreText
import Observation
import OSLog
import SwiftUI

/// The colour tokens of the Windows renderer (win/src/index.css), resolved for the window's appearance.
enum Theme {
    static let surfaceCanvas = Color(nsColor: NS.surfaceCanvas)
    static let surfaceBase = Color(nsColor: NS.surfaceBase)
    static let surfaceRaised = Color(nsColor: NS.surfaceRaised)
    static let surfaceTint = Color(nsColor: NS.surfaceTint)

    static let rule = Color(nsColor: NS.rule)
    static let ruleStrong = Color(nsColor: NS.ruleStrong)
    static let ruleControl = Color(nsColor: NS.ruleControl)

    static let textPrimary = Color(nsColor: NS.textPrimary)
    static let textSecondary = Color(nsColor: NS.textSecondary)
    static let textTertiary = Color(nsColor: NS.textTertiary)

    static let ok = Color(nsColor: NS.ok)
    static let warn = Color(nsColor: NS.warn)
    static let danger = Color(nsColor: NS.danger)

    /// The same tokens for AppKit drawing, such as the transcript's text views.
    enum NS {
        static let surfaceCanvas = dynamic(light: 0xF5F7F9, dark: 0x0E1012)
        static let surfaceBase = dynamic(light: 0xFFFFFF, dark: 0x15171A)
        static let surfaceRaised = dynamic(light: 0xEAEDF1, dark: 0x1F2225)
        static let surfaceTint = dynamic(light: (0x1A1E24, 0.05), dark: (0xE7EAED, 0.06))

        static let rule = dynamic(light: (0x1A1E24, 0.10), dark: (0xE7EAED, 0.10))
        static let ruleStrong = dynamic(light: (0x1A1E24, 0.22), dark: (0xE7EAED, 0.22))
        static let ruleControl = dynamic(light: (0x1A1E24, 0.49), dark: (0xE7EAED, 0.37))

        static let textPrimary = dynamic(light: 0x1A1E24, dark: 0xE7EAED)
        static let textSecondary = dynamic(light: 0x565B62, dark: 0xA6ABB2)
        static let textTertiary = dynamic(light: 0x82878C, dark: 0x767B81)

        static let ok = dynamic(light: 0x1A763F, dark: 0x78D694)
        static let warn = dynamic(light: 0x8D6310, dark: 0xE5D183)
        static let danger = dynamic(light: 0xBD1F3D, dark: 0xFA7F8E)

        /// The accent the user picked, read when the colour is drawn so a change shows at once.
        static func accent(_ shade: KeyPath<AccentShades, RGB>) -> NSColor {
            NSColor(name: nil) { appearance in
                let accent = UserDefaults.standard.string(forKey: "accent").flatMap(Accent.init(rawValue:)) ?? .vermilion
                return NSColor(accent.shades(dark: isDark(appearance))[keyPath: shade])
            }
        }

        private static func dynamic(light: Int, dark: Int) -> NSColor {
            dynamic(light: (light, 1), dark: (dark, 1))
        }

        private static func dynamic(light: (Int, Double), dark: (Int, Double)) -> NSColor {
            NSColor(name: nil) { appearance in
                let pick = isDark(appearance) ? dark : light
                return NSColor(RGB(hex: pick.0), alpha: pick.1)
            }
        }
    }

    /// The radii of the Windows scale: xs, sm, md, lg.
    enum Radius {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
    }

    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
}

/// One colour as 0–255 channels, the space the Windows accent maths works in.
struct RGB: Equatable, Sendable {
    var r: Double
    var g: Double
    var b: Double

    init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    init(hex: Int) {
        self.init(Double((hex >> 16) & 0xFF), Double((hex >> 8) & 0xFF), Double(hex & 0xFF))
    }

    static let white = RGB(255, 255, 255)
    static let black = RGB(0, 0, 0)

    func mixed(with other: RGB, _ amount: Double) -> RGB {
        RGB(r + (other.r - r) * amount, g + (other.g - g) * amount, b + (other.b - b) * amount)
    }

    var luminance: Double {
        func channel(_ value: Double) -> Double {
            let s = value / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }

    func contrast(with other: RGB) -> Double {
        let high = max(luminance, other.luminance)
        let low = min(luminance, other.luminance)
        return (high + 0.05) / (low + 0.05)
    }

    /// Rounded like the Windows hex output, so both apps land on the same colour.
    var rounded: RGB { RGB(r.rounded(), g.rounded(), b.rounded()) }
}

extension NSColor {
    convenience init(_ rgb: RGB, alpha: Double = 1) {
        self.init(srgbRed: rgb.r / 255, green: rgb.g / 255, blue: rgb.b / 255, alpha: alpha)
    }
}

/// The seven accents of the Okabe-Ito palette, as in win/src/app/accent.ts. The first is the default.
enum Accent: String, CaseIterable, Identifiable, Sendable {
    case vermilion, blue, orange, green, pink, sky, yellow

    var id: String { rawValue }

    var base: RGB {
        switch self {
        case .vermilion: RGB(hex: 0xD55E00)
        case .blue: RGB(hex: 0x0072B2)
        case .orange: RGB(hex: 0xE69F00)
        case .green: RGB(hex: 0x009E73)
        case .pink: RGB(hex: 0xCC79A7)
        case .sky: RGB(hex: 0x56B4E9)
        case .yellow: RGB(hex: 0xF0E442)
        }
    }

    var title: String {
        switch self {
        case .vermilion: String(localized: "Vermilion")
        case .blue: String(localized: "Blue")
        case .orange: String(localized: "Orange")
        case .green: String(localized: "Green")
        case .pink: String(localized: "Pink")
        case .sky: String(localized: "Sky blue")
        case .yellow: String(localized: "Yellow")
        }
    }

    /// The panel colour accent text must read on in each theme, `--bg-panel` on Windows.
    private static let page = (light: RGB(hex: 0xF5F5F5), dark: RGB(hex: 0x1E1E1E))

    /// Every accent shade for one theme. Soft, ink and hover come from the base colour.
    func shades(dark: Bool) -> AccentShades {
        let page = dark ? Self.page.dark : Self.page.light
        let toward = dark ? RGB.white : RGB.black
        let text = base.contrast(with: .white) >= base.contrast(with: .black) ? RGB.white : RGB.black
        var ink = base
        for _ in 0..<20 where ink.contrast(with: page) < 4.5 {
            ink = ink.mixed(with: toward, 0.1)
        }
        return AccentShades(
            base: base,
            text: text,
            ink: ink.rounded,
            soft: page.mixed(with: base, dark ? 0.2 : 0.14).rounded,
            hover: base.mixed(with: toward, 0.14).rounded
        )
    }

    /// One shade as a colour that follows the window between light and dark.
    func color(_ shade: KeyPath<AccentShades, RGB>) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            NSColor(shades(dark: Theme.isDark(appearance))[keyPath: shade])
        })
    }
}

struct AccentShades: Equatable, Sendable {
    let base: RGB
    /// Black or white, whichever reads better on the base colour.
    let text: RGB
    /// The accent darkened or lightened until text in it passes AA on the panel.
    let ink: RGB
    let soft: RGB
    let hover: RGB
}

/// Light, dark, or whatever the system uses, as the Windows theme setting offers.
enum ThemeChoice: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: String(localized: "Match system")
        case .light: String(localized: "Light")
        case .dark: String(localized: "Dark")
        }
    }

    var appearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

/// The chat text sizes of the Windows setting: Small, Medium and Large, 13, 15 and 18 points.
enum TextSize: String, CaseIterable, Identifiable, Sendable {
    case small, medium, large

    static let key = "chatTextSize"

    var id: String { rawValue }

    var points: CGFloat {
        switch self {
        case .small: 13
        case .medium: 15
        case .large: 18
        }
    }

    var title: String {
        switch self {
        case .small: String(localized: "Small")
        case .medium: String(localized: "Medium")
        case .large: String(localized: "Large")
        }
    }

    /// The size the transcript draws with, read where AppKit builds the text.
    static var current: TextSize {
        UserDefaults.standard.string(forKey: key).flatMap(TextSize.init(rawValue:)) ?? .medium
    }
}

/// The interface languages both apps ship. Empty follows the system.
enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
    case system = "", en, fr, es, ru

    var id: String { rawValue }

    /// Each language in its own name, as the Windows list shows them.
    var title: String {
        switch self {
        case .system: String(localized: "Match system")
        case .en: "English"
        case .fr: "Français"
        case .es: "Español"
        case .ru: "Русский"
        }
    }
}

/// The theme and accent the user picked, remembered between launches.
@MainActor
@Observable
final class AppearanceSettings {
    private enum Key {
        static let theme = "theme"
        static let accent = "accent"
    }

    @ObservationIgnored private let defaults: UserDefaults

    var theme: ThemeChoice {
        didSet {
            defaults.set(theme.rawValue, forKey: Key.theme)
            apply()
        }
    }

    var accent: Accent {
        didSet { defaults.set(accent.rawValue, forKey: Key.accent) }
    }

    var textSize: TextSize {
        didSet { defaults.set(textSize.rawValue, forKey: TextSize.key) }
    }

    /// The language the app was launched in, and the one it will use from its next launch.
    let launchLanguage: AppLanguage
    var language: AppLanguage {
        didSet {
            if language == .system {
                defaults.removeObject(forKey: "AppleLanguages")
            } else {
                defaults.set([language.rawValue], forKey: "AppleLanguages")
            }
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = defaults.string(forKey: Key.theme).flatMap(ThemeChoice.init(rawValue:)) ?? .system
        accent = defaults.string(forKey: Key.accent).flatMap(Accent.init(rawValue:)) ?? .vermilion
        textSize = defaults.string(forKey: TextSize.key).flatMap(TextSize.init(rawValue:)) ?? .medium
        // Only a list this app wrote holds one entry; the system's own list never shows here as ours.
        let chosen = defaults.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "")?["AppleLanguages"] as? [String]
        let saved = chosen?.first.flatMap(AppLanguage.init(rawValue:)) ?? .system
        language = saved
        launchLanguage = saved
    }

    /// A language change shows from the next launch, so the app offers to start again.
    func relaunch() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
            Task { @MainActor in NSApp.terminate(nil) }
        }
    }

    /// Set on the app rather than through SwiftUI, which does not hand a window back to the system look.
    func apply() {
        NSApp?.appearance = theme.appearance
    }
}

/// The two typefaces the Windows app ships, registered for this process only.
enum Fonts {
    static let sans = "Geologica"
    static let mono = "JetBrains Mono"

    static func register() {
        for name in ["Geologica", "JetBrainsMono"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else {
                Logger.app.error("font \(name, privacy: .public) is missing from the bundle")
                continue
            }
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                let reason = error?.takeRetainedValue().localizedDescription ?? "unknown"
                Logger.app.error("font \(name, privacy: .public) not registered: \(reason, privacy: .public)")
            }
        }
    }
}

extension NSFont {
    /// Geologica for AppKit text, falling back to the system face if the bundle lost it.
    static func ui(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont {
        family(Fonts.sans, size: size, weight: weight) ?? .systemFont(ofSize: size, weight: weight)
    }

    static func code(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont {
        family(Fonts.mono, size: size, weight: weight) ?? .monospacedSystemFont(ofSize: size, weight: weight)
    }

    private static func family(_ name: String, size: CGFloat, weight: NSFont.Weight) -> NSFont? {
        let descriptor = NSFontDescriptor(fontAttributes: [
            .family: name,
            .traits: [NSFontDescriptor.TraitKey.weight: weight],
        ])
        return NSFont(descriptor: descriptor, size: size)
    }
}

extension Font {
    /// Geologica at a fixed point size, the interface face on Windows.
    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(Fonts.sans, fixedSize: size).weight(weight)
    }

    static func code(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(Fonts.mono, fixedSize: size).weight(weight)
    }
}

/// A Phosphor glyph from Icons.xcassets, in the weight Windows picks for the size.
struct Icon: View {
    let glyph: Glyph
    var size: CGFloat = 16
    var filled = false

    var body: some View {
        Image(nsImage: Self.image(glyph, size: size, filled: filled))
            .renderingMode(.template)
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    static func assetName(_ glyph: Glyph, size: CGFloat, filled: Bool) -> String {
        let suffix = filled ? "-fill" : size >= 24 ? "-light" : ""
        return "ph-\(glyph.rawValue)\(suffix)"
    }

    @MainActor private static var cache: [String: NSImage] = [:]

    /// The glyph at its point size. Menus draw an image at its own size, ignoring the frame around it.
    @MainActor static func image(_ glyph: Glyph, size: CGFloat, filled: Bool) -> NSImage {
        let name = assetName(glyph, size: size, filled: filled)
        let key = "\(name)@\(size)"
        if let cached = cache[key] { return cached }
        let image = (NSImage(named: name)?.copy() as? NSImage) ?? NSImage()
        image.size = NSSize(width: size, height: size)
        image.isTemplate = true
        cache[key] = image
        return image
    }
}

/// The dragon mark, drawn in the colour of the text around it.
struct DragonMark: View {
    var size: CGFloat = 16

    var body: some View {
        Image("DragonMark")
            .resizable()
            .renderingMode(.template)
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
