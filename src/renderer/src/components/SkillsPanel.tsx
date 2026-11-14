// Settings → Skills: the skills Claude Code loads (yours, the default folder's, and plugins'), switched on and
// off for LocalClaude chats, written and edited here, or added from a folder or a .zip / .skill file.
import { useEffect, useMemo, useState } from 'react'
import { skillNameError, type SkillDraft, type SkillInfo } from '../../../shared/extensions'
import type { AppSettings } from '../../../shared/types'
import { api } from '../api'

const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

function SkillForm({ draft, onDone, onCancel }: { draft: SkillDraft; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState(draft)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <div className="mcp-form skill-form">
      <div className="field">
        <label>Name</label>
        <input
          className="input mono"
          name="skillName"
          placeholder="release-notes"
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
        />
      </div>
      <div className="field">
        <label>
          What it’s for <span className="muted small">Claude reads this to decide when to use the skill</span>
        </label>
        <textarea
          className="input"
          name="skillDescription"
          rows={2}
          placeholder="Write release notes from the git log. Use when the user asks for release notes or a changelog."
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
        />
      </div>
      <div className="field">
        <label>
          Instructions <span className="muted small">Markdown: what Claude should do when it uses the skill</span>
        </label>
        <textarea className="input code" name="skillBody" rows={10} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} spellCheck={false} />
      </div>
      {error && <div className="danger-text small">{error}</div>}
      <div className="row gap end">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          name="saveSkill"
          disabled={saving}
          onClick={async () => {
            const bad = skillNameError(d.name.trim())
            if (bad) return setError(bad)
            setSaving(true)
            const r = await api.saveSkill(d)
            setSaving(false)
            if (r.ok) onDone()
            else setError(r.error)
          }}
        >
          {draft.dir ? 'Save' : 'Create skill'}
        </button>
      </div>
    </div>
  )
}

export function SkillsPanel({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => Promise<void> }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [filter, setFilter] = useState('')
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const reload = (): Promise<void> => api.listSkills().then(setSkills)
  useEffect(() => void reload(), [settings.defaultCwd])

  const off = new Set(settings.disabledSkills ?? [])
  const toggle = (s: SkillInfo): void => {
    const next = new Set(off)
    if (next.has(s.id)) next.delete(s.id)
    else next.add(s.id)
    void onChange({ disabledSkills: [...next].sort() }).then(reload)
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (skills ?? []).filter((s) => !q || `${s.id} ${s.description} ${s.plugin ?? ''}`.toLowerCase().includes(q))
  }, [skills, filter])

  const add = async (replace?: string): Promise<void> => {
    setNote(null)
    const r = await api.importSkill(replace ?? null, !!replace)
    if (!r) return
    if (r.ok) {
      setNote({ text: `Added “${r.name}”. New chats can use it.` })
      return reload()
    }
    if (r.exists && confirm(`${r.error} Replace it with the one you picked?`)) return add(r.from)
    setNote({ text: r.error, error: true })
  }

  const groups: [string, SkillInfo[]][] = [
    ['Your skills', shown.filter((s) => s.source === 'user')],
    [settings.defaultCwd ? `In ${folderName(settings.defaultCwd)} (your default folder)` : 'In your default folder', shown.filter((s) => s.source === 'project')],
    ['From plugins', shown.filter((s) => s.source === 'plugin')]
  ]

  return (
    <div className="skills-panel">
      <h2>Skills</h2>
      <p className="muted small">
        A skill is a folder of instructions (a <code>SKILL.md</code>, sometimes with scripts) that Claude reads when a task calls for it. Yours live in{' '}
        <code>~/.claude/skills</code>. Switch one off here and LocalClaude chats won’t use it; Claude Code in a terminal still will.
      </p>
      {!settings.loadUserSettings && (
        <div className="notice small">
          Chats only load your skills and plugins while <b>Load my Claude Code user settings</b> is on, in Tools &amp; computer.
        </div>
      )}
      <div className="row gap skills-actions">
        <button className="btn" name="newSkill" onClick={() => setDraft({ name: '', description: '', body: '' })}>
          ＋ New skill
        </button>
        <button className="btn ghost" name="importSkill" onClick={() => void add()}>
          Add from a folder or .zip…
        </button>
        <button className="btn ghost" onClick={() => void api.revealSkills()}>
          Open skills folder
        </button>
        <span className="grow" />
        {(skills?.length ?? 0) > 8 && <input className="input skills-filter" placeholder="Filter skills" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      </div>
      {note && <div className={'small ' + (note.error ? 'danger-text' : 'ok-text')}>{note.text}</div>}
      {draft && (
        <SkillForm
          key={draft.dir ?? 'new'}
          draft={draft}
          onCancel={() => setDraft(null)}
          onDone={() => {
            setDraft(null)
            void reload()
          }}
        />
      )}
      {skills === null ? (
        <p className="muted small">Looking for skills…</p>
      ) : skills.length === 0 ? (
        <p className="muted small">No skills yet. Make one, add one from a folder or .zip, or install a plugin that has some.</p>
      ) : (
        groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <div key={title} className="field">
              <label>{title}</label>
              <div className="mcp-list">
                {list.map((s) => (
                  <div key={s.dir} className={'mcp-server skill-row' + (s.enabled ? '' : ' off')} data-skill={s.id}>
                    <div className="mcp-server-main">
                      <label className="mcp-switch" title={s.enabled ? 'On (click to switch off)' : 'Off (click to switch on)'}>
                        <input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} />
                      </label>
                      <span className="mcp-server-name mono">{s.id}</span>
                      <span className="mcp-summary muted small" title={s.description}>
                        {s.description}
                      </span>
                      {s.editable && (
                        <>
                          <button className="btn ghost small" onClick={async () => setDraft(await api.readSkill(s.dir))}>
                            Edit
                          </button>
                          <button
                            className="btn ghost small danger-text"
                            onClick={async () => {
                              if (!confirm(`Move the “${s.name}” skill to the trash?`)) return
                              const r = await api.deleteSkill(s.dir)
                              if (!r.ok) setNote({ text: r.error ?? 'Couldn’t delete it.', error: true })
                              void reload()
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {s.plugin && <span className="tag">{s.plugin.split('@')[0]}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
      )}
      <p className="muted small">
        DeepSeek chats get the list of skills that are on, with what each is for, and read a skill’s instructions when a task matches it. Changes apply to each chat the next time you send a message.
      </p>
    </div>
  )
}
