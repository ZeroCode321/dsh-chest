/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-plugin-shelf`.
 * @module @deepseek-ai/dsh-client-ui-plugin-shelf/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-plugin-shelf'

/** Cordis companion plugin name. */
export const name = 'client-ui-plugin-shelf-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: one '@' source registration plus one sidebar slot
 * registration, both effect-disposed; the source owns no cross-plugin mutable
 * state beyond a snapshot refreshed from the Host Remotes.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
