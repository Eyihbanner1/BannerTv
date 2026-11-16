#!/bin/sh
# Makes the journeys' MKV files (file-subtitles.spec.ts) from the 10-minute blank video and
# made-up subtitles (make-text.mjs: test lines only, at seeded times). Each carries a 224 KB
# attachment of zeros, which mkvmerge writes before the video, so the file is long enough for
# its hash to be read and its index and lines lie past its first 64 KB. Needs mkvmerge (run
# with v82.0) and node; run from anywhere:
#   sh apps/webos/e2e/fixtures/mkv/make-mkv.sh
set -eu
# mkvmerge reads its arguments in the locale's encoding: track names are UTF-8.
export LC_ALL=C.UTF-8

here=$(cd "$(dirname "$0")" && pwd)
video="$here/../blank-10min.webm"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

node "$here/make-text.mjs" "$work"
cp "$work/lines.json" "$here/lines.json"
head -c 229376 /dev/zero > "$work/pad.bin"

mux() {
  out="$1"
  shift
  mkvmerge -q --deterministic 20261115 -o "$here/$out" \
    --attachment-mime-type application/octet-stream --attach-file "$work/pad.bin" \
    "$video" "$@"
}

# English SRT (the default), a forced English SRT named Signs, Spanish ASS.
mux own.mkv \
  --language 0:eng --track-name 0:English --default-track-flag 0:yes "$work/english.srt" \
  --language 0:eng --track-name 0:Signs --forced-display-flag 0:yes --default-track-flag 0:no "$work/signs.srt" \
  --language 0:spa --default-track-flag 0:no "$work/spanish.ass"

# The same English track with no index for it: the file's Cues hold the video only.
mux no-index.mkv \
  --cues 0:none --language 0:eng --track-name 0:English "$work/english.srt"

# Picture subtitles only (PGS).
mux pictures.mkv --language 0:eng "$work/pictures.sup"

# Spanish SRT only, on the made-up film's times.
mux spanish.mkv --language 0:spa "$work/spanish.srt"
