// The space key, in the Keychain of this device only. Readable after the first unlock, so a push
// that wakes the app in the background can still connect.

import Foundation
import Security

struct KeyStoreError: Error {
    let status: OSStatus
}

enum KeyStore {
    private static let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: "dev.fmap.isbell",
        kSecAttrAccount: "space-key",
    ]

    /// Nil when none is stored.
    static func load() throws(KeyStoreError) -> String? {
        var found: CFTypeRef?
        let status = SecItemCopyMatching(
            query.merging([kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]) { $1 } as CFDictionary,
            &found)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = found as? Data else { throw KeyStoreError(status: status) }
        return String(decoding: data, as: UTF8.self)
    }

    /// Replaces the key stored before, if any.
    static func save(_ key: String) throws(KeyStoreError) {
        let attributes: [CFString: Any] = [
            kSecValueData: Data(key.utf8),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw KeyStoreError(status: updated) }
        let added = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeyStoreError(status: added) }
    }

    /// Deleting a key that is not there is not an error.
    static func delete() throws(KeyStoreError) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeyStoreError(status: status) }
    }
}
