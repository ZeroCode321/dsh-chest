/**
 * Whale-diving surface plugin, browser half: the DeepSeek whale mark animated
 * as a breaching dive with a water spout, registered beside the chat flow's
 * running turn status ("Deep diving..."). Purely decorative — zero business
 * face, zero copy, zero store. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ui-conversation's SlotMap merge (the
// 'conversation.chat.turnStatusIcon' entry) so the registration type-checks.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WhaleDivingLogo } from './WhaleDivingLogo.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots']

/**
 * Client plugin body: register the looping whale animation into the turn-status
 * icon seat declared by ui-conversation. The seat renders nothing when no
 * occupant registers, so this plugin is additive and self-contained.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.turnStatusIcon', () => ctx.slots.register(
    { name: 'conversation.chat.turnStatusIcon' },
    WhaleDivingLogo,
  ))
}
