// GitHub Pages version only: the same page opened as a Telegram Mini App from the bot.
// Telegram's script is loaded only there; it gives the theme, the back button, haptics, the user's name and room invitations.
const TG_APP='https://t.me/k22_yatzy_bot/play'; // direct link of the Mini App
(()=>{
  let inTg=/tgWebApp(Data|Platform|Version)=/.test(location.hash);
  try{if(inTg)sessionStorage.setItem('yatzy.tg','1');else inTg=sessionStorage.getItem('yatzy.tg')==='1'}catch(e){}
  if(!inTg)return;
  const s=document.createElement('script');
  s.src='https://telegram.org/js/telegram-web-app.js';
  s.onload=()=>{const tg=window.Telegram&&window.Telegram.WebApp;if(tg&&tg.platform&&tg.platform!=='unknown')tgSetup(tg)};
  document.head.appendChild(s);
})();
function tgSetup(tg){
  const has=v=>tg.isVersionAtLeast&&tg.isVersionAtLeast(v);
  document.documentElement.classList.add('tg');
  // follow Telegram's light or dark theme, and paint its header and background to match the page
  const theme=()=>{
    document.documentElement.dataset.theme=tg.colorScheme==='dark'?'dark':'light';
    const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    try{if(has('6.1')){tg.setHeaderColor(bg);tg.setBackgroundColor(bg)}if(has('7.10'))tg.setBottomBarColor(bg)}catch(e){}
  };
  theme();tg.onEvent('themeChanged',theme);
  tg.ready();tg.expand();
  // full screen on phones and tablets; the page keeps clear of Telegram's buttons over it
  const insets=()=>{const st=document.documentElement.style,a=tg.safeAreaInset||{},c=tg.contentSafeAreaInset||{};
    st.setProperty('--tg-top',((a.top||0)+(c.top||0))+'px');st.setProperty('--tg-bottom',((a.bottom||0)+(c.bottom||0))+'px');
    document.documentElement.classList.toggle('tgfull',!!tg.isFullscreen)};
  if(has('8.0')){
    ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'].forEach(e=>tg.onEvent(e,insets));insets();
    if(['ios','android'].includes(tg.platform)&&!tg.isFullscreen)try{tg.requestFullscreen()}catch(e){}
  }
  // scrolling the long table must not pull the app down and close it
  try{if(has('7.7'))tg.disableVerticalSwipes()}catch(e){}
  if(has('6.1'))haptic=k=>k==='yatzy'?tg.HapticFeedback.notificationOccurred('success'):tg.HapticFeedback.impactOccurred('medium');
  // Telegram's back button closes an open sheet, then leaves the statistics
  if(has('6.1')){
    const bb=tg.BackButton,sync=()=>{if($('sheet').firstChild||!$('vstats').hidden)bb.show();else bb.hide()};
    bb.onClick(()=>{if($('sheet').firstChild)sheet.close();else if(!$('vstats').hidden)$('tgame').click()});
    new MutationObserver(sync).observe($('sheet'),{childList:true});
    new MutationObserver(sync).observe($('vstats'),{attributes:true,attributeFilter:['hidden']});
    sync();
  }
  // the Telegram name is offered for a new player until it is in the list
  const u=tg.initDataUnsafe&&tg.initDataUnsafe.user,me=u&&[u.first_name,u.last_name].filter(Boolean).join(' ').trim().slice(0,16);
  if(me)new MutationObserver(()=>{const i=$('nname')||$('newname');
    if(i&&!i.value&&!i.dataset.tg&&!roster.some(r=>r.name.toLowerCase()===me.toLowerCase())){i.value=me;i.dataset.tg='1'}}).observe($('sheet'),{childList:true,subtree:true});
  // a finished game goes to a chat with a link to the bot
  shareVia=text=>tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(TG_APP||location.origin+location.pathname)+'&text='+encodeURIComponent(text+' Сыграем?'));
  if(has('6.9')&&tg.CloudStorage)tgCloud(tg);
  tgSection(tg,has);
  // invitations open the bot's Mini App right in the room
  if(TG_APP)inviteVia=(code,text)=>tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(TG_APP+'?startapp='+code)+'&text='+encodeURIComponent(text));
  if(window.openOnline)tgBot(tg,has);
  render();
  // a link with a room code opens that room; NEW-<code> comes from an invitation made in a chat and creates the room
  const sp=String(tg.initDataUnsafe&&tg.initDataUnsafe.start_param||'').toUpperCase();
  let seen='';try{seen=sessionStorage.getItem('yatzy.tgStart')||''}catch(e){}
  const m=sp.match(/^(NEW-)?([A-HJ-NP-Z2-9]{5})$/);
  if(m&&sp!==seen&&window.openOnline){
    try{sessionStorage.setItem('yatzy.tgStart',sp)}catch(e){}
    if(!net||net.code!==m[2])m[1]?window.openInvite(m[2]):window.openOnline(m[2]);
  }
}

// the bot: "your turn" messages and reminders, a nudge for the player on turn, invitations through @bot in any chat, the rating.
// The bot (server/worker.js) runs elsewhere and reads the app's requests from the database within a minute;
// its features show up once it has published pub/bot.
function tgBot(tg,has){
  const ask=(op,data)=>backend().then(b=>b.send(JSON.stringify({op,init:tg.initData,...data}))).catch(()=>{});
  const read=p=>backend().then(b=>b.read(p));
  // asked again until the bot answers, so a bot started while the app is open is found on the next room
  let on=null;const ready=()=>on||(on=read('pub/bot').then(v=>{if(!v)on=null;return !!v},()=>{on=null;return false}));
  const mine=s=>[...new Set(s.players.concat(s.game?s.game.players:[]).filter(p=>p.dev===DEV).map(p=>p.id))];
  // the bot learns which seats in the room are this Telegram account; Telegram asks once whether the bot may write
  roomHook=(ev,code,s)=>{const pids=mine(s);if(pids.length)ready().then(ok=>{if(!ok)return;
    if(lsGet('yatzy.tgAsked')||!has('6.9')||!tg.requestWriteAccess)return ask('hello',{code,pids});
    lsSet('yatzy.tgAsked',1);
    try{tg.requestWriteAccess(ok=>ask('hello',{code,pids,allow:!!ok}))}catch(e){ask('hello',{code,pids})}})};
  // and again each time the app comes back from the background, in case the bot missed the first time
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&net&&net.state)roomHook('back',net.code,net.state)});
  const u=tg.initDataUnsafe&&tg.initDataUnsafe.user;
  // the rating marks one's own line by a hash of the Telegram id, the same as the bot makes
  const myHash=u&&crypto.subtle?crypto.subtle.digest('SHA-256',new TextEncoder().encode('yatzy:'+u.id))
    .then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12)).catch(()=>''):Promise.resolve('');
  ready().then(ok=>{
    if(!ok)return;
    // a nudge goes only to a player the bot can write to, and once an hour from this device
    nudgeVia=async(code,name)=>{
      const say=(title,desc)=>toast({badge:'👉',label:'Бот',name:title,desc},name,false);
      const key='yatzy.nudged.'+code,left=Math.ceil(((lsGet(key)||0)+60*60e3-Date.now())/60e3);
      if(left>0)return say('Уже напомнили',`ещё раз можно через ${left} мин`);
      const p=game&&game.players[whoseTurn()];if(!p)return;
      const can=await read('pub/tg/'+code).then(v=>v?v[p.id]:undefined,()=>null);
      if(can===1){ask('nudge',{code});lsSet(key,Date.now());say('Напомню','бот напишет в течение минуты')}
      else say('Не получится',can===0?'не разрешил боту писать':can===null?'нет связи':'бот его пока не знает: пусть откроет игру из Telegram');
    };
    // the invitation is a card from the bot with a button straight into the room
    if(has('6.7'))inviteVia=code=>tg.switchInlineQuery(code,['users','groups']);
    const sec=document.createElement('section');
    sec.innerHTML='<h2>Рейтинг друзей</h2><p class="muted">Онлайн-партии через Telegram, где хотя бы двое зашли из Telegram. Старт 1000, победа над более сильным даёт больше очков.</p><div class="card"><ol class="records" id="tgrating"><li>Загружаю…</li></ol></div>';
    $('vstats').appendChild(sec);
    const load=()=>Promise.all([read('pub/rating'),myHash]).then(([r,h])=>{const el=$('tgrating');if(!el)return;
      const list=Array.isArray(r)?r.filter(Boolean):[];
      el.innerHTML=!list.length?'<li>Пока пусто: рейтинг появится после первой такой партии</li>'
        :list.map((x,k)=>`<li${h&&x.h===h?' class="me"':''}><span>${k+1}. ${esc(x.name)}</span><span><b>${x.r}</b> <small class="muted">${x.g} парт., ${x.w} побед</small></span></li>`).join('')},
      ()=>{const el=$('tgrating');if(el)el.innerHTML='<li>Рейтинг сейчас недоступен</li>'});
    load();$('tstats').addEventListener('click',load);
    render();
  });
}

// finished games and players also live in the user's Telegram cloud: they survive a cleared cache and show up
// on every device with this Telegram account. One key per game (g<time>), a marker for a deleted one (d<time>).
let tgCloudInfo='';
function tgCloud(tg){
  const cs=tg.CloudStorage,call=(fn,...a)=>new Promise((ok,bad)=>fn.call(cs,...a,(e,v)=>e?bad(e):ok(v)));
  const put=(k,v)=>{const j=JSON.stringify(v);return j.length>4096?Promise.resolve():call(cs.setItem,k,j).catch(()=>{})};
  const plain=g=>{const {_doc,...x}=g;return x};
  store={
    saveGame(){},
    saveRoster(r){put('roster',r.slice(0,60))},
    addGame(g){put('g'+g.at,plain(g))},
    updateGame(g){put('g'+g.at,plain(g))},
    deleteGame(g){call(cs.removeItem,'g'+g.at).catch(()=>{});put('d'+g.at,1)},
  };
  const show=t=>{tgCloudInfo=t;const el=$('tgcloud');if(el)el.textContent=t};
  show('Подключаюсь к облаку Telegram…');
  (async()=>{
    const keys=await call(cs.getKeys),num=k=>+k.slice(1);
    const gone=new Set(keys.filter(k=>k[0]==='d').map(num)),inCloud=new Set(keys.filter(k=>k[0]==='g').map(num));
    const have=new Set(history.map(g=>g.at)),want=keys.filter(k=>k[0]==='g'&&!have.has(num(k))&&!gone.has(num(k)));
    let changed=false;
    for(let i=0;i<want.length;i+=50){
      const vals=await call(cs.getItems,want.slice(i,i+50));
      Object.values(vals||{}).forEach(v=>{try{const g=JSON.parse(v);if(okSavedGame(g)&&!have.has(g.at)){history.push(g);have.add(g.at);changed=true}}catch(e){}});
    }
    // deleted on another device
    const n=history.length;history=history.filter(g=>!gone.has(g.at));if(history.length!==n)changed=true;
    if(keys.includes('roster')){try{const r=JSON.parse(await call(cs.getItem,'roster'));
      if(Array.isArray(r))r.forEach(x=>{if(x&&typeof x.id==='string'&&typeof x.name==='string'&&x.name.length<=16&&!roster.some(y=>y.name===x.name||y.id===x.id)){roster.push({id:x.id,name:x.name});changed=true}})}catch(e){}}
    if(changed){lsSet('yatzy.hist',history);lsSet('yatzy.roster',roster);render()}
    // what is only on this device goes up
    history.filter(g=>!inCloud.has(g.at)).forEach(g=>store.addGame(g));
    store.saveRoster(roster);
    show(`Партии и игроки сохраняются в облаке Telegram и видны на всех ваших устройствах с этим аккаунтом. Сейчас там партий: ${history.length}.`);
  })().catch(()=>show('Облако Telegram недоступно, партии хранятся только на этом устройстве.'));
}
// a Telegram block on the statistics tab: the cloud and an icon on the home screen
function tgSection(tg,has){
  const sec=document.createElement('section');
  sec.innerHTML='<h2>Telegram</h2><p class="muted" id="tgcloud"></p><div class="row" id="tghome"></div>';
  $('vstats').appendChild(sec);$('tgcloud').textContent=tgCloudInfo||'Партии хранятся на этом устройстве.';
  if(!has('8.0')||!tg.addToHomeScreen)return;
  const draw=st=>{const el=$('tghome');if(!el)return;
    el.innerHTML=st==='added'?'<p class="muted">Иконка уже на экране «Домой».</p>':st==='unsupported'?'':'<button class="btn" id="tgadd">Иконка на экран «Домой»</button>';
    if($('tgadd'))$('tgadd').onclick=()=>tg.addToHomeScreen()};
  try{tg.checkHomeScreenStatus(draw)}catch(e){draw('unknown')}
  tg.onEvent('homeScreenAdded',()=>draw('added'));
}
