import { useEffect, useRef, useState } from 'react';
import { getAppleMusicConfig } from './config';
import {
  libraryPlaylists, librarySongs, loadMusicKit, loadSelected, playlistSongs, searchSongs, snapshot,
  type MusicKitInstance, type MusicPlaylist, type MusicTrack,
} from './client';
import './appleMusic.css';

type View = 'search' | 'songs' | 'playlists';
type Playback = ReturnType<typeof snapshot>;
const EMPTY: Playback = { isAuthorized: false, isPlaying: false, playbackState: null, currentTime: 0, duration: 0, rate: 1, track: null };
const time = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const quietPause = (music: MusicKitInstance, stop = false): void => {
  try { void Promise.resolve(stop ? music.stop() : music.pause()).catch(() => {}); } catch { /* Cleanup must not throw. */ }
};

/** Isolated MusicKit connection check. A document navigation releases the local audio engine. */
export default function AppleMusic(): React.ReactElement {
  const [instance, setInstance] = useState<MusicKitInstance | null>(null);
  const [setup, setSetup] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [accessExpired, setAccessExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('search');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [searched, setSearched] = useState(false);
  const [playback, setPlayback] = useState<Playback>(EMPTY);
  const [selected, setSelected] = useState<MusicTrack | null>(null);
  const [measurement, setMeasurement] = useState('');
  const alive = useRef(false);
  const requests = useRef(0);
  const transport = useRef(0);
  const accountOperation = useRef(0);
  const accountPending = useRef(false);
  const expiresAt = useRef(0);
  const measure = useRef<{ wall: number; source: number; rate: number } | null>(null);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let current: MusicKitInstance | null = null;
    const abort = new AbortController();
    setSetup('loading'); setError(''); setAccessExpired(false);
    void getAppleMusicConfig(abort.signal).then(async (config) => {
      if (disposed) return;
      expiresAt.current = config.expiresAt;
      const music = await loadMusicKit(config.developerToken);
      if (disposed) return;
      current = music;
      // Reopening this screen never resumes playback by itself.
      try { await music.pause(); } catch { throw new Error('Apple Music could not initialize playback. Reload the connection to try again.'); }
      if (disposed) return;
      setInstance(music); setPlayback(snapshot(music)); setSetup('ready');
    }).catch((caught: unknown) => {
      if (disposed) return;
      setError(caught instanceof Error ? caught.message : 'Apple Music could not be opened. Try again.');
      setSetup('failed');
    });
    return () => {
      disposed = true; alive.current = false; abort.abort(); requests.current++; transport.current++; accountOperation.current++;
      measure.current = null;
      if (current) quietPause(current, true);
    };
  }, [retry]);

  useEffect(() => {
    if (!instance) return;
    let wasAuthorized = instance.isAuthorized;
    let expired = false;
    const clearAccount = () => {
      requests.current++; transport.current++; measure.current = null;
      setTracks([]); setPlaylists([]); setPlaylist(null); setSelected(null); setSearched(false);
      if (!accountPending.current) setBusy(false);
      setLoading(false);
    };
    const update = () => {
      const next = snapshot(instance);
      if (wasAuthorized && !next.isAuthorized) clearAccount();
      wasAuthorized = next.isAuthorized;
      setPlayback(next);
      const sample = measure.current;
      if (sample && (!next.isPlaying || Math.abs(next.rate - sample.rate) > 0.001)) {
        measure.current = null; setMeasurement('Measurement cancelled. Keep the song playing at one speed.');
      } else if (sample && performance.now() - sample.wall >= 10_000) {
        const wallSeconds = (performance.now() - sample.wall) / 1000;
        const sourceSeconds = next.currentTime - sample.source;
        measure.current = null;
        setMeasurement(`${sourceSeconds.toFixed(1)} seconds of song in ${wallSeconds.toFixed(1)} seconds. Listen to check pitch and clarity; timing alone does not establish sound quality.`);
      }
      if (!expired && expiresAt.current <= Date.now() / 1000 + 60) {
        expired = true;
        setAccessExpired(true);
        requests.current++; transport.current++; accountOperation.current++;
        accountPending.current = false; setBusy(false); setLoading(false);
        measure.current = null;
        quietPause(instance);
        setError('Apple Music access needs to be renewed. Return to local files, or reopen this screen after the app is updated.');
      }
    };
    const failure = () => {
      measure.current = null; transport.current++;
      quietPause(instance);
      if (!accountPending.current) setBusy(false);
      setError('Apple Music could not play this song. Check your connection and subscription, then choose the song again.');
    };
    const authorization = () => update();
    const interval = window.setInterval(update, 250);
    instance.addEventListener('mediaPlaybackError', failure);
    instance.addEventListener('authorizationStatusDidChange', authorization);
    return () => {
      window.clearInterval(interval);
      instance.removeEventListener('mediaPlaybackError', failure);
      instance.removeEventListener('authorizationStatusDidChange', authorization);
    };
  }, [instance]);

  const connect = (): void => {
    if (!instance || busy || accessExpired || accountPending.current) return;
    setBusy(true); setError(''); setNotice('');
    // Must be called directly in the tap handler, with SDK setup already complete.
    const id = ++accountOperation.current;
    accountPending.current = true;
    let authorization: Promise<unknown>;
    try { authorization = instance.authorize(); } catch { accountPending.current = false; setBusy(false); setError('Sign-in could not open. Try again in Safari.'); return; }
    void authorization.then(() => {
      if (!alive.current || id !== accountOperation.current) return;
      setPlayback(snapshot(instance));
      setNotice(instance.isAuthorized ? 'Connected. Search for a song, or open your Apple Music library.' : 'Sign-in was not completed. Tap Connect Apple Music to try again.');
    }).catch(() => {
      if (alive.current && id === accountOperation.current) setError('Apple Music sign-in did not finish. Try again and allow Apple’s sign-in window.');
    }).finally(() => { if (alive.current && id === accountOperation.current) { accountPending.current = false; setBusy(false); } });
  };

  const disconnect = (): void => {
    if (!instance || accountPending.current) return;
    const id = ++accountOperation.current;
    accountPending.current = true;
    requests.current++; transport.current++; measure.current = null;
    setBusy(true); setLoading(false); setError('');
    quietPause(instance, true);
    let signingOut: Promise<void>;
    try { signingOut = instance.unauthorize(); } catch { accountPending.current = false; setBusy(false); setError('Apple Music could not disconnect. Try again while online.'); return; }
    void signingOut.then(() => {
      if (!alive.current || id !== accountOperation.current) return;
      setTracks([]); setPlaylists([]); setPlaylist(null); setSelected(null); setSearched(false);
      setPlayback(snapshot(instance)); setNotice('Disconnected from Apple Music. Your local files and classes are unchanged.');
    }).catch(() => { if (alive.current && id === accountOperation.current) setError('Apple Music could not disconnect. Try again while online.'); })
      .finally(() => { if (alive.current && id === accountOperation.current) { accountPending.current = false; setBusy(false); } });
  };

  const browse = async (next: View, chosenPlaylist: MusicPlaylist | null = null): Promise<void> => {
    if (!instance?.isAuthorized || accessExpired || accountPending.current || (next === 'search' && !query.trim())) return;
    const id = ++requests.current;
    setView(next); setPlaylist(chosenPlaylist); setLoading(true); setError(''); setNotice('');
    setTracks([]); setPlaylists([]); setSearched(true);
    try {
      if (next === 'playlists' && !chosenPlaylist) {
        const items = await libraryPlaylists(instance);
        if (id === requests.current && alive.current) setPlaylists(items);
      } else {
        const items = next === 'search' ? await searchSongs(instance, query.trim())
          : chosenPlaylist ? await playlistSongs(instance, chosenPlaylist.id) : await librarySongs(instance);
        if (id === requests.current && alive.current) setTracks(items);
      }
    } catch {
      if (id === requests.current && alive.current) setError('Could not load Apple Music results. Check your connection, or disconnect and sign in again.');
    } finally {
      if (id === requests.current && alive.current) setLoading(false);
    }
  };

  const choose = async (track: MusicTrack): Promise<void> => {
    if (!instance || busy || accessExpired || accountPending.current) return;
    const id = ++transport.current;
    setBusy(true); setError(''); setNotice(''); measure.current = null; setMeasurement('');
    try {
      await loadSelected(instance, track);
      if (id !== transport.current || !alive.current) { quietPause(instance); return; }
      setSelected(track); setPlayback(snapshot(instance));
      setNotice('Song ready. Tap Play when you are ready.');
    } catch {
      if (id === transport.current && alive.current) { setSelected(null); setError('This song could not be opened. Try another song or check your Apple Music subscription.'); }
    } finally { if (id === transport.current && alive.current) setBusy(false); }
  };

  const action = (operation: () => void | Promise<unknown>): void => {
    if (!instance || !playback.isAuthorized || accessExpired || accountPending.current) return;
    measure.current = null; setMeasurement(''); setError(''); setNotice('');
    const id = ++transport.current;
    try {
      // Play/seek is invoked before any await, preserving the original gesture.
      void Promise.resolve(operation()).catch(() => {
        if (alive.current && id === transport.current) setError('Playback did not complete that action. Try Play again, or choose another song.');
      });
      setPlayback(snapshot(instance));
    } catch { setError('This playback control is not available right now. Try Play again.'); }
  };

  const hasSong = !!selected && playback.isAuthorized && !accessExpired;
  const duration = playback.duration || selected?.durationSeconds || 0;
  const position = Math.min(duration, playback.currentTime);
  const shownTrack = playback.track ?? selected;

  return <main className="apple-music-page">
    <header className="apple-music-header"><a href={import.meta.env.BASE_URL}>← Local player</a><span>ClassTempo</span></header>
    <div className="apple-music-content">
      <div className="apple-music-title"><div><p className="apple-music-eyebrow">CONNECTION TEST</p><h1>Apple Music</h1></div>{playback.isAuthorized && <button type="button" onClick={disconnect} disabled={busy}>Disconnect</button>}</div>
      <p className="apple-music-intro">Find a song. Play it from your Apple Music subscription.</p>
      <p className="apple-music-limits">Internet and an Apple Music subscription are required for full songs. This test player does not add streams to local classes or prepare stems.</p>
      {setup === 'loading' && <div><p role="status">Opening the Apple Music connection…</p><button type="button" onClick={() => window.location.reload()}>Reload connection</button></div>}
      {error && <p className="apple-music-error" role="alert">{error}</p>}
      {notice && <p className="apple-music-notice" role="status">{notice}</p>}
      {accessExpired && <button type="button" onClick={() => window.location.reload()}>Reload connection</button>}
      {accountPending.current && busy && <button type="button" onClick={() => window.location.reload()}>Cancel connection attempt</button>}
      {setup === 'failed' && <div className="apple-music-setup"><h2>Connection not ready</h2><p>The app owner needs an active Apple Developer membership and MusicKit key before Apple Music can connect.</p><button type="button" onClick={() => setRetry(retry + 1)}>Check again</button></div>}
      {setup === 'ready' && !playback.isAuthorized && !accessExpired && <section className="apple-music-connect"><span aria-hidden="true">♫</span><h2>Your music, through Apple</h2><p>Sign in on Apple’s secure page to access your music. ClassTempo does not see your password or copy streaming songs to this device.</p><button className="apple-music-primary" type="button" onClick={connect} disabled={busy}>{busy ? 'Waiting for Apple…' : 'Connect Apple Music'}</button></section>}
      {playback.isAuthorized && !accessExpired && <>
        <section className="apple-music-browser" aria-label="Find Apple Music songs">
          <div className="apple-music-tabs" role="group" aria-label="Apple Music source">
            <button type="button" aria-pressed={view === 'search'} onClick={() => { requests.current++; setView('search'); setPlaylist(null); setTracks([]); setPlaylists([]); setSearched(false); setLoading(false); }}>Search</button>
            <button type="button" aria-pressed={view === 'songs'} onClick={() => void browse('songs')}>My songs</button>
            <button type="button" aria-pressed={view === 'playlists'} onClick={() => void browse('playlists')}>Playlists</button>
          </div>
          {view === 'search' && <form className="apple-music-search" onSubmit={(event) => { event.preventDefault(); void browse('search'); }}><label htmlFor="apple-music-search">Search Apple Music<input id="apple-music-search" type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="Song or artist" autoComplete="off" /></label><button type="submit" disabled={!query.trim() || loading}>Search</button></form>}
          {playlist && <button className="apple-music-playlist-back" type="button" onClick={() => void browse('playlists')}>← All playlists</button>}
          {playlist && <h2>{playlist.name}</h2>}
          <div className="apple-music-results" aria-busy={loading}>
            {loading ? <p role="status">Loading…</p> : <>
              {tracks.length > 0 && <ul>{tracks.map((track) => <li key={`${track.type}:${track.id}`}><button type="button" disabled={busy} onClick={() => void choose(track)} aria-label={`Open ${track.name} by ${track.artist}`}>
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" width="48" height="48" loading="lazy" /> : <span className="apple-music-art-placeholder" aria-hidden="true">♫</span>}
                <span><strong>{track.name}</strong><small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small></span><span aria-hidden="true">›</span>
              </button></li>)}</ul>}
              {playlists.length > 0 && <ul>{playlists.map((item) => <li key={item.id}><button type="button" onClick={() => void browse('playlists', item)}><span className="apple-music-art-placeholder" aria-hidden="true">≡</span><span><strong>{item.name}</strong><small>Open playlist</small></span><span aria-hidden="true">›</span></button></li>)}</ul>}
              {searched && !tracks.length && !playlists.length && !error && <p>No {view === 'playlists' && !playlist ? 'playlists' : 'songs'} found.{view === 'search' ? ' Try a different song or artist.' : ''}</p>}
              {!searched && <p>Search by song or artist, then tap a result to open it.</p>}
              {(tracks.length > 0 || playlists.length > 0) && <p className="apple-music-list-note">This connection test shows the first 25 {view === 'playlists' && !playlist ? 'playlists' : 'songs'} only.</p>}
            </>}
          </div>
        </section>
        <section className="apple-music-player" aria-label="Apple Music player">
          <p className="apple-music-eyebrow">{busy ? 'PLEASE WAIT' : 'NOW PLAYING'}</p><h2>{shownTrack?.name ?? 'Choose a song above'}</h2>{shownTrack && <p>{shownTrack.artist}</p>}
          <div className="apple-music-timeline"><span>{time(position)}</span><input type="range" min="0" max={Math.max(1, duration)} step="1" value={position} aria-label="Song position" disabled={!hasSong || busy || !duration} onChange={(event) => { const next = Number(event.target.value); action(() => instance!.seekToTime(next)); }} /><span>{time(duration)}</span></div>
          <div className="apple-music-transport"><button type="button" disabled={!hasSong || busy} onClick={() => action(() => instance!.seekToTime(0))}>Restart</button><button className="apple-music-primary" type="button" disabled={!hasSong || busy} onClick={() => action(() => playback.isPlaying ? instance!.pause() : instance!.play())}>{playback.isPlaying ? 'Pause' : 'Play'}</button></div>
          <details className="apple-music-tests"><summary>Test speed and seeking</summary><div><p>These controls need an iPhone listening check before they join the class player. Use a familiar song and listen for pitch changes or warbling.</p><div className="apple-music-test-buttons">{[0.75, 1, 1.1].map((rate) => <button type="button" key={rate} disabled={!hasSong || busy} aria-pressed={Math.abs(playback.rate - rate) < 0.001} onClick={() => action(() => { instance!.playbackRate = rate; })}>{Math.round(rate * 100)}%</button>)}</div><button type="button" disabled={!hasSong || busy} onClick={() => action(() => instance!.seekToTime(Math.max(0, playback.currentTime - 10)))}>Back 10 seconds</button><button type="button" disabled={!playback.isPlaying || busy} onClick={() => { measure.current = { wall: performance.now(), source: playback.currentTime, rate: playback.rate }; setMeasurement('Measuring 10 seconds of uninterrupted playback…'); }}>Measure playback speed</button>{measurement && <p role="status">{measurement}</p>}<p className="apple-music-list-note">Also check a full song, your class speaker, lock-screen controls, and pause/resume after an interruption. A preview or a timer reading is not a full playback pass.</p></div></details>
        </section>
      </>}
      <p className="apple-music-footer">Your local player, saved media, cues, practices and classes stay separate. <a href={import.meta.env.BASE_URL}>Return to local files</a>.</p>
    </div>
  </main>;
}
