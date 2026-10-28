export interface SpotifyConfig {
  clientId: string;
  redirectUri: string;
}

/** Public app identity only. Spotify client secrets must never enter a browser build. */
export function getSpotifyConfig(): SpotifyConfig | null {
  const clientId: unknown = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  const configuredRedirect: unknown = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9]{16,128}$/.test(clientId.trim())) return null;
  try {
    const page = new URL(location.href);
    const redirect = typeof configuredRedirect === 'string' && configuredRedirect.trim()
      ? new URL(configuredRedirect.trim())
      : new URL(import.meta.env.BASE_URL, page);
    // Spotify permits plain HTTP only for explicit loopback IP addresses, not localhost.
    const loopback = redirect.hostname === '127.0.0.1' || redirect.hostname === '[::1]';
    if (redirect.origin !== page.origin || redirect.username || redirect.password
      || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback))) return null;
    if (configuredRedirect && (redirect.search || redirect.hash)) return null;
    redirect.search = '';
    redirect.hash = '';
    return { clientId: clientId.trim(), redirectUri: redirect.href };
  } catch {
    return null;
  }
}
