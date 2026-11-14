/**
 * A stable id for a block's internal links (a marker to its entry, a figure to its note), from
 * the block's own content: the same post renders the same ids, and two blocks on one page
 * differ unless they are the same block twice.
 */
export function blockId(prefix: string, content: unknown): string {
  const text = JSON.stringify(content);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
