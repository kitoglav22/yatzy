// GitHub Pages version only: moving to the site's own address.
// The history lives in the browser under the site's address, so the old site hands it over once in the link
// (#move=…, never sent to any server) and the new one takes it in like a backup file.
const NEW_HOME=window.__yatzyHome||''; // the new address, e.g. 'https://example.ru/'; empty while there is none
const MOVE_KEYS=['yatzy.hist','yatzy.roster','yatzy.game','yatzy.dice','yatzy.rooms','yatzy.online','yatzy.offgame','yatzy.dev','yatzy.backupAt','yatzy.backupTime'];
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const viaStream=(bytes,S)=>new Response(new Blob([bytes]).stream().pipeThrough(new S('deflate-raw'))).arrayBuffer().then(b=>new Uint8Array(b));
// 'z' + compressed where the browser can, 'j' + plain otherwise; the same browser reads it back on the new address
async function packMove(){
  const ls={};MOVE_KEYS.forEach(k=>{const v=localStorage.getItem(k);if(v!=null)ls[k]=v});
  const bytes=new TextEncoder().encode(JSON.stringify({app:'yatzy',v:1,ls}));
  return typeof CompressionStream==='function'?'z'+b64(await viaStream(bytes,CompressionStream)):'j'+b64(bytes);
}
async function unpackMove(s){
  const bytes=s[0]==='z'?await viaStream(unb64(s.slice(1)),DecompressionStream):unb64(s.slice(1));
  const d=JSON.parse(new TextDecoder().decode(bytes));
  if(!d||d.app!=='yatzy'||!d.ls||typeof d.ls!=='object')throw 0;
  return d.ls;
}
// an empty notebook takes everything as it was; one already in use adds the games and players it lacks, like a backup file
function takeMove(ls){
  const parse=k=>{try{return JSON.parse(ls[k])}catch(e){return null}};
  const hist=(Array.isArray(parse('yatzy.hist'))?parse('yatzy.hist'):[]).filter(okSavedGame);
  const people=(Array.isArray(parse('yatzy.roster'))?parse('yatzy.roster'):[]).filter(okPerson).map(r=>({id:r.id,name:r.name}));
  const empty=!(lsGet('yatzy.hist')||[]).length&&!(lsGet('yatzy.roster')||[]).length;
  const seen=new Set(empty?[]:history.map(g=>g.at));let n=0;
  const hs=empty?[]:history.slice();hist.forEach(g=>{if(!seen.has(g.at)){seen.add(g.at);hs.push(g);n++}});
  const rs=empty?[]:roster.slice();people.forEach(r=>{if(!rs.some(x=>x.name===r.name||x.id===r.id))rs.push(r)});
  lsSet('yatzy.hist',hs);lsSet('yatzy.roster',rs);
  MOVE_KEYS.forEach(k=>{
    if(k==='yatzy.hist'||k==='yatzy.roster'||!(k in ls)||parse(k)==null)return;
    if(k==='yatzy.game'&&!normGame(parse(k)))return;
    if(k==='yatzy.dev'&&!/^[a-z0-9]{1,48}$/.test(parse(k)))return;
    if(empty||lsGet(k)==null)lsSet(k,parse(k));
  });
  return n;
}
// a line at the top of the game screen, above the backup reminder
function moveNote(html,btn){
  let el=$('move');if(!el){el=document.createElement('div');el.id='move';$('remind').before(el)}
  el.innerHTML=`<div class="remind"><span>${html}</span><button class="btn small" id="mvbtn">${btn||'Понятно'}</button></div>`;
  $('mvbtn').onclick=()=>el.remove();
  return $('mvbtn');
}
const moveIn=location.hash.match(/^#move=([zj][A-Za-z0-9_-]+)$/);
if(moveIn){
  // the link is used once: a reload or a copied address does not bring the data in again
  window.history.replaceState(null,'',location.pathname+location.search);
  document.body.style.visibility='hidden';
  unpackMove(moveIn[1]).then(ls=>{takeMove(ls);lsSet('yatzy.movedIn',Date.now())}).catch(()=>lsSet('yatzy.movedIn',-1)).then(()=>location.reload());
}
{
  const moved=lsGet('yatzy.movedIn');
  if(moved){
    lsSet('yatzy.movedIn',null);
    moveNote(moved>0?'Партии и игроки перенесены со старого адреса.':'Не удалось перенести данные. Сохраните копию на старом адресе и восстановите её здесь из файла.');
  }
}
// the old address: an empty notebook simply goes to the new one, a filled one offers to move with everything.
// Inside Telegram nothing changes: the bot opens the address it is given, and the games are in the Telegram cloud.
if(NEW_HOME&&!moveIn&&location.origin!==new URL(NEW_HOME).origin){
  let inTg=/tgWebApp(Data|Platform|Version)=/.test(location.hash);
  try{inTg=inTg||sessionStorage.getItem('yatzy.tg')==='1'}catch(e){}
  const filled=history.length||roster.length||(lsGet('yatzy.rooms')||[]).length||lsGet('yatzy.online');
  const host=new URL(NEW_HOME).host;
  if(inTg){}
  else if(!filled)location.replace(NEW_HOME+location.search+location.hash);
  else{
    const go=moveNote(`Блокнот переехал на <b>${esc(host)}</b>. Откройте его там вместе со всеми партиями и игроками. Если блокнот на экране «Домой», после переезда добавьте его заново и удалите старый значок.`,'Переехать');
    go.onclick=async()=>{
      try{
        const data=await packMove();
        if(data.length>1500000)throw 0;
        location.href=NEW_HOME+'#move='+data;
      }catch(e){moveNote('Не получилось перенести ссылкой. Сохраните копию во вкладке «Статистика» и восстановите её на '+esc(host)+'.')}
    };
  }
}
