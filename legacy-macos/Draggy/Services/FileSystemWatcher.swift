import Foundation

public final class FileSystemWatcher: @unchecked Sendable {
    private var source: DispatchSourceFileSystemObject?
    private var fileDescriptor: CInt = -1
    private let queue = DispatchQueue(label: "com.draggy.fileswatcher", qos: .utility)

    public init() {}

    public func start(watching path: String, onChange: @escaping @Sendable () -> Void) {
        stop()

        fileDescriptor = open(path, O_EVTONLY)
        guard fileDescriptor >= 0 else { return }

        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .delete, .rename, .extend, .attrib],
            queue: queue
        )

        src.setEventHandler {
            onChange()
        }

        src.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.fileDescriptor >= 0 {
                close(self.fileDescriptor)
                self.fileDescriptor = -1
            }
        }

        src.resume()
        self.source = src
    }

    public func stop() {
        if let source {
            source.cancel()
            self.source = nil
        }
    }

    deinit {
        stop()
    }
}
