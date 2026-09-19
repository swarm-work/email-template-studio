/**
 * The words for "somebody else saved this template while you were editing".
 *
 * Application layer: one pure function, no React, no DOM, no Zod. The banner
 * and the dialog are both dumb components that render what this returns, so
 * the wording is unit-tested in one place instead of being spread across two
 * components that can drift apart.
 */

/** Everything the banner and the dialog need to say, already worded. */
export interface VersionConflictCopy {
  /** The open-time banner: a draft that started from an older version. */
  readonly banner: string
  /** The dialog's title, shown when a save was refused. */
  readonly title: string
  /** The label of the "throw my edits away" action, naming the version it loads. */
  readonly discardLabel: string
}

/**
 * Describes the gap between the version a draft started from and the version
 * the template is on now, or `null` when there is no gap to describe.
 *
 * `null` covers two cases on purpose: a draft that started from the version
 * that is still current (nothing happened), and a draft with no recorded base
 * version at all — `0`, written by a build from before drafts tracked one.
 * Guessing at those would put a frightening banner on a perfectly ordinary
 * draft, so they say nothing instead (plan §3.3).
 */
export function describeVersionConflict(
  baseVersionNumber: number,
  currentVersionNumber: number,
): VersionConflictCopy | null {
  if (baseVersionNumber <= 0 || baseVersionNumber === currentVersionNumber) return null
  const base = `v${baseVersionNumber}`
  const current = `v${currentVersionNumber}`
  return {
    banner: `You have unsaved edits made against ${base}. This template is now ${current}.`,
    title: `This template was saved elsewhere as ${current}.`,
    discardLabel: `Discard mine and load ${current}`,
  }
}
