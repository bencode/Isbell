// Voice input, for the reply bar and the terminal: a recording, sent to the web's speech service,
// comes back as tidied words. Five minutes' recording ends by itself; one dropped is never sent.

import AVFoundation
import IsbellKit
import Observation
import UIKit
import os

enum VoiceProblem: Equatable {
    /// The microphone is not allowed; only iOS Settings can allow it now.
    case denied
    case failure(VoiceFailure)
}

@MainActor @Observable
final class VoiceInput {
    enum State: Equatable { case idle, recording, working }
    private(set) var state: State = .idle {
        // The screen stays on while one speaks without touching it, and sleeps again after (#139).
        didSet {
            if (oldValue == .recording) != (state == .recording) {
                UIApplication.shared.isIdleTimerDisabled = state == .recording
            }
        }
    }
    /// Why the last try came to nothing, until the next.
    private(set) var problem: VoiceProblem?
    /// The voice as it was heard, 0…1, the latest last.
    private(set) var levels: [Double] = []
    /// When the recording began.
    private(set) var since: Date?

    static let service = URL(string: "https://isbell.fmap.dev/voice")!
    /// The service takes five minutes at most.
    static let longest: TimeInterval = 300
    /// How many of the latest levels are kept to be shown.
    static let shown = 40

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var file: URL?
    @ObservationIgnored private var onText: ((String) -> Void)?
    @ObservationIgnored private var metering: Task<Void, Never>?
    @ObservationIgnored private var sending: Task<Void, Never>?
    /// Starts so far: one left waiting on iOS's question is over once another begins, or is dropped.
    @ObservationIgnored private var tries = 0

    /// Starts recording; the words heard go to `onText` once `finish` sends them. Kept while
    /// recognising, so they still land if the bar that started it has gone (the agent asks).
    func start(onText: @escaping (String) -> Void) async {
        guard state == .idle else { return }
        tries += 1
        let mine = tries
        problem = nil
        let allowed = await allowed()
        // Tapped again, or left, while iOS asked.
        guard tries == mine, state == .idle else { return }
        guard allowed else { return problem = .denied }
        let url = FileManager.default.temporaryDirectory.appending(path: "voice-\(UUID().uuidString).m4a")
        file = url
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            recorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32000,
            ])
        } catch {
            release()
            return problem = .failure(.failed(error.localizedDescription))
        }
        recorder?.isMeteringEnabled = true
        guard recorder?.record() == true else {
            release()
            return problem = .failure(.failed(String(localized: "The microphone could not be used")))
        }
        self.onText = onText
        levels = []
        since = .now
        state = .recording
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        metering = Task { [weak self] in await self?.meter() }
    }

    /// Ends the recording and sends it.
    func finish() {
        guard state == .recording, let recorder, let file else { return }
        metering?.cancel()
        recorder.stop()
        let audio: Data
        do {
            audio = try Data(contentsOf: file)
        } catch {
            release()
            settle()
            return problem = .failure(.failed(error.localizedDescription))
        }
        release()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        state = .working
        sending = Task { [weak self] in
            do throws(VoiceFailure) {
                let text = try await transcribe(Self.service, audio: audio, filename: "voice.m4a", type: "audio/mp4")
                guard !Task.isCancelled else { return }
                self?.onText?(text)
            } catch {
                // Dropped on the way: nothing to say.
                if !Task.isCancelled { self?.problem = .failure(error) }
            }
            if !Task.isCancelled { self?.settle() }
        }
    }

    /// Drops the recording, or the words on their way, and lets the microphone go.
    func discard() {
        tries += 1
        guard state != .idle else { return }
        sending?.cancel()
        metering?.cancel()
        recorder?.stop()
        if state == .recording { release() }
        settle()
    }

    private func allowed() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: true
        case .undetermined: await AVAudioApplication.requestRecordPermission()
        default: false
        }
    }

    /// The voice, every 60 ms, until the recording ends; five minutes of it end it.
    private func meter() async {
        while let recorder, state == .recording {
            recorder.updateMeters()
            let level = min(1, pow(10, Double(recorder.averagePower(forChannel: 0)) / 20) * 5)
            levels = Array((levels + [level]).suffix(Self.shown))
            if recorder.currentTime >= Self.longest { return finish() }
            do {
                try await Task.sleep(for: .milliseconds(60))
            } catch {
                // Cancelled: the recording has ended.
                return
            }
        }
    }

    /// Lets go of the recorder, the microphone and the recording's file.
    private func release() {
        recorder = nil
        metering = nil
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            logger.warning("could not let the microphone go: \(error.localizedDescription)")
        }
        if let file, FileManager.default.fileExists(atPath: file.path()) {
            do {
                try FileManager.default.removeItem(at: file)
            } catch {
                logger.warning("could not remove a recording: \(error.localizedDescription)")
            }
        }
        file = nil
    }

    private func settle() {
        sending = nil
        onText = nil
        since = nil
        state = .idle
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "voice")
