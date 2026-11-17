const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

export function looksLikeArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ZIP_MAGIC.every((byte, index) => bytes[index] === byte)
}

export async function unwrapModelSource(bytes: Uint8Array): Promise<Uint8Array> {
  if (!looksLikeArchive(bytes)) return bytes
  try {
    const { unwrapIfcZip } = await import('@ifc-lite/parser')
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    return new Uint8Array(await unwrapIfcZip(buffer))
  } catch {
    return bytes
  }
}
