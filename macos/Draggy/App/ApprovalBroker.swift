import DraggyCore
import Foundation

/// Answers the core's approval questions. The core asks on the turn's own thread and waits, so `ask` blocks that
/// thread until the window calls `resolve`. It must never run on the main thread.
final class ApprovalBroker: ApprovalHandler, @unchecked Sendable {
    private let lock = NSLock()
    private var gate: DispatchSemaphore?
    private var answer: ApprovalChoice = .no
    private let present: @MainActor @Sendable (ApprovalRecord) -> Void

    init(present: @escaping @MainActor @Sendable (ApprovalRecord) -> Void) {
        self.present = present
    }

    func ask(request: ApprovalRecord) -> ApprovalChoice {
        let waiting = DispatchSemaphore(value: 0)
        lock.lock()
        gate = waiting
        answer = .no
        lock.unlock()

        let present = present
        Task { @MainActor in present(request) }
        waiting.wait()

        lock.lock()
        defer { lock.unlock() }
        return answer
    }

    /// Answers the question that is waiting, if any. Calling it with nothing waiting does nothing.
    func resolve(_ choice: ApprovalChoice) {
        lock.lock()
        let waiting = gate
        gate = nil
        answer = choice
        lock.unlock()
        waiting?.signal()
    }
}
