import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACCEPT_MEDIA } from '../dancer/media';
import { normalizePracticeSettings, type PracticeSettings } from '../practice/settings';
import {
  createBackup, getMediaFile, listClasses, listMedia, markOpened, mediaId, moveClassEntry, newId,
  parseBackup, removeClass, removeMedia, restoreBackup, saveClass, saveMedia,
  type ClassEntry, type ClassSet, type LibraryMedia,
} from './store';
import './library.css';

export interface LibraryModalProps {
  open: boolean;
  initialKind: 'audio' | 'video';
  onClose: () => void;
  /** Loads one item, without starting playback. */
  onLoad: (file: File, libraryId: string, practiceOverride?: PracticeSettings) => Promise<void>;
  currentFile?: File | null;
  currentTitle?: string | null;
  currentPractice?: PracticeSettings;
  currentDuration?: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The library could not complete that action. Please try again.';
}

function fileSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function LibraryModal({ open, initialKind, onClose, onLoad, currentFile, currentTitle, currentPractice, currentDuration }: LibraryModalProps) {
  const [view, setView] = useState<'audio' | 'video' | 'classes'>(initialKind);
  const [media, setMedia] = useState<LibraryMedia[]>([]);
  const [classes, setClasses] = useState<ClassSet[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  const refresh = useCallback(async () => {
    const [items, savedClasses] = await Promise.all([listMedia(), listClasses()]);
    setMedia(items);
    setClasses(savedClasses);
    setSelected((id) => savedClasses.some((item) => item.id === id) ? id : savedClasses[0]?.id ?? '');
  }, []);

  useEffect(() => {
    if (!open) return;
    setView(initialKind);
    setError('');
    setNotice('');
    setSearch('');
    void refresh().catch((cause: unknown) => setError(message(cause)));
  }, [open, initialKind, refresh]);

  // This portal owns focus while open; save and restore each sibling's prior inert state.
  useLayoutEffect(() => {
    if (!open || !overlay.current || !panel.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay.current);
    const states = siblings.map((element) => ({ element, inert: element.inert }));
    for (const { element } of states) element.inert = true;
    panel.current.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (!panel.current) return;
      // The player also has global shortcuts; they must not run while the library is open.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.busy) latest.current.onClose();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter((element) => !element.hidden && element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); panel.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      for (const { element, inert } of states) element.inert = inert;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  async function perform(action: () => Promise<void>): Promise<void> {
    if (latest.current.busy) return;
    setBusy(true);
    latest.current.busy = true;
    setError('');
    setNotice('');
    try { await action(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); latest.current.busy = false; }
  }

  async function importFiles(files: File[]): Promise<void> {
    await perform(async () => {
      let imported = 0;
      const failures: string[] = [];
      for (const file of files) {
        try { await saveMedia(file); imported++; }
        catch { failures.push(file.name); }
      }
      await refresh();
      if (imported) setNotice(`${imported} ${imported === 1 ? 'file saved' : 'files saved'} on this device. Tap a title to load it.`);
      if (failures.length) setError(`${failures.length} ${failures.length === 1 ? 'file could' : 'files could'} not be saved. Device storage may be full. Tap Song or Video to open a file directly.`);
    });
  }

  async function load(item: LibraryMedia, practiceOverride?: PracticeSettings): Promise<void> {
    await perform(async () => {
      const file = await getMediaFile(item.id);
      await onLoad(file, item.id, practiceOverride);
      // A recent-list failure must not label successfully loaded playback as a failure.
      await markOpened(item.id).catch(() => {});
      onClose();
    });
  }

  async function updateClass(item: ClassSet): Promise<void> {
    await perform(async () => { await saveClass(item); await refresh(); });
  }

  function isCurrent(item: LibraryMedia | undefined): boolean {
    return !!currentFile && !!item && mediaId(item) === mediaId(currentFile);
  }

  function capturePractice(entry: ClassEntry): ClassEntry {
    return currentPractice && currentDuration && currentDuration > 0
      ? { ...entry, practice: normalizePracticeSettings(currentPractice, currentDuration), practiceDuration: currentDuration }
      : entry;
  }

  function exerciseDescription(entry: ClassEntry, item: LibraryMedia): string {
    const prefix = item.kind === 'video' ? 'Video' : 'Song';
    if (!entry.practice) return `${prefix} · Saved track settings`;
    const selected = entry.practice.sections.find((section) => section.id === entry.practice?.selectedSectionId);
    return `${prefix} · ${Math.round(entry.practice.tempo * 100)}%${selected ? ` · ${selected.name}` : ''}${entry.practice.mode === 'repeat' ? ' · Repeat' : entry.practice.mode === 'once' ? ' · Once' : ''}`;
  }

  async function exportSettings(): Promise<void> {
    await perform(async () => {
      const backup = await createBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `classtempo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice('Backup download started. It includes class sets, cues and practice settings; keep your music and video originals separately.');
    });
  }

  if (!open) return null;
  const activeClass = classes.find((item) => item.id === selected);
  const shown = media.filter((item) => item.kind === view && item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const available = media.filter((item) => item.available);

  return createPortal(
    <div className="library-overlay" ref={overlay} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="library-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="library-heading" aria-describedby="library-description" tabIndex={-1}>
        <header className="library-heading">
          <div><span className="library-eyebrow">PREPARE YOUR CLASS</span><h2 id="library-heading">Your library</h2></div>
          <button type="button" className="library-close" onClick={onClose} disabled={busy} aria-label="Close library">✕</button>
        </header>
        <p id="library-description" className="library-description">Saved on this device. One track plays at a time.</p>
        <div className="library-tabs" role="group" aria-label="Library content">
          <button type="button" aria-pressed={view === 'audio'} onClick={() => setView('audio')}>Songs</button>
          <button type="button" aria-pressed={view === 'video'} onClick={() => setView('video')}>Videos</button>
          <button type="button" aria-pressed={view === 'classes'} onClick={() => setView('classes')}>Classes</button>
        </div>
        <div className="library-feedback" aria-live="polite">
          {busy && <p>Working…</p>}
          {notice && <p className="library-notice">{notice}</p>}
          {error && <p className="library-error" role="alert">{error}</p>}
        </div>
        <div className="library-scroll">
          {view !== 'classes' ? <>
            <div className="library-toolbar">
              <input aria-label="Search saved media" placeholder="Find a saved title…" value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
              <button type="button" className="library-primary" disabled={busy} onClick={() => input.current?.click()}>Import files</button>
            </div>
            <p className="library-small">Recent first · Tap a title to load. Playback waits for Play.</p>
            {currentFile && !media.some((item) => item.available && item.id === mediaId(currentFile)) && <button type="button" className="library-save-current" disabled={busy} onClick={() => void importFiles([currentFile])}>Save current: {currentTitle || currentFile.name}</button>}
            {shown.length ? <ul className="library-items">{shown.map((item) => <li key={item.id}>
              <button type="button" className="library-media-title" disabled={busy || !item.available} onClick={() => void load(item)}>
                <span>{item.name}</span><small>{item.available ? `${fileSize(item.size)} · Saved on device` : 'Import this file again to reconnect it'}</small>
              </button>
              {item.available && <button type="button" className="library-icon-button" aria-label={`Remove saved copy of ${item.name}`} disabled={busy} onClick={() => {
                if (window.confirm(`Remove the saved copy of “${item.name}” from this device? Your original file, cues and class entries will remain.`)) void perform(async () => { await removeMedia(item.id); await refresh(); setNotice('Saved copy removed. Class entries remain ready to reconnect when you import the file again.'); });
              }}>×</button>}
            </li>)}</ul> : <div className="library-empty"><strong>{search ? 'No matching titles' : `Save your first ${view === 'audio' ? 'song' : 'video'}`}</strong><p>Import local files to reopen them without the file picker. Spotify and Apple Music downloads cannot be imported as ordinary files.</p></div>}
          </> : <>
            <form className="library-toolbar" onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void perform(async () => {
                const item = await saveClass({ id: newId(), name, entries: [], updatedAt: Date.now() });
                await refresh(); setSelected(item.id); setName('');
              });
            }}>
              <input aria-label="New class name" placeholder="e.g. Tuesday beginners" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
              <button type="submit" className="library-primary" disabled={busy || !name.trim()}>Create class</button>
            </form>
            {classes.length > 0 && <label className="library-field">Class set<select value={selected} onChange={(event) => setSelected(event.target.value)}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            {activeClass ? <>
              <p className="library-small">Tap an exercise to load it. Advance manually; the next song never starts automatically. Add the current track to save its speed and practice settings for that exercise.</p>
              <ol className="library-class-items">{activeClass.entries.map((entry, index) => {
                const item = media.find((candidate) => candidate.id === entry.mediaId);
                return <li key={entry.id}>
                  <span className="library-entry-number">{index + 1}</span>
                  <button type="button" className="library-media-title" disabled={busy || !item?.available} onClick={() => { if (item) void load(item, entry.practice); }}><span>{item?.name ?? 'Missing file'}</span><small>{item?.available ? exerciseDescription(entry, item) : 'Import the original file to reconnect'}</small></button>
                  <div className="library-entry-tools">
                    <button type="button" disabled={busy || index === 0} aria-label={`Move exercise ${index + 1} up`} onClick={() => void updateClass({ ...activeClass, entries: moveClassEntry(activeClass.entries, entry.id, -1) })}>↑</button>
                    <button type="button" disabled={busy || index === activeClass.entries.length - 1} aria-label={`Move exercise ${index + 1} down`} onClick={() => void updateClass({ ...activeClass, entries: moveClassEntry(activeClass.entries, entry.id, 1) })}>↓</button>
                    <button type="button" disabled={busy} aria-label={`Remove exercise ${index + 1} from class`} onClick={() => void updateClass({ ...activeClass, entries: activeClass.entries.filter((candidate) => candidate.id !== entry.id) })}>×</button>
                  </div>
                  {isCurrent(item) && currentPractice && !!currentDuration && <button type="button" className="library-entry-settings" disabled={busy} onClick={() => void updateClass({ ...activeClass, entries: activeClass.entries.map((candidate) => candidate.id === entry.id ? capturePractice(candidate) : candidate) })}>Use current settings for exercise {index + 1}</button>}
                </li>;
              })}</ol>
              {activeClass.entries.length === 0 && <p className="library-empty">Add saved songs or videos below. The same title can appear more than once.</p>}
              <label className="library-field">Add an exercise<select disabled={busy || !available.length} value="" onChange={(event) => {
                const id = event.target.value;
                if (id) {
                  const entry = { id: newId(), mediaId: id };
                  void updateClass({ ...activeClass, entries: [...activeClass.entries, isCurrent(media.find((item) => item.id === id)) ? capturePractice(entry) : entry] });
                }
              }}><option value="">{available.length ? 'Choose a saved song or video…' : 'Import files in Songs or Videos first'}</option>{available.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <button type="button" className="library-danger" disabled={busy} onClick={() => {
                if (window.confirm(`Delete the class set “${activeClass.name}”? Saved files and cues will remain.`)) void perform(async () => { await removeClass(activeClass.id); await refresh(); });
              }}>Delete this class set</button>
            </> : <div className="library-empty"><strong>Your class, ready to teach</strong><p>Create a named class and arrange songs and videos in teaching order.</p></div>}
          </>}
          <div className="library-backup">
            <button type="button" className="library-backup-toggle" aria-expanded={backupOpen} onClick={() => setBackupOpen(!backupOpen)}>Backup & device storage <span aria-hidden="true">{backupOpen ? '−' : '+'}</span></button>
            {backupOpen && <div className="library-backup-content">
              <p>Back up class sets, cues and practice settings. <strong>Audio and video files are not included.</strong> Import the originals again on another device.</p>
              <p>Restore adds missing items and keeps existing settings. Reload the current track afterward to use restored cues and practice settings.</p>
              <div className="library-backup-buttons"><button type="button" disabled={busy} onClick={() => void exportSettings()}>Export settings</button><button type="button" disabled={busy} onClick={() => backupInput.current?.click()}>Restore settings</button></div>
              <p className="library-small">Device storage can be cleared by the browser or device settings. Keep your original media and a separate settings backup. Saved copies can play offline after the app has been opened online.</p>
            </div>}
          </div>
        </div>
        <input ref={input} type="file" accept={ACCEPT_MEDIA} multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files); }} />
        <input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void perform(async () => {
            if (file.size > 5_000_000) throw new Error('Choose a ClassTempo settings backup under 5 MB.');
            const restored = await restoreBackup(parseBackup(await file.text()));
            await refresh();
            setNotice(`Restored ${restored.classes} class sets and ${restored.settings} cue/practice records. Existing settings were kept. Import any missing original files, then reload the current track.`);
          });
        }} />
      </div>
    </div>, document.body,
  );
}

export default LibraryModal;
