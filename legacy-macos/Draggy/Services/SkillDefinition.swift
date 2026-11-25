import Foundation

public struct SkillParameterDefinition: Codable, Sendable {
    public let name: String
    public let type: String
    public let description: String
    public let required: Bool

    public init(name: String, type: String, description: String, required: Bool = false) {
        self.name = name
        self.type = type
        self.description = description
        self.required = required
    }
}

public struct SkillDefinition: Identifiable, Codable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let parameters: [SkillParameterDefinition]
    public let promptTemplate: String?

    public init(id: String, name: String, description: String, parameters: [SkillParameterDefinition] = [], promptTemplate: String? = nil) {
        self.id = id
        self.name = name
        self.description = description
        self.parameters = parameters
        self.promptTemplate = promptTemplate
    }
}
