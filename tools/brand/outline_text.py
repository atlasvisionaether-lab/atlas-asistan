import sys, json
sys.path.insert(0, sys.argv[1])
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
font = TTFont(sys.argv[2])
gs = font.getGlyphSet(); cmap = font.getBestCmap(); hmtx = font['hmtx']
upm = font['head'].unitsPerEm
out = {'upm': upm, 'ascender': font['hhea'].ascent, 'descender': font['hhea'].descent, 'words': {}}
for word in sys.argv[3:]:
    pen = SVGPathPen(gs); x = 0
    for ch in word:
        g = cmap.get(ord(ch))
        if g is None: raise SystemExit('eksik glif: ' + ch)
        # y eksenini çevir (SVG aşağı doğru), taban çizgisi 0
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        x += hmtx[g][0]
    out['words'][word] = {'d': pen.getCommands(), 'width': x}
print(json.dumps(out))
