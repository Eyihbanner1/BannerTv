# Long HLS fixture

Ten minutes of black at 160x90 and one frame a second (VP9, no audio) in ten fMP4 segments of a minute, and one French WebVTT subtitle rendition in a single segment. The playback journeys serve it at `https://media.example.com/hls-long/master.m3u8`; its subtitle rendition sends it to hls.js. It is long enough for subtitle files to be judged against it, and for its French track to be the reference other files are lined up against.

`subs-fr.vtt` is not here: the journeys' mock writes it from synthetic timings (`HLS_LONG_FRENCH` in `../../play.ts`), with made-up text.

Made with:

```sh
ffmpeg -f lavfi -i "color=c=black:s=160x90:r=1:d=600" -c:v libvpx-vp9 -b:v 8k -deadline realtime -cpu-used 8 -g 60 -an \
  -f hls -hls_time 60 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init_0.mp4 \
  -hls_segment_filename 's0_%03d.m4s' p0.m3u8
```

`master.m3u8` and `subs-fr.m3u8` were then written by hand, to add the subtitle rendition and the `CODECS` attribute.
