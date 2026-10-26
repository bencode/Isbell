// Grammars for code in documents: lowlight's common set, and the languages agents also write. A
// fence is highlighted only when it names one of these; others stay plain.

import clojure from 'highlight.js/lib/languages/clojure'
import dart from 'highlight.js/lib/languages/dart'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import fsharp from 'highlight.js/lib/languages/fsharp'
import haskell from 'highlight.js/lib/languages/haskell'
import julia from 'highlight.js/lib/languages/julia'
import lisp from 'highlight.js/lib/languages/lisp'
import matlab from 'highlight.js/lib/languages/matlab'
import nix from 'highlight.js/lib/languages/nix'
import ocaml from 'highlight.js/lib/languages/ocaml'
import powershell from 'highlight.js/lib/languages/powershell'
import scala from 'highlight.js/lib/languages/scala'
import scheme from 'highlight.js/lib/languages/scheme'
import { common } from 'lowlight'

export const languages = {
  ...common,
  clojure,
  dart,
  dockerfile,
  elixir,
  erlang,
  fsharp,
  haskell,
  julia,
  lisp,
  matlab,
  nix,
  ocaml,
  powershell,
  scala,
  scheme,
}

/** Fences that are text, not code: kept plain rather than guessed at. */
export const PLAIN = ['mermaid', 'text', 'txt', 'plaintext']
