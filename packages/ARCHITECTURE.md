# Web architecture

## Packages

| Package        | Role                                                                                                                                                                            | Depends on                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `@isbell/core` | The relay protocol from a browser: frames, the space key and auth signature, the reconnecting client connection, the space store, herdr calls, and the project model. No React. | `@noble/*`, `@scure/base`      |
| `@isbell/desk` | The desktop workbench.                                                                                                                                                          | `@isbell/core`, React, Base UI |

`@isbell/core` and the Rust crates share no code; `crates/isbell-proto/tests/vectors.json` keeps
their encoding and signing identical, and both test suites read it.

## Inside an app (`desk/src`)

```text
src/
├── main.tsx, styles.css       the entry: hands locales/ to core/i18n
├── locales/                   every string the interface shows, per language: resources only
├── core/                      app context: the space connection, local prefs, the language
├── utils/                     pure helpers: hrefs, shortcuts, time
├── components/<name>/index.tsx  pure UI, one directory per component
├── features/<feature>/        one directory per feature: its pages and their logic
└── shell/                     the frame: routes, layout, sidebar, notifications
```

Allowed imports, from left to right only:

```text
shell ──▶ features ──▶ core ──▶ @isbell/core
  │           │
  └───────────┴──────▶ components, utils
```

- `core/` holds what depends on the running app: React context, the connection, stored state,
  the language. A helper that needs none of these belongs in `utils/`.
- `utils/` imports nothing from the app.
- `locales/` imports nothing from the app either. Only the entry, `main.tsx`, takes its strings
  and hands them to `I18nProvider`; `core/i18n` takes just its `Key` type, so that `t('…')` is
  checked. Adding or changing a string touches `locales/` alone.
- `components/` are pure UI. They take every text as a prop (the labels come from `uiLabels(t)`
  in `core/i18n`) and never read app state. Importing a type from `@isbell/core` is fine.
- A feature imports `core/`, `components/` and `utils/`, never `shell/` and never another
  feature. When one feature leads to another (New session to Add project), the shell passes a
  callback.
- Files are named for what they are: `*-page.tsx`, `*-dialog.tsx`, `*-panel.tsx`. Tests sit next
  to the code they test.

| New code                                               | Goes in                             |
| ------------------------------------------------------ | ----------------------------------- |
| A route's page, or a dialog or panel that does one job | `features/<feature>/`               |
| Something every page needs from the running app        | `core/`                             |
| A pure function or a hook with no app state            | `utils/`                            |
| A string the interface shows                           | `locales/en.ts` and `locales/zh.ts` |
| A presentational piece used by more than one feature   | `components/<name>/`                |
| Routing, layout, wiring features together              | `shell/`                            |
