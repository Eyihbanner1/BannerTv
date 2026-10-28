# HLS fixture

Ten seconds of black at 160x90 (VP9) with two sine-tone audio renditions (English 440 Hz, French 660 Hz, Opus) in fMP4 segments, and one English WebVTT subtitle rendition. The playback journeys serve it at `https://media.example.com/hls/master.m3u8`; its alternates send it to hls.js. VP9 and Opus because the test Chromium has no H.264 or AAC.

Made with:

```sh
printf 'WEBVTT\n\n00:00:00.200 --> 00:00:09.800\nHello from the stream\n' > subs-en.vtt
ffmpeg -f lavfi -i "color=c=black:s=160x90:r=10:d=10" -f lavfi -i "sine=f=440:d=10" -f lavfi -i "sine=f=660:d=10" \
  -map 0:v -map 1:a -map 2:a -c:v libvpx-vp9 -b:v 50k -deadline realtime -cpu-used 8 -g 20 \
  -c:a libopus -b:a 24k -ac 1 -metadata:s:a:0 language=eng -metadata:s:a:1 language=fre \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -master_pl_name master.m3u8 \
  -var_stream_map "v:0,agroup:aud a:0,agroup:aud,language:eng,name:English,default:yes a:1,agroup:aud,language:fre,name:French" \
  -hls_segment_filename 's%v_%03d.m4s' p%v.m3u8
```

`master.m3u8` and `subs-en.m3u8` were then written by hand, to add the subtitle rendition and the `CODECS` attribute.
