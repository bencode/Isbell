# Isbell for iOS

A native iPhone client for an Isbell space. It talks to the same relay as the web client and
reads the same protocol, checked against `crates/isbell-proto/tests/vectors.json`.

Work in progress: it joins a space and lists its machines.

## Layout

```text
ios/
├── Isbell.xcodeproj    the app target; Isbell/ is a synchronized folder
├── Isbell/             the app (SwiftUI, main-actor by default)
│   ├── Core/           the space key, the connection, what views observe
│   ├── Shell/          the root and the screens around the features
│   └── Features/       one folder per feature
└── IsbellKit/          the protocol: frames, identity, machine state, the relay connection
```

IsbellKit is a Swift package with no UI and no third-party dependencies, so it builds and tests
on the Mac alone.

## Requirements

Xcode 27 or later, with an iOS 26 or later simulator.

## Test the protocol

```sh
cd ios/IsbellKit
swift test
```

## Run the app

Open `ios/Isbell.xcodeproj` in Xcode and run the `Isbell` scheme on a simulator, or build from the
command line:

```sh
xcodebuild -project ios/Isbell.xcodeproj -scheme Isbell \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

On first launch, paste the key that `isbell space show` prints on any of your machines, or a link
carrying it as `#k=…`. The key is kept in the iPhone's Keychain, on this device only.

To run on a device, pick your own team under Signing & Capabilities; leave that change out of
commits.
