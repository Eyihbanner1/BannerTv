/** A video as its stream and subtitles requests name it. */
export interface PlayerVideo {
  type: string;
  id: string;
}

export interface PlayerFirst {
  /** These videos are the player's until the release it returns is called. */
  put(videos: readonly PlayerVideo[]): () => void;
  /** 1 for a request about a video a player has, else 0: the addon client's playPriority. */
  priority(type: string, videoId: string): number;
}

/**
 * The videos a player has open, so that their stream and subtitles requests
 * can go ahead of others waiting for a request slot: Home's rows, Details'
 * extras, and the lookups ahead for other episodes.
 */
export function createPlayerFirst(): PlayerFirst {
  // How many players have each video, by type and id.
  const held = new Map<string, number>();
  const keyOf = (type: string, id: string) => `${type}:${id}`;

  return {
    put(videos) {
      const keys = Array.from(new Set(videos.map((video) => keyOf(video.type, video.id))));
      keys.forEach((key) => held.set(key, (held.get(key) ?? 0) + 1));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        keys.forEach((key) => {
          const left = (held.get(key) ?? 1) - 1;
          if (left > 0) held.set(key, left);
          else held.delete(key);
        });
      };
    },
    priority: (type, videoId) => (held.has(keyOf(type, videoId)) ? 1 : 0),
  };
}
