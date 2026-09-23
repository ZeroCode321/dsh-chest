/**
 * The sidebar chest section: one header with a refresh affordance, then the
 * `plugin` and `skill` groups over a single scroll region.
 *
 * Rows are deliberately quiet — icon, name, one meta line, and a state dot that
 * distinguishes "installed and running" from "installed, restart to apply". A
 * row opens a dialog that carries every action, because a sidebar column is too
 * narrow to hang five buttons off every line.
 *
 * The section owns no data: the listing arrives through the bound `useChest`
 * selector hook and every mutation is a callback that answers with a sentence to
 * show. Icons come from the icon atoms; no copy in this section carries emoji.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconChevronRightOutline14, IconChevronUpOutline14,
  IconCordisPluginOutline14, IconDownloadOutline16, IconFolderOpenOutline16, IconPauseOutline16,
  IconPlayOutline16, IconPlusOutline16, IconRefreshOutline14, IconSkillOutline16,
  IconTrashOutline16, Modal, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChestPluginEntry, ChestSkillDraft, ChestSkillEntry } from '@deepseek-ai/dsh-host-plugin-shelf/types'
import type { ChestActionOutcome, ChestKind, ChestSectionProps } from './contract.ts'
import css from './ChestSection.module.css'

/** How long an action notice stays before the section clears it. */
const NOTICE_RESET_MS = 4200

/** The blank skill draft behind the "new skill" dialog. */
function blankSkill(): ChestSkillDraft {
  return { name: '', description: '', whenToUse: '', body: '' }
}

/** The editable skill form state. */
interface SkillForm {
  readonly id: string | null
  readonly draft: ChestSkillDraft
  readonly userOnly: boolean
}

/** Render the chest section. */
export function ChestSection(props: ChestSectionProps) {
  const { wide, refresh, setExpanded, useChest, useChestExpanded, t } = props
  const view = useChest(state => state)
  const expanded = useChestExpanded(state => state)
  const snapshot = view.snapshot
  const [openPluginId, setOpenPluginId] = useState<string | null>(null)
  const [form, setForm] = useState<SkillForm | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
  }, [])

  if (!wide) return null

  const live = new Set(view.liveModules)
  const plugins = snapshot?.plugins ?? []
  const skills = snapshot?.skills ?? []
  const openPlugin = plugins.find(entry => entry.id === openPluginId) ?? null
  // One-slot moves are disabled at the edges: a move that cannot happen must not
  // report the same "saved" notice a real one does.
  const pluginIndex = plugins.findIndex(entry => entry.id === openPluginId)
  const skillIndex = skills.findIndex(entry => entry.id === form?.id)
  /** Total entries behind the fold, shown so a folded chest still says it holds something. */
  const held = snapshot === null ? null : plugins.length + skills.length

  const say = (text: string): void => {
    setNotice(text)
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => { setNotice(null) }, NOTICE_RESET_MS)
  }

  /** Run one action: busy gate, failure sentence, notice on success. */
  const run = async (action: () => Promise<ChestActionOutcome>, done: string): Promise<boolean> => {
    setBusy(true)
    setFailure(null)
    const outcome = await action()
    setBusy(false)
    if (!outcome.ok) {
      setFailure(`${t('failed')}${outcome.message}`)
      return false
    }
    say(done)
    return true
  }

  const pluginState = (entry: ChestPluginEntry): 'live' | 'restart' | 'idle' => {
    if (!entry.installed) return 'idle'
    return live.has(entry.packageName) ? 'live' : 'restart'
  }

  const pluginMeta = (entry: ChestPluginEntry): string => {
    const origin = entry.origin === 'store' ? t('originStore') : t('originExternal')
    const state = pluginState(entry)
    const status = state === 'live' ? t('liveNow') : state === 'restart' ? t('needsRestart') : t('notInstalled')
    return `${origin} · ${status}`
  }

  const skillMeta = (entry: ChestSkillEntry): string => {
    const prefix = entry.userOnly ? `${t('menuUserOnly')} · ` : ''
    const files = entry.files > 0 ? ` · ${entry.files} ${t('filesAttached')}` : ''
    return `${prefix}${entry.description}${files}`
  }

  return (
    <div className={css.root}>
      <div className={css.header}>
        <button
          type="button"
          className={css.headerToggle}
          aria-expanded={expanded}
          aria-label={expanded ? t('collapse') : t('expand')}
          title={expanded ? t('collapse') : t('expand')}
          onClick={() => { setExpanded(!expanded) }}
        >
          <span className={css.chevron} aria-hidden="true">
            {expanded ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
          </span>
          <span className={css.title}>{t('section')}</span>
          {held === null ? null : <span className={css.count}>{held}</span>}
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={refresh}
        >
          <IconRefreshOutline14 size={14} />
        </button>
      </div>

      {expanded
        ? (
          <>
            {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
            {snapshot?.restartRequired === true ? <p className={css.warning}>{t('restartNotice')}</p> : null}

            <div className={css.body}>
              {view.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
              {view.status === 'error' ? (
                <p className={css.status}>
                  <span>{t('error')}</span>
                  <button type="button" className={css.retry} onClick={refresh}>{t('retry')}</button>
                </p>
              ) : null}

              {snapshot !== null ? (
                <>
                  <div className={css.group}>
                    <span className={css.groupTitle}>{t('pluginGroup')}</span>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('addPlugin')}
                      title={t('addPlugin')}
                      onClick={() => { setAdding(true); setFailure(null) }}
                    >
                      <IconPlusOutline16 size={14} />
                    </button>
                  </div>
                  {plugins.length === 0 ? <p className={css.status}>{t('pluginEmpty')}</p> : null}
                  <ul className={css.list}>
                    {plugins.map(entry => (
                      <li className={css.row} key={`plugin-${entry.id}`}>
                        <button
                          type="button"
                          className={css.rowMain}
                          title={entry.packageName}
                          onClick={() => { setOpenPluginId(entry.id); setFailure(null) }}
                        >
                          <span className={css.rowIcon} aria-hidden="true"><IconCordisPluginOutline14 size={14} /></span>
                          <span className={css.texts}>
                            <span className={css.name}>{entry.packageName}</span>
                            <span className={css.meta}>{pluginMeta(entry)}</span>
                          </span>
                          {pluginState(entry) === 'live' ? <StateDot state="done" size={10} /> : null}
                          {pluginState(entry) === 'restart' ? <StateDot state="warning" size={10} /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className={css.group}>
                    <span className={css.groupTitle}>{t('skillGroup')}</span>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('addSkill')}
                      title={t('addSkill')}
                      onClick={() => { setForm({ id: null, draft: blankSkill(), userOnly: false }); setFailure(null) }}
                    >
                      <IconPlusOutline16 size={14} />
                    </button>
                  </div>
                  {skills.length === 0 ? <p className={css.status}>{t('skillEmpty')}</p> : null}
                  <ul className={css.list}>
                    {skills.map(entry => (
                      <li className={css.row} key={`skill-${entry.id}`}>
                        <button
                          type="button"
                          className={css.rowMain}
                          title={entry.path}
                          onClick={() => {
                            setForm({
                              id: entry.id,
                              draft: {
                                name: entry.name,
                                description: entry.description,
                                whenToUse: entry.whenToUse ?? '',
                                body: entry.body,
                              },
                              userOnly: entry.userOnly,
                            })
                            setFailure(null)
                          }}
                        >
                          <span className={css.rowIcon} aria-hidden="true"><IconSkillOutline16 size={14} /></span>
                          <span className={css.texts}>
                            <span className={css.name}>{entry.name}</span>
                            <span className={css.meta}>{skillMeta(entry)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </>
        )
        : (snapshot?.restartRequired === true ? <p className={css.warning}>{t('restartNotice')}</p> : null)}

      <Modal
        open={openPlugin !== null}
        onClose={() => { setOpenPluginId(null); setConfirming(null) }}
        title={openPlugin === null ? t('pluginTitle') : openPlugin.packageName}
        description={t('pluginAbout')}
        closeLabel={t('close')}
        footer={openPlugin === null ? undefined : (
          <div className={css.footer}>
            {failure !== null ? <p className={css.failure} role="alert">{failure}</p> : null}
            <div className={css.footerRow}>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconChevronUpOutline14 size={14} />}
                disabled={busy || pluginIndex <= 0}
                onClick={() => { void run(() => props.movePlugin(openPlugin.id, 'up'), t('saved')) }}
              >
                {t('moveUp')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconChevronDownOutline14 size={14} />}
                disabled={busy || pluginIndex === plugins.length - 1}
                onClick={() => { void run(() => props.movePlugin(openPlugin.id, 'down'), t('saved')) }}
              >
                {t('moveDown')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconDownloadOutline16 size={14} />}
                disabled={busy}
                onClick={() => { void run(() => props.exportPlugin(openPlugin.id), t('exported')) }}
              >
                {t('export')}
              </Button>
            </div>
            <div className={css.footerRow}>
              {openPlugin.installed ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<IconPauseOutline16 size={14} />}
                  disabled={busy}
                  onClick={() => { void run(() => props.uninstallPlugin(openPlugin.id), t('uninstalledNotice')) }}
                >
                  {t('uninstall')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<IconPlayOutline16 size={14} />}
                  disabled={busy || !openPlugin.hasPatch}
                  onClick={() => { void run(() => props.installPlugin(openPlugin.id), t('installedNotice')) }}
                >
                  {t('install')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={<IconTrashOutline16 size={14} />}
                disabled={busy}
                onClick={() => {
                  if (confirming !== openPlugin.id) {
                    setConfirming(openPlugin.id)
                    return
                  }
                  setConfirming(null)
                  void run(() => props.deletePlugin(openPlugin.id), t('removedNotice')).then((ok) => {
                    if (ok) setOpenPluginId(null)
                  })
                }}
              >
                {confirming === openPlugin.id ? t('confirmRemove') : t('remove')}
              </Button>
            </div>
          </div>
        )}
      >
        {openPlugin === null ? null : (
          <dl className={css.facts}>
            <div className={css.fact}>
              <dt>{t('skillName')}</dt>
              <dd>{openPlugin.packageName}{openPlugin.version.length > 0 ? ` · ${openPlugin.version}` : ''}</dd>
            </div>
            <div className={css.fact}>
              <dt>{t('pluginTitle')}</dt>
              <dd>
                {openPlugin.hasPatch ? t('hasPatch') : t('noPatch')}
                {' · '}
                {openPlugin.hasClient ? t('hasClient') : t('onlyHost')}
              </dd>
            </div>
            <div className={css.fact}>
              <dt>{t('folderLabel')}</dt>
              <dd className={css.path}>{openPlugin.path}</dd>
            </div>
            <div className={css.fact}>
              <dt>{t('installed')}</dt>
              <dd>
                {pluginState(openPlugin) === 'live'
                  ? t('liveNow')
                  : pluginState(openPlugin) === 'restart' ? t('needsRestart') : t('notInstalled')}
              </dd>
            </div>
            <p className={css.hint}>{t('bundleHint')}</p>
            <p className={css.hint}>
              {openPlugin.origin === 'store' ? t('deleteStoreHint') : t('deleteExternalHint')}
            </p>
          </dl>
        )}
      </Modal>

      <Modal
        open={adding}
        onClose={() => { setAdding(false); setFailure(null) }}
        title={t('addPlugin')}
        closeLabel={t('close')}
      >
        <AddPluginBody
          {...props}
          failure={failure}
          setFailure={setFailure}
          busy={busy}
          setBusy={setBusy}
          say={say}
          onDone={() => { setAdding(false) }}
        />
      </Modal>

      <Modal
        open={form !== null}
        onClose={() => { setForm(null); setFailure(null) }}
        title={form?.id === null ? t('newSkillTitle') : t('editSkillTitle')}
        closeLabel={t('close')}
        footer={form === null ? undefined : (
          <div className={css.footer}>
            {failure !== null ? <p className={css.failure} role="alert">{failure}</p> : null}
            <div className={css.footerRow}>
              {form.id !== null ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronUpOutline14 size={14} />}
                    disabled={busy || skillIndex <= 0}
                    onClick={() => { void run(() => props.moveSkill(form.id ?? '', 'up'), t('saved')) }}
                  >
                    {t('moveUp')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronDownOutline14 size={14} />}
                    disabled={busy || skillIndex === skills.length - 1}
                    onClick={() => { void run(() => props.moveSkill(form.id ?? '', 'down'), t('saved')) }}
                  >
                    {t('moveDown')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconDownloadOutline16 size={14} />}
                    disabled={busy}
                    onClick={() => { void run(() => props.exportSkill(form.id ?? ''), t('exported')) }}
                  >
                    {t('export')}
                  </Button>
                </>
              ) : null}
            </div>
            <div className={css.footerRow}>
              <Button variant="ghost" size="sm" onClick={() => { setForm(null); setFailure(null) }}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || form.draft.name.trim().length === 0 || form.draft.description.trim().length === 0}
                onClick={() => {
                  const draft: ChestSkillDraft = { ...form.draft, userOnly: form.userOnly }
                  const action = form.id === null
                    ? props.createSkill(draft)
                    : props.updateSkill(form.id, draft)
                  void run(() => action, t('saved')).then((ok) => { if (ok) setForm(null) })
                }}
              >
                {t('save')}
              </Button>
              {form.id !== null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconTrashOutline16 size={14} />}
                  disabled={busy}
                  onClick={() => {
                    if (confirming !== form.id) {
                      setConfirming(form.id)
                      return
                    }
                    setConfirming(null)
                    void run(() => props.deleteSkill(form.id ?? ''), t('removedNotice')).then((ok) => {
                      if (ok) setForm(null)
                    })
                  }}
                >
                  {confirming === form.id ? t('confirmRemove') : t('remove')}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      >
        {form === null ? null : (
          <div className={css.form}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('skillName')}</span>
              <input
                className={css.input}
                value={form.draft.name}
                placeholder={t('skillNamePlaceholder')}
                onChange={(event) => { setForm({ ...form, draft: { ...form.draft, name: event.currentTarget.value } }) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('skillDescription')}</span>
              <input
                className={css.input}
                value={form.draft.description}
                placeholder={t('skillDescriptionPlaceholder')}
                onChange={(event) => { setForm({ ...form, draft: { ...form.draft, description: event.currentTarget.value } }) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('skillWhenToUse')}</span>
              <input
                className={css.input}
                value={form.draft.whenToUse ?? ''}
                placeholder={t('skillWhenToUsePlaceholder')}
                onChange={(event) => { setForm({ ...form, draft: { ...form.draft, whenToUse: event.currentTarget.value } }) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('skillBody')}</span>
              <textarea
                className={css.textarea}
                rows={7}
                value={form.draft.body}
                placeholder={t('skillBodyPlaceholder')}
                onChange={(event) => { setForm({ ...form, draft: { ...form.draft, body: event.currentTarget.value } }) }}
              />
            </label>
            <label className={css.checkbox}>
              <input
                type="checkbox"
                checked={form.userOnly}
                onChange={(event) => { setForm({ ...form, userOnly: event.currentTarget.checked }) }}
              />
              <span>{t('skillUserOnly')}</span>
            </label>
            {form.id === null ? (
              <FilePicker
                kind="skill"
                label={t('importFile')}
                importBundle={props.importBundle}
                disabled={busy}
                onImported={() => { say(t('saved')); setForm(null) }}
                onFailed={(message) => { setFailure(`${t('failed')}${message}`) }}
              />
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  )
}

/** The add-plugin dialog body: a local folder, or a `.chest` document. */
function AddPluginBody({
  addPluginFromPath, importBundle, failure, setFailure, busy, setBusy, say, onDone, t,
}: ChestSectionProps & {
  failure: string | null
  setFailure: (value: string | null) => void
  busy: boolean
  setBusy: (value: boolean) => void
  say: (text: string) => void
  onDone: () => void
}) {
  const [path, setPath] = useState('')

  const add = async (): Promise<void> => {
    if (path.trim().length === 0) return
    setBusy(true)
    setFailure(null)
    const outcome = await addPluginFromPath(path.trim())
    setBusy(false)
    if (!outcome.ok) {
      setFailure(`${t('failed')}${outcome.message}`)
      return
    }
    say(t('saved'))
    setPath('')
    onDone()
  }

  return (
    <div className={css.form}>
      {failure !== null ? <p className={css.failure} role="alert">{failure}</p> : null}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('folderLabel')}</span>
        <input
          className={css.input}
          value={path}
          placeholder={t('folderPlaceholder')}
          onChange={(event) => { setPath(event.currentTarget.value) }}
        />
      </label>
      <div className={css.formActions}>
        <Button
          variant="primary"
          size="sm"
          icon={<IconFolderOpenOutline16 size={14} />}
          disabled={busy || path.trim().length === 0}
          onClick={() => { void add() }}
        >
          {t('addFromPath')}
        </Button>
        <FilePicker
          kind="plugin"
          label={t('importFile')}
          importBundle={importBundle}
          disabled={busy}
          onImported={() => { say(t('saved')); onDone() }}
          onFailed={(message) => { setFailure(`${t('failed')}${message}`) }}
        />
      </div>
      <p className={css.hint}>{t('bundleHint')}</p>
    </div>
  )
}

/** One hidden file input behind a button: the browser's half of importing a bundle. */
function FilePicker({ kind, label, importBundle, disabled, onImported, onFailed }: {
  kind: ChestKind
  label: string
  importBundle: (kind: ChestKind, file: File) => Promise<ChestActionOutcome>
  disabled: boolean
  onImported: () => void
  onFailed: (value: string) => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={<IconDownloadOutline16 size={14} />}
        disabled={disabled}
        onClick={() => { input.current?.click() }}
      >
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".chest,application/json"
        className={css.hiddenInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file === undefined) return
          void importBundle(kind, file).then((outcome) => {
            if (outcome.ok) onImported()
            else onFailed(outcome.message)
          })
        }}
      />
    </>
  )
}
