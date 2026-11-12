// A pane's terminal while its page is shown: attached once the view has a size, and attached again,
// once for each time it was open, when it was lost; one taken by another screen stays ended, for two
// screens not to take it from each other for ever. As web/src/features/session/use-terminal.ts and
// the phone's useReattach.

import Foundation
import IsbellKit
import Observation
import os

@MainActor @Observable
final class TerminalModel {
    enum Phase { case opening, open, ended }

    private(set) var phase: Phase = .opening
    /// Why it ended; nil when it was taken by another screen or the pane closed.
    private(set) var error: CallError?
    /// Where the bytes go: set by TermView once it exists.
    @ObservationIgnored var screen: ((Data) -> Void)?

    @ObservationIgnored private let mid: String
    @ObservationIgnored private let paneId: String
    @ObservationIgnored private var terminal: Terminal?
    @ObservationIgnored private var size: TermSize?
    /// Whether the next loss may attach again on its own: once per time it was open.
    private var spare = true
    /// Bumped on each attach and on close, so an attempt overtaken by another is dropped.
    @ObservationIgnored private var attempt = 0

    /// Lost, and to attach again on its own once the app is in front with the relay open.
    var waiting: Bool { phase == .ended && error != nil && spare }

    init(mid: String, paneId: String) {
        self.mid = mid
        self.paneId = paneId
    }

    /// With the view's size: the first call attaches, later ones resize.
    func sized(_ space: Space, _ size: TermSize) {
        let first = self.size == nil
        self.size = size
        if first { attach(space) } else { terminal?.resize(size) }
    }

    func input(_ bytes: Data) {
        terminal?.input(bytes)
    }

    func reconnect(_ space: Space) {
        spare = true
        attach(space)
    }

    /// With the app in front and the relay open: a terminal lost with an error attaches again, if
    /// it may.
    func resume(_ space: Space) {
        guard waiting, space.status == .open else { return }
        spare = false
        attach(space)
    }

    /// Lets the pane go; it stays in herdr.
    func close() {
        attempt += 1
        terminal?.close()
        terminal = nil
    }

    private func attach(_ space: Space) {
        guard let size else { return }
        terminal?.close()
        terminal = nil
        attempt += 1
        let current = attempt
        phase = .opening
        error = nil
        let events = TerminalEvents(output: { [weak self] in self?.screen?($0) }, size: { _ in }, end: { [weak self] error in
            guard let self, current == attempt else { return }
            terminal = nil
            ended(error)
        })
        Task {
            do throws(CallError) {
                let opened = try await openTerminal(space.open, mid: mid, paneId: paneId, size: size, events: events)
                guard current == attempt else { return opened.close() }
                terminal = opened
                phase = .open
                spare = true
                // The view may have changed size while it opened.
                if let now = self.size { opened.resize(now) }
            } catch {
                guard current == attempt else { return }
                ended(error)
            }
        }
    }

    private func ended(_ error: CallError?) {
        if let error { logger.info("the terminal of \(self.paneId) ended: \(error.msg)") }
        self.error = error
        phase = .ended
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "terminal")
