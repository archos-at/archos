/**
 * What a chat says about itself (ADR-0180): the temporary switch and the line
 * that says who reads the chat and what is kept from it. A top-level module of
 * the feature, like `store` and `types`, so the composer and the layout take
 * these two without the feature's index, which carries the socket hook.
 */

export {
  ConversationPrivacyLine,
  ConversationPrivacyLineView,
  type ConversationPrivacyLineProps,
  type ConversationPrivacyLineViewProps,
} from './components/conversation-privacy/ConversationPrivacyLine'
export {
  TemporaryChatToggle,
  TemporaryChatToggleView,
  type TemporaryChatToggleProps,
  type TemporaryChatToggleViewProps,
} from './components/conversation-privacy/TemporaryChatToggle'
