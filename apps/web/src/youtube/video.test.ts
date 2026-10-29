import { describe, expect, it } from 'vitest';
import { parseYouTubeVideo, youtubeVideoUrl } from './video';

const id = 'M7lc1UVf-VE';
describe('YouTube single-video links', () => {
  it.each([
    `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&list=untrusted&si=tracking`,
    `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`, `youtu.be/${id}`, `http://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`,
  ])('keeps only the canonical single video for %s', input => {
    expect(parseYouTubeVideo(input)).toEqual({ id, startSeconds: 0, url: `https://www.youtube.com/watch?v=${id}` });
  });
  it.each([
    [`https://youtu.be/${id}?t=1h2m3s`, 3723], [`https://youtube.com/watch?v=${id}&t=75`, 75],
    [`https://youtube.com/watch?v=${id}&start=12.5`, 12.5], [`https://youtube.com/watch?v=${id}#t=1m2s`, 62],
  ])('reads an explicit start point from %s', (input, startSeconds) => {
    expect(parseYouTubeVideo(input)?.startSeconds).toBe(startSeconds);
  });
  it.each([
    '', id, 'javascript:alert(1)', `https://youtube.com.evil.test/watch?v=${id}`,
    `https://youtu.be.evil.test/${id}`, `https://user@www.youtube.com/watch?v=${id}`,
    `https://youtube.com:444/watch?v=${id}`, `https://youtube.com/watch?v=${id}&v=abcdefghijk`,
    'https://youtube.com/playlist?list=abc', 'https://youtube.com/@channel',
    `https://youtube-nocookie.com/watch?v=${id}`, `https://youtube.com/watch?v=bad`,
    `https://youtube.com/embed/${id}/extra`, `https://youtu.be/${id}?t=oops`,
    `https://youtu.be/${id}?t=-5`, `https://youtu.be/${id}?t=Infinity`,
    `https://youtu.be/${id}?t=999999999999999999999`, `https://youtu.be/${id}\n?x=1`,
  ])('rejects non-video or unsafe input %j', input => { expect(parseYouTubeVideo(input)).toBeNull(); });
  it('retains no arbitrary query or fragment in a shared fallback URL', () => {
    expect(parseYouTubeVideo(`https://youtu.be/${id}?t=12s&email=private&si=secret#tracking`)?.url).toBe(`https://www.youtube.com/watch?v=${id}&t=12s`);
    expect(() => youtubeVideoUrl('../bad')).toThrow('valid YouTube');
  });
  it('does not impose a one-day start-point limit on a long video or live archive', () => {
    expect(parseYouTubeVideo(`https://youtu.be/${id}?t=25h`)?.startSeconds).toBe(90_000);
    const video = parseYouTubeVideo(`https://youtu.be/${id}?t=12.5`)!;
    expect(parseYouTubeVideo(video.url)?.startSeconds).toBe(12.5);
  });
});
