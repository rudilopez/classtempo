import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { hasSpotifyTesterAccess, isSpotifyTesterCode, SPOTIFY_TESTER_INVITE_HASH } from '../spotify/access';
import { listClasses, listMedia } from './store';
import spotifyLogo from '../assets/spotify-logo.svg';
import './libraryHome.css';

export type LibraryDestination = 'files' | 'classes' | 'apple-music' | 'youtube' | 'spotify';

export interface LibraryHomeProps {
  onChoose: (destination: LibraryDestination) => void;
  onOpenFile: () => void;
  disabled?: boolean;
  mediaCount?: number;
  classCount?: number;
}

type IconName = 'file' | 'classes' | 'apple' | 'youtube' | 'spotify';

function LibraryIcon({ name }: { name: IconName }): ReactElement {
  if (name === 'youtube') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="4" /><path d="m10 9 5 3-5 3Z" className="library-home-icon-fill" /></svg>;
  if (name === 'apple' || name === 'spotify') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16V6l11-2v10M9 10l11-2" /><ellipse cx="6" cy="17" rx="3" ry="2.5" /><ellipse cx="17" cy="15" rx="3" ry="2.5" /></svg>;
  if (name === 'classes') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M9 16v-5l5-1v5" /><path d="M9 16c0 1-3 1.8-3 .2S9 15 9 16ZM14 15c0 1-3 1.8-3 .2S14 14 14 15Z" /></svg>;
}

function countLabel(count: number | undefined, singular: string, plural: string): string | undefined {
  return count === undefined ? undefined : `${count} ${count === 1 ? singular : plural}`;
}

/** One source chooser shared by the local and streaming players; it never starts a playback engine. */
export function LibraryHome({ onChoose, onOpenFile, disabled = false, mediaCount, classCount }: LibraryHomeProps): ReactElement {
  const [storedCounts, setStoredCounts] = useState<{ media?: number; classes?: number }>({});
  const [testerOpen, setTesterOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const testerButton = useRef<HTMLButtonElement>(null);
  const codeId = useId();
  const errorId = useId();
  const spotifyVisible = hasSpotifyTesterAccess();

  useEffect(() => {
    let active = true;
    if (mediaCount === undefined) void listMedia().then(items => {
      if (active) setStoredCounts(previous => ({ ...previous, media: items.length }));
    }).catch(() => { /* Missing counts do not imply an empty or unavailable collection. */ });
    if (classCount === undefined) void listClasses().then(items => {
      if (active) setStoredCounts(previous => ({ ...previous, classes: items.length }));
    }).catch(() => { /* Sources remain usable if device storage cannot be read. */ });
    return () => { active = false; };
  }, [mediaCount, classCount]);

  useEffect(() => { if (testerOpen) input.current?.focus(); }, [testerOpen]);

  const closeTester = () => {
    setTesterOpen(false);
    setError('');
    setCode('');
    requestAnimationFrame(() => testerButton.current?.focus());
  };
  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    if (!isSpotifyTesterCode(code)) {
      setError('That code was not recognized. Check the code from your invitation.');
      input.current?.focus();
      return;
    }
    // The existing explicit-invite route consumes the invitation and remembers this installation.
    window.location.hash = SPOTIFY_TESTER_INVITE_HASH;
  };

  if (testerOpen) return <div className="library-home library-home-tester">
    <button type="button" className="library-home-back" disabled={disabled} onClick={closeTester}>← Back to Library</button>
    <div className="library-home-tester-copy">
      <span className="library-home-section-label">BY INVITATION</span>
      <h3>Tester access</h3>
      <p>Have an invitation code? Enter it here to show your test feature in this browser or installed app.</p>
    </div>
    <form onSubmit={submitCode}>
      <label htmlFor={codeId}>Invitation code</label>
      <input ref={input} id={codeId} type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false}
        value={code} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        placeholder="Enter your code" onChange={event => { setCode(event.target.value); setError(''); }} />
      {error && <p id={errorId} className="library-home-error" role="alert">{error}</p>}
      <button type="submit" className="library-home-primary" disabled={disabled || !code.trim()}>Continue</button>
    </form>
    <p className="library-home-footnote">A code reveals the feature. Any required account, subscription and provider approval still apply.</p>
  </div>;

  const row = (destination: LibraryDestination, title: string, description: string, icon: IconName, meta?: string) => <button
    key={destination} type="button" className={`library-home-row library-home-${destination}`} disabled={disabled}
    onClick={() => onChoose(destination)}>
    <span className="library-home-icon"><LibraryIcon name={icon} /></span>
    <span className="library-home-row-copy"><span className="library-home-row-title">{destination === 'spotify' ? <img className="library-home-spotify-logo" src={spotifyLogo} alt="Spotify" /> : title}{meta && <span className="library-home-count">{meta}</span>}</span><span className="library-home-row-description">{description}</span></span>
    <span className="library-home-chevron" aria-hidden="true">›</span>
  </button>;

  return <div className="library-home">
    <button type="button" className="library-home-primary library-home-open" disabled={disabled} onClick={onOpenFile}>
      <span className="library-home-open-icon" aria-hidden="true">＋</span><span><strong>Open a file</strong><small>Add a song or video from your device</small></span><span aria-hidden="true">↗</span>
    </button>
    <section className="library-home-section" aria-label="Your collection">
      <h3 className="library-home-section-label">Your collection</h3>
      <div className="library-home-group">
        {row('files', 'Saved files', 'Your songs and videos on this device', 'file', countLabel(mediaCount ?? storedCounts.media, 'file', 'files'))}
        {row('classes', 'Class plans', 'Put files and practices in teaching order', 'classes', countLabel(classCount ?? storedCounts.classes, 'plan', 'plans'))}
      </div>
    </section>
    <section className="library-home-section" aria-label="Play from">
      <h3 className="library-home-section-label">Play from</h3>
      <div className="library-home-group">
        {import.meta.env.VITE_APPLE_MUSIC_ENABLED === 'true' && row('apple-music', 'Apple Music', 'Search music · Subscription required', 'apple')}
        {row('youtube', 'YouTube', 'Open a video link · Internet required', 'youtube')}
        {spotifyVisible && row('spotify', 'Spotify', 'Invited testers · Premium · Original speed', 'spotify')}
      </div>
      <p className="library-home-footnote">Streaming stays online. Saved files unlock Practice, class plans and supported audio stems.</p>
    </section>
    {!spotifyVisible && <button ref={testerButton} type="button" className="library-home-tester-link" disabled={disabled} onClick={() => setTesterOpen(true)}>
      <span>Tester access</span><span aria-hidden="true">›</span>
    </button>}
  </div>;
}
