import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACCEPT_MEDIA } from '../dancer/media';
import { normalizePracticeSettings, type PracticeSettings } from '../practice/settings';
import { importSelection } from './importFlow';
import { practiceClassEntry, savedClassPractices, type SavedClassPractice } from './classPreparation';
import {
  createBackup, getMediaFile, listClasses, listMedia, markOpened, mediaId, moveClassEntry, newId,
  parseBackup, removeClass, removeMedia, restoreBackup, saveClass, saveMedia,
  type ClassEntry, type ClassSet, type LibraryMedia,
} from './store';
import './library.css';

export interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
  /** Loads one item, without starting playback. */
  /** Null means the import could not be saved; open directly without retrying that save. */
  onLoad: (file: File, libraryId: string | null, practiceOverride?: PracticeSettings) => Promise<void>;
  /** Enters a live class; the host checks actual saved files before opening an exercise. */
  onTeachClass?: (classSet: ClassSet, entryId?: string) => Promise<void>;
  activeClassId?: string;
  onNotice?: (message: string) => void;
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

export function LibraryModal({ open, onClose, onLoad, onTeachClass, activeClassId, onNotice, currentFile, currentTitle, currentPractice, currentDuration }: LibraryModalProps) {
  const [view, setView] = useState<'media' | 'classes'>('media');
  const [media, setMedia] = useState<LibraryMedia[]>([]);
  const [classes, setClasses] = useState<ClassSet[]>([]);
  const [selected, setSelected] = useState('');
  const [classDraft, setClassDraft] = useState<ClassSet | null>(null);
  const [entryDetails, setEntryDetails] = useState<string | null>(null);
  const [practices, setPractices] = useState<SavedClassPractice[]>([]);
  const [name, setName] = useState('');
  const [creatingClass, setCreatingClass] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Working…');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const classNameInput = useRef<HTMLInputElement>(null);
  const classHeading = useRef<HTMLHeadingElement>(null);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  const refresh = useCallback(async () => {
    const [items, savedClasses] = await Promise.all([listMedia(), listClasses()]);
    setMedia(items);
    setClasses(savedClasses);
    setPractices(savedClassPractices(items));
    setSelected((id) => savedClasses.some((item) => item.id === id) ? id : '');
  }, []);

  useEffect(() => {
    if (!open) return;
    setView('media');
    setSelected('');
    setClassDraft(null);
    setEntryDetails(null);
    setCreatingClass(false);
    setName('');
    setBackupOpen(false);
    setError('');
    setNotice('');
    setProgress('Working…');
    setSearch('');
    void refresh().catch((cause: unknown) => setError(message(cause)));
  }, [open, refresh]);

  useEffect(() => {
    if (open && creatingClass) classNameInput.current?.focus();
  }, [open, creatingClass]);

  useEffect(() => {
    if (!open || view !== 'classes') return;
    if (selected) classHeading.current?.focus();
    else overviewHeading.current?.focus();
  }, [open, view, selected]);

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
        const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter((element) => !element.hidden && element.getClientRects().length > 0);
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
    setProgress('Working…');
    try { await action(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); latest.current.busy = false; }
  }

  async function importFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    await perform(async () => {
      setSearch('');
      setView('media');
      const imported = await importSelection(files, {
        save: saveMedia,
        open: async (file, id) => { setProgress(`Opening “${file.name}”…`); await onLoad(file, id); },
        onProgress: (file, index, total) => setProgress(`Saving ${index} of ${total}: ${file.name}`),
      });
      const saved = `${imported.savedCount} of ${imported.selectedCount} ${imported.selectedCount === 1 ? 'file saved' : 'files saved'} on this device.`;
      const failed = imported.failedFiles.length ? ` ${imported.failedFiles.length} could not be saved; keep the originals.` : '';
      if (imported.opened) {
        onNotice?.(`Opened “${files[0]!.name}”. ${saved}${failed} Tap Play when ready.`);
        onClose();
      } else {
        setNotice(saved + failed);
        setError(imported.openError || 'This file could not be opened. Choose another file to continue.');
        void refresh().catch(() => {});
      }
    });
  }

  async function saveCurrent(): Promise<void> {
    if (!currentFile) return;
    await perform(async () => {
      await saveMedia(currentFile);
      setNotice('Current file saved on this device. Playback and practice settings are unchanged.');
      void refresh().catch(() => {});
    });
  }

  async function load(item: LibraryMedia): Promise<void> {
    await perform(async () => {
      const file = await getMediaFile(item.id);
      await onLoad(file, item.id);
      // A recent-list failure must not label successfully loaded playback as a failure.
      void markOpened(item.id).catch(() => {});
      onClose();
    });
  }

  async function teachClass(item: ClassSet, entryId?: string): Promise<void> {
    if (!onTeachClass) return;
    await perform(async () => {
      setProgress('Checking class files…');
      await onTeachClass(item, entryId);
      onClose();
    });
  }

  async function saveClassDraft(): Promise<void> {
    if (!classDraft) return;
    await perform(async () => {
      await saveClass(classDraft);
      await refresh();
      setClassDraft(null);
      setEntryDetails(null);
      setNotice('Class saved. Teach it now, or return to it later.');
    });
  }

  function updateEntry(entryId: string, change: Partial<ClassEntry>): void {
    setClassDraft((draft) => draft ? { ...draft,
      entries: draft.entries.map((entry) => entry.id === entryId ? { ...entry, ...change } : entry) } : draft);
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
    if (!entry.practice) return `${prefix} · Full track · 100%`;
    const selected = entry.practice.sections.find((section) => section.id === entry.practice?.selectedSectionId);
    return `${prefix} · ${Math.round(entry.practice.tempo * 100)}%${selected && entry.practice.mode !== 'off' ? ` · ${selected.name}` : ' · Full track'}${entry.practice.mode === 'repeat' ? ` · ${entry.practice.repetitions === null ? 'Repeat until stopped' : `${entry.practice.repetitions} passes`}` : entry.practice.mode === 'once' ? ' · Once' : ''}`;
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
  const savedClass = classes.find((item) => item.id === selected);
  const activeClass = classDraft?.id === selected ? classDraft : savedClass;
  const editingClass = !!classDraft && classDraft.id === selected;
  const searchText = search.trim();
  const searchKey = searchText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const shown = media.filter((item) => !searchKey || item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().includes(searchKey));
  const available = media.filter((item) => item.available);


  const createForm = <form className="library-create-form" onSubmit={(event) => {
    event.preventDefault();
    if (!name.trim()) return;
    void perform(async () => {
      const item = await saveClass({ id: newId(), name, entries: [], updatedAt: Date.now() });
      await refresh(); setSelected(item.id); setClassDraft(item); setName(''); setCreatingClass(false);
    });
  }}>
    <label className="library-field">Class name<input ref={classNameInput} aria-label="New class name" placeholder="e.g. Tuesday beginners" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="library-create-actions">
      <button type="submit" className="library-primary" disabled={busy || !name.trim()}>Create class</button>
      {classes.length > 0 && <button type="button" disabled={busy} onClick={() => { setCreatingClass(false); setName(''); }}>Cancel</button>}
    </div>
  </form>;

  return createPortal(
    <div className="library-overlay" ref={overlay} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="library-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="library-heading" aria-describedby="library-description" tabIndex={-1}>
        <header className="library-heading">
          <div><span className="library-eyebrow">READY FOR CLASS</span><h2 id="library-heading">Your library</h2></div>
          <button type="button" className="library-close" onClick={onClose} disabled={busy} aria-label="Close library">✕</button>
        </header>
        <p id="library-description" className="library-description">Your media and teaching plans, saved on this device.</p>
        <div className="library-tabs" role="group" aria-label="Library content">
          <button type="button" aria-pressed={view === 'media'} disabled={busy || !!classDraft} onClick={() => setView('media')}>Media <span className="library-tab-count">{media.length}</span></button>
          <button type="button" aria-pressed={view === 'classes'} disabled={busy || !!classDraft} onClick={() => { setView('classes'); setSelected(''); setCreatingClass(false); }}>Classes <span className="library-tab-count">{classes.length}</span></button>
        </div>
        <div className="library-feedback" aria-live="polite">
          {busy && <p>{progress}</p>}
          {notice && <p className="library-notice">{notice}</p>}
          {error && <p className="library-error" role="alert">{error}</p>}
        </div>
        <div className="library-scroll">
          {view === 'media' ? <>
            {media.length > 0 && <>
              <div className="library-section-heading">
                <div><h3>Saved media</h3><p>Songs and videos together. Tap a title to open.</p></div>
                <button type="button" className="library-primary library-add" disabled={busy} onClick={() => input.current?.click()}>+ Add media</button>
              </div>
              <p className="library-import-help">Audio: choose Files. Video: choose Photos or Files. Multiple files are saved together; the first opens paused.</p>
              <div className="library-search">
                <input aria-label="Search saved media" aria-describedby="library-search-help" placeholder="Search saved media" value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">Clear</button>}
              </div>
              <p id="library-search-help" className="library-small library-search-status" role="status">
                {searchText ? `${shown.length} of ${media.length} saved files match.` : `${media.length} saved ${media.length === 1 ? 'file' : 'files'} · Recent first`}
              </p>
            </>}
            {currentFile && !media.some((item) => item.available && mediaId(item) === mediaId(currentFile)) && <button type="button" className="library-save-current" disabled={busy} onClick={() => void saveCurrent()}>Save current: {currentTitle || currentFile.name}</button>}
            {shown.length ? <ul className="library-items">{shown.map((item) => <li key={item.id}>
              <button type="button" className="library-media-title" disabled={busy || !item.available} onClick={() => void load(item)}>
                <span className="library-media-name">{item.name}</span>
                <span className="library-media-meta"><span className={`library-kind-badge ${item.kind}`}>{item.kind === 'video' ? 'Video' : 'Song'}</span><small>{item.available ? `${fileSize(item.size)} · On device` : 'Missing copy · Add the original to reconnect'}</small></span>
              </button>
              {item.available && <button type="button" className="library-icon-button" aria-label={`Remove saved copy of ${item.name}`} disabled={busy} onClick={() => {
                if (window.confirm(`Remove the saved copy of “${item.name}” from this device? Your original file, cues and class entries will remain.`)) void perform(async () => { await removeMedia(item.id); await refresh(); setNotice('Saved copy removed. Class entries remain ready to reconnect when you add the file again.'); });
              }}>×</button>}
            </li>)}</ul> : searchText ? <div className="library-empty library-no-results"><strong>No saved media matches “{searchText}”</strong><p>Try another title or clear your search.</p><button type="button" onClick={() => setSearch('')}>Show all media</button></div> : <div className="library-empty library-first-media">
              <span className="library-empty-icon" aria-hidden="true">♫</span><h3>Your music. Your videos.</h3><p>Add media once, then find it here whenever you teach.</p>
              <button type="button" className="library-primary" disabled={busy} onClick={() => input.current?.click()}>+ Add media</button>
              <p className="library-import-help">Audio: choose Files. Video: choose Photos or Files.<br />Your first selection opens automatically and waits for Play.</p>
            </div>}
            <p className="library-source-note">Local files only. This does not search or import Spotify or Apple Music downloads.</p>
          </> : activeClass ? <>
            <button type="button" className="library-back" disabled={busy || editingClass} onClick={() => setSelected('')}>← All classes</button>
            <div className="library-class-detail-heading"><h3 ref={classHeading} tabIndex={-1}>{editingClass ? 'Edit class' : activeClass.name}</h3>
              <p>{activeClass.entries.length} {activeClass.entries.length === 1 ? 'exercise' : 'exercises'}{activeClass.id === activeClassId ? ' · In session' : ''} · {editingClass ? 'Save your teaching order and reminders.' : activeClass.autoNext ? 'Continues after each completed exercise.' : 'You choose when to move on.'}</p></div>
            <div className="library-class-actions">{editingClass ? <>
              <button type="button" className="library-primary" disabled={busy || !activeClass.name.trim()} onClick={() => void saveClassDraft()}>Save class</button>
              <button type="button" disabled={busy} onClick={() => { setClassDraft(null); setEntryDetails(null); }}>Cancel edits</button>
            </> : <>
              <button type="button" className="library-primary" disabled={busy || !activeClass.entries.length || !onTeachClass} onClick={() => void teachClass(activeClass)}>Teach class</button>
              <button type="button" disabled={busy} onClick={() => { setClassDraft(activeClass); setEntryDetails(null); setNotice(''); }}>Edit class</button>
            </>}</div>
            {editingClass ? <div className="library-class-setup">
              <label className="library-field">Class name<input aria-label="Class name" maxLength={100} disabled={busy} value={activeClass.name} onChange={(event) => setClassDraft({ ...activeClass, name: event.target.value })} /></label>
              <label className="library-field">Between exercises<select aria-label="Between exercises" disabled={busy} value={activeClass.autoNext ? 'continue' : 'wait'} onChange={(event) => setClassDraft({ ...activeClass, autoNext: event.target.value === 'continue' })}>
                <option value="wait">Wait for me</option><option value="continue">Play next automatically</option>
              </select></label>
              <p className="library-small">Repeating until stopped keeps the current exercise playing. Use Next when you are ready.</p>
              <label className="library-field library-add-exercise">Add a full song or video<select aria-label="Add a full song or video" disabled={busy || !available.length} value="" onChange={(event) => {
                const id = event.target.value;
                if (id) setClassDraft({ ...activeClass, entries: [...activeClass.entries, { id: newId(), mediaId: id }] });
              }}><option value="">{available.length ? 'Choose saved media…' : 'Save media in your library first'}</option>{available.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.kind === 'video' ? 'Video' : 'Song'}</option>)}</select></label>
              <label className="library-field">Add a saved practice<select aria-label="Add a saved practice" disabled={busy || !practices.length} value="" onChange={(event) => {
                const choice = practices.find((practice) => practice.id === event.target.value);
                if (choice) setClassDraft({ ...activeClass, entries: [...activeClass.entries, practiceClassEntry(choice, newId())] });
              }}><option value="">{practices.length ? 'Choose a named practice…' : 'No saved practices yet'}</option>{practices.map((choice) => <option value={choice.id} key={choice.id}>{choice.name} · {choice.mediaName} · {Math.round(choice.settings.tempo * 100)}%</option>)}</select></label>
              <p className="library-small">Full songs start at 100%. Practices keep their saved range, tempo and repeats. Add either more than once.</p>
            </div> : <p className="library-small">Teach class opens the player. Tap an exercise below to start there; use Next in the player to keep teaching.</p>}
            <ol className={`library-class-items${editingClass ? ' is-editing' : ''}`}>{activeClass.entries.map((entry, index) => {
              const item = media.find((candidate) => candidate.id === entry.mediaId);
              return <li key={entry.id}>
                <span className="library-entry-number">{index + 1}</span>
                <button type="button" className="library-media-title" disabled={busy || (!editingClass && (!item?.available || !onTeachClass))}
                  aria-expanded={editingClass ? entryDetails === entry.id : undefined}
                  onClick={() => editingClass ? setEntryDetails(entryDetails === entry.id ? null : entry.id) : void teachClass(activeClass, entry.id)}>
                  <span className="library-media-name">{entry.name || item?.name || 'Missing file'}</span>
                  {entry.name && <small className="library-entry-source">{item?.name ?? 'Missing file'}</small>}
                  <small>{item?.available ? exerciseDescription(entry, item) : 'Add the original file to reconnect'}</small>
                  {entry.note && <span className="library-entry-note">{entry.note}</span>}
                  {editingClass && <small className="library-entry-edit-hint">{entryDetails === entry.id ? 'Close details' : 'Edit name & note'}</small>}
                </button>
                {editingClass && <>
                  <div className="library-entry-tools">
                    <button type="button" disabled={busy || index === 0} aria-label={`Move exercise ${index + 1} up`} onClick={() => setClassDraft({ ...activeClass, entries: moveClassEntry(activeClass.entries, entry.id, -1) })}>↑</button>
                    <button type="button" disabled={busy || index === activeClass.entries.length - 1} aria-label={`Move exercise ${index + 1} down`} onClick={() => setClassDraft({ ...activeClass, entries: moveClassEntry(activeClass.entries, entry.id, 1) })}>↓</button>
                    <button type="button" disabled={busy} aria-label={`Remove exercise ${index + 1} from class`} onClick={() => setClassDraft({ ...activeClass, entries: activeClass.entries.filter((candidate) => candidate.id !== entry.id) })}>×</button>
                  </div>
                  {entryDetails === entry.id && <div className="library-entry-editor">
                    <label className="library-field">Exercise name (optional)<input aria-label={`Exercise ${index + 1} name`} maxLength={100} placeholder={item?.name ?? 'e.g. Footwork slowly'} disabled={busy} value={entry.name ?? ''} onChange={(event) => updateEntry(entry.id, { name: event.target.value })} /></label>
                    <label className="library-field">Teaching note (optional)<textarea aria-label={`Exercise ${index + 1} note`} maxLength={500} rows={2} placeholder="e.g. Count the first eight, then change partners" disabled={busy} value={entry.note ?? ''} onChange={(event) => updateEntry(entry.id, { note: event.target.value })} /></label>
                    {isCurrent(item) && currentPractice && !!currentDuration && <button type="button" className="library-entry-settings" disabled={busy} onClick={() => updateEntry(entry.id, capturePractice(entry))}>Use current player settings</button>}
                  </div>}
                </>}
              </li>;
            })}</ol>
            {activeClass.entries.length === 0 && <div className="library-empty library-empty-class"><strong>Build your teaching order</strong><p>{editingClass ? 'Add full songs, videos or saved practices above. No extra setup is needed for full songs.' : 'Edit class to add songs, videos or saved practices.'}</p>{!available.length && <p>Save your class, then use Media to add files.</p>}</div>}
            {editingClass && <button type="button" className="library-danger" disabled={busy} onClick={() => {
              if (window.confirm(`Delete the class set “${activeClass.name}”? Saved files and cues will remain.`)) void perform(async () => { await removeClass(activeClass.id); await refresh(); setClassDraft(null); setEntryDetails(null); setSelected(''); setNotice('Class removed. Your saved media and cues are unchanged.'); });
            }}>Delete this class</button>}
          </> : <>
            <div className="library-section-heading">
              <div><h3 ref={overviewHeading} tabIndex={-1}>Your classes</h3><p>Save a teaching order for each class.</p></div>
              {classes.length > 0 && !creatingClass && <button type="button" className="library-primary" disabled={busy} onClick={() => { setCreatingClass(true); setName(''); }}>+ New class</button>}
            </div>
            {classes.length === 0 && <div className="library-empty library-first-class"><h3>A class is your teaching plan</h3><p>Give it a name, add saved songs or videos, and arrange your exercises. Play one at a time.</p></div>}
            {(creatingClass || classes.length === 0) && createForm}
            {classes.length > 0 && <ul className="library-class-cards">{classes.map((item) => <li key={item.id}><button type="button" className="library-class-card" onClick={() => { setSelected(item.id); setCreatingClass(false); }}>
              <span className="library-class-card-icon" aria-hidden="true">≡</span><span className="library-class-card-copy"><strong>{item.name}</strong><small>{item.entries.length} {item.entries.length === 1 ? 'exercise' : 'exercises'}{item.id === activeClassId ? ' · In session' : ''}</small></span><span className="library-class-chevron" aria-hidden="true">›</span>
            </button></li>)}</ul>}
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
            setNotice(`Restored ${restored.classes} class sets and ${restored.settings} cue/practice records. Existing settings were kept. Add any missing original files, then reopen the current track.`);
          });
        }} />
      </div>
    </div>, document.body,
  );
}

export default LibraryModal;
