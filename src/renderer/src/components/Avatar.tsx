// Your avatar: your profile picture if you set one, else your initial on a color picked from your name.
import { isAvatarImage } from '../../../shared/avatar'

const AVATAR_COLORS = [
  ['#d97757', '#b35a3c'],
  ['#5b8def', '#3f6fd1'],
  ['#7b5fc4', '#5e44a3'],
  ['#2f9e7a', '#227a5e'],
  ['#c9772b', '#a35c1c'],
  ['#c2456a', '#9e3253']
]
/** the same color every time for the same name */
export function avatarStyle(name: string): { background: string } {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [a, b] = AVATAR_COLORS[h % AVATAR_COLORS.length]
  return { background: `linear-gradient(135deg, ${a}, ${b})` }
}

export function Avatar({ name, image, size, className }: { name: string; image?: string; size?: number; className?: string }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.45) } : {}
  const cls = 'avatar' + (className ? ' ' + className : '')
  if (image && isAvatarImage(image)) return <img className={cls + ' avatar-img'} src={image} alt="" style={style} draggable={false} />
  return (
    <span className={cls} style={{ ...avatarStyle(name), ...style }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The square side, in pixels, a picked picture is cropped and scaled to. */
const SIDE = 160

/**
 * Ask for a picture file and turn it into a small square image (center-cropped), as a data: URL that's
 * saved with your settings. Resolves to null if you cancel; rejects if the file isn't an image we can read.
 */
export function pickAvatar(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      avatarFromFile(file).then(resolve, reject)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function avatarFromFile(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => {
      throw new Error('That file isn’t a picture LocalClaude can read. Try a PNG, JPEG or WebP.')
    })
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    if (!s) throw new Error('That picture is empty.')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIDE
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, SIDE, SIDE)
    // WebP keeps transparency and stays small (a few KB)
    return canvas.toDataURL('image/webp', 0.9)
  } finally {
    URL.revokeObjectURL(url)
  }
}
