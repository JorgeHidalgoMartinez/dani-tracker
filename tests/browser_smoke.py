"""Browser integration checks. All private records below are synthetic and isolated."""
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass


def check(base_url=None):
    server = None
    if not base_url:
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        base_url=f'http://127.0.0.1:{server.server_port}/'
    with sync_playwright() as p:
        executable=shutil.which('chromium') if not os.environ.get('CI') else None
        browser=p.chromium.launch(executable_path=executable,headless=True)
        for width,height in [(1440,1000),(390,844)]:
            context=browser.new_context(viewport={'width':width,'height':height},accept_downloads=True)
            page=context.new_page();errors=[];requests=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:requests.append(request))
            page.goto(base_url,wait_until='networkidle')
            assert page.locator('#mPos').inner_text() != '—'
            assert page.locator('#fixtureRows .statline').count()==34
            assert page.locator('#standings tr').count()==18
            for tab in ['calendario','rival','predicciones','liga','dani','fuentes','inicio']:
                page.locator(f'[data-tab="{tab}"]').click()
                assert page.locator(f'#{tab}').is_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),f'Overflow {width} {tab}'
            page.locator('[data-tab="calendario"]').click()
            page.locator('#fixtureFilter').select_option('played')
            n=page.locator('#fixtureRows .statline').count();assert 0<n<=34
            page.locator('#fixtureFilter').select_option('pending')
            assert page.locator('#fixtureRows .statline').count()==34-n
            page.locator('[data-tab="rival"]').click()
            options=page.locator('#rivalSelect option').all()
            for option in [options[0],options[-1]]:
                page.locator('#rivalSelect').select_option(option.get_attribute('value'))
                assert page.locator('#rivalAnalysis').inner_text()
            page.locator('[data-tab="predicciones"]').click()
            values=page.locator('#rivalForecast .prob b').all_inner_texts()
            assert abs(sum(int(v.split()[0]) for v in values)-100)<=1
            before=page.locator('#rivalForecast').inner_text()
            page.locator('#locationSelect').select_option('away')
            page.locator('#locationSelect').select_option('home')
            assert page.locator('#rivalForecast').inner_text()
            page.locator('[data-tab="dani"]').click()
            assert page.locator('#manualCount').inner_text()=='0'
            assert page.locator('#manualCall').inner_text()=='—'
            page.locator('#inputJ').select_option('1')
            page.locator('#inputStatus').select_option('starter')
            page.locator('#inputMinutes').fill('70');page.locator('#inputGoals').fill('1')
            page.locator('#saveRecord').click()
            assert page.locator('#manualCount').inner_text()=='1'
            page.reload(wait_until='networkidle')
            page.locator('[data-tab="dani"]').click()
            assert page.locator('#manualCount').inner_text()=='1'
            with page.expect_download() as d: page.locator('#exportJSON').click()
            backup=json.loads(Path(d.value.path()).read_text());assert backup['records']['1']['minutes']==70
            page.locator('#inputJ').select_option('1');page.locator('#removeRecord').click()
            assert page.locator('#manualCount').inner_text()=='0'
            page.once('dialog',lambda dialog:dialog.accept())
            page.locator('#importJSON').set_input_files({'name':'synthetic.json','mimeType':'application/json','buffer':json.dumps(backup).encode()})
            page.wait_for_function("document.querySelector('#manualCount').textContent==='1'")
            page.locator('#inputJ').select_option('1');page.locator('#inputStatus').select_option('no')
            page.locator('#inputMinutes').fill('5');page.locator('#saveRecord').click()
            assert 'incoherentes' in page.locator('#saveInfo').inner_text()
            page.route('**/data/snapshot.json*',lambda route:route.fulfill(status=503,body='unavailable'))
            page.locator('#reloadData').click()
            page.wait_for_function("document.querySelector('#dataBanner').textContent.includes('No se ha podido')")
            assert page.locator('#standings tr').count()==18
            assert all(r.method=='GET' for r in requests),'Private data transmitted'
            assert not errors,errors
            context.close()
            print(f'OK navegador {width}×{height}: secciones, datos, filtros, probabilidades, registros, exportación/restauración, fallback y ausencia de envíos privados')
        browser.close()
    if server: server.shutdown()

if __name__=='__main__':
    import sys
    check(sys.argv[1] if len(sys.argv)>1 else None)
