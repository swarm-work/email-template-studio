/**
 * Adapter: the merge-field keys found in a visual template become the domain's
 * `PropsValidator`. Infrastructure layer, because only infrastructure knows Zod.
 *
 * A visual template has no hand-written schema and no TSX to read props from:
 * its contract is simply "every `{{key}}` on the canvas needs a value". That
 * contract changes as somebody types, so it is built from the LIVE document
 * (see StudioPage) rather than from the schema stored with the saved version.
 */
import { z } from 'zod'
import type { PropsValidator } from '@/domain'
import { zodPropsValidator } from './zodPropsValidator'

/**
 * Requires a value for each key. Non-strict on purpose (`z.object`, not
 * `z.strictObject`): extra keys in the sample payload are perfectly reasonable
 * — a key someone is about to use, or one left over from an edit — and are not
 * worth blocking a preview for.
 *
 * A leaf is a string, a number or a boolean, because that is exactly what
 * `applyMergeFields` can substitute (`String(3)` is `"3"`). The plan said
 * "required string"; a validator that called `{"orderCount": 3}` invalid while
 * the substitution happily rendered `3` would just be two halves of one
 * feature disagreeing about what a value is (ADR-26).
 *
 * Dotted keys (`user.name`) become nested objects, which is the shape
 * `applyMergeFields` reads them back out of.
 */
export function mergeFieldPropsValidator(keys: readonly string[]): PropsValidator {
  return zodPropsValidator(objectFor(keys))
}

/** What one merge field may hold: everything `applyMergeFields` can print. */
const LEAF_VALUE = z.union([z.string(), z.number(), z.boolean()])

/** Builds the nested `z.object` for a set of possibly dotted keys. */
function objectFor(keys: readonly string[]): z.ZodType {
  const branches = new Map<string, string[]>()
  const leaves = new Set<string>()

  for (const key of keys) {
    const [head, ...rest] = key.split('.')
    if (rest.length === 0) leaves.add(head)
    else branches.set(head, [...(branches.get(head) ?? []), rest.join('.')])
  }

  const shape: Record<string, z.ZodType> = {}
  // A key that is both a leaf and a branch (`user` and `user.name`) can only be
  // satisfied as the object, so the branch wins — the same rule as
  // `mergeFieldsJsonSchema`, kept in step on purpose.
  for (const name of leaves) if (!branches.has(name)) shape[name] = LEAF_VALUE
  for (const [name, rest] of branches) shape[name] = objectFor(rest)

  return z.object(shape)
}
