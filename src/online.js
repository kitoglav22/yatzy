// GitHub Pages version only: online play. A room in Firebase Realtime Database holds the shared game
// as one JSON string; every device keeps its own history and achievements.
// the Firebase project's web app config; it is public by design, access is limited by the database rules (database.rules.json)
const FB={apiKey:"AIzaSyCD5cYHREOmhXcU4_89V5TcMf4SOtNAddg",authDomain:"yatzy-654ba.firebaseapp.com",databaseURL:"https://yatzy-654ba-default-rtdb.europe-west1.firebasedatabase.app",projectId:"yatzy-654ba",appId:"1:621596129875:web:808ef98d27ba240cf5a4a6"};
const ROOM_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SYNC=['players','scores','started','ended','dice','roll','log'];
const DEV=lsGet('yatzy.dev')||(()=>{const d=uid()+uid();lsSet('yatzy.dev',d);return d})();

let backendP=null;
function backend(){
  if(!backendP)backendP=(window.__yatzyNet?Promise.resolve(window.__yatzyNet()):fbBackend()).catch(e=>{backendP=null;throw e});
  return backendP;
}
async function fbBackend(){
  const base='https://www.gstatic.com/firebasejs/10.12.2/firebase-';
  const [A,U,D]=await Promise.all(['app','auth','database'].map(m=>import(base+m+'.js')));
  const app=A.initializeApp(FB),auth=U.getAuth(app),db=D.getDatabase(app),R=p=>D.ref(db,p);
  // anonymous sign-in: no accounts, but the database only talks to this app
  await new Promise((ok,bad)=>{const off=U.onAuthStateChanged(auth,u=>{if(u){off();ok()}else U.signInAnonymously(auth).catch(bad)})});
  return {
    async tx(code,fn){const r=await D.runTransaction(R(`rooms/${code}/state`),fn,{applyLocally:false});return {ok:r.committed,val:r.snapshot.val()}},
    watch(code,cb){return D.onValue(R(`rooms/${code}/state`),s=>cb(s.val()))},
    watchOn(code,cb){return D.onValue(R(`rooms/${code}/on`),s=>cb(s.val()||{}))},
    setOn(code,on){const r=R(`rooms/${code}/on/${DEV}`);if(on){D.onDisconnect(r).set(false);return D.set(r,true)}D.onDisconnect(r).cancel();return D.set(r,false)},
    remove(code){return D.remove(R(`rooms/${code}`))},
    connected(cb){return D.onValue(R('.info/connected'),s=>cb(!!s.val()))},
  };
}
const pickKeys=(g,keys)=>{const o={};keys.forEach(k=>{if(g[k]!==undefined)o[k]=g[k]});return o};
const finished=g=>!!g.ended||g.players.every((_,i)=>ALL.every(c=>g.scores[i][c.id]!=null));
const roomCode=()=>{const a=new Uint8Array(5);crypto.getRandomValues(a);return [...a].map(x=>ROOM_CHARS[x%ROOM_CHARS.length]).join('')};
// change the room state in a transaction; fn gets the parsed state and returns the new one, or undefined to leave it
async function txRoom(code,fn){
  const b=await backend();
  const r=await b.tx(code,cur=>{if(cur==null)return null;let s;try{s=JSON.parse(cur)}catch(e){return}const n=fn(s);return n===undefined?undefined:JSON.stringify(n)});
  return r.val?JSON.parse(r.val):null;
}

function makeNet(code){
  const n={code,state:null,on:{},connected:false,loaded:false,last:'',offs:[],
    mine(i){return n.connected&&!!game&&!!game.players[i]&&game.players[i].dev===DEV},
    push(){
      if(!n.connected||!game||!n.state||!n.state.game||game.started!==n.state.game.started)return;
      const g=pickKeys(game,SYNC),j=JSON.stringify(g);if(j===n.last)return;n.last=j;
      txRoom(code,s=>{if(!s.game||s.game.started!==g.started)return;s.game=g;s.by=DEV;s.rev=(s.rev||0)+1;return s}).catch(()=>{});
    },
    apply(str){
      const s=str?JSON.parse(str):null;
      if(!s){if(n.loaded)leaveRoom(true);return}
      const first=!n.loaded;n.state=s;n.loaded=true;
      // a game that has just started closes the room sheet
      if($('roomsheet')){if(s.game&&!finished(s.game)&&!(game&&game.started===s.game.started))sheet.close();else drawRoom()}
      // own writes come back too; the local game is already ahead of them
      if(s.by===DEV&&!first&&s.game&&game&&game.started===s.game.started)return;
      if(!s.game){if(game&&game.players.some(p=>p.dev)){game=null;lsSet('yatzy.game',null)}render();return}
      const old=game&&game.started===s.game.started?game:null;
      const ng=normGame(JSON.parse(JSON.stringify(s.game)));if(!ng)return;
      ng.log=ng.log||[];
      if(old){ng.saved=old.saved;ng.savedAt=old.savedAt;ng.newAch=old.newAch;ng.shown=old.shown}
      else{const h=history.find(x=>x.started===ng.started);ng.saved=!!h;ng.savedAt=h?h.at:null}
      const prevN=old&&old.roll?old.roll.n:0;
      game=ng;n.last=JSON.stringify(pickKeys(game,SYNC));
      // achievements of the other devices' players pop up here as well
      if(old)game.players.forEach((p,i)=>{if(p.dev!==DEV&&JSON.stringify(old.scores[i])!==JSON.stringify(game.scores[i]))checkLive(i,old.scores[i]||{})});
      if(over()&&!game.saved)archive();else if(game.saved&&!over()&&old)unarchive();
      lsSet('yatzy.game',game);
      const r=game.roll;
      if(old&&r&&r.n===prevN+1&&!r.jokerTaken)animateRoll(r.dice.map((_,k)=>r.n===1||!r.held[k]));else render();
    },
    actions(ac){
      const last=(game.log||[]).slice(-1)[0],li=last?game.players.findIndex(p=>p.id===last.pid):-1,lc=last&&[...ALL,JK].find(c=>c.id===last.cid);
      const canUndo=li>=0&&lc&&n.mine(li)&&!rolling;
      ac.innerHTML=canUndo?`<div class="row"><button class="btn" id="undo">↶ Отменить: ${esc(game.players[li].name)}, ${lc.name}</button></div>`:'';
      if(canUndo)$('undo').onclick=undo;
    },
    again(){startRoomGame()},
    openRoom(){openRoom()},
  };
  return n;
}

// joining: the local game waits on the side and comes back after leaving the room
async function enterRoom(code){
  if(!net&&!lsGet('yatzy.online'))lsSet('yatzy.offgame',game&&!game.players.some(p=>p.dev)?game:null);
  lsSet('yatzy.online',{code});
  if(net)net.offs.forEach(f=>f&&f());
  net=makeNet(code);const me=net;render();
  try{
    const b=await backend();if(net!==me)return;
    me.offs.push(b.connected(c=>{me.connected=c;if(c)b.setOn(code,true).catch(()=>{});if(net===me)render()}));
    me.offs.push(b.watch(code,v=>{if(net===me)me.apply(v)}));
    me.offs.push(b.watchOn(code,v=>{me.on=v;if(net===me){renderNet();if($('roomsheet'))drawRoom()}}));
  }catch(e){if(net===me){me.error=true;render()}}
}
async function leaveRoom(gone){
  const me=net;if(!me)return;
  net=null;me.offs.forEach(f=>f&&f());
  lsSet('yatzy.online',null);
  game=normGame(lsGet('yatzy.offgame'));lsSet('yatzy.offgame',null);lsSet('yatzy.game',game);
  sheet.close();ui.confirm=false;render();
  if(gone){toast({badge:'✕',name:'Комната закрыта',desc:'все игроки вышли'},'Онлайн',false);return}
  try{
    const b=await backend();await b.setOn(me.code,false);
    // players leave the room between games; the last one out removes it
    const s=await txRoom(me.code,s=>{if(s.game&&!finished(s.game))return;s.players=s.players.filter(p=>p.dev!==DEV);if(s.game)s.game=null;return s});
    if(s&&!s.players.length)await b.remove(me.code);
  }catch(e){}
}
async function startRoomGame(){
  if(!net)return;
  await txRoom(net.code,s=>{
    if(s.game&&!finished(s.game))return;
    if(s.players.length<2)return;
    // each new game in the room starts with the next player
    const k=(s.round||0)%s.players.length,ps=s.players.slice(k).concat(s.players.slice(0,k));
    s.round=(s.round||0)+1;
    s.game={players:ps.map(p=>({id:p.id,name:p.name,dev:p.dev})),scores:ps.map(()=>({})),started:Date.now(),dice:true,roll:newRoll(),log:[]};
    s.by=DEV;s.rev=(s.rev||0)+1;return s;
  }).catch(()=>{});
}

function renderNet(){
  const el=$('net');if(!el)return;
  if(!net){el.innerHTML='';return}
  const s=net.state,away=s?s.players.filter(p=>p.dev!==DEV&&net.on[p.dev]!==true):[];
  const status=net.error?'не удалось подключиться':!net.connected?'подключаюсь…':away.length?`${away.map(p=>esc(p.name)).join(', ')} не в сети`:'все на связи';
  el.innerHTML=`<div class="netbar"><span class="dot${net.connected&&!away.length?' on':''}"></span><span>Онлайн, комната <b>${net.code}</b> · ${status}</span><button class="btn small" id="nroom">Комната</button></div>`;
  $('nroom').onclick=openRoom;
  if(!game){
    const tb=$('table');
    tb.innerHTML=`<tbody><tr><td style="padding:28px 20px;text-align:center"><p style="margin:0 0 14px;font-weight:700">${s&&s.players.length>=2?'Все в сборе? Начинайте партию.':'Ждём второго игрока. Отправьте ему код комнаты.'}</p><div class="row" style="justify-content:center"><button class="btn primary" id="nopen">Открыть комнату</button></div></td></tr></tbody>`;
    $('nopen').onclick=openRoom;
  }
}
const prevAfter=window.onAfterRender;
window.onAfterRender=()=>{prevAfter&&prevAfter();renderNet()};

// sheets
let netPick=[];
function shareRoom(code){
  const url=location.origin+location.pathname+'#room='+code,text=`Сыграем в Яцзы? Комната ${code}`;
  if(navigator.share)navigator.share({title:'Яцзы',text,url}).catch(()=>{});
  else navigator.clipboard&&navigator.clipboard.writeText(text+': '+url).then(()=>{$('nmsg')&&($('nmsg').textContent='Ссылка скопирована')}).catch(()=>{});
}
function drawRoom(){
  const s=net&&net.state;if(!s){sheet.open(`<h3 id="roomsheet">Комната ${net?net.code:''}</h3><p class="muted">Подключаюсь…</p><div class="row"><button class="btn" id="cancel">Закрыть</button></div>`);$('cancel').onclick=sheet.close;return}
  const playing=s.game&&!finished(s.game),canStart=!playing&&s.players.length>=2;
  sheet.open(`<h3 id="roomsheet">Комната ${net.code}</h3>
    <p class="muted">Друг открывает сайт, нажимает «Играть онлайн» и вводит код. Или отправьте ему ссылку.</p>
    <div class="roomcode">${net.code}</div>
    <div class="roster">${s.players.map((p,i)=>`<div class="pick on"><span class="seat">${i+1}</span><span>${esc(p.name)}${p.dev===DEV?' · это устройство':net.on[p.dev]?'':' · не в сети'}</span></div>`).join('')}</div>
    <p class="muted" id="nmsg">${playing?'Партия идёт. Новые игроки смогут войти, когда она закончится.':s.players.length<2?'Ждём второго игрока.':''}</p>
    <div class="row">${playing?'':`<button class="btn primary" id="nstart" ${canStart?'':'disabled'}>Начать партию</button>`}<button class="btn" id="nshare">Пригласить</button><button class="btn" id="nleave">Выйти из комнаты</button><button class="btn" id="cancel">Закрыть</button></div>`);
  if($('nstart'))$('nstart').onclick=()=>{sheet.close();startRoomGame()};
  $('nshare').onclick=()=>shareRoom(net.code);
  $('nleave').onclick=()=>{
    if(playing&&$('nleave').dataset.arm!=='1'){$('nleave').dataset.arm='1';$('nleave').textContent='Точно выйти?';$('nmsg').textContent='Партия не закончена. Вернуться в неё можно будет по тому же коду.';return}
    leaveRoom();
  };
  $('cancel').onclick=sheet.close;
}
function openRoom(){if(net)drawRoom()}
// who plays on this device: names from the roster or a new one
function drawPick(title,cta,onGo,taken){
  sheet.open(`<h3>${title}</h3><p class="muted">Кто играет на этом устройстве? Можно выбрать нескольких, если вы сидите вместе.</p>
    <div class="roster">${roster.map(r=>{const k=netPick.indexOf(r.id);return `<div class="ritem"><button class="pick${k>=0?' on':''}" data-id="${r.id}"><span class="seat">${k>=0?'✓':''}</span><span>${esc(r.name)}</span></button></div>`}).join('')}</div>
    <form class="add" id="naddf"><input id="nname" placeholder="Новый игрок" maxlength="16" autocomplete="off" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
    <p class="muted" id="nmsg"></p>
    <div class="row"><button class="btn primary" id="ngo" ${netPick.length?'':'disabled'}>${cta}</button><button class="btn" id="cancel">Отмена</button></div>`);
  const redraw=()=>drawPick(title,cta,onGo,taken);
  document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{const id=b.dataset.id,k=netPick.indexOf(id);if(k>=0)netPick.splice(k,1);else if(netPick.length<MAXP-1)netPick.push(id);redraw()});
  $('naddf').onsubmit=e=>{e.preventDefault();const v=$('nname').value.trim().slice(0,16);if(!v)return;
    let r=roster.find(x=>x.name.toLowerCase()===v.toLowerCase());if(!r){r={id:uid(),name:v};roster.push(r);saveRoster()}
    if(!netPick.includes(r.id)&&netPick.length<MAXP-1)netPick.push(r.id);redraw()};
  $('ngo').onclick=async()=>{
    const ps=netPick.map(id=>roster.find(r=>r.id===id)).filter(Boolean);
    const clash=taken?ps.find(p=>taken.some(t=>t.toLowerCase()===p.name.toLowerCase())):null;
    if(clash){$('nmsg').textContent=`В комнате уже есть «${clash.name}». Переименуйте игрока или выберите другого.`;return}
    $('ngo').disabled=true;$('nmsg').textContent='Подключаюсь…';
    try{await onGo(ps)}catch(e){$('nmsg').textContent=e&&e.msg||'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';$('ngo').disabled=false}
  };
  $('cancel').onclick=sheet.close;
}
const fail=msg=>{const e=new Error(msg);e.msg=msg;return e};
async function createRoom(ps){
  for(let t=0;t<5;t++){
    const code=roomCode(),st={v:1,players:ps.map(p=>({id:p.id,name:p.name,dev:DEV})),game:null,by:DEV,rev:1,at:Date.now()};
    const b=await backend(),r=await b.tx(code,cur=>cur==null?JSON.stringify(st):undefined);
    if(r.ok){await enterRoom(code);drawRoom();return}
  }
  throw fail('Не удалось создать комнату, попробуйте ещё раз.');
}
async function joinRoom(code,ps){
  let why='';
  const s=await txRoom(code,s=>{
    if(s.players.some(p=>p.dev===DEV))return;
    if(s.game&&!finished(s.game)){why='Партия в этой комнате уже идёт. Войти можно будет, когда она закончится.';return}
    if(s.players.length+ps.length>MAXP){why=`В комнате уже ${s.players.length} игрока, всего можно ${MAXP}.`;return}
    const names=s.players.map(p=>p.name.toLowerCase()),dup=ps.find(p=>names.includes(p.name.toLowerCase()));
    if(dup){why=`В комнате уже есть «${dup.name}». Переименуйте игрока или выберите другого.`;return}
    ps.forEach(p=>s.players.push({id:p.id,name:p.name,dev:DEV}));s.by=DEV;s.rev=(s.rev||0)+1;return s;
  });
  if(!s)throw fail('Комнаты с таким кодом нет. Проверьте код.');
  if(!s.players.some(p=>p.dev===DEV))throw fail(why||'Не получилось войти, попробуйте ещё раз.');
  await enterRoom(code);drawRoom();
}
async function startJoin(code){
  code=code.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length!==5||[...code].some(c=>!ROOM_CHARS.includes(c)))return 'В коде 5 букв и цифр, например K7MPX.';
  // already in this room on this device: just come back
  const s=await txRoom(code,s=>undefined);
  if(!s)return 'Комнаты с таким кодом нет. Проверьте код.';
  if(s.players.some(p=>p.dev===DEV)){await enterRoom(code);drawRoom();return ''}
  netPick=[];drawPick(`Вход в комнату ${code}`,'Войти',ps=>joinRoom(code,ps),s.players.map(p=>p.name));return '';
}
window.openOnline=(code)=>{
  if(net)return openRoom();
  sheet.open(`<h3>Игра онлайн</h3><p class="muted">Каждый играет на своём устройстве. Кубики бросает тот, чей ход, остальные видят каждый бросок. Партия на этом устройстве никуда не денется и вернётся, когда вы выйдете из комнаты.</p>
    <div class="row"><button class="btn primary" id="ncreate">Создать комнату</button></div>
    <form class="add" id="njoin"><input id="ncode" placeholder="Код комнаты" maxlength="5" autocomplete="off" autocapitalize="characters" aria-label="Код комнаты" value="${typeof code==='string'?esc(code):''}"><button class="btn" type="submit">Войти</button></form>
    <p class="muted" id="nmsg"></p><div class="row"><button class="btn" id="cancel">Отмена</button></div>`);
  $('ncreate').onclick=()=>{netPick=game&&!game.players.some(p=>p.dev)?game.players.map(p=>p.id).filter(id=>roster.some(r=>r.id===id)).slice(0,1):[];drawPick('Новая комната','Создать комнату',createRoom)};
  $('njoin').onsubmit=async e=>{e.preventDefault();$('nmsg').textContent='Ищу комнату…';
    try{const err=await startJoin($('ncode').value);if(err&&$('nmsg'))$('nmsg').textContent=err}catch(e){$('nmsg')&&($('nmsg').textContent='Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.')}};
  $('cancel').onclick=sheet.close;
};
if(!FB&&!window.__yatzyNet)delete window.openOnline;
else{
  const saved=lsGet('yatzy.online');if(saved&&saved.code)enterRoom(saved.code);
  // an invitation link ends with #room=CODE
  const fromLink=()=>{const m=location.hash.match(/^#room=([A-Za-z0-9]{5})$/);if(!m)return;
    window.history.replaceState(null,'',location.pathname+location.search);if(!net||net.code!==m[1].toUpperCase())window.openOnline(m[1].toUpperCase())};
  window.addEventListener('hashchange',fromLink);fromLink();
  render();
}
