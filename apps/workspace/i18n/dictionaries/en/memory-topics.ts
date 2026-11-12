/**
 * memoryTopics namespace: a topic groups the notes of one shelf (ADR-0180, the amendment on topics).
 * Shared by the personal shelf and the project shelf; the office shelf reads the same words.
 */
export const memoryTopics = {
  // The group of notes that have no topic. Shown last, under its own heading.
  noTopic: 'No topic',
  // The number of notes a topic holds, as a heading's meta line.
  topicCount: '{count, plural, one {# note} other {# notes}}',
  // The menu of a note: where to move it.
  moveTo: 'Move to …',
  // The option that opens a new topic in the topic picker.
  newTopic: 'New topic',
  // The action on a topic's heading that renames it, or merges it into another.
  rename: 'Rename topic',
  renamePlaceholder: 'Topic name',
  // Shown under the rename field: a name another topic already has merges the two.
  mergeHint: 'If that topic exists, the two are merged.',
  // The action on a topic that removes the topic and every note on it (personal shelf only).
  removeTopic: 'Remove topic and all its notes',
  // Asked before the removal, with the count of notes it takes away.
  removeTopicConfirm: '{count, plural, one {# note in "{name}" is} other {# notes in "{name}" are}} removed for good.',
  // The action that takes a topic apart: its notes stay, without a topic.
  ungroup: 'Ungroup',
  // The first choice of the topic filter: every topic at once.
  allTopics: 'All topics',
  // Shown under the topic field when the name is longer than the bound.
  topicTooLong: 'At most 40 characters.',
  // The label of the topic filter and of the topic field.
  filterLabel: 'Topic',
}
