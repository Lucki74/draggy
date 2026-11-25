import Foundation
import Security

/// Holds secrets such as provider API keys. Callers read one only while building a request.
protocol SecretStore: Sendable {
    func secret(for account: String) throws -> String?
    /// An empty or nil value removes the secret.
    func setSecret(_ value: String?, for account: String) throws
}

/// Keychain generic passwords under one service name.
struct KeychainSecretStore: SecretStore {
    enum Failure: Error, Equatable {
        case status(OSStatus)
    }

    let service: String

    init(service: String = "com.draggy.app") {
        self.service = service
    }

    func secret(for account: String) throws -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Failure.status(status) }
        guard let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func setSecret(_ value: String?, for account: String) throws {
        let query = baseQuery(account)
        let removed = SecItemDelete(query as CFDictionary)
        guard removed == errSecSuccess || removed == errSecItemNotFound else {
            throw Failure.status(removed)
        }
        guard let value, !value.isEmpty else { return }
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure.status(status) }
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
