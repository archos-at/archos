import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProposalCardApp } from './ProposalCardApp'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ProposalCardApp />
    </StrictMode>
  )
}
