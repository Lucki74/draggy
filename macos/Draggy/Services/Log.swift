import OSLog

extension Logger {
    static let subsystem = "com.draggy.app"

    static let app = Logger(subsystem: subsystem, category: "app")
    static let sandbox = Logger(subsystem: subsystem, category: "sandbox")
    static let shell = Logger(subsystem: subsystem, category: "shell")
    static let engine = Logger(subsystem: subsystem, category: "engine")
    static let models = Logger(subsystem: subsystem, category: "models")
    static let mcp = Logger(subsystem: subsystem, category: "mcp")
    static let browser = Logger(subsystem: subsystem, category: "browser")
    static let updater = Logger(subsystem: subsystem, category: "updater")
    static let storage = Logger(subsystem: subsystem, category: "storage")
    static let chat = Logger(subsystem: subsystem, category: "chat")
    static let tools = Logger(subsystem: subsystem, category: "tools")
    static let diagnostics = Logger(subsystem: subsystem, category: "diagnostics")
}
