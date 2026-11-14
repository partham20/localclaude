/** A profile picture is stored with your settings as a small data: URL. Anything else is ignored. */
export const AVATAR_MAX_LENGTH = 400_000

export function isAvatarImage(v: unknown): v is string {
  return typeof v === 'string' && v.length <= AVATAR_MAX_LENGTH && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(v)
}
