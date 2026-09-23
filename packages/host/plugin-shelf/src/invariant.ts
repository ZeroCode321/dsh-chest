/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-plugin-shelf/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-shelf'

/** Cordis companion plugin name. */
export const name = 'host-plugin-shelf-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every listing is scanned directly from the plugin store,
 * the registered external folders, the skill root, and the booted profile, and
 * one serialized queue owns every mutation.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
