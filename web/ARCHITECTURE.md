# Web architecture

One Vite app. Its source is layered so that the protocol and the model it reads stay free of React
and of the app built on them.

## Layers (`src`)

```text
src/
├── main.tsx, styles.css       the entry: hands locales/ to core/i18n
├── locales/                   every string the interface shows, per language: resources only
├── model/                     the relay protocol from a browser, and what it is read into. No React
├── core/                      app context: the space connection, local prefs, the language
├── utils/                     pure helpers: hrefs, shortcuts, time
├── components/<name>/index.tsx  pure UI, one directory per component
├── features/<feature>/        one directory per feature: its pages and their logic
└── shell/                     the frame: routes, layout, sidebar, notifications
```

Allowed imports, from left to right only; a layer may import any layer to its right:

```text
shell ──▶ features ──▶ core ──▶ model
  │           │
  └───────────┴──────▶ components, utils
```

- `model/` holds frames, the space key and auth signature, the reconnecting client connection,
  the WebRTC direct link, the space store, herdr calls, the project model, and an agent's screen
  read as turns. It imports nothing from the app, nor React; `biome.json` enforces both. Code
  imports the module it needs (`model/herdr`), as there is no index of the whole layer.
- `model/` and the Rust crates share no code; `crates/isbell-proto/tests/vectors.json` keeps
  their encoding and signing identical, and both test suites read it.
- `core/` holds what depends on the running app: React context, the connection, stored state,
  the language. A helper that needs none of these belongs in `utils/`, or in `model/` when it is
  about the space and its machines.
- `utils/` imports nothing from the app.
- `locales/` imports nothing from the app either. Only the entry, `main.tsx`, takes its strings
  and hands them to `I18nProvider`; `core/i18n` takes just its `Key` type, so that `t('…')` is
  checked. Adding or changing a string touches `locales/` alone.
- `components/` are pure UI. They take every text as a prop (the labels come from `uiLabels(t)`
  in `core/i18n`) and never read app state. Importing a type from `model/` is fine.
- A feature imports `core/`, `model/`, `components/` and `utils/`, never `shell/` and never
  another feature. When one feature leads to another (New session to Add project), the shell
  passes a callback.
- Files are named for what they are: `*-page.tsx`, `*-dialog.tsx`, `*-panel.tsx`. Tests sit next
  to the code they test; recorded screens sit in `model/screen/fixtures/`.

| New code                                               | Goes in                             |
| ------------------------------------------------------ | ----------------------------------- |
| Protocol, or reading what the machines report          | `model/`                            |
| A route's page, or a dialog or panel that does one job | `features/<feature>/`               |
| Something every page needs from the running app        | `core/`                             |
| A pure function or a hook with no app state            | `utils/`                            |
| A string the interface shows                           | `locales/en.ts` and `locales/zh.ts` |
| A presentational piece used by more than one feature   | `components/<name>/`                |
| Routing, layout, wiring features together              | `shell/`                            |
