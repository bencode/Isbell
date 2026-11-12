// The ＋ by the reply: photos, the camera, files, each sent to the machine as soon as it is picked.
// A photo goes as a JPEG no larger than 2048 px across: the library's are often HEIC, which agents
// do not read, and an agent scales larger ones down anyway. A file goes as it is.

import IsbellKit
import PhotosUI
import SwiftUI
import UIKit
import os

struct AttachMenu: View {
    @Environment(SpaceStore.self) private var store
    let attachments: Attachments
    @State private var choosingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var shooting = false
    @State private var importing = false

    var body: some View {
        Menu {
            Button("Photos", systemImage: "photo.on.rectangle") { choosingPhotos = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Camera", systemImage: "camera") { shooting = true }
            }
            Button("Files", systemImage: "folder") { importing = true }
        } label: {
            Label("Attach", systemImage: "plus")
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
        }
        .menuStyle(.button)
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .photosPicker(isPresented: $choosingPhotos, selection: $photos, matching: .images)
        .onChange(of: photos) { _, picked in
            guard !picked.isEmpty else { return }
            photos = []
            Task { await take(picked) }
        }
        .fullScreenCover(isPresented: $shooting) {
            CameraPicker { image in
                shooting = false
                if let image { add(photo: image, name: photoName(1)) }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            do {
                try result.get().forEach(add(file:))
            } catch {
                logger.error("could not pick files: \(error)")
                attachments.failed(name: String(localized: "Files"), error.localizedDescription)
            }
        }
    }

    private func take(_ picked: [PhotosPickerItem]) async {
        for (i, item) in picked.enumerated() {
            let name = photoName(i + 1)
            do {
                guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    attachments.failed(name: name, String(localized: "The photo can't be read"))
                    continue
                }
                add(photo: image, name: name)
            } catch {
                logger.error("could not load a photo: \(error)")
                attachments.failed(name: name, error.localizedDescription)
            }
        }
    }

    private func add(photo: UIImage, name: String) {
        guard let data = scaled(photo).jpegData(compressionQuality: 0.85) else {
            return attachments.failed(name: name, String(localized: "The photo can't be read"))
        }
        attachments.add(store.space, name: name, data: data, preview: thumbnail(photo))
    }

    private func add(file url: URL) {
        let name = url.lastPathComponent
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            if let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > uploadMax {
                return attachments.failed(name: name, String(localized: "Over 20 MB"))
            }
            let data = try Data(contentsOf: url)
            attachments.add(store.space, name: name, data: data, preview: UIImage(data: data).flatMap(thumbnail))
        } catch {
            logger.error("could not read \(name): \(error)")
            attachments.failed(name: name, error.localizedDescription)
        }
    }
}

/// `photo-<time>-<n>.jpg`: each upload lands in its own directory, so the name only has to tell the
/// agent what it is.
private func photoName(_ n: Int) -> String {
    let clock = DateFormatter()
    clock.locale = Locale(identifier: "en_US_POSIX")
    clock.dateFormat = "HHmmss"
    return "photo-\(clock.string(from: .now))-\(n).jpg"
}

/// At most 2048 px across, upright.
private func scaled(_ image: UIImage) -> UIImage {
    let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let ratio = min(1, 2048 / max(size.width, size.height))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let target = CGSize(width: (size.width * ratio).rounded(), height: (size.height * ratio).rounded())
    return UIGraphicsImageRenderer(size: target, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: target))
    }
}

/// Small enough to fill a chip.
private func thumbnail(_ image: UIImage) -> UIImage? {
    let ratio = 116 / max(1, min(image.size.width, image.size.height))
    return image.preparingThumbnail(of: CGSize(width: image.size.width * ratio, height: image.size.height * ratio))
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "attach")
