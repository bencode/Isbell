// What a machine is and how loaded it is, read every 2 s while the sheet is open, and how this
// iPhone reaches it. As the PC sidebar's machine panel (web/src/features/machine/facts.ts).

import IsbellKit
import SwiftUI
import os

struct MachineInfoSheet: View {
    @Environment(SpaceStore.self) private var store
    let mid: String
    @State private var system: System?
    /// The time an `isbell.system` call takes there and back, but the first, which waits for a CPU sample.
    @State private var roundTrip: Duration?

    var body: some View {
        let entry = store.space.machines.first { $0.id == mid }
        NavigationStack {
            List {
                if let system, entry?.online == true { usage(system) }
                if let entry { about(entry) }
                connection(entry)
            }
            .navigationTitle(Text(verbatim: entry?.state.machine.name ?? ""))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .task(id: entry?.online) { await poll(online: entry?.online == true) }
    }

    private func usage(_ s: System) -> some View {
        Section("Usage") {
            LabeledContent { Text(percent(s.cpu.usage)) } label: { Text("CPU · \(s.cpu.cores ?? s.cpu.threads) cores") }
            LabeledContent {
                Text(percent(used: s.memory.used, of: s.memory.total))
            } label: {
                Text("Memory · \(bytes(s.memory.total, .memory))")
            }
            if let disk = s.disk {
                LabeledContent {
                    Text(percent(used: disk.total - disk.free, of: disk.total))
                } label: {
                    Text("Disk · \(bytes(disk.total, .file))")
                }
            }
            if let load = s.load {
                LabeledContent("Load 1/5/15") {
                    Text(verbatim: [load.one, load.five, load.fifteen].map { $0.formatted(.number.precision(.fractionLength(2))) }
                        .joined(separator: "  "))
                }
            }
        }
        .monospacedDigit()
    }

    private func about(_ entry: MachineEntry) -> some View {
        let machine = entry.state.machine
        return Section("This machine") {
            LabeledContent("Hostname") { Text(verbatim: machine.hostname) }
            if let brand = system?.cpu.brand, !brand.isEmpty {
                LabeledContent("Chip") { Text(verbatim: "\(brand) · \(system?.cpu.arch ?? "")") }
            }
            LabeledContent("System") { Text(verbatim: system?.os ?? machine.os) }
            if let uptime = system?.uptimeSecs {
                LabeledContent("Up for") { Text(verbatim: elapsed(0, now: Date(timeIntervalSince1970: Double(uptime)))) }
            }
            LabeledContent("isbell / herdr") { Text(verbatim: "\(machine.version) / \(entry.state.herdr.version ?? "—")") }
            LabeledContent("Agents") { Text(verbatim: entry.state.caps.agentKinds.joined(separator: " ")) }
        }
    }

    private func connection(_ entry: MachineEntry?) -> some View {
        Section("Connection") {
            LabeledContent("Route") { Text("Relay") }
            LabeledContent("Round trip") {
                Text(verbatim: roundTrip.map { "\(Int(($0 / .milliseconds(1)).rounded())) ms" } ?? "—")
            }
            LabeledContent("Machine") { entry?.online == true ? Text("Online") : Text("Offline") }
        }
    }

    private func poll(online: Bool) async {
        roundTrip = nil
        guard online else { return }
        var first = true
        repeat {
            let start = ContinuousClock.now
            do {
                system = try await readSystem(store.call, mid: mid)
                if !first { roundTrip = ContinuousClock.now - start }
                first = false
            } catch {
                // The last reading stays.
                logger.warning("could not read the system of \(mid): \(error.msg)")
            }
        } while await pause(.seconds(2))
    }
}

private func bytes(_ n: Int64, _ style: ByteCountFormatter.CountStyle) -> String {
    ByteCountFormatter.string(fromByteCount: n, countStyle: style)
}

private let logger = Logger(subsystem: "dev.fmap.isbell", category: "machine")
