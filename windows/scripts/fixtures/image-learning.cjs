'use strict';
const pack = {
  words: [
    { word: 'garden', meaning: '花園', phonetic: '/ˈɡɑrdən/', hint: '可以欣賞植物的戶外空間', example: 'This is a garden.' },
    { word: 'flower', meaning: '花朵', hint: '植物上色彩鮮豔的部分', example: 'A flower grows here.' },
    { word: 'bench', meaning: '長椅', hint: '能讓幾個人一起坐的家具', example: 'The bench is outside.' }
  ],
  patterns: [
    { prompt: 'One flower ____ here.', answer: 'is', choices: ['is', 'are', 'am'], explanation: '單數主詞用 is。' },
    { prompt: 'Two benches ____ outside.', answer: 'are', choices: ['are', 'is', 'am'], explanation: '複數主詞用 are。' }
  ]
};
const markedPack = 'MILO_GAME_PACK_V1\n' + JSON.stringify(pack) + '\nMILO_GAME_PACK_END';
const invalidMarkedPack = 'MILO_GAME_PACK_V1\n{"words":[],"patterns":[]}\nMILO_GAME_PACK_END';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;font:16px/1.5 Arial}
nav{position:fixed;left:0;top:0;bottom:0;width:150px;background:#eee;padding:12px}
main{height:calc(100vh - 130px);margin-left:150px;overflow:auto}.mx-auto{max-width:620px;margin:auto}
article{padding:20px}footer{position:fixed;bottom:0;left:150px;right:0;padding:10px;background:white}
form{border:1px solid #aaa;padding:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#prompt-textarea{min-height:44px;max-height:130px;overflow:auto;flex:1;min-width:170px;white-space:pre-wrap}
button{min-height:36px;padding:8px}#previews{display:flex;gap:8px}#previews img{width:50px;height:40px;object-fit:contain}
</style></head><body>
<nav id="native-sidebar"><strong>ChatGPT</strong><button id="native-new">新對話</button></nav>
<main><article data-testid="conversation-turn-0"><div class="mx-auto"><div data-message-author-role="assistant"><p>A picture can help us learn English.</p></div></div></article></main>
<footer><form id="composer"><input id="lesson-file" type="file" accept="image/*" hidden><input id="foreign-file" type="file" accept="application/pdf" hidden>
<div id="previews"></div><span id="upload-progress" role="progressbar" hidden>Uploading</span>
<div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"></div>
<button type="button" id="fixture-voice" aria-label="Start voice">Voice</button>
<button type="button" id="fixture-send" data-testid="send-button" disabled>Send</button></form></footer>
<script>
(() => {
  const file=document.getElementById('lesson-file'),editor=document.getElementById('prompt-textarea');
  const previews=document.getElementById('previews'),progress=document.getElementById('upload-progress'),send=document.getElementById('fixture-send');
  let generation=0,url=null;
  const state=window.__fixture={changes:[],foreignChanges:[],sent:[],uploadDelay:80,uploadReady:false,gamePackMode:'valid',packDelay:40,packReplies:0};
  const update=()=>{send.disabled=!state.uploadReady||!editor.innerText.trim()};
  editor.addEventListener('input',update);
  state.clearDraft=()=>{generation++;editor.replaceChildren();previews.replaceChildren();progress.hidden=true;state.uploadReady=false;file.value='';if(url){URL.revokeObjectURL(url);url=null}update()};
  file.addEventListener('change',async event=>{
    const selected=file.files[0];if(!selected)return;
    state.lastFile=selected;
    const current=++generation;state.uploadReady=false;progress.hidden=false;update();
    state.changes.push({trusted:event.isTrusted,name:selected.name,type:selected.type,size:selected.size});
    const bytes=new Uint8Array(await selected.arrayBuffer());
    state.changes[state.changes.length-1].signature=[...bytes.slice(0,3)];
    await new Promise(resolve=>setTimeout(resolve,state.uploadDelay));
    if(current!==generation)return;
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(selected);
    const image=new Image();image.alt='Selected lesson image';image.src=url;previews.replaceChildren(image);
    progress.hidden=true;state.uploadReady=true;update();
  });
  document.getElementById('foreign-file').addEventListener('change',event=>{
    const selected=event.target.files[0];if(!selected)return;
    state.foreignChanges.push({trusted:event.isTrusted,name:selected.name,type:selected.type});
    const preview=document.createElement('div');preview.id='concurrent-user-file';preview.setAttribute('data-testid','file-preview');preview.textContent=selected.name;document.querySelector('form').appendChild(preview);
  });
  async function produceGamePack(prompt) {
    if(state.gamePackMode==='none')return;
    const nonce=prompt.match(/MILO_GAME_REQUEST:([a-f0-9-]{36})/i);
    const prefix=nonce?'MILO_GAME_REQUEST:'+nonce[1]+${JSON.stringify('\n')}:'';
    const text=prefix+(state.gamePackMode==='invalid'?${JSON.stringify(invalidMarkedPack)}:${JSON.stringify(markedPack)});
    await new Promise(resolve=>setTimeout(resolve,state.packDelay));
    const article=document.createElement('article');document.querySelector('main').appendChild(article);
    await new Promise(resolve=>setTimeout(resolve,20));
    const message=document.createElement('div');message.setAttribute('data-message-author-role','assistant');state.lastAssistant=message;
    const pre=document.createElement('pre');pre.textContent='';message.appendChild(pre);article.appendChild(message);
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.setAttribute('data-testid','fixture-copy');article.appendChild(copy);
    for(let i=0;i<text.length;i+=90){pre.textContent+=text.slice(i,i+90);await new Promise(resolve=>setTimeout(resolve,20))}
    state.packReplies++;
  }
  send.addEventListener('click',event=>{
    if(send.disabled)return;
    const prompt=editor.innerText;state.sent.push({text:prompt,trusted:event.isTrusted,file:state.changes[state.changes.length-1]});
    const article=document.createElement('article'),user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=prompt;article.appendChild(user);document.querySelector('main').appendChild(article);state.lastUser=user;
    if(prompt.includes('MILO_GAME_PACK_V1'))void produceGamePack(prompt);
    editor.replaceChildren();previews.replaceChildren();state.uploadReady=false;progress.hidden=true;update();
    // Keep the same underlying File selection: production must reset value to
    // upload the same photo again, rather than relying on a remounted input.
  });
})();
</script></body></html>`;

module.exports = { html, pack, markedPack };
