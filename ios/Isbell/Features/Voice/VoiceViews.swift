// What voice input shows where its words will land, in the reply bar and in the terminal's key bar.

import IsbellKit
import SwiftUI
import UIKit

/// A recording under way: a red dot, the voice as it is heard, and for how long. `ink` is the bars'
/// and the time's colour: the page's text, or the terminal's.
struct VoiceMeter: View {
    let voice: VoiceInput
    let ink: Color

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(.red).frame(width: 9, height: 9)
                .background(Circle().fill(.red.opacity(0.2)).padding(-4))
            HStack(spacing: 2.5) {
                Spacer(minLength: 0)
                ForEach(Array(voice.levels.enumerated()), id: \.offset) { _, level in
                    Capsule().fill(ink.opacity(0.85)).frame(width: 3, height: 3 + level * 23)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: 26)
            .clipped()
            TimelineView(.periodic(from: voice.since ?? .now, by: 1)) { context in
                let seconds = Int(context.date.timeIntervalSince(voice.since ?? context.date))
                Text(verbatim: "\(seconds / 60):\(String(format: "%02d", seconds % 60))")
                    .font(.system(size: 13.5, weight: .medium, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(ink.opacity(0.6))
            }
        }
    }
}

/// Why voice input came to nothing, in a line; with a way to iOS Settings when only they can allow
/// the microphone.
struct VoiceProblemLine: View {
    @Environment(\.openURL) private var openURL
    let problem: VoiceProblem

    var body: some View {
        HStack(spacing: 8) {
            text
            if problem == .denied {
                Button("Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .fontWeight(.semibold)
                .foregroundStyle(.tint)
            }
        }
        .font(.footnote)
        .foregroundStyle(.red)
    }

    private var text: Text {
        switch problem {
        case .denied: Text("The microphone is not allowed")
        case .failure(.limited): Text("Too many recordings; wait a minute")
        case .failure(.usedUp): Text("Today's voice input is used up; it is back tomorrow")
        case .failure(.empty): Text("Nothing was heard")
        case .failure(.failed(let msg)): Text(verbatim: msg)
        }
    }
}
