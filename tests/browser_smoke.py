"""Optional Playwright browser checks. Provider/audio device are MOCKED in voice scenario.
Run from the repository root: python tests/browser_smoke.py
Dependencies (only for this optional check): Python playwright + installed Chromium.
Never reads .env.local and never connects to AssemblyAI.
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts'
ARTIFACTS.mkdir(exist_ok=True)
PASSWORD = 'browser-only-client-password'
PORT = 3187
BASE = f'http://127.0.0.1:{PORT}'
MOCK_SOCKET = r'''
window.__mockProvider = true;
window.__sentMessages = [];
class MockVoiceSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    super(); this.readyState = 0; this.bufferedAmount = 0;
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.dispatchEvent(new Event('open')); }, 15);
  }
  emit(event) { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  send(raw) {
    const message = JSON.parse(raw);
    if (message.type !== 'input.audio') window.__sentMessages.push(message.type);
    if (message.type === 'session.update') {
      this.emit({ type: 'session.ready', session_id: 'sess_MOCK_BROWSER_TEST' });
      this.emit({ type: 'reply.started', reply_id: 'hello' });
      this.emit({ type: 'reply.audio', data: btoa('\0'.repeat(1920)) });
      this.emit({ type: 'transcript.agent', item_id: 'hello', reply_id: 'hello', text: '[MOCK PROVIDER] Hello from the browser test.' });
      this.emit({ type: 'reply.done', reply_id: 'hello', status: 'completed' });
    } else if (message.type === 'input.audio' && !this.toolRequested) {
      this.toolRequested = true;
      this.emit({ type: 'input.speech.started' });
      this.emit({ type: 'transcript.user.delta', item_id: 'u1', text: 'What services' });
      this.emit({ type: 'transcript.user', item_id: 'u1', text: 'What services do you offer?' });
      this.emit({ type: 'reply.started', reply_id: 'fc-call_e2e' });
      this.emit({ type: 'tool.call', call_id: 'call_e2e', name: 'get_services', arguments: { vehicleId: 'sedan-petrol' } });
      this.emit({ type: 'reply.done', reply_id: 'fc-call_e2e', status: 'completed' });
    } else if (message.type === 'tool.result') {
      this.emit({ type: 'reply.started', reply_id: 'result' });
      this.emit({ type: 'reply.audio', data: btoa('\0'.repeat(1920)) });
      this.emit({ type: 'transcript.agent', item_id: 'a2', reply_id: 'result', text: '[MOCK PROVIDER] The server returned the service catalogue.', interrupted: true });
      this.emit({ type: 'reply.done', reply_id: 'result', status: 'interrupted' });
    } else if (message.type === 'session.end') {
      this.emit({ type: 'session.ended' }); this.close();
    }
  }
  close() { this.readyState = 3; this.dispatchEvent(new CloseEvent('close')); }
}
window.WebSocket = MockVoiceSocket;
'''

def main():
    env = dict(os.environ)
    env.update(PORT=str(PORT), ASSEMBLYAI_API_KEY='', DEMO_CLIENT_PASSWORD=PASSWORD,
               DEMO_ADMIN_PASSWORD='browser-only-admin-password')
    process = subprocess.Popen(['node', 'spikes/voice-access/server.mjs'], cwd=ROOT, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assertions = []
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(BASE + '/api/status', timeout=1).close()
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError('Local browser-test server did not start.')
                time.sleep(.1)
        else:
            raise RuntimeError('Local browser-test server did not become ready.')
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
            args = ['--no-sandbox', '--use-fake-device-for-media-stream']
            browser = p.chromium.launch(headless=True, executable_path=executable, args=args)
            context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True,
                                          permissions=['microphone'])
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until='networkidle')
            expect(page.get_by_role('heading', name='First, make the conversation work.')).to_be_visible()
            expect(page.locator('#start')).to_be_disabled()
            assertions.append('Page loads; voice is disabled without a key.')
            page.fill('#password', 'wrong-password')
            page.click('#login-button')
            expect(page.locator('#error')).to_contain_text('Incorrect demo username')
            assertions.append('Incorrect credentials show a safe error.')
            page.fill('#password', PASSWORD)
            page.click('#login-button')
            expect(page.locator('#auth-status')).to_contain_text('Signed in as client')
            page.click('#catalog-check')
            expect(page.locator('.catalog-row')).to_have_count(4)
            expect(page.locator('#catalog')).to_contain_text('15,000 KZT')
            expect(page.locator('#check-tool .check-status')).to_have_text('Waiting')
            assertions.append('Manual catalogue check uses the server and does not mark voice verification complete.')
            page.select_option('#vehicle', 'ev-demo')
            page.click('#catalog-check')
            expect(page.locator('.catalog-row')).to_have_count(3)
            assert 'Oil change' not in page.locator('#catalog').inner_text()
            assertions.append('EV compatibility filters out oil change.')
            page.select_option('#vehicle', '')
            page.click('#catalog-check')
            expect(page.locator('.catalog-row')).to_have_count(4)
            page.screenshot(path=str(ARTIFACTS / 'desktop-local-no-key.png'), full_page=True)
            with page.expect_download() as event:
                page.click('#export-report')
            exported = ARTIFACTS / 'browser-export-no-key.json'
            event.value.save_as(exported)
            report = json.loads(exported.read_text())
            assert report['evidence']['providerReady'] is False
            assert PASSWORD not in exported.read_text()
            assert 'transcript text' in report['excludes']
            assertions.append('Evidence export contains no credentials or fabricated live success.')
            page.reload(wait_until='networkidle')
            expect(page.locator('#auth-status')).to_contain_text('Signed in as client')
            assertions.append('Demo sign-in survives page refresh.')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(ARTIFACTS / 'mobile-local-no-key.png'), full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            assertions.append('Mobile layout has no horizontal overflow at 390 px.')
            page.set_viewport_size({'width': 1440, 'height': 1100})
            # The voice test uses an explicit browser-only fake provider + fake microphone.
            # Production source has no mock-provider switch. No provider network request is made.
            page.add_init_script(MOCK_SOCKET)
            def status_fixture(route):
                response = route.fetch()
                payload = response.json()
                payload['apiKeyConfigured'] = True
                route.fulfill(response=response, json=payload)
            page.route('**/api/status', status_fixture)
            page.route('**/api/voice/token', lambda route: route.fulfill(json={
                'token': 'MOCK_BROWSER_ONLY_TOKEN', 'websocketUrl': 'wss://agents.assemblyai.com/v1/ws',
                'maxSessionSeconds': 180, 'expiresInSeconds': 60,
                'session': {'system_prompt': 'Mock fixture', 'tools': [], 'input': {'language_codes': ['en']}, 'output': {'voice': 'alba'}}
            }))
            page.reload(wait_until='networkidle')
            page.check('#consent')
            page.click('#start')
            expect(page.locator('#progress')).to_have_text('5 / 5', timeout=15000)
            expect(page.locator('#gate-status')).to_have_text('Events observed. Confirm the two human audio checks.')
            assert not page.locator('#heard-audio').is_checked()
            assert not page.locator('#heard-stop').is_checked()
            expect(page.locator('.catalog-row')).to_have_count(4)
            expect(page.locator('#transcript')).to_contain_text('[MOCK PROVIDER]')
            assertions.append('MOCK provider: AudioWorklets, protocol, server tool round-trip, transcript and interruption indicators work; human checks remain unchecked.')
            page.click('#start')
            expect(page.locator('#connection-status')).to_have_text('Not connected')
            assert 'session.end' in page.evaluate('window.__sentMessages')
            assertions.append('MOCK provider: Stop sends session.end and stops the UI connection.')
            assert not errors, errors
            assertions.append('No uncaught browser JavaScript errors during these checks.')
            browser.close()
        result = {'checksPassed': len(assertions), 'checks': assertions, 'liveAssemblyAIVerified': False,
                  'realMicrophoneVerified': False, 'providerFixture': 'Explicit browser test only', 'browserErrors': errors}
        (ARTIFACTS / 'browser-results.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

if __name__ == '__main__':
    main()
