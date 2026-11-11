// The space key's life in the app: read at launch, stored on joining, dropped on leaving or when
// the relay rejects it.

import IsbellKit
import Observation
import os

@Observable
final class AppModel {
    enum Phase {
        case join(rejected: Bool)
        case joined(SpaceStore)
    }

    private(set) var phase: Phase = .join(rejected: false)

    init() {
        guard let key = Self.storedKey() else { return }
        do {
            phase = .joined(open(try parseKey(key)))
        } catch {
            logger.error("the stored space key does not parse: \(String(describing: error))")
            forgetKey()
        }
    }

    func join(_ identity: Identity) throws(KeyStoreError) {
        try KeyStore.save(identity.key)
        phase = .joined(open(identity))
    }

    func leave() {
        close()
        forgetKey()
        phase = .join(rejected: false)
    }

    func reconnectNow() {
        if case .joined(let store) = phase { store.reconnectNow() }
    }

    private func open(_ identity: Identity) -> SpaceStore {
        SpaceStore(identity: identity) { [weak self] in
            guard let self else { return }
            close()
            forgetKey()
            phase = .join(rejected: true)
        }
    }

    private func close() {
        if case .joined(let store) = phase { store.close() }
    }

    private static func storedKey() -> String? {
        do {
            return try KeyStore.load()
        } catch {
            logger.error("could not read the space key: \(error.status)")
            return nil
        }
    }

    /// The device stops using the key either way, so a failure is only logged.
    private func forgetKey() {
        do {
            try KeyStore.delete()
        } catch {
            logger.error("could not delete the space key: \(error.status)")
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "app")
