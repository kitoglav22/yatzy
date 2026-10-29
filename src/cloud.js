// claude.ai version only: keep the game, roster and finished games in the artifact's database
(async()=>{
  let db=null;try{db=await window.claude?.use?.('db')}catch(e){}
  if(!db)return;
  const sync=t=>{$('sync').textContent=t};
  let tm=null;
  store={
    saveGame(g){clearTimeout(tm);tm=setTimeout(()=>db.doc('current/game').set({json:JSON.stringify(g),at:Date.now()}).then(()=>sync('Сохранено в облаке')).catch(()=>sync('Сохранено только на этом устройстве')),400)},
    saveRoster(r){db.doc('current/roster').set({json:JSON.stringify(r)}).catch(()=>{})},
    addGame(g){db.collection('games').add(g).then(ref=>{g._doc=ref.id;lsSet('yatzy.hist',history)}).catch(()=>sync('Не удалось сохранить партию в облако'))},
    deleteGame(g){if(g._doc)db.doc('games/'+g._doc).delete().catch(()=>{})},
    updateGame(g){if(!g._doc)return;const {_doc,...data}=g;db.doc('games/'+_doc).set(data).catch(()=>{})}
  };
  try{
    const [gs,rs,hs]=await Promise.all([db.doc('current/game').get(),db.doc('current/roster').get(),db.collection('games').get()]);
    if(rs.exists){try{const r=JSON.parse(rs.data().json);if(Array.isArray(r)&&r.length)roster=r.filter(okPerson).map(x=>({id:x.id,name:x.name}))}catch(e){}}
    if(gs.exists){try{const g=normGame(JSON.parse(gs.data().json));if(g)game=g}catch(e){}}
    ensureRoster(game);
    const remote=hs.docs.map(d=>({...d.data(),_doc:d.id})).filter(okSavedGame),seen=new Set(remote.map(g=>g.at));
    const localOnly=history.filter(g=>!seen.has(g.at));localOnly.forEach(g=>store.addGame(g));
    history=remote.concat(localOnly);
    lsSet('yatzy.hist',history);lsSet('yatzy.roster',roster);lsSet('yatzy.game',game);
    store.saveRoster(roster);
    sync('Сохраняется в облаке');render();
  }catch(e){sync('Нет связи, счёт хранится на устройстве')}
})();
