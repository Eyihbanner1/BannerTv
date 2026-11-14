#!/bin/sh
# Makes the Matroska test files from a synthetic picture (ffmpeg's lavfi
# testsrc, 32x18 at 10 frames a second) and the synthetic subtitle files in
# text/. No sound, no real film or show. Needs ffmpeg and mkvmerge (run with
# ffmpeg 6.1.1 and mkvmerge v82.0); run from anywhere:
#   sh packages/core/src/media/fixtures/make-fixtures.sh
# The files differ from run to run only in the UIDs and dates the muxers
# write, which the tests do not read.
set -eu
# mkvmerge reads its arguments in the locale's encoding: track names are UTF-8.
export LC_ALL=C.UTF-8

here=$(cd "$(dirname "$0")" && pwd)
text="$here/text"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

video() {
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc=size=32x18:rate=10" -t "$1" \
    -c:v libx264 -preset veryslow -crf 45 -threads 1 -pix_fmt yuv420p \
    -x264-params keyint=20:min-keyint=20:scenecut=0 "$2"
}

video 60 "$work/v60.mkv"
video 20 "$work/v20.mkv"
video 10 "$work/v10.mkv"

# mkvmerge: SRT, a forced SRT, ASS (with a BCP 47 language), SSA marked for
# the hard of hearing, WebVTT (settings in BlockAdditions).
mkvmerge -q -o "$here/mkvmerge.mkv" "$work/v60.mkv" \
  --language 0:eng --track-name 0:English --default-track-flag 0:yes "$text/eng.srt" \
  --language 0:eng --track-name 0:Signs --forced-display-flag 0:yes --default-track-flag 0:no "$text/signs.srt" \
  --language 0:fr-CA --track-name '0:Français' --default-track-flag 0:no "$text/fre.ass" \
  --language 0:ger --hearing-impaired-flag 0:yes --default-track-flag 0:no "$text/ger.ssa" \
  --language 0:spa --default-track-flag 0:no "$text/spa.vtt"

# ffmpeg: SRT, ASS marked forced, WebVTT (as WebM's D_WEBVTT/SUBTITLES). Its
# Clusters start with a CRC-32 and size themselves as small as they can.
ffmpeg -hide_banner -loglevel error -y -i "$work/v60.mkv" -i "$text/eng.srt" -i "$text/fre.ass" \
  -i "$text/spa.vtt" -map 0 -map 1 -map 2 -map 3 -c copy \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title=English \
  -metadata:s:s:1 language=fre -disposition:s:1 forced \
  -metadata:s:s:2 language=spa "$here/ffmpeg.mkv"

# zlib-compressed SRT.
mkvmerge -q -o "$here/zlib.mkv" "$work/v20.mkv" --language 0:eng --compression 0:zlib "$text/eng.srt"

# A second SeekHead at the end, which the first points to (it lists the Clusters).
mkvmerge -q -o "$here/seekhead.mkv" --clusters-in-meta-seek "$work/v20.mkv" --language 0:eng "$text/eng.srt"

# Cues as muxers before 2013 wrote them: video only, no CueRelativePosition.
mkvmerge -q -o "$here/old-cues.mkv" --engage no_cue_relative_position --engage no_cue_duration \
  "$work/v20.mkv" --cues 0:none --language 0:eng "$text/eng.srt"

# A current muxer told not to index the subtitles: video-only Cues with relative positions.
mkvmerge -q -o "$here/video-cues.mkv" "$work/v20.mkv" --cues 0:none --language 0:eng "$text/eng.srt"

# Written to a pipe, as a live recording is: no Cues, sizes unknown.
ffmpeg -hide_banner -loglevel error -y -i "$work/v10.mkv" -i "$text/eng.srt" -map 0 -map 1 -c copy \
  -f matroska pipe:1 >"$here/live.mkv"

ls -l "$here"/*.mkv
