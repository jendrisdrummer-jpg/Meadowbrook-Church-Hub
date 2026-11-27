"""Optional: redraws the app icon (1024) and splash (2732) from the hub's own cross icon
(public/icons/icon-512.png is a flat blue square with a white cross, so it is redrawn crisp at full size).
Needs Pillow. The results are already committed under ios/; run this only to change the look.
Usage: python3 scripts/make-assets.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

here = Path(__file__).resolve().parent.parent
brand = json.loads((here / 'church.config.json').read_text())['colors']['brand']
set_dir = here / 'ios/App/App/Assets.xcassets'


def cross(size, scale):
    img = Image.new('RGB', (size, size), brand)  # opaque: App Store icons may not have transparency
    d = ImageDraw.Draw(img)
    u = size * scale / 512  # the source cross: 60 wide, 274 tall, 228 across, centred
    c = size / 2
    d.rectangle([c - 30 * u, c - 128 * u, c + 30 * u, c + 146 * u], fill='white')
    d.rectangle([c - 114 * u, c - 44 * u, c + 114 * u, c + 16 * u], fill='white')
    return img


cross(1024, 1).save(set_dir / 'AppIcon.appiconset/AppIcon-512@2x.png')
splash = cross(2732, 0.9)
for n in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    splash.save(set_dir / 'Splash.imageset' / n)
print('done')
