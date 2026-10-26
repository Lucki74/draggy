import Foundation

public final class ExcelCreator: Sendable {
    public static let shared = ExcelCreator()

    public init() {}

    public func createSpreadsheet(headers: [String], rows: [[String]], outputPath: String) throws {
        var csv = headers.joined(separator: ",") + "\n"
        for row in rows {
            csv += row.joined(separator: ",") + "\n"
        }
        try csv.write(toFile: outputPath, atomically: true, encoding: .utf8)
    }
}
