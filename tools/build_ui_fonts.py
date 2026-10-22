"""Build the menu font script, a text-free Retro menu background, and HD mode's text font script.
Requires Pillow. The fonts are vendored: Amarante (menu) and Chakra Petch (HD text), both SIL OFL.
"""
from pathlib import Path
import json, base64
from PIL import Image
ROOT = Path(__file__).resolve().parent.parent
# FontFace receives bytes so a copy opened directly from disk also has the proper menu font.
(ROOT/'web/data/menufont.js').write_text('window.AB_MENUFONT=' + json.dumps(base64.b64encode((ROOT/'web/data/menu-amarante.ttf').read_bytes()).decode()) + ';\n')
# Preserve the original portrait and spark trail; erase only the old menu labels.
im = Image.open(ROOT/'web/img/mainmenu.png').convert('RGB')
patch = im.crop((340,376,640,406))
for top in [114,150,187,225,261,298,335]: im.paste(patch,(340,top-4))
im.save(ROOT/'web/img/mainmenu-clean.png',optimize=True)

# HD text: Chakra Petch (its cut corners echo the original bitmap fonts) instead of scaled bitmap
# letters. Script-wrapped like the menu font, so a copy opened from disk has it too (js/gfx.js).
ui = {w: base64.b64encode((ROOT/f'web/data/ui-chakra-petch-{w}.woff2').read_bytes()).decode() for w in (600, 700)}
(ROOT/'web/data/uifont.js').write_text('window.AB_UIFONT=' + json.dumps(ui) + ';\n')
