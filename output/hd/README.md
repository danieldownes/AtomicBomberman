# HD artwork and QA

The deployed pack is in `../../web/hd/`: 82 animation atlases (2,146 cels), 51 images and
three outline UI fonts. All imagegen edits used the built-in imagegen tool. The original
Retro art stays in `web/data/` and `web/img/`; real people in the credits and the intro
movie retain their original assets in both modes.

`prompts/` contains the generation prompt set, keyed by job ID. Most files preserve the
verbatim tool prompt and generated source path. The two initial title/menu records are
explicitly labelled reconstructed briefs. For `bundle-celebrations-192`, the `-v2` record
is the selected revision; it removes an invented sign from the first generation.

`jobs.json` records packing grids and original frame metadata. The local reference,
generated and packed PNG caches are ignored by Git. `tools/build_hd.cjs` packs those
sources into WebP without changing frame order, logical size or hotspots. Original
animation alpha supplies frame registration; generated pixels supply material detail.
Menu lettering is ordinary text rendered with the bundled Amarante font, whose license
is in `web/data/menu-amarante.LICENSE.txt`.

Run `node tools/test_hd.cjs` from the repository root with `sharp` and `@napi-rs/canvas`
available to regenerate the menu, arena, animation and winner-colour previews. These are
offline native Canvas integration checks. Full-size arena captures are ignored by Git.
The pack is about 32.4 MiB including its manifest and fonts. Its initial switch downloads
about 24.4 MiB; arena graphics are deferred until selected. HTTP compression can reduce
the script/font transfer further.
