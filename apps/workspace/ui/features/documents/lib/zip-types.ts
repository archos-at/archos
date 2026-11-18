export const ZIP_EXTENSION = '.zip'

export const ZIP_MIME_TYPES: readonly string[] = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]

export const isZipArchive = (file: { name: string }): boolean => /\.zip$/i.test(file.name)

export const withZipAccepted = (accept: string): string =>
  accept
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .includes(ZIP_EXTENSION)
    ? accept
    : `${accept},${ZIP_EXTENSION}`
