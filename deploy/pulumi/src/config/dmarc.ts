/**
 * The shape of a DMARC policy record (RFC 7489 §6.3), checked before it is
 * published. Cloudflare accepts any TXT content, and a receiver that cannot
 * parse the record treats the domain as having none: a typo here silently
 * switches the policy off. Pure, so `stack-files.spec.ts` can run it on the
 * committed stack files too.
 */

const POLICY = /^(?:none|quarantine|reject)$/;
const ALIGNMENT = /^[rs]$/;
const MAILTO = /^mailto:[^\s@,;!]+@[^\s@,;!]+(?:![0-9]+[kmgt]?)?$/i;

/** Each tag RFC 7489 §6.3 defines, with the check its value must pass. */
const TAGS: Record<string, (value: string) => boolean> = {
  v: (value) => value === "DMARC1",
  p: (value) => POLICY.test(value),
  sp: (value) => POLICY.test(value),
  adkim: (value) => ALIGNMENT.test(value),
  aspf: (value) => ALIGNMENT.test(value),
  pct: (value) => /^\d{1,3}$/.test(value) && Number(value) <= 100,
  rua: (value) => value.split(",").every((uri) => MAILTO.test(uri.trim())),
  ruf: (value) => value.split(",").every((uri) => MAILTO.test(uri.trim())),
  fo: (value) => /^[01ds](?::[01ds])*$/.test(value),
  rf: (value) => /^afrf(?::afrf)*$/i.test(value),
  ri: (value) => /^\d+$/.test(value),
};

/**
 * Why `record` is not a DMARC policy record, or undefined when it is one:
 * `v=DMARC1` first, a `p=` policy, every tag one RFC 7489 defines, none twice,
 * each value of its tag's form.
 */
export function dmarcRecordProblem(record: string): string | undefined {
  const tags = record
    .trim()
    .split(";")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  const seen = new Set<string>();
  for (const [index, tag] of tags.entries()) {
    const eq = tag.indexOf("=");
    const name = (eq < 0 ? tag : tag.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? "" : tag.slice(eq + 1).trim();
    if (index === 0 && (name !== "v" || value !== "DMARC1")) return 'it must start with "v=DMARC1;"';
    if (!(name in TAGS)) return `"${tag}" is not a DMARC tag (RFC 7489 §6.3 defines ${Object.keys(TAGS).join(", ")})`;
    if (seen.has(name)) return `the tag "${name}" appears twice`;
    if (!TAGS[name](value)) return `"${tag}" is not a valid value for "${name}"`;
    seen.add(name);
  }
  if (tags.length === 0) return 'it is empty; a record starts with "v=DMARC1;"';
  if (!seen.has("p")) return 'it has no "p=" policy (none, quarantine or reject), which a policy record requires';
  return undefined;
}
