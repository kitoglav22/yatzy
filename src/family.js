// GitHub Pages version only: one history of finished games for the whole family, on every device that knows the code
// (the site, the Telegram app, another phone). It lives in the same Firebase database as the rooms, under hist/<code>:
// g/<key> a finished game as a JSON string, d/<key> the time it was deleted, r the players.
// The key is the game's start time, so the copies of one online game that every device in the room saves are one game.
// Anyone who knows the code can read and change this history, so the code is long and everything read is checked.
const FAM_LEN=12;
const famCode=v=>{const c=String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return c.length===FAM_LEN&&[...c].every(x=>ROOM_CHARS.includes(x))?c:''};
const famShow=c=>c.match(/.{4}/g).join('-');
const famKey=gameKey;
const famPlain=g=>{const {_doc,...x}=g;return JSON.stringify(x)};
let fam={code:famCode(lsGet('yatzy.family')),n:null,err:'',off:null};

// what the shared history holds now goes into this device's history; games only this device has go up.
// Returns the changes to write
function famMerge(v){
  const g=v&&typeof v.g==='object'?v.g:{},d=v&&typeof v.d==='object'?v.d:{},up={};let changed=false;
  // deleted on another device (a game saved again after that is in g, and wins)
  const n=history.length;history=history.filter(x=>!(famKey(x) in d)||famKey(x) in g);if(history.length!==n)changed=true;
  const at=new Map(history.map((x,i)=>[famKey(x),i]));
  Object.entries(g).forEach(([k,j])=>{
    let x;try{x=JSON.parse(j)}catch(e){return}
    if(!okSavedGame(x)||famKey(x)!==k)return;
    if(!at.has(k)){history.push(x);at.set(k,history.length-1);changed=true;return}
    // the same game, changed on another device (a player renamed): its time here stays, the current game may point to it
    const i=at.get(k),y={...x,at:history[i].at};
    if(famPlain(y)!==famPlain(history[i])){history[i]=y;changed=true}
  });
  history.forEach(x=>{const k=famKey(x);if(!(k in g)&&!(k in d))up['g/'+k]=famPlain(x)});
  if(v&&typeof v.r==='string')try{const r=JSON.parse(v.r);
    if(Array.isArray(r))r.forEach(x=>{if(okPerson(x)&&!roster.some(y=>y.name===x.name||y.id===x.id)){roster.push({id:x.id,name:x.name});changed=true}})}catch(e){}
  if(changed){lsSet('yatzy.hist',history);lsSet('yatzy.roster',roster)}
  return {up,changed,n:Object.keys(g).length+Object.keys(up).length};
}

const famWrite=ch=>fam.code&&Object.keys(ch).length&&backend().then(b=>b.update('hist/'+fam.code,ch)).catch(()=>{});
keepers.push({
  addGame(g){famWrite({['g/'+famKey(g)]:famPlain(g),['d/'+famKey(g)]:null})},
  updateGame(g){famWrite({['g/'+famKey(g)]:famPlain(g)})},
  deleteGame(g){famWrite({['g/'+famKey(g)]:null,['d/'+famKey(g)]:Date.now()})},
  saveRoster(r){famWrite({r:JSON.stringify(r.slice(0,60))})},
});

async function famConnect(code){
  if(fam.off){fam.off();fam.off=null}
  fam.code=code;fam.n=null;fam.err='';lsSet('yatzy.family',code);famDraw();
  try{
    const b=await backend();if(fam.code!==code)return;
    let first=true;
    fam.off=b.watchPath('hist/'+code,v=>{
      if(fam.code!==code)return;
      const m=famMerge(v||{});fam.n=m.n;fam.err='';
      if(first){first=false;m.up.r=JSON.stringify(roster.slice(0,60))}
      famWrite(m.up);
      // with every game kept in the shared history the backup reminder is not needed
      cloudKeeps=true;
      if(m.changed)render();else famDraw();
    },e=>{fam.err=netErr(e);famDraw()});
  }catch(e){fam.err=netErr(e);famDraw()}
}
function famLeave(){if(fam.off){fam.off();fam.off=null}fam={code:'',n:null,err:'',off:null};lsSet('yatzy.family',null);cloudKeeps=false;render()}
async function famJoin(code,msg){
  msg('Проверяю код…');
  try{
    const b=await backend(),v=await b.read('hist/'+code);
    if(!v)return msg('Истории с таким кодом нет. Проверьте код.');
    sheet.close();famConnect(code);
  }catch(e){msg(netErr(e))}
}
function famNew(){
  const a=new Uint8Array(FAM_LEN);crypto.getRandomValues(a);
  famConnect([...a].map(x=>ROOM_CHARS[x%ROOM_CHARS.length]).join(''));
}
function famShare(){
  const c=famShow(fam.code),tg=document.documentElement.classList.contains('tg')&&window.Telegram&&window.Telegram.WebApp;
  const text=`Общая история Яцзы: откройте «Статистику», «Общая история» и введите код ${c}`;
  if(tg&&TG_APP)return tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(TG_APP+'?startapp=H-'+fam.code)+'&text='+encodeURIComponent(text));
  const url=location.origin+location.pathname+'#hist='+fam.code;
  if(navigator.share)navigator.share({title:'Яцзы',text,url}).catch(()=>{});
  else navigator.clipboard&&navigator.clipboard.writeText(text+'. Или по ссылке: '+url).then(()=>{if($('fmsg'))$('fmsg').textContent='Код и ссылка скопированы'}).catch(()=>{});
}
// a link with a code asks first: this device's games will join that history
window.openFamily=code=>{
  code=famCode(code);
  if(code&&code===fam.code)return;
  sheet.open(`<h3>Общая история</h3>
    <p class="muted">Партии и игроки будут общими на всех устройствах с этим кодом: на сайте, в Telegram, на телефоне второго игрока. Партии с этого устройства тоже попадут в неё.</p>
    <form class="add" id="famf"><input id="famin" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" aria-label="Код общей истории" value="${code?famShow(code):''}"><button class="btn primary" type="submit">Подключить</button></form>
    <p class="muted" id="fmsg">${fam.code?'Сейчас подключена другая история: эта её заменит.':''}</p>
    <div class="row"><button class="btn" id="cancel">Отмена</button></div>`);
  $('cancel').onclick=sheet.close;
  const msg=t=>{if($('fmsg'))$('fmsg').textContent=t};
  $('famf').onsubmit=e=>{e.preventDefault();const c=famCode($('famin').value);if(!c)return msg('Код из 12 букв и цифр, например ABCD-EFGH-2345');famJoin(c,msg)};
};
// a block on the statistics tab
function famDraw(){
  const el=$('famst');if(!el)return;
  if(fam.code&&!net)$('sync').textContent='Партии хранятся на этом устройстве и в общей истории';
  // redrawn only when something changed, so a half-pressed button stays as it is
  const sig=[fam.code,fam.n,fam.err].join();if(el.dataset.sig===sig)return;el.dataset.sig=sig;
  if(!fam.code){
    el.innerHTML=`<p class="muted">Одна история партий на всех ваших устройствах: на сайте, в Telegram и на телефоне второго игрока. Статистика и ачивки везде будут одинаковые.</p>
      <div class="row"><button class="btn" id="famnew">Создать общую историю</button><button class="btn" id="famjoin">У меня есть код</button></div>`;
    $('famnew').onclick=famNew;$('famjoin').onclick=()=>window.openFamily('');return;
  }
  el.innerHTML=`<p class="muted">Код: <b class="famcode">${famShow(fam.code)}</b>. ${fam.err?esc(fam.err):fam.n==null?'Подключаюсь…':`Партий в общей истории: ${fam.n}.`}
    Введите этот код на других устройствах. Его знают только те, кому вы его дали: кто знает код, видит и может менять историю.</p>
    <p class="muted" id="fmsg"></p>
    <div class="row"><button class="btn" id="famshare">Поделиться кодом</button><button class="btn" id="famleave">Отключить</button></div>`;
  $('famshare').onclick=famShare;
  $('famleave').onclick=()=>{const b=$('famleave');
    if(b.dataset.arm!=='1'){b.dataset.arm='1';b.textContent='Точно отключить?';$('fmsg').textContent='Партии останутся и здесь, и в общей истории, но новые перестанут туда попадать.';return}
    famLeave()};
}
{
  const sec=document.createElement('section');
  sec.innerHTML='<h2>Общая история</h2><div id="famst"></div>';
  $('vstats').appendChild(sec);famDraw();
  const prev=window.onAfterRender;window.onAfterRender=()=>{prev&&prev();famDraw()};
  if(fam.code)famConnect(fam.code);
  const fromLink=()=>{const m=location.hash.match(/^#hist=([A-Za-z0-9-]+)$/);if(!m)return;
    window.history.replaceState(null,'',location.pathname+location.search);window.openFamily(m[1])};
  window.addEventListener('hashchange',fromLink);fromLink();
}
