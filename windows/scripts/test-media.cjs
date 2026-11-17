'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-media-'));
let app;
(async () => {
  try {
    app = await electron.launch({ args: [root, '--use-fake-device-for-media-stream',
      ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: directory }, timeout: 60000 });
    const page = await app.firstWindow(); await page.waitForSelector('#reload');
    await app.evaluate(({ session, dialog }) => {
      // The production handlers still enforce origin, media type, and consent.
      dialog.showMessageBox = async () => ({ response: 0 });
      session.fromPartition('persist:milo-chat').protocol.handle('https', () => new Response('<!doctype html><title>Audio integration test</title>', { headers: { 'content-type': 'text/html' } }));
    });
    await page.locator('#reload').click();
    await page.waitForFunction(() => document.querySelector('#connection').textContent !== '正在連線…');
    const result = await app.evaluate(async ({ webContents }) => {
      const chat = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
      return chat.executeJavaScript(`(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({audio:true});
        const devices = await navigator.mediaDevices.enumerateDevices();
        const output = devices.find(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default');
        const player = new Audio();
        let sink = 'default';
        if (output && player.setSinkId) { await player.setSinkId(output.deviceId); sink = 'selected'; }
        let cameraDenied = false;
        try { const camera = await navigator.mediaDevices.getUserMedia({video:true}); camera.getTracks().forEach(track=>track.stop()); }
        catch (error) { cameraDenied = error.name === 'NotAllowedError'; }
        const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection();
        sender.onicecandidate = event => { if(event.candidate) receiver.addIceCandidate(event.candidate).catch(()=>{}); };
        receiver.onicecandidate = event => { if(event.candidate) sender.addIceCandidate(event.candidate).catch(()=>{}); };
        sender.addTrack(stream.getAudioTracks()[0],stream);
        const offer = await sender.createOffer(); await sender.setLocalDescription(offer); await receiver.setRemoteDescription(offer);
        const answer = await receiver.createAnswer(); await receiver.setLocalDescription(answer); await sender.setRemoteDescription(answer);
        let packets = 0;
        for(let attempt=0;attempt<100;attempt++) {
          const stats = await receiver.getStats();
          for (const stat of stats.values()) if(stat.type==='inbound-rtp' && stat.kind==='audio') packets = stat.packetsReceived || 0;
          if (packets > 0) break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        const result = {live:stream.getAudioTracks()[0].readyState==='live',sink,cameraDenied,packets};
        sender.close(); receiver.close(); stream.getTracks().forEach(track=>track.stop());
        return result;
      })()`);
    });
    assert.equal(result.live, true); assert.equal(result.cameraDenied, true);
    assert.ok(result.packets > 0, 'Audio RTP packets travel through a real local WebRTC connection');
    assert.equal(result.sink, 'selected', 'Non-default audio output is permitted');
    console.log('Actual Chromium audio capture, speaker selection, and WebRTC loopback passed:', result);
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
