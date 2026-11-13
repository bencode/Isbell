// Which worktree a project's files are browsed in, where there are too many for a menu: found by
// branch or directory. As web/src/shell/mobile/files/worktree-sheet.tsx.

import IsbellKit
import SwiftUI

struct WorktreeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let roots: [FilesRoot]
    let current: String?
    let choose: (FilesRoot) -> Void
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List(matchRoots(roots, query)) { r in
                Button {
                    choose(r)
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(marked(r.branch ?? String(localized: "detached"), query.trimmingCharacters(in: .whitespaces)))
                            Text(marked(r.display, query.trimmingCharacters(in: .whitespaces)))
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                        Spacer()
                        if r.own { Text("here").font(.caption2).foregroundStyle(.secondary) }
                        if r.key == current { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .listRowBackground(Palette.raised)
            }
            .paletteList()
            .overlay {
                if matchRoots(roots, query).isEmpty { ContentUnavailableView.search(text: query) }
            }
            .searchable(text: $query, prompt: Text("Find a worktree"))
            .navigationTitle("Switch worktree")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
