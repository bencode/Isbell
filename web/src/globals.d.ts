/** The version of isbell this app was built with (vite.config.ts). */
declare const __ISBELL_VERSION__: string

interface ImportMetaEnv {
  /** The speech service voice input goes to (`POST {url}/v1/transcribe`); without it, there is none. */
  readonly VITE_VOICE_URL?: string
}
