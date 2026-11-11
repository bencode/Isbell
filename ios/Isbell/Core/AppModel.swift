// The space key's life in the app: read at launch, stored on joining, dropped on leaving or when
// the relay rejects it. What the app remembers of a space goes with it.

import IsbellKit
import Observation
import os

@Observable
final class AppModel {
    enum Phase {
        case join(rejected: Bool)
        case joined(SpaceStore)
    }

    let prefs = Prefs()
    private(set) var phase: Phase = .join(rejected: false)
    @ObservationIgnored private var active = false

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
        drop()
        phase = .join(rejected: false)
    }

    /// Whether the app is in front, for the space to keep up with its machines.
    func setActive(_ on: Bool) {
        active = on
        if case .joined(let store) = phase { store.setActive(on) }
    }

    private func open(_ identity: Identity) -> SpaceStore {
        let store = SpaceStore(identity: identity, prefs: prefs) { [weak self] in
            guard let self else { return }
            drop()
            phase = .join(rejected: true)
        }
        store.setActive(active)
        return store
    }

    private func drop() {
        if case .joined(let store) = phase { store.close() }
        forgetKey()
        prefs.clearSpace()
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
