import Foundation
import XCTest

final class LocalizationTests: XCTestCase {
    private func catalogue() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Draggy/Resources/Localizable.xcstrings")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        return try XCTUnwrap((object as? [String: Any])?["strings"] as? [String: Any])
    }

    func testEveryKeyHasFrenchSpanishAndChinese() throws {
        for (key, entry) in try catalogue() {
            let localizations = (entry as? [String: Any])?["localizations"] as? [String: Any] ?? [:]
            for language in ["fr", "es", "zh-Hans"] {
                let unit = (localizations[language] as? [String: Any])?["stringUnit"] as? [String: Any]
                let value = unit?["value"] as? String ?? ""
                XCTAssertFalse(value.isEmpty, "\(key) has no \(language) text")
            }
        }
    }

    func testTranslationsKeepTheFormatPlaceholders() throws {
        for (key, entry) in try catalogue() {
            let localizations = (entry as? [String: Any])?["localizations"] as? [String: Any] ?? [:]
            let expected = placeholders(in: key)
            for (language, item) in localizations {
                let unit = (item as? [String: Any])?["stringUnit"] as? [String: Any]
                let value = unit?["value"] as? String ?? ""
                XCTAssertEqual(placeholders(in: value), expected, "\(key) in \(language)")
            }
        }
    }

    private func placeholders(in text: String) -> [String] {
        let pattern = try! NSRegularExpression(pattern: "%(\\d+\\$)?(@|lld|llu|\\.1f)")
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range)
            .map { String(text[Range($0.range, in: text)!]).replacingOccurrences(of: "\\d+\\$", with: "", options: .regularExpression) }
            .sorted()
    }
}
