import XCTest
@testable import Draggy

final class KeychainSecretStoreTests: XCTestCase {
    private func makeStore() -> KeychainSecretStore {
        KeychainSecretStore(service: "com.draggy.app.tests.\(UUID().uuidString)")
    }

    func testMissingSecretReadsAsNil() throws {
        XCTAssertNil(try makeStore().secret(for: "provider"))
    }

    func testSecretRoundTripsAndReplaces() throws {
        let store = makeStore()
        try store.setSecret("first", for: "provider")
        XCTAssertEqual(try store.secret(for: "provider"), "first")
        try store.setSecret("second", for: "provider")
        XCTAssertEqual(try store.secret(for: "provider"), "second")
        try store.setSecret(nil, for: "provider")
    }

    func testEmptyValueRemovesTheSecret() throws {
        let store = makeStore()
        try store.setSecret("key", for: "provider")
        try store.setSecret("", for: "provider")
        XCTAssertNil(try store.secret(for: "provider"))
    }
}
