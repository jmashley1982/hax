import { hex as hexDigits, int, pick, type Rng } from '@/core/rng'

/** Procedural hex/binary-flavored value generators (key material, blobs, ids). */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function hex(rng: Rng, len: number): string {
  return hexDigits(rng, len)
}

export function b64(rng: Rng, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += pick(rng, B64_CHARS.split(''))
  return out.padEnd(len - (len % 4 === 0 ? 0 : 4 - (len % 4)), '=')
}

export function uuid(rng: Rng): string {
  const seg = (n: number) => hexDigits(rng, n)
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${pick(rng, ['8', '9', 'a', 'b'])}${seg(3)}-${seg(12)}`
}

export function sha(rng: Rng, bytes: 1 | 256 = 256): string {
  return hexDigits(rng, bytes === 256 ? 64 : 40)
}

/** A byte-dump row: offset + 16 hex bytes + ascii gutter. */
export function hexRow(rng: Rng, offset: number): string {
  const bytes = Array.from({ length: 16 }, () => int(rng, 0, 255))
  const hexPart = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
  const ascii = bytes
    .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
    .join('')
  return `${offset.toString(16).padStart(8, '0')}  ${hexPart}  |${ascii}|`
}
