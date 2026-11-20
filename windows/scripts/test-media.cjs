'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-media-'));
const output = path.join(root, 'test-results', 'media-continuity.json');
const fixture = `<!doctype html><title>Audio continuity integration test</title>
<style>*{box-sizing:border-box}body{margin:0;overflow:hidden;font:16px Arial}main{height:calc(100vh - 80px);overflow:auto}article{padding:20px}.mx-auto{max-width:720px;margin:auto}footer{position:fixed;bottom:0;width:100%;padding:14px;background:#eee}canvas{position:fixed;right:0;top:0;width:100px;height:100px}</style>
<main><article data-testid="conversation-turn-1"><div class="mx-auto"><div data-message-author-role="assistant"><p id="captions">A synthetic caption update.</p></div></div></article></main>
<footer><form><textarea id="prompt-textarea"></textarea><button type="button" aria-label="End voice">End voice</button></form></footer><canvas class="voice-orb" width="100" height="100"></canvas><audio id="remote-audio" autoplay></audio>`;
let app;
const report = { platform: process.platform, synthetic: true, durationTargetMs: 15000, samples: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function chatEvaluate(code) {
  return app.evaluate(({ webContents }, source) => {
    const chat = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    if (!chat) throw new Error('The test ChatGPT view is unavailable');
    return chat.executeJavaScript(source);
  }, code);
}
// This function is serialized into the trusted-origin test page. It records only
// state/counters; no microphone samples, RTP payloads, or transcripts are saved.
async function prepareCall() {
  const started = performance.now();
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true
  } });
  const micTrack = microphone.getAudioTracks()[0];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const output = devices.find(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default');
  const player = document.getElementById('remote-audio');
  let sink = 'default';
  if (output && player.setSinkId) { await player.setSinkId(output.deviceId); sink = 'selected'; }
  let cameraDenied = false;
  try { const camera = await navigator.mediaDevices.getUserMedia({ video: true }); camera.getTracks().forEach(track => track.stop()); }
  catch (error) { cameraDenied = error.name === 'NotAllowedError'; }

  // A continuous known tone avoids interpreting a fake microphone's silence/VAD
  // behavior as a speaker failure. Capture permission is exercised separately.
  const context = new AudioContext(); await context.resume();
  const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 220; gain.gain.value = 0.015;
  oscillator.connect(gain); gain.connect(destination); oscillator.start();
  const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection();
  const events = [];
  for (const type of ['play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'error', 'emptied']) {
    player.addEventListener(type, () => { if (events.length < 40) events.push({ type, elapsedMs: Math.round(performance.now() - started) }); });
  }
  const queuedForSender = [], queuedForReceiver = [];
  sender.onicecandidate = event => {
    if (!event.candidate) return;
    if (receiver.remoteDescription) receiver.addIceCandidate(event.candidate).catch(() => {});
    else queuedForReceiver.push(event.candidate);
  };
  receiver.onicecandidate = event => {
    if (!event.candidate) return;
    if (sender.remoteDescription) sender.addIceCandidate(event.candidate).catch(() => {});
    else queuedForSender.push(event.candidate);
  };
  let remoteTrack = null, playback = null;
  receiver.ontrack = event => {
    remoteTrack = event.track;
    player.srcObject = event.streams[0] || new MediaStream([event.track]);
    playback = player.play();
  };
  sender.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  const offer = await sender.createOffer(); await sender.setLocalDescription(offer); await receiver.setRemoteDescription(offer);
  for (const candidate of queuedForReceiver) await receiver.addIceCandidate(candidate);
  const answer = await receiver.createAnswer(); await receiver.setLocalDescription(answer); await sender.setRemoteDescription(answer);
  for (const candidate of queuedForSender) await sender.addIceCandidate(candidate);
  if (!playback) throw new Error('The receiver did not attach a remote audio track');
  await playback;
  let captionUpdates = 0;
  const captionTimer = setInterval(() => {
    captionUpdates++;
    document.getElementById('captions').textContent = 'Practice English. '.repeat(1 + captionUpdates % 70);
  }, 50);
  const trackState = track => ({ readyState: track?.readyState || 'missing', enabled: !!track?.enabled, muted: !!track?.muted });
  const settings = micTrack.getSettings(), constraints = micTrack.getConstraints();
  const microphoneSettings = {};
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
    if (['boolean', 'string'].includes(typeof settings[key])) microphoneSettings[key] = settings[key];
  }
  window.__miloMediaContinuity = {
    async sample() {
      const incoming = await receiver.getStats(), outgoing = await sender.getStats();
      let packetsReceived = 0, bytesReceived = 0, packetsLost = 0, totalAudioEnergy = 0, jitterBufferEmittedCount = 0;
      let rtcpRoundTripMeasurements = 0, remoteInboundReports = 0;
      for (const stat of incoming.values()) if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
        packetsReceived += stat.packetsReceived || 0; bytesReceived += stat.bytesReceived || 0; packetsLost += stat.packetsLost || 0;
        totalAudioEnergy += stat.totalAudioEnergy || 0; jitterBufferEmittedCount += stat.jitterBufferEmittedCount || 0;
      }
      for (const stat of outgoing.values()) if (stat.type === 'remote-inbound-rtp' && stat.kind === 'audio') {
        remoteInboundReports++; rtcpRoundTripMeasurements += stat.roundTripTimeMeasurements || 0;
      }
      return { elapsedMs: Math.round(performance.now() - started), packetsReceived, bytesReceived, packetsLost, totalAudioEnergy,
        jitterBufferEmittedCount, remoteInboundReports, rtcpRoundTripMeasurements, captionUpdates, audioTime: player.currentTime,
        paused: player.paused, ended: player.ended, readyState: player.readyState, networkState: player.networkState,
        volume: player.volume, muted: player.muted, speakerSelected: !!output && player.sinkId === output.deviceId, contextState: context.state,
        senderState: sender.connectionState, receiverState: receiver.connectionState, iceState: receiver.iceConnectionState,
        microphone: trackState(micTrack), remoteTrack: trackState(remoteTrack), sourceTrack: trackState(destination.stream.getAudioTracks()[0]),
        pageHidden: document.hidden, events: events.slice() };
    },
    async close() {
      clearInterval(captionTimer); player.pause(); player.srcObject = null;
      sender.close(); receiver.close(); microphone.getTracks().forEach(track => track.stop());
      destination.stream.getTracks().forEach(track => track.stop()); oscillator.stop(); await context.close();
    }
  };
  return { sink, cameraDenied, microphoneSettings, echoCancellationRequested: constraints.echoCancellation === true,
    echoCancellationSupported: !!navigator.mediaDevices.getSupportedConstraints().echoCancellation,
    source: 'continuous Web Audio tone through local WebRTC', capture: 'Chromium fake microphone', playback: 'HTMLAudioElement with receiver MediaStream' };
}
async function sample(phase, extra = {}) {
  const current = await chatEvaluate('window.__miloMediaContinuity.sample()');
  const windowState = await app.evaluate(({ BrowserWindow, powerSaveBlocker, webContents }) => {
    const main = BrowserWindow.getAllWindows()[0];
    return { minimized: main.isMinimized(), visible: main.isVisible(), focused: main.isFocused(),
      mediaPowerRequests: [...globalThis.__miloMediaPowerRequests].filter(id => powerSaveBlocker.isStarted(id)).length,
      nativeMediaEvents: globalThis.__miloNativeMediaEvents.slice(),
      audible: webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/')).isCurrentlyAudible() };
  });
  const result = { phase, ...extra, window: windowState, ...current };
  report.samples.push(result); return result;
}
(async () => {
  try {
    app = await electron.launch({ args: [root, '--use-fake-device-for-media-stream',
      ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: directory }, timeout: 60000 });
    const page = await app.firstWindow(); await page.waitForSelector('#reload');
    await app.evaluate(({ session, dialog, powerSaveBlocker, webContents }, html) => {
      // Exercise production origin checks, audio-only capture, and consent.
      dialog.showMessageBox = async () => ({ response: 0 });
      // Observe the real production request, rather than installing a second
      // playback guard just for the test. No device or content data is logged.
      globalThis.__miloMediaPowerRequests = new Set();
      globalThis.__miloNativeMediaEvents = [];
      const chat = webContents.getAllWebContents().find(item => item.getType() === 'webview' || item.session === session.fromPartition('persist:milo-chat'));
      for (const name of ['media-started-playing', 'media-paused', 'audio-state-changed']) chat.on(name, () => {
        if (globalThis.__miloNativeMediaEvents.length < 40) globalThis.__miloNativeMediaEvents.push(name);
      });
      const start = powerSaveBlocker.start.bind(powerSaveBlocker);
      const stop = powerSaveBlocker.stop.bind(powerSaveBlocker);
      powerSaveBlocker.start = type => {
        const id = start(type);
        if (type === 'prevent-app-suspension') globalThis.__miloMediaPowerRequests.add(id);
        return id;
      };
      powerSaveBlocker.stop = id => { globalThis.__miloMediaPowerRequests.delete(id); return stop(id); };
      session.fromPartition('persist:milo-chat').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    }, fixture);
    await page.locator('#reload').click();
    await page.waitForFunction(() => document.querySelector('#connection').textContent !== '正在連線…');
    report.setup = await chatEvaluate(`(${prepareCall.toString()})()`);
    let initial;
    for (let attempt = 0; attempt < 100; attempt++) {
      initial = await chatEvaluate('window.__miloMediaContinuity.sample()');
      const powerActive = await app.evaluate(() => globalThis.__miloMediaPowerRequests.size === 1);
      if (initial.packetsReceived > 0 && initial.audioTime > 0.1 && powerActive) break;
      await delay(100);
    }
    assert.ok(initial.packetsReceived > 0 && initial.audioTime > 0.1, 'Receiver audio is attached and actually playing');
    await sample('playing');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await page.locator('#search').fill('new'); await page.locator('#search').press('Enter');
    await page.waitForSelector('#lookup:not([hidden])');
    await page.locator('#microphone').click(); // Footer setting changes must not stop an existing stream.
    await delay(3000); await sample('dictionary-and-footer');
    await app.evaluate(({ BrowserWindow, webContents }) => {
      BrowserWindow.getAllWindows()[0].setSize(1180, 820);
      webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/')).focus();
    });
    await delay(3000); await sample('resize-and-chat-focus');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await delay(3000); await sample('minimize-requested', { minimizeRequested: true });
    await app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]; main.restore(); main.show(); main.webContents.focus(); });
    await delay(3000); await sample('restored-and-shell-focus');
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/')).focus());
    await delay(3000); await sample('continued');

    assert.equal(report.setup.cameraDenied, true);
    assert.equal(report.setup.sink, 'selected', 'Non-default speaker selection remains permitted');
    assert.equal(report.setup.echoCancellationRequested, true);
    assert.equal(report.setup.echoCancellationSupported, true);
    assert.notEqual(report.setup.microphoneSettings.echoCancellation, false, 'Requested echo cancellation is not disabled by the wrapper');
    for (const [index, current] of report.samples.entries()) {
      assert.equal(current.paused, false, `${current.phase}: remote player stays active`);
      assert.equal(current.ended, false, `${current.phase}: remote stream has not ended`);
      assert.equal(current.muted, false, `${current.phase}: player remains unmuted`);
      assert.ok(current.volume > 0 && current.readyState >= 2, `${current.phase}: player has audio data and a positive volume`);
      assert.equal(current.speakerSelected, true, `${current.phase}: selected output is retained`);
      assert.equal(current.contextState, 'running', `${current.phase}: continuous source stays active`);
      assert.equal(current.window.mediaPowerRequests, 1, `${current.phase}: playback retains one background power request`);
      assert.equal(current.receiverState, 'connected', `${current.phase}: WebRTC remains connected`);
      for (const name of ['microphone', 'remoteTrack', 'sourceTrack']) {
        assert.equal(current[name].readyState, 'live', `${current.phase}: ${name} stays live`);
        assert.equal(current[name].enabled, true, `${current.phase}: ${name} stays enabled`);
        assert.equal(current[name].muted, false, `${current.phase}: ${name} is not muted`);
      }
      assert.ok(!current.events.some(event => ['pause', 'ended', 'error', 'stalled'].includes(event.type)), `${current.phase}: playback has no interruption event`);
      if (index) {
        const previous = report.samples[index - 1];
        assert.ok(current.packetsReceived > previous.packetsReceived, `${current.phase}: incoming audio packets keep advancing`);
        assert.ok(current.bytesReceived > previous.bytesReceived, `${current.phase}: incoming audio bytes keep advancing`);
        assert.ok(current.audioTime > previous.audioTime + 1, `${current.phase}: playback clock keeps advancing`);
        assert.ok(current.totalAudioEnergy > previous.totalAudioEnergy, `${current.phase}: received tone remains non-silent`);
      }
    }
    const first = report.samples[0], last = report.samples.at(-1);
    assert.ok(last.elapsedMs - first.elapsedMs >= 14500, 'Continuity is checked for at least 15 seconds');
    assert.ok(last.captionUpdates > first.captionUpdates + 100, 'Streaming captions update during playback');
    assert.ok(last.remoteInboundReports > 0 && last.rtcpRoundTripMeasurements > 0, 'RTCP receiver reports return to the sender');
    await chatEvaluate('window.__miloMediaContinuity.close()');
    for (let attempt = 0; attempt < 100; attempt++) {
      report.playbackPowerReleased = await app.evaluate(() => globalThis.__miloMediaPowerRequests.size === 0);
      if (report.playbackPowerReleased) break;
      await delay(50);
    }
    assert.equal(report.playbackPowerReleased, true, 'Stopping playback releases its background power request');
    report.ok = true;
    console.log('Sustained local Chromium WebRTC playback passed (synthetic devices, not an account call):', {
      durationMs: last.elapsedMs - first.elapsedMs, packets: last.packetsReceived, playbackSeconds: last.audioTime,
      rtcpRoundTripMeasurements: last.rtcpRoundTripMeasurements, captionUpdates: last.captionUpdates, phases: report.samples.map(item => item.phase)
    });
  } catch (error) { report.ok = false; report.error = error.message; throw error; }
  finally {
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (app) {
      try { await chatEvaluate('window.__miloMediaContinuity?.close()'); } catch {}
      await app.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
