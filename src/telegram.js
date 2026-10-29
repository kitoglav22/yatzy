// GitHub Pages version only: the same page opened as a Telegram Mini App from the bot.
// Telegram's script is loaded only there; it gives the theme, the back button, haptics, the user's name and room invitations.
const TG_APP=null; // direct link of the Mini App, https://t.me/<bot>/<app>
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
  // invitations open the bot's Mini App right in the room
  if(TG_APP)inviteVia=(code,text)=>tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(TG_APP+'?startapp='+code)+'&text='+encodeURIComponent(text));
  const sp=String(tg.initDataUnsafe&&tg.initDataUnsafe.start_param||'').toUpperCase();
  let seen='';try{seen=sessionStorage.getItem('yatzy.tgStart')||''}catch(e){}
  if(/^[A-Z2-9]{5}$/.test(sp)&&sp!==seen&&window.openOnline){
    try{sessionStorage.setItem('yatzy.tgStart',sp)}catch(e){}
    if(!net||net.code!==sp)window.openOnline(sp);
  }
}
