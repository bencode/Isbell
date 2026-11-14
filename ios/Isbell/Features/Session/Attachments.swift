// Files for an agent: each goes to its machine as soon as it is picked, and the reply names where it
// landed there. As useAttachments and Attachments in web/src/features/session/attachments.tsx.

import IsbellKit
import SwiftUI
import UIKit

@MainActor
@Observable
final class Attachments {
    struct Item: Identifiable {
        let id: Int
        let name: String
        let size: Int
        var sent = 0
        /// Where it landed on the machine, once it did.
        var path: String?
        var error: String?
        /// A thumbnail, for an image.
        let preview: UIImage?
    }

    private(set) var items: [Item] = []
    @ObservationIgnored private let mid: String
    @ObservationIgnored private var lastId = 0

    init(mid: String) {
        self.mid = mid
    }

    /// Where those landed on the machine, in the order added.
    var paths: [String] { items.compactMap(\.path) }
    /// Some are still on their way.
    var uploading: Bool { items.contains { $0.path == nil && $0.error == nil } }

    /// Sends the file at once; one over uploadMax is listed with its error and not sent.
    func add(_ space: Space, name: String, data: Data, preview: UIImage?) {
        let id = nextId()
        let tooLarge = data.count > uploadMax ? String(localized: "Over 20 MB") : nil
        items.append(Item(id: id, name: name, size: data.count, error: tooLarge, preview: preview))
        guard tooLarge == nil else { return }
        Task {
            do throws(CallError) {
                let path = try await upload(space.open, mid: mid, name: name, bytes: data) { sent in
                    self.patch(id) { $0.sent = sent }
                }
                patch(id) { $0.path = path }
            } catch {
                patch(id) { $0.error = error.msg }
            }
        }
    }

    /// A file that could not be read or made into one to send, listed with why.
    func failed(name: String, _ error: String) {
        items.append(Item(id: nextId(), name: name, size: 0, error: error, preview: nil))
    }

    /// Takes it off the list; one on its way still lands, for the machine's temporary directory to clear.
    func remove(_ id: Int) {
        items.removeAll { $0.id == id }
    }

    func clear() {
        items = []
    }

    private func nextId() -> Int {
        lastId += 1
        return lastId
    }

    private func patch(_ id: Int, _ change: (inout Item) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[i])
    }
}

/// The files added, above the reply: a thumbnail or the file's name, its progress, a button to
/// remove it, and under them what went wrong.
struct AttachmentChips: View {
    let attachments: Attachments

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(attachments.items) { item in
                        Chip(item: item) { attachments.remove(item.id) }
                    }
                }
                .padding(.top, 8)
                .padding(.trailing, 8)
            }
            .scrollIndicators(.hidden)
            ForEach(attachments.items.filter { $0.error != nil }) { item in
                Text(verbatim: "\(item.name): \(item.error ?? "")").font(.footnote).foregroundStyle(.red).lineLimit(2)
            }
        }
    }
}

private struct Chip: View {
    let item: Attachments.Item
    let remove: () -> Void

    var body: some View {
        ZStack {
            if let preview = item.preview {
                Image(uiImage: preview).resizable().scaledToFill()
            } else {
                VStack(spacing: 3) {
                    Image(systemName: "doc").font(.title3)
                    Text(verbatim: item.name).font(.system(size: 9)).lineLimit(2).multilineTextAlignment(.center)
                }
                .foregroundStyle(.secondary)
                .padding(4)
            }
            if item.path == nil && item.error == nil {
                Color.black.opacity(0.35)
                Text(verbatim: "\(item.sent * 100 / max(item.size, 1))%")
                    .font(.caption2.monospaced().weight(.semibold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 58, height: 58)
        .background(Palette.raised)
        .clipShape(.rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(item.error == nil ? Palette.line : Palette.danger, lineWidth: item.error == nil ? 0.5 : 1.5)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: remove) {
                Label("Remove", systemImage: "xmark.circle.fill")
                    .labelStyle(.iconOnly)
                    .font(.body)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .buttonStyle(.plain)
            .offset(x: 7, y: -7)
        }
    }
}
