# Conversion tools

These are the scripts used to build `../web` from the CD. They need Python 3 with Pillow and
pycdlib, plus ffmpeg. The victory-art build also needs Node.js with `sharp` available to it.

1. Extract the CD: `python extract_iso.py ../AtomicBomberman.iso ../extracted`
2. Build the game data, sprites, fonts and pictures:
   * `python build_data.py ../extracted ../web/data`
   * `python build_sprites.py ../extracted ../web`
   * `node build_victory.cjs` builds one victory scene and its colour masks from the original
     variants exported to `../output/victory/source` by `build_sprites.py`.
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
   * `python tools/build_music_loops.py` (from the repository root) writes `audio/music/<name>.js`
     for the seamlessly looped tracks, so they loop from disk (file://) too; `--measure` (ffmpeg,
     numpy, scipy) prints where each track's opening comes round again (`AB.audio.MUSIC_LOOPS`).
   * `python build_ui_fonts.py` (from the repository root; Pillow, numpy and fontTools required)
     embeds the vendored Amarante menu font, removes the old lettering from the Retro menu
     background, and embeds the vendored Chakra Petch (600 and 700, Latin, from
     `@fontsource/chakra-petch`) as `data/uifont.js`, HD mode's text font.
     Menu labels and their actions live together in `web/js/screens.js`.
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

* `node tools/test_hd.cjs` (from the repository root, with `@napi-rs/canvas` and `sharp` available)
  checks the Retro default, zero HD requests on Retro boot, menu toggle and persistence,
  loading progress, cancellation, failure/retry, complete frame/image coverage, source sizes,
  per-arena lazy loading and unchanged simulation. It renders menu, arena and winner-colour
  previews into `output/hd/` using native Canvas, entirely offline.
* The optional HD pack is in `web/hd/`. `output/hd/jobs.json` records imagegen jobs and
  `output/hd/prompts/` records their prompts. `node tools/build_hd.cjs accept ID IMAGE.png`
  copies a generated image into the local build cache, registers animation cels against the
  original silhouettes, and packs WebP assets without changing frame rectangles or hotspots.
  `node tools/build_hd.cjs repack` rebuilds accepted jobs from that cache;
  `node tools/build_hd.cjs manifest` refreshes the catalog and derived power-up icons/masks.
  The manifest is a script so both HTTP and `file://` work. It includes HD font bytes and
  byte weights for progress reporting, and marks arena assets for deferred loading.
  `ORIGINAL` in `build_hd.cjs` lists what stays original in HD: Classic, and the remasters that
  came out wrong. `python tools/check_hd_cels.py` compares every HD frame (including left-out
  atlases still in `web/hd/atlases`), scaled back down, with the CD's frame: it ranks them in
  `output/hd/check-cels.txt` and draws the 60 worst side by side in `output/hd/check-cels.png`
  (`--worst 120` for more). `python tools/check_hd_cels.py zen kick` draws every frame of those
  atlases, original above HD, into `output/hd/check-<name>.png`. Scores find candidates; look.
  `python tools/build_bomb_transforms.py` fits the biggest bomb frame onto each of the CD's bomb
  frames (scale, lean, shift) and prints the `BOMB_XF` table `js/render.js` draws HD bombs with.
  `manifest` also runs `node tools/build_pixel_scripts.cjs`: opened from disk, Chrome won't let
  the game read a picture file's pixels, which recolouring needs, so each recoloured atlas and
  the victory pictures (HD and Retro) also come as `<picture>.js` holding a data: URL, loaded
  only from file:// (`AB.gfx.readableSrc`). `build_victory.cjs` runs it too.
  Reference/generated/packed PNG build caches are ignored by Git. Keep those local sources
  if you want to repack later; the generated runtime WebPs are the deployed deliverables.

  Repairs use `python tools/align_hd.py <atlas>` (numpy and Pillow): fit each **whole** generated
  cell before cropping, without painting the original RGB beneath a misplaced figure. Review
  the comparisons in `output/hd/repair/`; scores are diagnostics, not approval. For genuinely
  wrong poses, `prepare_hd_repairs.py <atlas> <1-4 frame numbers>` creates widely padded imagegen
  references and `accept_hd_repair.py <job-id>` registers their replacements as candidates.
  `align_hd.py --gallery <atlas>` refreshes comparisons after replacement. Candidates do not
  enable themselves. `promote_hd_repairs.py` contains the explicit reviewed selection and packs
  it into retained PNG sources under `output/hd/repairs/`, indexed by `repairs.json`. These take
  precedence during `manifest` and `repack`, so old generation pages cannot undo the repairs.
  The conveyor uses one shared material with the original stripe phases. The Aliens wall and
  four wobble/fall cels have new imagegen artwork; prompts are under `output/hd/prompts/repair-*`.
  `repair_hd_flames.py prepare|accept` builds five connected blast references and slices the
  new imagegen results at the original frame offsets, avoiding independently generated joins.
  The meditation and head-polishing idles, plus `xplode2/3/4/10/12/14/16`, still fail pose review
  and retain the original animations. Do not remove their fallback entries based on score alone.
  `node tools/preview_hd_repairs.cjs` renders the repair gallery and playback frames offline.

* `node tools/test_victory.cjs` (from the repository root, with `@napi-rs/canvas` available)
  checks runner-up selection, score ties, both scoring modes, teams, independent recolouring,
  preserved background/display pixels, all 100 colour pairs, cached rendering and loading
  recovery. It writes six full-size previews and `output/victory/colour-combinations.png`.
* `node tools/build_victory.cjs` regenerates `web/img/victory-base.png` and `victory-mask.png`
  from `output/victory/source/` (requires `sharp`). The base is the original green/blue scene.
  The mask's R/G channels select winner/loser material indices; its bottom ten rows hold RGB
  palette tables, winners at columns 0-255 and losers at 256-511. Winner colours use the CD's
  ten original palettes. Loser colours retain the original white/red/blue references and derive
  the remaining colours from the white suit's shading. The runtime caches up to four colour
  pairs. Original reference PNGs stay outside the deployed `web/` folder.

* `node tools/build_favicon.cjs` exports `output/favicon/green-bomberman-master.png` into the
  green PNG favicons, a 16/32/48 px ICO, and the 180/192/512 px home-screen icons. It requires
  `sharp` and `@napi-rs/canvas` on Node's module path. The master was generated with the built-in
  imagegen tool from the game's title/victory artwork; its prompt and a light/dark preview at
  actual tab sizes are in `output/favicon/`. Transparency is preserved in all icon sizes.

* `node tools/test_tilesets.cjs` (from the repository root, with `@napi-rs/canvas` available to
  Node) checks that the original arenas still draw exactly as with the renderer in commit
  `c77e4b4`, that drawing Bedrock never changes the simulation, that Bedrock is in the Arenas list
  and gets picked, and that a failed texture download falls back to Green Acres' terrain and is
  retried next round. It also renders game/menu/destruction PNG previews into `output/tilesets/`,
  entirely offline. Keep the reference commit in the local Git history when running this check.
* The Bedrock textures are in `web/img/tilesets/bedrock/textures.png`: three 40 x 36 panels side by
  side (grass, bedrock, grass-topped dirt), the size of the original arenas' tiles, so the game
  draws them 1:1 (9 KB). They were box-filtered down from the generated 2172 x 724 sheet in
  `output/tilesets/bedrock-textures-source.png`, with the colours made more vivid (saturation
  x1.4, contrast x1.08, brightness x1.04). Runtime code in `web/js/tilesets.js` caches the floor,
  border, blocks and nine break frames from it.
  The concept sheet and exact generation prompts are in `output/tilesets/`. Rebuilding CD assets
  does not replace these files. For a direct art review, append `?test=1&level=12` to the game
  URL (Bedrock is arena 12, counting from 0).

* `anidump.py` / `aniseq.py <file.ani>` dump the chunk and sequence structure of an `.ANI` file.
* `anilib.py` is the `.ANI` decoder: `CHFILEANI` header, `FRAM`/`CIMG` 16-bit RLE images, and
  `SEQ`/`STAT` sequences.
* `fon.py` decodes the `.FON` bitmap fonts.

To redo the decompilation (needs `angr`, `r2pipe` and radare2):

* `decomp_all.py` writes every function of `BM95.EXE` to pseudo-C.
* `valuemap.py` maps each `VALUELST.RES` id to the functions that read it.

Paths inside the scripts may need adjusting.
