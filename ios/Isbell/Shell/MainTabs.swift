// The two tabs once joined: what is going on now, and the projects of each machine.

import SwiftUI

struct MainTabs: View {
    @Environment(SpaceStore.self) private var store

    var body: some View {
        TabView {
            Tab("Active", systemImage: "bolt.fill") { ActiveView() }
                .badge(store.lanes.asking.count)
            Tab("Projects", systemImage: "folder") { ProjectsView() }
        }
    }
}
