/** Whale-diving turn-status icon: the DeepSeek whale breaching with a spout. */
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: resolves the 'conversation.chat.turnStatusIcon' SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './WhaleDivingLogo.module.css'

export type WhaleDivingLogoProps = PropsRuntime<'conversation.chat.turnStatusIcon'>

/**
 * Render a looping breach, spout, dive, and settling surface. Purely
 * decorative: the parent status row carries the accessible label.
 * @param _props - framework session kit (unused; the animation is self-contained).
 */
export function WhaleDivingLogo(_props: WhaleDivingLogoProps) {
  return (
    <span className={css.root} aria-hidden="true">
      <svg className={css.fx} viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path className={css.surface} d="M3 16.3 Q11 17.1 19 16.3" />
        <path className={css.ripple} pathLength="1" d="M4 16.4 Q11 18.2 18 16.4" />
        <path className={css.spray} pathLength="1" d="M9.8 5.2 C9.7 4.1 9.8 3.2 10.2 2.6" />
        <path className={css.spray} pathLength="1" d="M10.2 2.6 C9.2 1.9 8.3 2 7.8 2.7" />
        <path className={css.spray} pathLength="1" d="M10.2 2.6 C11.2 1.9 12.2 2 12.8 2.8" />
        <path className={css.splash} pathLength="1" d="M10.7 16.2 C9.7 15 8.8 13.9 8.5 12.8" />
        <path className={css.splash} pathLength="1" d="M11.2 16.2 C12.3 15 13.2 14.2 13.8 13.2" />
      </svg>
      <span className={css.whale} data-whale-logo><FishLogo size={16} /></span>
    </span>
  )
}
