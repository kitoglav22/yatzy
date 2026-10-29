// GitHub Pages version only: file backup and offline cache
$('sync').textContent='Всё хранится на этом устройстве';
// share sheet first ("Save to Files" can replace the previous copy), plain download as a fallback
function exportBackup(){
  const json=JSON.stringify({app:'yatzy',v:2,saved:Date.now(),roster,history,game},null,1);
  const name='yatzy-backup.json';
  const done=()=>{
    $('bmsg').textContent='В копии партий: '+history.length+', игроков: '+roster.length;
    lsSet('yatzy.backupAt',history.length);lsSet('yatzy.backupTime',Date.now());render();
  };
  const download=()=>{
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    a.download=name;document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);done();
  };
  let file=null;try{file=new File([json],name,{type:'application/json'})}catch(e){}
  if(file&&navigator.canShare&&navigator.canShare({files:[file]})){
    navigator.share({files:[file],title:'Яцзы: резервная копия'}).then(done).catch(e=>{if(e&&e.name!=='AbortError')download()});
  } else download();
}
$('exp').onclick=exportBackup;
if(navigator.share)shareVia=text=>navigator.share({text,url:location.origin+location.pathname}).catch(()=>{});
$('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text());if(!Array.isArray(d.history))throw 0;
    const seen=new Set(history.map(g=>g.at));let n=0;
    d.history.forEach(g=>{if(okSavedGame(g)&&!seen.has(g.at)){seen.add(g.at);history.push(g);n++}});
    (Array.isArray(d.roster)?d.roster:[]).forEach(r=>{if(okPerson(r)&&!roster.some(x=>x.name===r.name||x.id===r.id))roster.push({id:r.id,name:r.name})});
    lsSet('yatzy.hist',history);saveRoster();render();
    $('bmsg').textContent='Добавлено партий: '+n+'. Всего в истории: '+history.length;
  }catch(_){$('bmsg').textContent='Это не файл копии Яцзы. Выберите файл yatzy-….json'}
  e.target.value='';
};
// a home-screen app can stay open for days: look for a new version whenever it comes back to the foreground
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});
  }).catch(()=>{});
  // reload only when a new version replaces a running one, not on the very first install
  let had=!!navigator.serviceWorker.controller,reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!had){had=true;return}if(reloaded||document.querySelector('.sheet'))return;reloaded=true;location.reload()});
}
// the release number under the page shows whether a new version has arrived
{const v=document.createElement('p');v.className='muted';v.id='ver';v.textContent='Версия /*VERSION*/';$('sync').after(v)}
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
// remind about a backup every 5 finished games, unless the Telegram cloud already keeps every game
let cloudKeeps=false;
function lastBackupText(since){
  const t=lsGet('yatzy.backupTime');
  if(!t)return 'Резервную копию ещё не сохраняли.';
  const d=new Date(t).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
  return 'Последняя копия: '+d+(since>0?', после неё сыграно партий: '+since:', все партии в ней')+'.';
}
window.onAfterRender=()=>{
  const since=history.length-(lsGet('yatzy.backupAt')||0);
  if($('blast'))$('blast').textContent=lastBackupText(since);
  const el=$('remind');if(!el)return;
  if(since>=5&&!cloudKeeps&&(!game||!anyScore()||over())){
    el.innerHTML=`<div class="remind"><span>${lastBackupText(since)} Сохраните копию, чтобы история не потерялась.</span><button class="btn small" id="rexp">Сохранить копию</button></div>`;
    $('rexp').onclick=exportBackup;
  } else el.innerHTML='';
};
render();
