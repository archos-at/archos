import type { ErrorCode } from '../types'
import { PRODUCT_NAME } from '@/lib/brand'

export interface ErrorMeta {
  status: 'error' | 'warning' | 'info'
  title: string
  defaultMessage: string
  titleKey?: string
  retryable?: boolean
  messageKey?: string
}

export const ERROR_REGISTRY: Record<ErrorCode, ErrorMeta> = {
  'connection.lost': {
    status: 'error',
    title: 'Connection Lost',
    titleKey: 'errorRegistry.connectionLost.title',
    defaultMessage: 'Lost connection to the server. Please check your network.',
    messageKey: 'errorRegistry.connectionLost.message',
  },
  'connection.failed': {
    status: 'error',
    title: 'Connection Failed',
    titleKey: 'errorRegistry.connectionFailed.title',
    defaultMessage: 'Unable to connect to the server. Please check your network connection.',
    messageKey: 'errorRegistry.connectionFailed.message',
  },
  'connection.server_incompatible': {
    status: 'error',
    title: PRODUCT_NAME + ' is not reachable right now',
    titleKey: 'errorRegistry.serverIncompatible.title',
    defaultMessage:
      'The server runs a different version than this page, which happens briefly during an update. Try again in a few minutes; if it persists, tell support.',
    messageKey: 'errorRegistry.serverIncompatible.message',
  },
  'connection.timeout': {
    status: 'warning',
    title: 'Request Timeout',
    titleKey: 'errorRegistry.connectionTimeout.title',
    defaultMessage: 'The request took too long to complete.',
    messageKey: 'errorRegistry.connectionTimeout.message',
  },

  'connection.client_outdated': {
    status: 'warning',
    title: PRODUCT_NAME + ' was updated',
    titleKey: 'errorRegistry.clientOutdated.title',
    defaultMessage: PRODUCT_NAME + ' was updated. Reload the page to continue.',
    messageKey: 'errorRegistry.clientOutdated.message',
  },
  'auth.session_expired': {
    status: 'error',
    title: 'Session Expired',
    titleKey: 'errorRegistry.sessionExpired.title',
    defaultMessage: 'Your session has expired. Please sign in again.',
    messageKey: 'errorRegistry.sessionExpired.message',
  },
  'auth.unauthorized': {
    status: 'error',
    title: 'Unauthorized',
    titleKey: 'errorRegistry.unauthorized.title',
    defaultMessage: 'You do not have permission to perform this action.',
    messageKey: 'errorRegistry.unauthorized.message',
  },

  'agent.response_failed': {
    status: 'error',
    title: 'Response Failed',
    titleKey: 'errorRegistry.responseFailed.title',
    defaultMessage: 'The assistant encountered an error generating a response.',
    messageKey: 'errorRegistry.responseFailed.message',
  },
  'agent.response_interrupted': {
    status: 'warning',
    title: 'Response Interrupted',
    titleKey: 'errorRegistry.responseInterrupted.title',
    defaultMessage: PRODUCT_NAME + ' did not finish this answer, and the server has none. Please send the question again.',
    messageKey: 'errorRegistry.responseInterrupted.message',
  },
  'agent.no_response': {
    status: 'warning',
    title: 'No response',
    titleKey: 'errorRegistry.noResponse.title',
    defaultMessage: PRODUCT_NAME + ' did not respond to your question, not even to a second attempt. Send it again.',
    messageKey: 'errorRegistry.noResponse.message',
  },
  'agent.workflow_error': {
    status: 'error',
    title: 'Request Failed',
    titleKey: 'errorRegistry.workflowError.title',
    defaultMessage: 'The assistant hit an unexpected error while handling your request. Please try again.',
    messageKey: 'errorRegistry.workflowError.message',
  },
  'agent.zdr_refused': {
    status: 'error',
    title: 'Model not available under zero data retention',
    titleKey: 'errorRegistry.zdrRefused.title',
    defaultMessage:
      "Your organization's zero-data-retention setting only allows models with a zero-data-retention endpoint, and the model for this task has none. An organization admin must choose one under Organization → Models.",
    messageKey: 'errorRegistry.zdrRefused.message',
    retryable: false,
  },

  'research.queue_full': {
    status: 'warning',
    title: 'Recherche ausgelastet',
    titleKey: 'errorRegistry.researchQueueFull.title',
    defaultMessage:
      'Die Recherche-Warteschlange ist gerade voll. Bitte sende deine Anfrage in einem Moment erneut.',
    messageKey: 'errorRegistry.researchQueueFull.message',
  },

  'budget.exhausted': {
    status: 'error',
    title: 'Budget exhausted',
    titleKey: 'budgetExhausted.title',
    defaultMessage:
      'Your LLM budget is exhausted. You can review your usage under Organization → Usage & budgets.',
  },

  'system.unknown': {
    status: 'error',
    title: 'Something Went Wrong',
    titleKey: 'errorRegistry.unknown.title',
    defaultMessage: 'An unexpected error occurred. Please try again.',
    messageKey: 'errorRegistry.unknown.message',
  },
}

export const errorConcernsTheThread = (code: ErrorCode): boolean =>
  !code.startsWith('connection.') && !code.startsWith('auth.')

export const getErrorMeta = (code: ErrorCode): ErrorMeta => {
  return ERROR_REGISTRY[code] || ERROR_REGISTRY['system.unknown']
}
