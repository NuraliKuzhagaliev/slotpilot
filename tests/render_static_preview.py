"""Offline layout rendering only. This does not verify the running web application."""
from pathlib import Path
import json
import shutil
import os
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
public = root / 'spikes/voice-access/public'
out = root / 'artifacts'
out.mkdir(exist_ok=True)
html = (public / 'index.html').read_text()
css = (public / 'style.css').read_text()
html = html.replace('<link rel="stylesheet" href="/style.css"><script type="module" src="/app.mjs"></script>', f'<style>{css}</style>')
html = html.replace('<section class="setup-notice" id="setup-notice" role="status" hidden></section>', '<section class="setup-notice" id="setup-notice" role="status">Static layout preview only. No running browser integration or live voice has been verified here.</section>')
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
    page = browser.new_page()
    for label, width, height in [('desktop',1440,1100),('mobile',390,844)]:
        page.set_viewport_size({'width':width,'height':height})
        page.set_content(html)
        assert page.locator('h1').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(out / f'{label}-static-preview.png'), full_page=True)
        results.append({'viewport':label,'width':width,'horizontalOverflow':False,'kind':'static HTML/CSS render only'})
    browser.close()
(out / 'static-layout-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
