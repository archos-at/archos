import React from 'react'
import { BlocksDocument } from './blocks-to-pdf'
import type { DocumentChrome } from './branding'
import { documentSections, type PdfRequest } from './report-document'

interface ReportPDFProps {
  request: PdfRequest
  branding?: DocumentChrome
}

export const ReportPDF: React.FC<ReportPDFProps> = ({ request, branding }) => {
  const { sections } = documentSections(request)
  return (
    <BlocksDocument
      cover={{
        title: sections.title,
        facts: sections.facts,
        notice: sections.notice ?? undefined,
        chrome: branding,
      }}
      blocks={sections.body}
      keywords={request.aiProvenance}
      subject={sections.notice?.title}
    />
  )
}

interface MarkdownPDFProps {
  markdown: string
}

export const MarkdownPDF: React.FC<MarkdownPDFProps> = ({ markdown }) => (
  <ReportPDF request={{ markdown }} />
)
