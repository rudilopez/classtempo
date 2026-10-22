import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { MAX_SECTIONS, MIN_SECTION_SECONDS, selectedPracticeSection, type PracticeSection, type PracticeSettings } from './settings';
import './practice.css';

export interface PracticePanelProps {
  settings: PracticeSettings;
  onChange(settings: PracticeSettings): void;
  position: number;
  duration: number;
  onClose(): void;
  /** Video delay is unavailable until the host can safely resume audible playback. */
  delayDisabled?: boolean;
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** One shared rehearsal setup for songs and videos. Values are saved by the host per track. */
export function PracticePanel({ settings, onChange, position, duration, onClose, delayDisabled = false }: PracticePanelProps) {
  const selected = selectedPracticeSection(settings);
  const [editingId, setEditingId] = useState<string | null>(selected?.id ?? null);
  const [name, setName] = useState(selected?.name ?? 'Section 1');
  const [start, setStart] = useState(seconds(selected?.start ?? Math.min(position, Math.max(0, duration - MIN_SECTION_SECONDS))));
  const [end, setEnd] = useState(seconds(selected?.end ?? Math.min(duration, position + 10)));
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<PracticeSettings | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop.current)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of siblings) element.inert = true;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? dialog.current)?.focus();
    const guardFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) focusFirst();
    };
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      const outside = !dialog.current?.contains(document.activeElement) || document.activeElement === dialog.current;
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', guardFocus, true);
    focusFirst();
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', guardFocus, true);
      for (const { element, inert } of siblings) element.inert = inert;
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const edit = (section: PracticeSection | null) => {
    setEditingId(section?.id ?? null);
    setName(section?.name ?? `Section ${settings.sections.length + 1}`);
    setStart(seconds(section?.start ?? Math.min(position, Math.max(0, duration - MIN_SECTION_SECONDS))));
    setEnd(seconds(section?.end ?? Math.min(duration, position + 10)));
    setError(null);
  };
  const change = (next: PracticeSettings) => {
    setUndo(settings);
    onChange(next);
  };
  const saveSection = (event: FormEvent) => {
    event.preventDefault();
    const a = Number(start);
    const b = Number(end);
    if (!start.trim() || !end.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > duration || b - a < MIN_SECTION_SECONDS) {
      setError(`Choose an end after the start, within this ${seconds(duration)} second track. Minimum section: 0.25 seconds.`);
      return;
    }
    if (!editingId && settings.sections.length >= MAX_SECTIONS) { setError(`You can save up to ${MAX_SECTIONS} sections per track.`); return; }
    const section: PracticeSection = { id: editingId ?? newId(), name: name.trim() || `Section ${settings.sections.length + 1}`, start: a, end: b };
    const sections = editingId ? settings.sections.map((item) => item.id === editingId ? section : item) : [...settings.sections, section];
    change({ ...settings, sections, selectedSectionId: section.id, mode: settings.mode === 'off' ? 'once' : settings.mode });
    edit(section);
  };

  return createPortal(
    <div className="practice-backdrop" ref={backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <div
        className="practice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-title"
        tabIndex={-1}
        ref={dialog}
      >
        <header className="practice-heading">
          <div><h2 id="practice-title">Practice</h2><p>Saved with this track</p></div>
          <button type="button" className="practice-done" onClick={onClose}>Done</button>
        </header>
        <div className="practice-body">
          <section className="practice-block" aria-labelledby="practice-tempo-label">
            <h3 id="practice-tempo-label">Teaching tempo · {Math.round(settings.tempo * 100)}%</h3>
            <div className="practice-presets" role="group" aria-label="Teaching tempo presets">
              {[75, 90, 100, 110].map((percent) => <button type="button" key={percent} aria-pressed={Math.round(settings.tempo * 100) === percent} onClick={() => change({ ...settings, tempo: percent / 100 })}>{percent}%</button>)}
            </div>
          </section>
          <section className="practice-block" aria-labelledby="practice-section-label">
            <div className="practice-block-heading">
              <h3 id="practice-section-label">Sections</h3>
              <button type="button" disabled={settings.sections.length >= MAX_SECTIONS} onClick={() => edit(null)}>+ New</button>
            </div>
            {settings.sections.length > 0 && <label className="practice-field">
              <span>Selected section</span>
              <select value={settings.selectedSectionId ?? ''} onChange={(event) => {
                const section = settings.sections.find((item) => item.id === event.target.value) ?? null;
                change({ ...settings, selectedSectionId: section?.id ?? null });
                edit(section);
              }}>
                {settings.sections.map((section) => <option value={section.id} key={section.id}>{section.name} · {seconds(section.start)}–{seconds(section.end)}s</option>)}
              </select>
            </label>}
            <form className="practice-section-form" onSubmit={saveSection}>
              <label className="practice-field"><span>{editingId ? 'Section name' : 'New section name'}</span><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Chorus, turn pattern…" /></label>
              <div className="practice-time-grid">
                <label className="practice-field"><span>A · Start (seconds)</span><input type="number" inputMode="decimal" min={0} max={duration} step="0.01" value={start} onChange={(event) => setStart(event.target.value)} /><button type="button" onClick={() => setStart(seconds(Math.min(position, duration)))}>Use current time</button></label>
                <label className="practice-field"><span>B · End (seconds)</span><input type="number" inputMode="decimal" min={0} max={duration} step="0.01" value={end} onChange={(event) => setEnd(event.target.value)} /><button type="button" onClick={() => setEnd(seconds(Math.min(position, duration)))}>Use current time</button></label>
              </div>
              {error && <p className="practice-error" role="alert">{error}</p>}
              <div className="practice-form-actions">
                <button type="submit" className="practice-primary">{editingId ? 'Save section' : 'Add section'}</button>
                {editingId && <button type="button" onClick={() => {
                  const sections = settings.sections.filter((section) => section.id !== editingId);
                  const next = sections[0] ?? null;
                  change({ ...settings, sections, selectedSectionId: next?.id ?? null, mode: next ? settings.mode : 'off' });
                  edit(next);
                }}>Delete</button>}
              </div>
            </form>
          </section>
          <section className="practice-block" aria-labelledby="practice-repeat-label">
            <h3 id="practice-repeat-label">When you press Play</h3>
            <div className="practice-modes" role="group" aria-label="Section playback">
              <button type="button" aria-pressed={settings.mode === 'off'} onClick={() => change({ ...settings, mode: 'off' })}>Full track</button>
              <button type="button" disabled={!selected} aria-pressed={settings.mode === 'once'} onClick={() => change({ ...settings, mode: 'once' })}>Section once</button>
              <button type="button" disabled={!selected} aria-pressed={settings.mode === 'repeat'} onClick={() => change({ ...settings, mode: 'repeat' })}>Repeat</button>
            </div>
            {settings.mode !== 'off' && selected && <p className="practice-hint">Plays between {seconds(selected.start)}s and {seconds(selected.end)}s, then {settings.mode === 'once' ? 'stops' : 'repeats'}. Resumes your position when paused inside this section.</p>}
            {settings.mode === 'repeat' && <div className="practice-time-grid">
              <label className="practice-field"><span>Total plays</span><select value={settings.repetitions === null ? 'forever' : String(settings.repetitions)} onChange={(event) => change({ ...settings, repetitions: event.target.value === 'forever' ? null : Number(event.target.value) })}>
                <option value="forever">Until stopped</option>
                {[1, 2, 3, 4, 8, 16].map((count) => <option key={count} value={count}>{count} {count === 1 ? 'play' : 'plays'}</option>)}
                {settings.repetitions !== null && ![1, 2, 3, 4, 8, 16].includes(settings.repetitions) && <option value={settings.repetitions}>{settings.repetitions} plays</option>}
              </select></label>
              <label className="practice-field"><span>Pause between (seconds)</span><input type="number" inputMode="decimal" min={0} max={30} step="0.5" value={settings.gapSeconds} onChange={(event) => change({ ...settings, gapSeconds: Math.max(0, Math.min(30, Number(event.target.value))) })} /></label>
            </div>}
          </section>
          <section className="practice-block" aria-labelledby="practice-delay-label">
            <h3 id="practice-delay-label">Get into position</h3>
            <label className="practice-field"><span>Start delay (seconds)</span><input type="number" inputMode="decimal" disabled={delayDisabled} min={0} max={30} step="1" value={settings.delaySeconds} onChange={(event) => change({ ...settings, delaySeconds: Math.max(0, Math.min(30, Number(event.target.value))) })} /></label>
            <div className="practice-presets" role="group" aria-label="Start delay presets">
              {[0, 3, 5, 10].map((delay) => <button type="button" disabled={delayDisabled} aria-pressed={settings.delaySeconds === delay} key={delay} onClick={() => change({ ...settings, delaySeconds: delay })}>{delay === 0 ? 'Off' : `${delay}s`}</button>)}
            </div>
            <p className="practice-hint">{delayDisabled ? 'Play the video once to enable its start delay on this device.' : 'A visible countdown gives you time to join your students. Pause cancels it.'}</p>
          </section>
          <button className="practice-undo" type="button" disabled={!undo} onClick={() => {
            if (!undo) return;
            onChange(undo);
            edit(selectedPracticeSection(undo));
            setUndo(null);
          }}>Undo last saved change</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
