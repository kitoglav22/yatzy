// GitHub Pages version only: online play. A room in Firebase Realtime Database holds the shared game
// as one JSON string; every device keeps its own history and achievements.
// the Firebase project's web app config; it is public by design, access is limited by the database rules (database.rules.json)
const FB={apiKey:"AIzaSyCD5cYHREOmhXcU4_89V5TcMf4SOtNAddg",authDomain:"yatzy-654ba.firebaseapp.com",databaseURL:"https://yatzy-654ba-default-rtdb.europe-west1.firebasedatabase.app",projectId:"yatzy-654ba",appId:"1:621596129875:web:808ef98d27ba240cf5a4a6"};
const ROOM_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SYNC=['players','scores','started','ended','dice','roll','log'];
// the shared part of the game; undo history is cut to the last moves to keep the room small
const synced=g=>{const o=pickKeys(g,SYNC);if(o.log)o.log=o.log.slice(-40);return o};
// the Telegram bot listens here: 'enter' when a room is loaded
let roomHook=null;
// the Telegram bot (server/worker.js) looks at a room again when it hears that a cell was written or a game started there;
// it is told through the database, because not every player can reach the bot's server
const botNote=code=>backend().then(b=>b.send(JSON.stringify({op:'moved',code}))).catch(()=>{});
const DEV=lsGet('yatzy.dev')||(()=>{const d=uid()+uid();lsSet('yatzy.dev',d);return d})();
// in Telegram a seat remembers a hash of the account that took it (set by telegram.js), so another account cannot take it over
let myAcct='';
const seatOf=p=>myAcct?{...p,h:myAcct}:(({h,...x})=>x)(p);
// a seat can be continued from another device by the same Telegram account at any time; a seat taken outside Telegram
// only while its device is away; a seat of another Telegram account never
const canTake=(group,on)=>group.every(p=>!p.h||p.h===myAcct)&&(group.some(p=>p.h&&p.h===myAcct)||!(on&&on[group[0].dev]));
const onNow=code=>backend().then(b=>new Promise(res=>{let off=null,done=false;const end=v=>{if(done)return;done=true;res(v||{});setTimeout(()=>off&&off())};off=b.watchOn(code,end);setTimeout(()=>end({}),3000)})).catch(()=>({}));

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
    // a request for the bot, and what the bot publishes for the app
    send(v){return D.push(R('req'),v)},
    read(p){return D.get(R(p)).then(s=>s.val())},
  };
}
function pickKeys(g,keys){const o={};keys.forEach(k=>{if(g[k]!==undefined)o[k]=g[k]});return o}
const finished=g=>!!g.ended||g.players.every((_,i)=>ALL.every(c=>g.scores[i][c.id]!=null));
const roomCode=()=>{const a=new Uint8Array(5);crypto.getRandomValues(a);return [...a].map(x=>ROOM_CHARS[x%ROOM_CHARS.length]).join('')};
// change the room state in a transaction; fn gets the parsed state and returns the new one, or undefined to leave it.
// t is the time of the last change: the bot removes rooms nobody touched for two months
async function txRoom(code,fn){
  const b=await backend();
  const r=await b.tx(code,cur=>{if(cur==null)return null;const s=parseState(cur);if(!s)return;const n=fn(s);if(n===undefined)return;n.t=Date.now();return JSON.stringify(n)});
  return parseState(r.val)||null;
}

// anyone who knows a room code can write to it, so everything that comes from the room is checked
// before it reaches the page: known cells with allowed values, dice 0-6, short names and ids
const okId=x=>typeof x==='string'&&/^[a-z0-9]{1,24}$/.test(x);
const okName=x=>typeof x==='string'&&x.trim().length>0&&x.length<=16;
const cellOk=(id,v)=>{const c=[...ALL,JK].find(c=>c.id===id);return !!c&&(v===null||c.vals.includes(v))};
const okPlayers=ps=>Array.isArray(ps)&&ps.length<=MAXP&&ps.every(p=>p&&okId(p.id)&&okName(p.name)&&okId(p.dev));
const okRoll=r=>r==null||(typeof r==='object'&&Array.isArray(r.dice)&&r.dice.length===5&&r.dice.every(v=>Number.isInteger(v)&&v>=0&&v<=6)
  &&Array.isArray(r.held)&&r.held.length===5&&r.held.every(v=>typeof v==='boolean')&&Number.isInteger(r.n)&&r.n>=0&&r.n<=3&&(r.jokerTaken==null||typeof r.jokerTaken==='boolean'));
const okGame=g=>!!g&&typeof g==='object'&&okPlayers(g.players)&&g.players.length>=2&&Array.isArray(g.scores)&&g.scores.length===g.players.length
  &&g.scores.every(sc=>sc&&typeof sc==='object'&&!Array.isArray(sc)&&Object.entries(sc).every(([k,v])=>cellOk(k,v)))
  &&Number.isFinite(g.started)&&(g.ended==null||typeof g.ended==='boolean')&&(g.dice==null||typeof g.dice==='boolean')&&okRoll(g.roll)
  &&(g.log==null||Array.isArray(g.log)&&g.log.length<=200&&g.log.every(e=>e&&okId(e.pid)&&cellOk(e.cid,e.prev??null)&&okRoll(e.roll)));
// a proposal to end the game early: who proposed it, the devices that agreed, and the game it is about
const okStop=v=>!!v&&typeof v==='object'&&okId(v.by)&&Array.isArray(v.yes)&&v.yes.length<=MAXP&&v.yes.every(okId)&&Number.isFinite(v.g);
const okState=s=>!!s&&typeof s==='object'&&okPlayers(s.players)&&(s.game==null||okGame(s.game))&&(s.prev==null||okGame(s.prev))&&(s.stop==null||okStop(s.stop));
function parseState(str){if(str==null)return null;try{const s=JSON.parse(str);return okState(s)?s:undefined}catch(e){return undefined}}

function makeNet(code){
  const n={code,state:null,on:{},connected:false,loaded:false,last:'',offs:[],q:Promise.resolve(),base:null,tip:null,
    own(i){return !!game&&!!game.players[i]&&game.players[i].dev===DEV},
    mine(i){return n.connected&&n.own(i)},
    // moves go to the room one after another, each only onto the game it was made on (n.base: the room's game as last
    // seen here, n.tip: the latest move still on its way); a move that meets a game someone else has changed in the meantime is not written over it, so
    // neither side's action silently disappears: this device shows what the room has instead
    push(){
      if(!n.connected||!game||!n.state||!n.state.game||game.started!==n.state.game.started)return;
      const g=synced(game),j=JSON.stringify(g);if(j===n.last)return;n.last=j;
      // the bot hears about written cells only, not about every roll
      const cells=x=>x.scores.reduce((a,sc)=>a+ALL.filter(c=>sc[c.id]!=null).length,0);let wrote=false;
      // the base is fixed when the move is made: the room's game, or the previous move from here if that is still on its way
      const base=n.tip!=null?n.tip:n.base;n.tip=j;
      n.q=n.q.then(()=>{
        return txRoom(code,s=>{if(!s.game||s.game.started!==g.started||s.game.ended||base!=null&&JSON.stringify(s.game)!==base)return;wrote=cells(s.game)!==cells(g);s.game=g;s.by=DEV;s.rev=(s.rev||0)+1;return s})
          .then(s=>{if(!s||!s.game||JSON.stringify(s.game)!==j)throw 0;n.base=j;if(n.tip===j)n.tip=null;if(wrote)botNote(code)})})
        .catch(()=>{n.tip=null;if(net!==n)return;toast({badge:'!',label:'Онлайн',name:'Ход не отправился',desc:'показываю то, что сохранено в комнате'},'Онлайн',false);n.resync()});
    },
    resync(){n.last='';if(n.state)n.apply(JSON.stringify(n.state),true)},
    // a reaction only touches s.fx; one per 1.2 s from this device
    react(k){
      const now=Date.now();if(!REACTS[k]||now-(n.fxSent||0)<1200)return;n.fxSent=now;
      const me=game&&game.players.find(p=>p.dev===DEV);showReact(me?me.name:'Вы',REACTS[k]);
      txRoom(code,s=>{s.fx={dev:DEV,e:k,t:now};return s}).catch(()=>{});
    },
    apply(str,force){
      const s=parseState(str);if(s===undefined)return;
      if(!s){if(n.loaded)leaveRoom(true);return}
      const first=!n.loaded,was=n.state&&JSON.stringify([n.state.players,n.state.game,n.state.prev]);n.state=s;n.loaded=true;
      if(first&&roomHook)roomHook('enter',code,s);
      const fx=s.fx,fxNew=fx&&fx.t!==n.fxT;n.fxT=fx&&fx.t;
      // a proposal to end early pops up on the other devices; a refused one tells those who agreed
      const stop=stopOf(s),hadStop=n.stopSeen;n.stopSeen=stop?[stop.by,stop.g,...stop.yes].join():'';
      if(!first&&stop&&!hadStop&&stop.by!==DEV&&gameDevs(s).includes(DEV))toast({badge:'⏹',label:'Онлайн',name:`${esc(devName(s,stop.by))} предлагает закончить`,desc:'ответ под таблицей'},'Онлайн',false);
      if(!first&&hadStop&&!stop&&n.stopMine&&s.game&&!finished(s.game))toast({badge:'▶',label:'Онлайн',name:'Играем дальше',desc:'кто-то не согласился закончить'},'Онлайн',false);
      n.stopMine=!!stop&&stop.yes.includes(DEV);
      if(fxNew&&!first&&fx.dev!==DEV&&REACTS[fx.e]&&Number.isInteger(fx.e)){const p=s.players.find(x=>x.dev===fx.dev);if(p){showReact(p.name,REACTS[fx.e]);buzz('land')}}
      // nothing but a reaction changed: the local game may already be a move ahead of the room, so it stays as it is
      if(!first&&!force&&was===JSON.stringify([s.players,s.game,s.prev])){if(n.stopSeen!==hadStop)render();return}
      // a game that has just started closes the room sheet
      if($('roomsheet')){if(s.game&&!finished(s.game)&&!(game&&game.started===s.game.started))sheet.close();else redrawRoom()}
      // a device that missed the end of the previous game still gets it into its history
      if(s.prev&&s.prev.players.some(p=>p.dev===DEV)&&!history.some(h=>h.started===s.prev.started)&&!(game&&game.started===s.prev.started&&game.saved)){
        const keep=game&&game.started!==s.prev.started?game:null;game=normGame(JSON.parse(JSON.stringify(s.prev)));game.shown=(keep&&keep.shown)||{};
        if(over())archive();game=keep;
      }
      // own writes come back too; the local game is already ahead of them
      if(!force&&s.by===DEV&&!first&&s.game&&game&&game.started===s.game.started)return;
      // what the room has now is what the next move from here builds on
      n.base=s.game?JSON.stringify(s.game):null;
      if(!s.game){if(game&&game.players.some(p=>p.dev)){game=null;lsSet('yatzy.game',null)}render();return}
      const old=game&&game.started===s.game.started?game:null;
      const ng=normGame(JSON.parse(JSON.stringify(s.game)));if(!ng)return;
      ng.log=ng.log||[];
      if(old){ng.saved=old.saved;ng.savedAt=old.savedAt;ng.newAch=old.newAch;ng.shown=old.shown}
      else{const h=history.find(x=>x.started===ng.started);ng.saved=!!h;ng.savedAt=h?h.at:null}
      const prevN=old&&old.roll?old.roll.n:0;
      game=ng;n.last=JSON.stringify(synced(game));
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
      const s=n.state,stop=s&&stopOf(s);
      const ask=!stop||!gameDevs(s).includes(DEV)?'':stop.yes.includes(DEV)
        ?`<div class="confirm"><span>Предложение закончить досрочно. Ждём: ${gameDevs(s).filter(d=>!stop.yes.includes(d)).map(d=>esc(devName(s,d))).join(', ')}.</span><button class="btn" id="sno">Играть дальше</button></div>`
        :`<div class="confirm"><span>${esc(devName(s,stop.by))} предлагает закончить партию досрочно. В статистику она не попадёт.</span><button class="btn danger" id="syes">Закончить</button><button class="btn" id="sno">Играть дальше</button></div>`;
      ac.innerHTML=ask+(canUndo?`<div class="row"><button class="btn" id="undo">↶ Отменить: ${esc(game.players[li].name)}, ${lc.name}</button></div>`:'');
      if(canUndo)$('undo').onclick=undo;
      if($('syes'))$('syes').onclick=()=>voteStop(true);
      if($('sno'))$('sno').onclick=()=>{n.stopMine=false;voteStop(false)};
    },
    again(){if(n.state&&n.state.players.length>=2)startRoomGame();else openRoom()},
    openRoom(){openRoom()},
  };
  return n;
}

// rooms this device left in the middle of a game; "Мои комнаты" brings them back in one tap
const myRooms=()=>(lsGet('yatzy.rooms')||[]).filter(r=>r&&typeof r.code==='string'&&/^[A-Z0-9]{5}$/.test(r.code)&&Array.isArray(r.names));
function keepRoom(code,s){
  const rest=myRooms().filter(r=>r.code!==code);
  if(s)rest.unshift({code,names:(s.game||s).players.map(p=>String(p.name).slice(0,40))});
  lsSet('yatzy.rooms',rest.slice(0,8));
}
function roomList(){
  const rs=myRooms().filter(r=>!net||r.code!==net.code);if(!rs.length)return '';
  return `<p class="muted">Мои комнаты, где партия не закончена:</p><div class="roster">${rs.map(r=>`<button class="pick" data-room="${r.code}"><b class="rcode">${r.code}</b><span>${r.names.map(esc).join(', ')}</span></button>`).join('')}</div>`;
}
function bindRoomList(){
  document.querySelectorAll('[data-room]').forEach(b=>b.onclick=async()=>{
    const code=b.dataset.room;$('nmsg')&&($('nmsg').textContent='Подключаюсь…');
    try{
      if(net)await leaveRoom();
      const err=await startJoin(code);
      if(err){keepRoom(code,null);window.openOnline();$('nmsg').textContent=err}
    }catch(e){if(!$('nmsg'))window.openOnline();$('nmsg').textContent=netErr(e)}
  });
}
// joining: the local game waits on the side and comes back after leaving the room
// a seat taken before seats remembered their Telegram account gets it on the next visit
function stampSeat(code){
  if(!myAcct)return;
  txRoom(code,s=>{if(!s.players.some(p=>p.dev===DEV&&p.h!==myAcct))return;s.players=s.players.map(p=>p.dev===DEV?seatOf(p):p);s.by=DEV;s.rev=(s.rev||0)+1;return s}).catch(()=>{});
}
async function enterRoom(code){
  keepRoom(code,null);stampSeat(code);
  if(!net&&!lsGet('yatzy.online')){lsSet('yatzy.offgame',game&&!game.players.some(p=>p.dev)?game:null);game=null;lsSet('yatzy.game',null)}
  lsSet('yatzy.online',{code});
  if(net)net.offs.forEach(f=>f&&f());
  net=makeNet(code);const me=net;render();
  try{
    const b=await backend();if(net!==me)return;
    me.offs.push(b.connected(c=>{me.connected=c;if(c)b.setOn(code,inApp).catch(()=>{});if(net===me)render()}));
    me.offs.push(b.watch(code,v=>{if(net===me)me.apply(v)}));
    me.offs.push(b.watchOn(code,v=>{me.on=v;if(net===me){renderNet();if($('roomsheet'))redrawRoom()}}));
  }catch(e){if(net===me){me.error=errCode(e)||true;render()}}
}
const errCode=e=>e&&typeof e.code==='string'?e.code:'';
const netErr=e=>e&&e.msg||'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'+(errCode(e)?' ('+errCode(e)+')':'');
// a room that could not connect tries again when the network or the app comes back
const retry=()=>{if(net&&net.error&&navigator.onLine!==false){backendP=null;enterRoom(net.code)}};
window.addEventListener('online',retry);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')retry()});
// a player who switched away counts as "not in the app", so the bot may write to them;
// inside Telegram the app also tells when it is minimized
let inApp=true;
function present(on){inApp=on;const me=net;if(!me||!me.connected)return;backend().then(b=>b.setOn(me.code,on)).catch(()=>{})}
document.addEventListener('visibilitychange',()=>present(document.visibilityState==='visible'));
async function leaveRoom(gone){
  const me=net;if(!me)return;
  const st=me.state;keepRoom(me.code,!gone&&st&&st.game&&!finished(st.game)&&st.players.some(p=>p.dev===DEV)?st:null);
  net=null;me.offs.forEach(f=>f&&f());
  lsSet('yatzy.online',null);
  game=normGame(lsGet('yatzy.offgame'));lsSet('yatzy.offgame',null);lsSet('yatzy.game',game);
  sheet.close();ui.confirm=false;render();
  if(gone){toast({badge:'✕',label:'Онлайн',name:'Комната закрыта',desc:'все игроки вышли'},'Онлайн',false);return}
  try{
    const b=await backend();await b.setOn(me.code,false);
    // players leave the room between games; the last one out removes it
    const s=await txRoom(me.code,s=>{if(s.game&&!finished(s.game))return;s.players=s.players.filter(p=>p.dev!==DEV);if(s.game){s.prev=s.game;s.game=null}return s});
    if(s&&!s.players.length)await b.remove(me.code);
  }catch(e){}
}
// ending a room game early takes every device in it: one proposes, each of the others agrees or refuses
const gameDevs=s=>[...new Set(s.game.players.map(p=>p.dev))];
const devName=(s,dev)=>(s.game.players.find(p=>p.dev===dev)||{name:'Игрок'}).name;
const stopOf=s=>s.stop&&s.game&&!finished(s.game)&&s.stop.g===s.game.started?s.stop:null;
function voteStop(yes){
  const code=net&&net.code;if(!code)return;
  // written without this device's mark, so its own echo is applied here too and the game ends on every screen alike
  txRoom(code,s=>{
    if(!s.game||finished(s.game))return;
    const v=stopOf(s)||(yes?{by:DEV,yes:[],g:s.game.started}:null);if(!v)return;
    if(!yes)delete s.stop;
    else{if(!v.yes.includes(DEV))v.yes.push(DEV);if(gameDevs(s).every(d=>v.yes.includes(d))){s.game.ended=true;delete s.stop}else s.stop=v}
    delete s.by;s.rev=(s.rev||0)+1;return s;
  }).catch(()=>toast({badge:'!',label:'Онлайн',name:'Не получилось',desc:'нет связи с комнатой'},'Онлайн',false));
}
async function startRoomGame(){
  if(!net)return;
  const code=net.code;
  await txRoom(code,s=>{
    if(s.game&&!finished(s.game))return;
    if(s.players.length<2)return;
    // each new game in the room starts with the next player
    const k=(s.round||0)%s.players.length,ps=s.players.slice(k).concat(s.players.slice(0,k));
    s.round=(s.round||0)+1;
    if(s.game)s.prev=s.game;
    delete s.stop;
    s.game={players:ps.map(p=>({id:p.id,name:p.name,dev:p.dev})),scores:ps.map(()=>({})),started:Date.now(),dice:true,roll:newRoll(),log:[]};
    s.by=DEV;s.rev=(s.rev||0)+1;return s;
  }).then(s=>{if(s&&s.game)botNote(code)}).catch(()=>{});
}

function renderNet(){
  const el=$('net');if(!el)return;
  $('sync').textContent=net?'Онлайн-партия хранится в комнате, история и ачивки на этом устройстве':'Всё хранится на этом устройстве';
  if(!net){el.innerHTML='';return}
  const s=net.state,away=s?s.players.filter(p=>p.dev!==DEV&&net.on[p.dev]!==true):[];
  const status=net.error?'не удалось подключиться'+(typeof net.error==='string'?' ('+esc(net.error)+')':''):!net.connected?'подключаюсь…':away.length?`${away.map(p=>esc(p.name)).join(', ')} не в сети`:'все на связи';
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
let inviteVia=null; // set inside Telegram
// set inside Telegram: what the bot knows about each player of the room, a few words for the room sheet
let roomBot=null;
function shareRoom(code){
  const url=location.origin+location.pathname+'#room='+code,text=`Сыграем в Яцзы? Комната ${code}`;
  if(inviteVia)return inviteVia(code,text);
  if(navigator.share)navigator.share({title:'Яцзы',text,url}).catch(()=>{});
  else navigator.clipboard&&navigator.clipboard.writeText(text+': '+url).then(()=>{$('nmsg')&&($('nmsg').textContent='Ссылка скопирована')}).catch(()=>{});
}
function drawRoom(){
  const s=net&&net.state;roomSig=s?JSON.stringify([s.players,s.game&&!finished(s.game),net.on]):'';if(!s){sheet.open(`<h3 id="roomsheet">Комната ${net?net.code:''}</h3><p class="muted">Подключаюсь…</p><div class="row"><button class="btn" id="cancel">Закрыть</button></div>`);$('cancel').onclick=sheet.close;return}
  const playing=s.game&&!finished(s.game),canStart=!playing&&s.players.length>=2;
  sheet.open(`<h3 id="roomsheet">Комната ${net.code}</h3>
    <p class="muted">Друг открывает сайт, нажимает «Играть онлайн» и вводит код. Или отправьте ему ссылку.</p>
    <div class="roomcode">${net.code}</div>
    <div class="roster">${s.players.map((p,i)=>`<div class="pick on"><span class="seat">${i+1}</span><span>${esc(p.name)}${p.dev===DEV?' · это устройство':net.on[p.dev]?'':' · не в сети'}${roomBot?roomBot.mark(net.code,p.id):''}</span></div>`).join('')}</div>
    ${roomList()}
    <p class="muted" id="nmsg">${playing?'Партия идёт. Новые игроки смогут войти, когда она закончится.':s.players.length<2?'Ждём второго игрока.':''}</p>
    <div class="row">${playing&&!stopOf(s)?'<button class="btn" id="nstop">Закончить досрочно</button>':''}${playing?'':`<button class="btn primary" id="nstart" ${canStart?'':'disabled'}>Начать партию</button>`}<button class="btn" id="nshare">Пригласить</button><button class="btn" id="nleave">Выйти из комнаты</button><button class="btn" id="cancel">Закрыть</button></div>`);
  if($('nstart'))$('nstart').onclick=()=>{sheet.close();startRoomGame()};
  if($('nstop'))$('nstop').onclick=()=>{
    if($('nstop').dataset.arm!=='1'){$('nstop').dataset.arm='1';$('nstop').textContent='Предложить закончить';$('nmsg').textContent='Остальные игроки получат вопрос. Партия закончится, когда согласятся все, и в статистику не попадёт.';return}
    sheet.close();voteStop(true);
  };
  $('nshare').onclick=()=>shareRoom(net.code);
  $('nleave').onclick=()=>{
    if(playing&&$('nleave').dataset.arm!=='1'){$('nleave').dataset.arm='1';$('nleave').textContent='Точно выйти?';$('nmsg').textContent='Партия не закончена. Комната останется в списке «Мои комнаты», вернуться можно в одно касание.';return}
    leaveRoom();
  };
  $('cancel').onclick=sheet.close;bindRoomList();
}
function openRoom(){if(net){if(roomBot)roomBot.stale();drawRoom()}}
// back in a room: a game in progress goes straight to the score sheet, otherwise the room sheet
function showRoom(){const s=net&&net.state;if(s&&s.game&&!finished(s.game))sheet.close();else drawRoom()}
// redraw the open room sheet only when its content changes, so a half-done "leave?" survives the other player's rolls
let roomSig='';
function redrawRoom(){const s=net&&net.state,sig=s?JSON.stringify([s.players,s.game&&!finished(s.game),net.on]):'';if(sig!==roomSig)drawRoom()}
// who plays on this device: names from the roster or a new one
function drawPick(title,cta,onGo,taken,code,seats,on){
  const back=seats?[...new Set(seats.map(p=>p.dev))].map(d=>seats.filter(p=>p.dev===d)).filter(g=>canTake(g,on)):[];
  sheet.open(`<h3>${title}</h3><p class="muted">Кто играет на этом устройстве? Можно выбрать нескольких, если вы сидите вместе.</p>
    <div class="roster">${roster.map(r=>{const k=netPick.indexOf(r.id);return `<div class="ritem"><button class="pick${k>=0?' on':''}" data-id="${esc(r.id)}"><span class="seat">${k>=0?'✓':''}</span><span>${esc(r.name)}</span></button></div>`}).join('')}</div>
    <form class="add" id="naddf"><input id="nname" placeholder="Новый игрок" maxlength="16" autocomplete="off" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
    <p class="muted" id="nmsg"></p>
    <div class="row"><button class="btn primary" id="ngo" ${netPick.length?'':'disabled'}>${cta}</button><button class="btn" id="cancel">Отмена</button></div>
    ${back.length?`<p class="muted">Уже играли в этой комнате с другого устройства или из Safari? Продолжите за себя:</p><div class="row">${back.map(g=>`<button class="btn" data-seat="${esc(g[0].id)}">${g.map(p=>esc(p.name)).join(' и ')}</button>`).join('')}</div>`:''}`);
  const redraw=()=>drawPick(title,cta,onGo,taken,code,seats,on);
  document.querySelectorAll('[data-seat]').forEach(b=>b.onclick=async()=>{$('nmsg').textContent='Подключаюсь…';try{await reclaimSeat(code,b.dataset.seat)}catch(e){$('nmsg')&&($('nmsg').textContent=netErr(e))}});
  document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{const id=b.dataset.id,k=netPick.indexOf(id);if(k>=0)netPick.splice(k,1);else if(netPick.length<MAXP-1)netPick.push(id);redraw()});
  $('naddf').onsubmit=e=>{e.preventDefault();const v=$('nname').value.trim().slice(0,16);if(!v)return;
    let r=roster.find(x=>x.name.toLowerCase()===v.toLowerCase());if(!r){r={id:uid(),name:v};roster.push(r);saveRoster()}
    if(!netPick.includes(r.id)&&netPick.length<MAXP-1)netPick.push(r.id);redraw()};
  $('ngo').onclick=async()=>{
    const ps=netPick.map(id=>roster.find(r=>r.id===id)).filter(Boolean);
    const clash=taken?ps.find(p=>taken.some(t=>t.toLowerCase()===p.name.toLowerCase())):null;
    if(clash){$('nmsg').textContent=`В комнате уже есть «${clash.name}». Переименуйте игрока или выберите другого.`;return}
    $('ngo').disabled=true;$('nmsg').textContent='Подключаюсь…';
    try{await onGo(ps)}catch(e){if($('nmsg')){$('nmsg').textContent=netErr(e);$('ngo').disabled=false}}
  };
  $('cancel').onclick=sheet.close;
}
const fail=msg=>{const e=new Error(msg);e.msg=msg;return e};
async function createRoom(ps,fixed){
  for(let t=0;t<(fixed?1:5);t++){
    const code=fixed||roomCode(),st={v:1,players:ps.map(p=>seatOf({id:p.id,name:p.name,dev:DEV})),game:null,by:DEV,rev:1,at:Date.now()};
    const b=await backend(),r=await b.tx(code,cur=>cur==null?JSON.stringify(st):undefined);
    if(r.ok){await enterRoom(code);drawRoom();return}
  }
  // someone opened the same invitation a moment earlier
  if(fixed)return joinRoom(fixed,ps);
  throw fail('Не удалось создать комнату, попробуйте ещё раз.');
}
// an invitation sent through the bot carries a fresh code: the first one to open it creates the room
window.openInvite=async code=>{
  if(net&&net.code===code)return openRoom();
  if(net)await leaveRoom();
  try{
    const s=await txRoom(code,s=>undefined);
    if(s){const err=await startJoin(code);if(err){window.openOnline(code);$('nmsg').textContent=err}return}
    netPick=game&&!game.players.some(p=>p.dev)?game.players.map(p=>p.id).filter(id=>roster.some(r=>r.id===id)).slice(0,1):[];
    drawPick(`Новая комната ${code}`,'Создать комнату',ps=>createRoom(ps,code));
  }catch(e){window.openOnline();$('nmsg').textContent=netErr(e)}
};
async function joinRoom(code,ps){
  let why='';
  const s=await txRoom(code,s=>{
    if(s.players.some(p=>p.dev===DEV))return;
    if(s.game&&!finished(s.game)){why='Партия в этой комнате уже идёт. Войти можно будет, когда она закончится.';return}
    if(s.players.length+ps.length>MAXP){why=`В комнате уже ${s.players.length} игрока, всего можно ${MAXP}.`;return}
    const names=s.players.map(p=>p.name.toLowerCase()),dup=ps.find(p=>names.includes(p.name.toLowerCase()));
    if(dup){why=`В комнате уже есть «${dup.name}». Переименуйте игрока или выберите другого.`;return}
    ps.forEach(p=>s.players.push(seatOf({id:s.players.some(x=>x.id===p.id)?uid():p.id,name:p.name,dev:DEV})));s.by=DEV;s.rev=(s.rev||0)+1;return s;
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
  if(s.players.some(p=>p.dev===DEV)){await enterRoom(code);showRoom();return ''}
  const on=await onNow(code);
  netPick=[];drawPick(`Вход в комнату ${code}`,'Войти',ps=>joinRoom(code,ps),s.players.map(p=>p.name),code,s.players,on);return '';
}
// the same person on a new device, e.g. the invitation opened in Safari and the game continued from the home-screen icon
async function reclaimSeat(code,pid){
  let why='';
  const s=await txRoom(code,s=>{
    const p=s.players.find(x=>x.id===pid);if(!p){why='Такого игрока в комнате больше нет.';return}
    const old=p.dev,group=s.players.filter(x=>x.dev===old);
    if(!group.every(x=>!x.h||x.h===myAcct)){why='Это место занято другим аккаунтом Telegram.';return}
    s.players=s.players.map(x=>x.dev===old?seatOf({...x,dev:DEV}):x);
    [s.game,s.prev].forEach(g=>g&&g.players.forEach(x=>{if(x.dev===old)x.dev=DEV}));
    s.by=DEV;s.rev=(s.rev||0)+1;return s;
  });
  if(!s)throw fail('Комнаты с таким кодом нет. Проверьте код.');
  if(!s.players.some(p=>p.id===pid&&p.dev===DEV))throw fail(why||'Не получилось, попробуйте ещё раз.');
  await enterRoom(code);showRoom();
}
window.openOnline=(code)=>{
  if(net)return openRoom();
  sheet.open(`<h3>Игра онлайн</h3><p class="muted">Каждый играет на своём устройстве. Кубики бросает тот, чей ход, остальные видят каждый бросок. Партия на этом устройстве никуда не денется и вернётся, когда вы выйдете из комнаты.</p>
    <div class="row"><button class="btn primary" id="ncreate">Создать комнату</button></div>
    ${roomList()}
    <form class="add" id="njoin"><input id="ncode" placeholder="Код комнаты" maxlength="5" autocomplete="off" autocapitalize="characters" aria-label="Код комнаты" value="${typeof code==='string'?esc(code):''}"><button class="btn" type="submit">Войти</button></form>
    <p class="muted" id="nmsg"></p><div class="row"><button class="btn" id="cancel">Отмена</button></div>`);
  $('ncreate').onclick=()=>{netPick=game&&!game.players.some(p=>p.dev)?game.players.map(p=>p.id).filter(id=>roster.some(r=>r.id===id)).slice(0,1):[];drawPick('Новая комната','Создать комнату',createRoom)};
  $('njoin').onsubmit=async e=>{e.preventDefault();$('nmsg').textContent='Ищу комнату…';
    try{const err=await startJoin($('ncode').value);if(err&&$('nmsg'))$('nmsg').textContent=err}catch(e){$('nmsg')&&($('nmsg').textContent=netErr(e))}};
  $('cancel').onclick=sheet.close;bindRoomList();
};
if(!FB&&!window.__yatzyNet)delete window.openOnline;
else{
  const saved=lsGet('yatzy.online');if(saved&&typeof saved.code==='string'&&/^[A-Z0-9]{5}$/.test(saved.code))enterRoom(saved.code);
  // an invitation link ends with #room=CODE
  const fromLink=()=>{const m=location.hash.match(/^#room=([A-Za-z0-9]{5})$/);if(!m)return;
    window.history.replaceState(null,'',location.pathname+location.search);if(!net||net.code!==m[1].toUpperCase())window.openOnline(m[1].toUpperCase())};
  window.addEventListener('hashchange',fromLink);fromLink();
  render();
}
