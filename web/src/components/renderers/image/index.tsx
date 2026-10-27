// One image, fitted to the space or at a zoom of its own size, over a checkerboard so that what
// is transparent shows as such. An SVG shown this way runs none of its scripts.

import { useState } from 'react'
import styles from './image.module.scss'

/** Fitted, it fills the space and is never enlarged; otherwise it is `zoom` × its own width. */
export type ImageScale = { fit: true } | { fit: false; zoom: number }

type Props = { src: string; alt: string; scale: ImageScale; failed: string }

export function ImageRenderer(props: Props) {
  return (
    <div className={styles.renderer} data-fit={props.scale.fit}>
      {/* A new image starts over, so a past error clears. */}
      <Picture key={props.src} {...props} />
    </div>
  )
}

function Picture({ src, alt, scale, failed }: Props) {
  const [width, setWidth] = useState(0)
  const [broken, setBroken] = useState(false)
  if (broken) return <p className="m-auto text-danger">{failed}</p>
  return (
    <img
      src={src}
      alt={alt}
      className={styles.image}
      style={scale.fit || !width ? undefined : { width: width * scale.zoom, maxWidth: 'none' }}
      onLoad={e => setWidth(e.currentTarget.naturalWidth)}
      onError={() => setBroken(true)}
    />
  )
}
