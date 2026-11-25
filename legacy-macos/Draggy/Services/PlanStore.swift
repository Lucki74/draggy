import Foundation
import SwiftUI

public enum StepStatus: String, Codable, Sendable {
    case pending
    case inProgress = "in_progress"
    case completed
    case failed
}

public struct PlanStepItem: Identifiable, Codable, Sendable {
    public let id: String
    public var title: String
    public var status: StepStatus
    public var details: String?

    public init(id: String = UUID().uuidString, title: String, status: StepStatus = .pending, details: String? = nil) {
        self.id = id
        self.title = title
        self.status = status
        self.details = details
    }
}

public struct PlanModel: Identifiable, Codable, Sendable {
    public let id: String
    public var goal: String
    public var steps: [PlanStepItem]
    public var createdAt: Date

    public init(id: String = UUID().uuidString, goal: String, steps: [PlanStepItem] = []) {
        self.id = id
        self.goal = goal
        self.steps = steps
        self.createdAt = Date()
    }
}

@MainActor
@Observable
public final class PlanStore {
    public var currentPlan: PlanModel?
    public var planHistory: [PlanModel] = []

    public init() {}

    public func setPlan(goal: String, steps: [String]) {
        let stepItems = steps.map { PlanStepItem(title: $0) }
        let plan = PlanModel(goal: goal, steps: stepItems)
        self.currentPlan = plan
        self.planHistory.append(plan)
    }

    public func updateStepStatus(id: String, status: StepStatus) {
        guard var plan = currentPlan else { return }
        if let idx = plan.steps.firstIndex(where: { $0.id == id }) {
            plan.steps[idx].status = status
            currentPlan = plan
        }
    }
}
