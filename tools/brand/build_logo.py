import json, sys, os
O = json.load(open(sys.argv[1])); out = sys.argv[2]

def mark(prefix, animated, static_small=False):
    p = prefix
    sw = 1.0 if not static_small else 2.1   # favicon: daha kalın çizgi
    faint = '' if static_small else None
    anim = ''
    if animated:
        anim = f'''<style>
  .{p}-star{{transform-origin:32px 12px;animation:{p}-tw 3.6s ease-in-out infinite}}
  .{p}-sat{{animation:{p}-pulse 3.6s ease-in-out infinite}}
  @keyframes {p}-tw{{0%,100%{{transform:scale(1) rotate(0deg);opacity:1}}50%{{transform:scale(.78) rotate(45deg);opacity:.82}}}}
  @keyframes {p}-pulse{{0%,100%{{opacity:1}}50%{{opacity:.45}}}}
  @media (prefers-reduced-motion:reduce){{.{p}-star,.{p}-sat{{animation:none}}}}
</style>'''
    return f'''<defs>
    <linearGradient id="{p}-gold" x1="20" y1="8" x2="44" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff7d6"/><stop offset=".38" stop-color="#fde68a"/><stop offset=".72" stop-color="#fbbf24"/><stop offset="1" stop-color="#f59e0b"/>
    </linearGradient>
    <linearGradient id="{p}-sphere" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fde68a"/><stop offset=".55" stop-color="#fbbf24" stop-opacity=".75"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="{p}-orbit" x1="3" y1="43" x2="61" y2="29" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22d3ee" stop-opacity=".2"/><stop offset=".55" stop-color="#67e8f9"/><stop offset="1" stop-color="#a5f3fc" stop-opacity=".55"/>
    </linearGradient>
    <radialGradient id="{p}-core" cx="32" cy="30" r="27" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#312e81" stop-opacity=".55"/><stop offset=".7" stop-color="#0b0620" stop-opacity=".35"/><stop offset="1" stop-color="#0b0620" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="{p}-starfill" cx="32" cy="12" r="7.5" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#fff7d6"/><stop offset="1" stop-color="#fbbf24"/>
    </radialGradient>
  </defs>{anim}
  <circle cx="32" cy="32" r="26" fill="url(#{p}-core)"/>{'' if static_small else f'''
  <ellipse cx="32" cy="32" rx="11" ry="26" fill="none" stroke="#fde68a" stroke-opacity=".3" stroke-width="{0.8*sw:.2f}"/>
  <ellipse cx="32" cy="32" rx="26" ry="7.5" fill="none" stroke="#fde68a" stroke-opacity=".22" stroke-width="{0.8*sw:.2f}"/>
  <path d="M2.89 43.26 A30 8.5 -14 0 1 61.11 28.74" fill="none" stroke="url(#{p}-orbit)" stroke-opacity=".55" stroke-width="{1.4*sw:.2f}" stroke-linecap="round"/>'''}
  <circle cx="32" cy="32" r="26" fill="none" stroke="url(#{p}-sphere)" stroke-width="{1.6*sw:.2f}"/>
  <path d="M32 13 L19 49 M32 13 L45 49" fill="none" stroke="url(#{p}-gold)" stroke-width="{2.6*sw:.2f}" stroke-linecap="round"/>
  <path d="M61.11 28.74 A30 8.5 -14 0 1 2.89 43.26" fill="none" stroke="url(#{p}-orbit)" stroke-width="{1.7*sw:.2f}" stroke-linecap="round"/>
  <circle cx="19" cy="49" r="{2.1*min(sw,1.3):.2f}" fill="#a5f3fc"/>
  <circle cx="45" cy="49" r="{2.1*min(sw,1.3):.2f}" fill="#a5f3fc"/>
  <circle class="{p}-sat" cx="48.33" cy="39.51" r="{1.9*min(sw,1.3):.2f}" fill="#67e8f9"/>
  <path class="{p}-star" d="M32 4.2 L33.7 10.3 L39.8 12 L33.7 13.7 L32 19.8 L30.3 13.7 L24.2 12 L30.3 10.3 Z" fill="url(#{p}-starfill)"/>'''

HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
COMMENT = '<!-- Atlas Asistan — marka işareti. Gök küresi (yıldız haritası) + takımyıldızı "A" + yapay zekâ yörüngesi; tepede yıldız. Altın/cyan, koyu zemin için. -->\n'

def svg(vb, w, h, body, label):
    return HEAD + COMMENT + f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img" aria-label="{label}">\n  <title>{label}</title>\n  {body}\n</svg>\n'

# 1) İşaret (canlandırmalı)
open(os.path.join(out, 'atlas-mark.svg'), 'w').write(svg('0 0 64 64', 64, 64, mark('am', True), 'Atlas Asistan'))
# 2) Favicon (sabit, kalın çizgi, koyu zemin dairesi)
fav = '<circle cx="32" cy="32" r="31" fill="#07041a"/>\n  ' + mark('af', False, static_small=True)
open(os.path.join(out, 'atlas-favicon.svg'), 'w').write(svg('0 0 64 64', 64, 64, fav, 'Atlas Asistan'))
# 3) Yatay logo: işaret + "Atlas Asistan" (Fraunces 600, yollara çevrilmiş)
upm = O['upm']; size = 30.0; k = size / upm
w_atlas = O['words']['Atlas']['width'] * k; w_asistan = O['words']['Asistan']['width'] * k
gap_mark, gap_word = 14.0, size * 0.26
x0 = 64 + gap_mark; baseline = 42.6
x1 = x0 + w_atlas + gap_word
total = x1 + w_asistan + 2
text = f'''<defs><linearGradient id="al-word" x1="{x1:.1f}" y1="20" x2="{x1 + w_asistan:.1f}" y2="44" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff7d6"/><stop offset=".45" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
  <path transform="translate({x0:.2f} {baseline}) scale({k:.6f})" fill="#f5f2ff" d="{O['words']['Atlas']['d']}"/>
  <path transform="translate({x1:.2f} {baseline}) scale({k:.6f})" fill="url(#al-word)" d="{O['words']['Asistan']['d']}"/>'''
open(os.path.join(out, 'atlas-logo.svg'), 'w').write(svg(f'0 0 {total:.1f} 64', round(total), 64, mark('al', True) + '\n  ' + text, 'Atlas Asistan'))
print('logo genişliği', round(total, 1))
