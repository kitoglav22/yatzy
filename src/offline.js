// GitHub Pages version only: file backup and offline cache
$('sync').textContent='Всё хранится на этом устройстве';
function exportBackup(){
  const blob=new Blob([JSON.stringify({app:'yatzy',v:2,saved:Date.now(),roster,history,game},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='yatzy-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
  $('bmsg').textContent='В копии партий: '+history.length+', игроков: '+roster.length;
  lsSet('yatzy.backupAt',history.length);render();
}
$('exp').onclick=exportBackup;
$('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text());if(!Array.isArray(d.history))throw 0;
    const seen=new Set(history.map(g=>g.at));let n=0;
    d.history.forEach(g=>{if(!seen.has(g.at)){history.push(g);n++}});
    (d.roster||[]).forEach(r=>{if(!roster.some(x=>x.name===r.name))roster.push(r)});
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
  let reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloaded||document.querySelector('.sheet'))return;reloaded=true;location.reload()});
}
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
// remind about a backup every 5 finished games
window.onAfterRender=()=>{
  const el=$('remind');if(!el)return;
  const since=history.length-(lsGet('yatzy.backupAt')||0);
  if(since>=5&&(!game||!anyScore()||over())){
    el.innerHTML=`<div class="remind"><span>С последней резервной копии сыграно партий: ${since}. Сохраните копию, чтобы история не потерялась.</span><button class="btn small" id="rexp">Сохранить копию</button></div>`;
    $('rexp').onclick=exportBackup;
  } else el.innerHTML='';
};
render();
