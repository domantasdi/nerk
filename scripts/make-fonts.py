"""Build the bundled Lato TTFs from the lato-font package (Lato 2.0, SIL OFL).

Lato 2.0 is used instead of the Google Fonts build because the latter lacks
Lithuanian letters such as ė, į and ų. Fonts are subset to Latin-1 + Latin
Extended-A and converted to TrueType, because PDFs cannot embed WOFF/WOFF2.
Run after `npm install`:
    pip install fonttools brotli && python3 scripts/make-fonts.py
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = Path('node_modules/lato-font/fonts')
OUT = Path('src/assets/fonts')
OUT.mkdir(parents=True, exist_ok=True)
UNICODES = [*range(0x20, 0x7F), *range(0xA0, 0x180), *range(0x2010, 0x2030), 0x2039, 0x203A, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2195, 0x2212, 0x2715]

for weight, name in (('400', 'lato-normal'), ('700', 'lato-bold')):
    font = TTFont(SRC / name / f'{name}.woff')
    opts = subset.Options()
    opts.flavor = None
    opts.layout_features = ['kern', 'liga']
    opts.name_IDs = ['*']
    opts.hinting = False
    s = subset.Subsetter(opts)
    s.populate(unicodes=UNICODES)
    s.subset(font)
    font.flavor = None
    dest = OUT / f'lato-{weight}.ttf'
    font.save(dest)
    print(dest, dest.stat().st_size, 'bytes')
