// The files sent along with a prompt: the composer adds each one's path on the agent's machine as a
// line of its own (composer.tsx).

import { imageType } from './content'

// Where the gateway puts each upload: `<uploads>/<8 hex digits>/<name>` (gateway/file/write.rs), the
// uploads directory being `isbell-uploads` in the system's temporary one unless set elsewhere.
const UPLOADED = /^\/.*\/isbell-uploads\/[0-9a-f]{8}\/[^/]+$/

/** A prompt's own words, and the images sent along with it: the lines naming one uploaded for the
 * agent. Other uploads stay in the words, as do paths to an uploads directory set elsewhere. */
export function splitUploads(prompt: string): { text: string; images: string[] } {
  const lines = prompt.split('\n')
  const image = (line: string) => UPLOADED.test(line.trim()) && !!imageType(line.trim())
  return {
    text: lines
      .filter(line => !image(line))
      .join('\n')
      .trim(),
    images: lines.filter(image).map(line => line.trim()),
  }
}
