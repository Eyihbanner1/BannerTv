import { describe, expect, it } from 'vitest';
import { likeOf } from './like';

describe('likeOf', () => {
  it('reads titles like one title, with the type asked for', () => {
    expect(likeOf('films like The Matrix')).toEqual({ title: 'The Matrix', type: 'movie' });
    expect(likeOf('movies like inception')).toEqual({ title: 'inception', type: 'movie' });
    expect(likeOf('shows like Friends')).toEqual({ title: 'Friends', type: 'series' });
    expect(likeOf('TV series similar to Breaking Bad')).toEqual({
      title: 'Breaking Bad',
      type: 'series',
    });
    expect(likeOf('something like Inception')).toEqual({ title: 'Inception' });
    expect(likeOf('  like   the  matrix ')).toEqual({ title: 'the matrix' });
  });

  it('leaves titles and other words alone', () => {
    expect(likeOf('like')).toBeUndefined();
    expect(likeOf('films like')).toBeUndefined();
    expect(likeOf('Like Crazy')).toBeUndefined();
    expect(likeOf('dune')).toBeUndefined();
    expect(likeOf('I like Dune')).toBeUndefined();
    expect(likeOf('liked it')).toBeUndefined();
    expect(likeOf('horror like')).toBeUndefined();
    // "Some like" starts a title; "some films like" still asks.
    expect(likeOf('Some Like It Hot')).toBeUndefined();
    expect(likeOf('some films like Inception')).toEqual({ title: 'Inception', type: 'movie' });
  });
});
