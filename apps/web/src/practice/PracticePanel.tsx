import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTime } from '../types';
import { commitPracticeDraft, practiceTimeInput as seconds, type PracticeDraft } from './draft';
import { activatePracticeSection, MAX_SECTIONS, MIN_SECTION_SECONDS, selectedPracticeSection, type PracticeSection, type PracticeSettings } from './settings';
import './practice.css';

export interface PracticePanelProps {
  settings: PracticeSettings;
  cues: readonly ({ time: number; name: string } | null)[];
  onChange(settings: PracticeSettings): void;
  /** Called synchronously with the exact validated settings; the player commits and starts them. */
  onStart(settings: PracticeSettings): void;
  /** Ends the active practice without saving unfinished edits. */
  onEnd(): void;
  position: number;
  duration: number;
  onClose(): void;
  delayDisabled?: boolean;
}

function clock(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  return formatTime(value);
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rangeDraft(settings: PracticeSettings, section: PracticeSection | null, position: number, duration: number): PracticeDraft {
  return {
    settings,
    sectionId: section?.id ?? null,
    name: section?.name ?? `Practice ${settings.sections.length + 1}`,
    start: seconds(section?.start ?? Math.min(position, Math.max(0, duration - MIN_SECTION_SECONDS))),
    end: seconds(section?.end ?? duration),
  };
}

/** The visible range is always committed by either footer action, together with the chosen playback mode. */
export function PracticePanel({ settings, cues, onChange, onStart, onEnd, position, duration, onClose, delayDisabled = false }: PracticePanelProps) {
  const [draft, setDraft] = useState<PracticeDraft>(() => {
    const selected = selectedPracticeSection(settings);
    const initial = selected
      ? settings.mode === 'off' ? activatePracticeSection(settings, selected.id) : settings
      : { ...settings, mode: 'repeat' as const, repetitions: null, gapSeconds: 0, delaySeconds: 0 };
    return rangeDraft(initial, selected, position, duration);
  });
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<PracticeDraft | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const current = draft.settings;
  // Off is only an empty draft after deleting the last practice, never a playback choice in this editor.
  const deletedLastPractice = current.mode === 'off';
  const usableCues = cues.flatMap((cue, index) => cue && Number.isFinite(cue.time) && cue.time >= 0 && cue.time <= duration
    ? [{ ...cue, index }] : []);

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

  const change = (next: PracticeDraft) => { setUndo(draft); setDraft(next); setError(null); };
  const configure = (next: Partial<PracticeSettings>) => change({ ...draft, settings: { ...current, ...next } });
  const chooseSection = (id: string) => {
    const selected = current.sections.find((section) => section.id === id) ?? null;
    if (selected) change(rangeDraft(activatePracticeSection(current, selected.id), selected, position, duration));
  };
  const freshSection = () => change(rangeDraft({ ...current, selectedSectionId: null, mode: 'repeat', repetitions: null, gapSeconds: 0, delaySeconds: 0 }, null, position, duration));
  const deletePractice = () => {
    const sections = current.sections.filter((section) => section.id !== draft.sectionId);
    const selected = sections[0] ?? null;
    const next = { ...current, sections, selectedSectionId: selected?.id ?? null, mode: selected ? current.mode : 'off' as const, delaySeconds: selected ? current.delaySeconds : 0 };
    change(rangeDraft(selected ? activatePracticeSection(next, selected.id) : next, selected, position, duration));
  };
  const selectCue = (edge: 'start' | 'end', index: string) => {
    const cue = usableCues.find((item) => String(item.index) === index);
    if (!cue) return;
    const next = { ...draft, [edge]: seconds(cue.time) };
    if (edge === 'start') {
      // Keep a valid chosen endpoint; when the new start passes it, use the next cue or track end.
      if (Number(draft.end) - cue.time < MIN_SECTION_SECONDS) {
        const following = usableCues.filter((item) => item.time - cue.time >= MIN_SECTION_SECONDS).sort((a, b) => a.time - b.time)[0];
        next.end = seconds(following?.time ?? duration);
      }
      if (!draft.sectionId && /^Practice \d+$/.test(draft.name)) next.name = cue.name || `Cue ${cue.index + 1}`;
    }
    change(next);
  };
  const commit = (startPlayback: boolean) => {
    const result = commitPracticeDraft(draft, duration, newId);
    if ('error' in result) {
      setError(result.error);
      if (result.field === 'start') startInput.current?.focus();
      if (result.field === 'end') endInput.current?.focus();
      return;
    }
    if (startPlayback) onStart(result.settings);
    else { onChange(result.settings); onClose(); }
  };
  const cueValue = (time: string) => usableCues.find((cue) => time.trim() && Math.abs(cue.time - Number(time)) < .005)?.index.toString() ?? 'custom';
  const modeSummary = current.mode === 'repeat' ? current.repetitions === 1 ? '1 play — no repeat' : `Repeat ${current.repetitions === null ? 'until stopped' : `${current.repetitions} plays`}`
    : current.mode === 'once' ? 'Play once, then stop' : 'Save changes to remove the practice';

  return createPortal(
    <div className="practice-backdrop" ref={backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <div className="practice-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-title" tabIndex={-1} ref={dialog}>
        <header className="practice-heading">
          <div><h2 id="practice-title">Practice</h2><p>Name it, save it, use it again</p></div>
          <button type="button" className="practice-close" aria-label="Close practice without saving" title="Close without saving changes" onClick={onClose}>✕</button>
        </header>
        <div className="practice-body">
          <section className="practice-block practice-saved-block" aria-labelledby="practice-saved-label">
            <div className="practice-block-heading">
              <h3 id="practice-saved-label">Saved practices</h3>
              <button type="button" disabled={current.sections.length >= MAX_SECTIONS} onClick={freshSection}>+ New practice</button>
            </div>
            {current.sections.length > 0 && <label className="practice-field">
              <span>Choose a practice</span>
              <select aria-label="Saved practices" value={draft.sectionId ?? 'new'} onChange={(event) => event.target.value === 'new' ? freshSection() : chooseSection(event.target.value)}>
                <option value="new" disabled={current.sections.length >= MAX_SECTIONS}>New practice</option>
                {current.sections.map((section) => <option value={section.id} key={section.id}>{section.name} · {clock(section.start)}–{clock(section.end)}</option>)}
              </select>
            </label>}
            {deletedLastPractice ? <p className="practice-hint" role="status">Practice removed from this draft. Save changes to confirm, Undo to restore, or add a new practice.</p> : <>
              <label className="practice-field practice-name-field"><span>Practice name</span><input aria-label="Practice name" value={draft.name} maxLength={60} onChange={(event) => change({ ...draft, name: event.target.value })} placeholder="Chorus, turn pattern…" /></label>
              <p className="practice-hint">Saves the range, tempo and playback settings with this track. Start practice saves them too.</p>
            </>}
          </section>

          {!deletedLastPractice && <>
            <section className="practice-block" aria-labelledby="practice-mode-label">
              <h3 id="practice-mode-label">How to play</h3>
              <div className="practice-modes" role="group" aria-label="Practice playback mode">
                <button type="button" aria-pressed={current.mode === 'repeat'} onClick={() => configure({ mode: 'repeat', repetitions: current.repetitions === 1 ? null : current.repetitions })}>Repeat</button>
                <button type="button" aria-pressed={current.mode === 'once'} onClick={() => configure({ mode: 'once' })}>Once</button>
              </div>
            </section>

            <section className="practice-block" aria-labelledby="practice-range-label">
              <h3 id="practice-range-label">Practice range</h3>
              <div className="practice-time-grid">
                <div className="practice-edge">
                  <label className="practice-field"><span>Start at cue</span>
                    <select aria-label="Start at cue" value={cueValue(draft.start)} onChange={(event) => selectCue('start', event.target.value)}>
                      <option value="custom">Custom time below</option>
                      {usableCues.filter((cue) => duration - cue.time >= MIN_SECTION_SECONDS).map((cue) => <option value={cue.index} key={cue.index}>{cue.index + 1} · {cue.name || `Cue ${cue.index + 1}`} · {clock(cue.time)}</option>)}
                    </select>
                  </label>
                  <label className="practice-field"><span>Start (seconds)</span><input ref={startInput} aria-label="Start (seconds)" type="number" inputMode="decimal" min={0} max={duration} step="0.01" value={draft.start} onChange={(event) => change({ ...draft, start: event.target.value })} /></label>
                  <button type="button" onClick={() => change({ ...draft, start: seconds(Math.min(position, duration)) })}>Set start here</button>
                </div>
                <div className="practice-edge">
                  <label className="practice-field"><span>End at cue</span>
                    <select aria-label="End at cue" value={Math.abs(Number(draft.end) - duration) < .005 ? 'track-end' : cueValue(draft.end)} onChange={(event) => event.target.value === 'track-end' ? change({ ...draft, end: seconds(duration) }) : selectCue('end', event.target.value)}>
                      <option value="custom">Custom time below</option>
                      <option value="track-end">End of track · {clock(duration)}</option>
                      {usableCues.map((cue) => <option value={cue.index} key={cue.index}>{cue.index + 1} · {cue.name || `Cue ${cue.index + 1}`} · {clock(cue.time)}</option>)}
                    </select>
                  </label>
                  <label className="practice-field"><span>End (seconds)</span><input ref={endInput} aria-label="End (seconds)" type="number" inputMode="decimal" min={0} max={duration} step="0.01" value={draft.end} onChange={(event) => change({ ...draft, end: event.target.value })} /></label>
                  <button type="button" onClick={() => change({ ...draft, end: seconds(Math.min(position, duration)) })}>Set end here</button>
                </div>
              </div>
              {usableCues.length === 0 && <p className="practice-hint">No saved cues yet. Enter exact times here, or close Practice and tap an empty cue pad at the position you want.</p>}
            </section>

            {current.mode === 'repeat' && <section className="practice-block" aria-labelledby="practice-repeat-label">
              <h3 id="practice-repeat-label">Repetitions</h3>
              <div className="practice-time-grid">
                <label className="practice-field"><span>Total plays</span><select aria-label="Total plays" value={current.repetitions === null ? 'forever' : String(current.repetitions)} onChange={(event) => configure({ repetitions: event.target.value === 'forever' ? null : Number(event.target.value) })}>
                  <option value="forever">Until stopped</option>
                  {[2, 3, 4, 8, 16].map((count) => <option key={count} value={count}>{count} plays</option>)}
                  {current.repetitions !== null && ![2, 3, 4, 8, 16].includes(current.repetitions) && <option value={current.repetitions}>{current.repetitions === 1 ? '1 play (no repeat)' : `${current.repetitions} plays`}</option>}
                </select></label>
                <label className="practice-field"><span>Pause between (seconds)</span><input aria-label="Pause between (seconds)" type="number" inputMode="decimal" min={0} max={30} step="0.5" value={current.gapSeconds} onChange={(event) => configure({ gapSeconds: Math.max(0, Math.min(30, Number(event.target.value))) })} /></label>
              </div>
              <p className="practice-hint">Total plays includes the first play. Choose Until stopped for continuous practice.</p>
            </section>}

            <section className="practice-block" aria-labelledby="practice-tempo-label">
              <h3 id="practice-tempo-label">Teaching tempo · {Math.round(current.tempo * 100)}%</h3>
              <div className="practice-presets" role="group" aria-label="Teaching tempo presets">
                {[75, 90, 100, 110].map((percent) => <button type="button" key={percent} aria-pressed={Math.round(current.tempo * 100) === percent} onClick={() => configure({ tempo: percent / 100 })}>{percent}%</button>)}
              </div>
            </section>
            <section className="practice-block" aria-labelledby="practice-delay-label">
              <h3 id="practice-delay-label">Get into position</h3>
              <label className="practice-field"><span>Start delay (seconds)</span><input aria-label="Start delay (seconds)" type="number" inputMode="decimal" disabled={delayDisabled} min={0} max={30} step="1" value={current.delaySeconds} onChange={(event) => configure({ delaySeconds: Math.max(0, Math.min(30, Number(event.target.value))) })} /></label>
              <div className="practice-presets" role="group" aria-label="Start delay presets">
                {[0, 3, 5, 10].map((delay) => <button type="button" disabled={delayDisabled} aria-pressed={current.delaySeconds === delay} key={delay} onClick={() => configure({ delaySeconds: delay })}>{delay === 0 ? 'Off' : `${delay}s`}</button>)}
              </div>
              <p className="practice-hint">{delayDisabled ? 'Play the video once to enable its start delay on this device.' : 'A visible countdown gives you time to join your students. Pause cancels it.'}</p>
            </section>
            {draft.sectionId && <button type="button" className="practice-delete" onClick={deletePractice}>Delete this practice</button>}
          </>}
          <button className="practice-undo" type="button" disabled={!undo} onClick={() => { if (undo) { setDraft(undo); setUndo(null); setError(null); } }}>Undo last change</button>
        </div>
        <footer className="practice-footer">
          {error && <p className="practice-error" role="alert">{error}</p>}
          <p className="practice-preview">{current.mode !== 'off' && <strong>{clock(Number(draft.start))}–{clock(Number(draft.end))} · </strong>}{modeSummary}</p>
          <div className="practice-footer-actions">
            <button type="button" className="practice-primary" disabled={deletedLastPractice} onClick={() => commit(true)}>Start practice</button>
            <button type="button" onClick={() => commit(false)}>{deletedLastPractice ? 'Save changes' : 'Save practice'}</button>
          </div>
          {(settings.mode !== 'off' || settings.delaySeconds > 0) && <button type="button" className="practice-end" onClick={onEnd}>End practice · return to player</button>}
        </footer>
      </div>
    </div>, document.body,
  );
}
