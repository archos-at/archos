import type { ProductFeedbackTicketView } from '@/lib/product-feedback/types'

export function claimable(ticket: ProductFeedbackTicketView): boolean {
  return ticket.status !== 'resolved' && !ticket.assignee?.isViewer
}
