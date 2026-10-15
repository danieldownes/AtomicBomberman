# Conversion tools

These are the scripts used to build `../web` from the CD. They need Python 3 with Pillow and
pycdlib, plus ffmpeg.

1. Extract the CD: `python extract_iso.py ../AtomicBomberman.iso ../extracted`
2. Build the game data, sprites, fonts and pictures:
   * `python build_data.py ../extracted ../web/data`
   * `python build_sprites.py ../extracted ../web`
3. Convert the audio: `bash convert_audio.sh ../extracted/DATA/SOUND ../web/audio`
4. Sounds: convert the unused `.RSS` clips to MP3 in a folder too, then
   * `python build_voices.py ../extracted/DATA/RES/SOUNDLST.RES voice_transcripts.json <unused mp3 folder> voices_classified.js <scratch>/pack.js`
     sorts the unused takes into events and writes the uncensored and child-friendly lists. Ignore
     `pack.js` and the `voices_report.json` it also writes.
   * `python build_sounds.py ../extracted/DATA/RES/SOUNDLST.RES voice_transcripts.json voices_classified.js <sfx mp3 folder> <unused mp3 folder> ../web`
     writes `data/sounds.js` (events > phrases > takes) and one `audio/clips/<name>.js` per clip.
5. Port additions:
   * `python build_campaigns.py ../extracted/DATA/RES ../web` converts the campaign stages (`*.CAM`).
   * `python build_classic.py ../web` draws the Classic arena (`data/classic.js`, `img/field11.png`).
     `python make_chiptune.py classic.wav` writes its music; encode that to `audio/music/classic.mp3`.
   * `python build_menu_image.py ../web/img/mainmenu.png ../web/img/mainmenu_port.png` relabels
     the main menu ("Campaign Mode", "Network Game") using letters cut from the picture itself.
   * The intro: `INTRO/BMINTRO.EXE` on the CD has an Interplay MVE movie starting at byte 52850.
     Cut it out and re-encode it with ffmpeg:
     * `ffmpeg -i bmintro.mve -c:v libvpx-vp9 -crf 30 -b:v 0 -c:a libopus intro.webm`
     * `ffmpeg -i bmintro.mve -c:v libx264 -crf 17 -c:a aac intro.mp4`

About the voice files:

* `voice_transcripts.json` has a Whisper transcript for every `.RSS` clip. They were made with
  `whisper_stt.py`, which needs sherpa-onnx and the Whisper base.en model. The transcripts are
  approximate.
* `VOICE_LINES.csv` lists every clip with:
  * whether the shipped game uses it;
  * the category it is filed under;
  * which voice modes play it;
  * whether the Child friendly mode removes it;
  * its transcript.
* `build_voices.py` holds the rules that file each clip under a category and pick the
  uncensored and child-friendly sets. To change what Child friendly removes, edit
  `CHILD_RE`, `CHILD_LINES`, `CHILD_NAMES` or `KEEP_CHILD` there.

To inspect the files:

* `anidump.py` / `aniseq.py <file.ani>` dump the chunk and sequence structure of an `.ANI` file.
* `anilib.py` is the `.ANI` decoder: `CHFILEANI` header, `FRAM`/`CIMG` 16-bit RLE images, and
  `SEQ`/`STAT` sequences.
* `fon.py` decodes the `.FON` bitmap fonts.

To redo the decompilation (needs `angr`, `r2pipe` and radare2):

* `decomp_all.py` writes every function of `BM95.EXE` to pseudo-C.
* `valuemap.py` maps each `VALUELST.RES` id to the functions that read it.

Paths inside the scripts may need adjusting.
