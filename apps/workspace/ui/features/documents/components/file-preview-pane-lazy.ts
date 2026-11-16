import dynamic from 'next/dynamic'

export const IfcFilePreview = dynamic(
  () =>
    import('@/features/bim/components/ifc-file-preview').then((module) => module.IfcFilePreview),
  { ssr: false }
)

export const IfcFileFacts = dynamic(
  () => import('@/features/bim/components/ifc-file-facts').then((module) => module.IfcFileFacts),
  { ssr: false }
)
