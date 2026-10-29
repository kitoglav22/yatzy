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
  render();
  // invitations open the bot's Mini App right in the room
  if(TG_APP)inviteVia=(code,text)=>tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(TG_APP+'?startapp='+code)+'&text='+encodeURIComponent(text));
  const sp=String(tg.initDataUnsafe&&tg.initDataUnsafe.start_param||'').toUpperCase();
  let seen='';try{seen=sessionStorage.getItem('yatzy.tgStart')||''}catch(e){}
  if(/^[A-Z2-9]{5}$/.test(sp)&&sp!==seen&&window.openOnline){
    try{sessionStorage.setItem('yatzy.tgStart',sp)}catch(e){}
    if(!net||net.code!==sp)window.openOnline(sp);
  }
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
