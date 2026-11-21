'use strict';
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
  const state=window.__fixture={changes:[],foreignChanges:[],sent:[],uploadDelay:80,uploadReady:false};
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
  send.addEventListener('click',event=>{
    if(send.disabled)return;
    const prompt=editor.innerText;state.sent.push({text:prompt,trusted:event.isTrusted,file:state.changes[state.changes.length-1]});
    const article=document.createElement('article'),user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=prompt;article.appendChild(user);document.querySelector('main').appendChild(article);state.lastUser=user;
    editor.replaceChildren();previews.replaceChildren();state.uploadReady=false;progress.hidden=true;update();
    // Keep the same underlying File selection: production must reset value to
    // upload the same photo again, rather than relying on a remounted input.
  });
})();
</script></body></html>`;

module.exports = { html };
