"""Build index.html (GitHub Pages, offline) and dist/artifact.html (claude.ai) from src/."""
import pathlib, sys
root = pathlib.Path(__file__).parent
app = (root / 'src/app.html').read_text(encoding='utf8')
tail = "\nload();render();setView(location.hash==='#stats'?'stats':'game');\n</script>\n"
assert tail in app

def js(name):
    return (root / 'src' / name).read_text(encoding='utf8')

# GitHub Pages
s = app.replace('<!--EXTRA-->', js('backup.html')).replace(tail, tail[:-10] + js('offline.js') + '</script>\n')
i = s.index('</style>') + len('</style>')
head = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Яцзы">
<link rel="apple-touch-icon" href="icon.png">
<link rel="icon" href="icon.png">
'''
reset = '\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n</head><body>'
(root / 'index.html').write_text(head + s[:i] + reset + s[i:] + '</body></html>\n', encoding='utf8')

# claude.ai artifact
a = app.replace('<!--EXTRA-->', '').replace(tail, tail[:-10] + js('cloud.js') + '</script>\n')
a = a.replace('<title>Блокнот Яцзы</title>\n', '<title>Блокнот Яцзы</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n', 1)
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/artifact.html'
out.parent.mkdir(exist_ok=True)
out.write_text(a, encoding='utf8')
