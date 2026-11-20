'use strict';
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const count = Number(process.env.MILO_PERF_MESSAGES || 600);
const updates = Number(process.env.MILO_PERF_UPDATES || 120);
const legacy = ['compact_voice_composer.js', 'hide_voice_orb.js', 'keep_conversation_visible.js'].map(file => path.join(root, 'assets/android', file));
legacy.push(path.join(root, 'test/fixtures/legacy-wide-conversation.js'));
const modern = ['compact-voice.js', 'hide-voice-orb.js', 'keep-conversation-visible.js'].map(file => path.join(root, 'src/page', file));
modern.push(path.join(root, 'src/wide-conversation.js'));
const sentence = 'A little practice every day makes learning English easier. ';
const history = Array.from({ length: count }, (_, i) => `<article data-testid="conversation-turn-${i}"><div class="mx-auto"><div data-message-author-role="assistant"><div><p>${sentence.repeat(6)}<strong>new</strong></p><p>Keep learning.</p></div><button aria-label="Copy reply">Copy</button></div></div></article>`).join('');
const html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0;overflow:hidden;font:16px/1.5 Arial}main{height:calc(100vh - 68px);overflow:auto}.mx-auto{max-width:720px;margin:auto}article{margin:12px 0;padding:16px;border:1px solid #aaa}footer{position:fixed;bottom:0;left:0;right:0;background:white;padding:10px}form{display:flex;gap:8px}.voice-orb{position:fixed;right:0;top:0;width:80px;height:80px}</style><main>${history}<article data-testid="conversation-turn-last"><div class="mx-auto"><div data-message-author-role="assistant"><p id="stream">Today</p></div></div></article></main><footer><form><textarea id="prompt-textarea"></textarea><button aria-label="Start voice">Voice</button><button aria-label="End voice">End voice</button><span>ChatGPT can make mistakes.</span></form></footer><div class="voice-orb" data-testid="voice-orb"></div>`;
let app;
async function evaluate(source) {
  return app.evaluate(({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    return contents ? contents.executeJavaScript(code) : null;
  }, source);
}
async function run(mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-performance-'));
  try {
    app = await electron.launch({ args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: directory }, timeout: 60000 });
    const shell = await app.firstWindow(); await shell.waitForSelector('#reload');
    await app.evaluate(({ session }, html) => session.fromPartition('persist:milo-chat').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } })), html);
    await shell.locator('#reload').click();
    await shell.waitForFunction(() => document.querySelector('#connection').textContent !== '正在連線…');
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await evaluate('!!(window.__miloWideConversationV1 && window.__miloConversationVisibleV1)');
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Page enhancements have finished installing');
    await evaluate(`['__miloCompactComposerV1','__miloVoiceOrbFilterV1','__miloConversationVisibleV1','__miloWideConversationV1'].forEach(key=>window[key]?.stop())`);
    await evaluate(`(() => {
      const nativeRAF=window.requestAnimationFrame.bind(window);
      const query=document.querySelectorAll.bind(document);
      const set=Element.prototype.setAttribute;
      let metrics;
      window.__resetMiloMetrics=()=>metrics={documentQueries:0,broadQueries:0,attributeWrites:0,callbackMs:0,callbacks:0,maxCallbackMs:0,start:performance.now(),longTasks:0};
      window.__getMiloMetrics=()=>({...metrics,durationMs:performance.now()-metrics.start});
      window.__resetMiloMetrics();
      document.querySelectorAll=function(selector){metrics.documentQueries++; if(selector==='footer,small,div,span,p'||selector.includes('[data-message-author-role]'))metrics.broadQueries++;return query(selector)};
      Element.prototype.setAttribute=function(name,value){if(name.startsWith('data-milo-'))metrics.attributeWrites++;return set.call(this,name,value)};
      window.requestAnimationFrame=function(callback){return nativeRAF(time=>{const start=performance.now();try{callback(time)}finally{const duration=performance.now()-start;metrics.callbacks++;metrics.callbackMs+=duration;metrics.maxCallbackMs=Math.max(metrics.maxCallbackMs,duration)}})};
      try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=metrics.start)metrics.longTasks++}).observe({entryTypes:['longtask']})}catch{}
    })()`);
    const files = mode === 'legacy' ? legacy : modern;
    for (const file of files) await evaluate(fs.readFileSync(file, 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 300));
    const metrics = await evaluate(`(async()=>{
      let text=document.getElementById('stream').firstChild;
      window.__resetMiloMetrics();
      for(let i=0;i<${updates};i++){if(i%2===0)text.data+=' a new word';else{const p=text.parentElement;p.textContent+=' a new word';text=p.firstChild;}await new Promise(resolve=>setTimeout(resolve,16))}
      await new Promise(resolve=>setTimeout(resolve,180));
      const metrics=window.__getMiloMetrics();
      const scroll=document.querySelector('main');
      const bottomGap=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop;
      let behavior=null;
      if(${mode === 'modern'}) {
        const pause=()=>new Promise(resolve=>setTimeout(resolve,180));
        window.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));scroll.scrollTop=0;await pause();
        document.getElementById('stream').firstChild.data+=' More text.'.repeat(100);await pause();
        const manualScroll=scroll.scrollTop<2;
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'End'}));scroll.scrollTop=scroll.scrollHeight;await pause();
        document.getElementById('stream').firstChild.data+=' Another reply.'.repeat(40);await pause();
        const followResumed=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<3;
        const node=document.querySelector('article p').firstChild;
        const range=document.createRange();range.setStart(node,0);range.setEnd(node,10);getSelection().removeAllRanges();getSelection().addRange(range);
        const selectedTop=scroll.scrollTop;document.getElementById('stream').firstChild.data+=' More text.'.repeat(100);await pause();
        const selectionStable=Math.abs(scroll.scrollTop-selectedTop)<3;
        getSelection().removeAllRanges();await pause();
        document.querySelector('footer').style.height='112px';await pause();
        const footerClearance=document.getElementById('stream').getBoundingClientRect().bottom<=document.querySelector('footer').getBoundingClientRect().top+1;
        const added=document.createElement('article');added.setAttribute('data-testid','conversation-turn-new');added.innerHTML='<div class="mx-auto"><div data-message-author-role="assistant"><p id="new-reply">A new message.</p></div></div>';
        scroll.appendChild(added);await pause();
        const newMessageWide=added.querySelector('.mx-auto').getAttribute('data-milo-wide-text')==='1';
        const newMessageFollow=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<3;
        // Site CSS may enable smooth scrolling. Repeated streaming updates must not
        // restart an animation that leaves the newest lines behind the composer.
        scroll.style.scrollBehavior='smooth';
        added.querySelector('p').textContent+=' More formatted content.'.repeat(160);
        for(let i=0;i<4;i++) await new Promise(requestAnimationFrame);
        const smoothScrollFollow=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<3;
        const smoothStylePreserved=scroll.style.scrollBehavior==='smooth';
        // React can mount a turn before it mounts the message content. Inspect
        // added subtrees between the turn and the author-role element as well.
        const staged=document.createElement('article');staged.setAttribute('data-testid','conversation-turn-staged');staged.style.display='contents';
        scroll.appendChild(staged);await pause();
        staged.innerHTML='<div class="mx-auto"><div data-message-author-role="assistant"><p id="staged-reply">A reply mounted later.</p></div></div>';
        await pause();
        const stagedMessageWide=staged.querySelector('.mx-auto').getAttribute('data-milo-wide-text')==='1';
        document.getElementById('staged-reply').textContent+=' More staged content.'.repeat(160);
        for(let i=0;i<4;i++) await new Promise(requestAnimationFrame);
        const stagedMessageFollow=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<3;
        // Formatted streaming remains local to the cached content box and must
        // not reintroduce a full-history scan on each code/list insertion.
        window.__resetMiloMetrics();
        for(let i=0;i<20;i++) {
          const formatted=document.createElement(i%2?'pre':'ul');formatted.textContent='Formatted chunk '+i;
          staged.querySelector('[data-message-author-role]').appendChild(formatted);
          await new Promise(requestAnimationFrame);
        }
        const formattedStreamingLocal=window.__getMiloMetrics().broadQueries===0;
        // Voice captions can stream outside message-author elements. They must
        // not trigger another full-history search or hide playback controls.
        const form=document.querySelector('footer form');
        const controls=document.createElement('div');
        controls.innerHTML='<button id="stop-speaking" aria-label="Stop speaking">Stop speaking</button><button id="pause-speaking" aria-label="Pause">Pause</button><button id="resume-speaking">Resume</button><button id="read-aloud" aria-label="Read aloud">Read aloud</button><div id="live-caption" aria-live="polite"><span>Listen to this sentence.</span></div><div id="media-orb" data-testid="voice-orb"><audio id="voice-output"></audio><canvas width="80" height="80"></canvas></div>';
        form.appendChild(controls);await pause();
        const visible=node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
        const voiceControlsVisible=['stop-speaking','pause-speaking','resume-speaking','read-aloud'].every(id=>visible(document.getElementById(id)));
        const voiceCaptionsVisible=visible(document.getElementById('live-caption'));
        const mediaContainerVisible=visible(document.getElementById('media-orb'));
        const context=new AudioContext();const oscillator=context.createOscillator();const destination=context.createMediaStreamDestination();
        const gain=context.createGain();gain.gain.value=0.02;oscillator.connect(gain).connect(destination);oscillator.start();await context.resume();
        const audio=document.getElementById('voice-output');audio.srcObject=destination.stream;await audio.play();
        let pauses=0;audio.addEventListener('pause',()=>pauses++);
        const before=context.currentTime;
        window.__resetMiloMetrics();
        for(let i=0;i<${updates};i++){
          const caption=document.getElementById('live-caption');const span=document.createElement('span');span.textContent='Streaming spoken sentence '+i;caption.replaceChildren(span);
          await new Promise(resolve=>setTimeout(resolve,16));
        }
        await pause();
        const captionMetrics=window.__getMiloMetrics();
        const voiceCaptionsLocal=captionMetrics.broadQueries===0;
        const voicePlaybackContinued=!audio.paused&&context.state==='running'&&context.currentTime>before+1&&pauses===0;
        oscillator.stop();audio.pause();destination.stream.getTracks().forEach(track=>track.stop());await context.close();
        behavior={manualScroll,followResumed,selectionStable,footerClearance,newMessageWide,newMessageFollow,smoothScrollFollow,smoothStylePreserved,stagedMessageWide,stagedMessageFollow,formattedStreamingLocal,voiceControlsVisible,voiceCaptionsVisible,mediaContainerVisible,voiceCaptionsLocal,voicePlaybackContinued};
        metrics.voiceCaptionStreaming=captionMetrics;
      }
      return {...metrics,bottomGap,behavior};
    })()`);
    return { mode, messages: count, updates, ...metrics };
  } finally {
    if (app) await app.close(); app = null;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
(async () => {
  const results = [await run('legacy')];
  if (!process.argv.includes('--legacy-only')) results.push(await run('modern'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results/performance.json'), JSON.stringify(results, null, 2));
  for (const result of results) console.log(result);
  if (results.length === 2) {
    assert.ok(results[1].broadQueries < results[0].broadQueries / 4, 'Streaming must avoid repeated full-history scans');
    assert.ok(results[1].attributeWrites <= results[0].attributeWrites / 4, 'Streaming must avoid redundant layout attributes');
    assert.ok(results[1].bottomGap < 100, 'New text remains visible at the bottom');
    for (const [name,passed] of Object.entries(results[1].behavior)) assert.equal(passed,true,name);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
