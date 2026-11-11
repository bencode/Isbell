// The images sent with a question: those in the record itself, and those uploaded to the machine,
// read from it. A thumbnail opens the image full width. As web/src/features/session/prompt-images.tsx.

import IsbellKit
import SwiftUI
import UIKit
import os

private let imageLimit = 5 << 20

struct PromptImages: View {
    let mid: String
    let paths: [String]
    /// data: URLs.
    let data: [String]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(paths, id: \.self) { PathImage(mid: mid, path: $0) }
            ForEach(Array(data.enumerated()), id: \.offset) { _, url in
                if let image = decoded(url) { Thumb(image: image) }
            }
        }
    }

    private func decoded(_ url: String) -> UIImage? {
        guard let comma = url.firstIndex(of: ","), url.hasPrefix("data:"),
              let bytes = Data(base64Encoded: String(url[url.index(after: comma)...])) else { return nil }
        return UIImage(data: bytes)
    }
}

/// An image on the machine; its name, when it cannot be read.
private struct PathImage: View {
    @Environment(SpaceStore.self) private var store
    let mid: String
    let path: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Thumb(image: image)
            } else if failed {
                Label((path as NSString).lastPathComponent, systemImage: "photo")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                RoundedRectangle(cornerRadius: 8).fill(Color(.tertiarySystemFill)).frame(width: 80, height: 80)
            }
        }
        .task(id: path) { await read() }
    }

    private func read() async {
        do throws(CallError) {
            let got = try await readFile(store.space.open, mid: mid, path: path, limit: imageLimit)
            image = got.bytes.flatMap(UIImage.init(data:))
            failed = image == nil
        } catch {
            logger.warning("could not read the image \(path): \(error.msg)")
            failed = true
        }
    }
}

private struct Thumb: View {
    let image: UIImage
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 80, height: 80)
                .clipShape(.rect(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator), lineWidth: 0.5) }
        }
        .buttonStyle(.plain)
        .fullScreenCover(isPresented: $open) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
                .onTapGesture { open = false }
        }
    }
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "images")
