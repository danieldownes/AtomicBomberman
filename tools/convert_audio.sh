#!/bin/bash
# Convert the .RSS sounds (raw 22050 Hz, 16-bit signed, stereo, little-endian) to MP3.
# usage: convert_audio.sh <extracted>/DATA/SOUND <web>/audio
SND="$1"; OUT="$2"; mkdir -p "$OUT/music" "$OUT/sfx_mp3"
MUSIC="TITLE MENU WIN LOSE NETWORK GRNACRES GENERIC HOCKEY PYRAMID MINESHFT BATTLE GIEGER HAUNTED OCEAN SWAMP SEWER DRAW"
for m in $MUSIC; do
  ffmpeg -nostdin -loglevel error -y -f s16le -ar 22050 -ac 2 -i "$SND/$m.RSS" -c:a libmp3lame -b:a 96k "$OUT/music/$(echo $m | tr A-Z a-z).mp3"
done
# sound effects referenced by DATA/RES/SOUNDLST.RES
grep -E '^[0-9]+,' "$SND/../RES/SOUNDLST.RES" | tr -d '\r' | sed 's/;.*//' | cut -d, -f2 | tr -d ' \t' | tr a-z A-Z | sort -u | while read n; do
  [ -f "$SND/$n.RSS" ] || continue
  case " $MUSIC " in *" $n "*) continue;; esac
  ffmpeg -nostdin -loglevel error -y -f s16le -ar 22050 -ac 2 -i "$SND/$n.RSS" -c:a libmp3lame -b:a 64k "$OUT/sfx_mp3/$(echo $n | tr A-Z a-z).mp3"
done
python3 "$(dirname "$0")/build_sfx_pack.py" "$OUT/sfx_mp3" "$OUT/sfx.js"
