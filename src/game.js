// the score table, entering scores, players, past games and the two tabs
function render(){
  const tb=$('table');
  if(!game){
    tb.innerHTML=`<tbody><tr><td style="padding:28px 20px;text-align:center"><p style="margin:0 0 14px;font-weight:700">Выберите, кто играет, и начните партию</p><div class="row" style="justify-content:center"><button class="btn primary" id="start0">Выбрать игроков</button>${window.openOnline?'<button class="btn" id="onl0">Играть онлайн</button>':''}</div></td></tr></tbody>`;
    $('start0').onclick=openSetup;if($('onl0'))$('onl0').onclick=window.openOnline;$('banner').innerHTML='';$('actions').innerHTML='';$('legend').innerHTML='';drawTotbar();renderHist();keepAwake();window.onAfterRender&&window.onAfterRender();return;
  }
  const n=game.players.length,T=game.players.map((_,i)=>totals(i)),turn=whoseTurn();
  const catW=n>=4?'30%':n===3?'34%':'40%';
  // a light stripe down your own column (online) or the column on turn (one device), so it is not lost while scrolling
  const me=i=>(net?net.own(i):i===turn)?' me':'';
  // in a room your own column comes first and the others follow in turn order, so your stripe always stands at the same place
  const first=net?Math.max(0,game.players.findIndex((_,i)=>net.own(i))):0,cols=range(0,n-1).map(k=>(first+k)%n);
  let h=`<colgroup><col style="width:${catW}">${game.players.map(()=>'<col>').join('')}</colgroup><thead><tr><th><button class="rulesbtn" data-help="all">Правила</button></th>`;
  h+=cols.map(i=>[game.players[i],i]).map(([p,i])=>`<th class="${turn===i?'active':''}${me(i)}"><div class="ph"><button class="nm" data-ren="${i}" ${net?'disabled':''} aria-label="Переименовать ${esc(p.name)}">${esc(p.name)}</button><span class="tag">ходит</span></div></th>`).join('')+'</tr></thead><tbody>';
  const sug=turn>=0?suggestions(turn):null,topSug=sug?Math.max(...Object.values(sug)):0;
  // a score that has just come in flashes once
  const lm=lastMove(),L=(game.log||[]).length,fresh=seen.game===game.started&&L>seen.n?lm:null;seen.game=game.started;seen.n=L;
  const cell=(i,c)=>{const v=game.scores[i][c.id];
    // only cells that score get a suggestion; a cell worth 0 looks like a plain empty cell, but one tap on it crosses it out
    // (shown as a 0 only right after the joker, when a 0 in any free cell is exactly what is due)
    if(v==null&&i===turn&&sug&&sug[c.id]!=null&&(sug[c.id]>0||game.roll&&game.roll.jokerTaken)&&mine(i)){const x=sug[c.id];
      return `<td class="cell${me(i)}"><button class="sug${x===0?' z':''}${x>0&&x===topSug?' best':''}" data-p="${i}" data-c="${c.id}" data-s="${x}" aria-label="${esc(game.players[i].name)}: ${c.name}, записать ${x}">${x}</button></td>`}
    const cls=(v==null?'empty':v===0?'zero':'')+(fresh&&fresh.i===i&&fresh.c.id===c.id?' flash':'');
    if(v==null&&i===turn&&sug&&sug[c.id]===0&&mine(i))
      return `<td class="cell${me(i)}"><button class="${cls}" data-p="${i}" data-c="${c.id}" data-s="0" aria-label="${esc(game.players[i].name)}: ${c.name}, вычеркнуть">—</button></td>`;
    // on one device someone else's empty cell waits for their turn, with dice on screen or real ones; a written one can still be corrected.
    // In a room only your own empty cells open on your turn, to write what the dice give or cross the cell out
    const shut=net?!(v==null&&i===turn&&mine(i)&&c.id!=='joker'):v==null&&i!==turn;
    return `<td class="cell${me(i)}"><button class="${cls}" data-p="${i}" data-c="${c.id}" ${shut?'disabled':''} aria-label="${esc(game.players[i].name)}: ${c.name}${v===0?', вычеркнуто':''}">${v==null?'—':v===0?'✕':v}</button></td>`};
  const row=c=>`<tr><td><button class="cat" data-help="${c.id}"><b>${c.name}</b><small>${c.hint}</small></button></td>${cols.map(i=>cell(i,c)).join('')}</tr>`;
  const need=t=>{if(t.bonus||!t.upFilled)return '';return t.par>=0?`<span class="need">с запасом +${t.par}</span>`:`<span class="need">отстаёт на ${-t.par}</span>`};
  const sec=t=>`<tr class="section"><td colspan="${n+1}">${t}</td></tr>`;
  h+=sec('Верхняя часть')+UP.map(row).join('');
  h+=`<tr class="sum"><td>Сумма</td>${cols.map(i=>[T[i],i]).map(([t,i])=>`<td class="v${me(i)}">${t.up}</td>`).join('')}</tr>`;
  h+=`<tr class="sum"><td><button class="cat" data-help="bonus"><b>Бонус</b><small>50 очков при 63+</small></button></td>${cols.map(i=>[T[i],i]).map(([t,i])=>`<td class="v${t.bonus?' got':''}${me(i)}">${t.bonus?'+50':'0'}${need(t)}</td>`).join('')}</tr>`;
  h+=sec('Нижняя часть')+LOW.map(row).join('')+row(JK);
  const best=Math.max(...T.map(t=>t.total)),leaders=T.filter(t=>t.total===best).length;
  h+=`<tr class="total"><td>Итого</td>${cols.map(i=>[T[i],i]).map(([t,i])=>`<td class="${t.total===best&&best>0&&leaders===1?'lead':''}${me(i)}">${t.total}</td>`).join('')}</tr></tbody>`;
  tb.innerHTML=h;drawTotbar();
  $('legend').innerHTML=over()||history.length>=5?'':`${game.dice?'<span><i class="lg sug">16</i>можно записать</span><span><i class="lg best">25</i>лучший вариант</span>':''}<span>Нажмите на название, чтобы увидеть правило</span>`;

  const bn=$('banner');
  if(over()){
    const order=T.map((t,i)=>({t:t.total,name:game.players[i].name})).sort((a,b)=>b.t-a.t);
    const msg=leaders>1?`Ничья, ${order.map(o=>o.t).join(' : ')}`:`Победа: ${esc(order[0].name)}, ${order.map(o=>o.t).join(' : ')}`;
    const na=(game.newAch||[]).filter(x=>x.list.length);
    const achHtml=na.length?`<div class="newach">${na.map(x=>`<p><span class="who">${esc(x.name)}</span>${x.list.map(a=>`<span class="achip${a.first?' new':''}">${a.name}</span>`).join('')}</p>`).join('')}${na.some(x=>x.list.some(a=>a.first))?'<p class="muted">Закрашены новые ачивки</p>':''}</div>`:'';
    bn.innerHTML=`<div class="banner"><div><strong>${msg}</strong>${game.ended&&!done()?'<p class="muted" style="margin-top:4px">Партия закончена досрочно.</p>':''}${achHtml}</div><div class="row">${shareVia?'<button class="btn" id="shareres">Поделиться</button>':''}<button class="btn primary" id="again">${net?'Ещё партию':'Новая игра'}</button></div></div>`;
    $('again').onclick=net?net.again:openSetup;
    if($('shareres'))$('shareres').onclick=()=>shareVia(resultText());
  } else bn.innerHTML='';

  const ac=$('actions');
  if(ui.confirm){
    ac.innerHTML=`<div class="confirm"><span>Игра не закончена. Начать заново? Текущий счёт не попадёт в историю.</span><button class="btn danger" id="yes">Да, новая игра</button><button class="btn" id="no">Отмена</button></div>`;
    $('yes').onclick=()=>{ui.confirm=false;render();openSetup()};
    $('no').onclick=()=>{ui.confirm=false;render()};
  } else if(ui.finish){
    ac.innerHTML=`<div class="confirm"><span>Закончить партию сейчас? Она попадёт в историю с текущим счётом, пустые клетки не считаются. Ачивки за неё не начисляются.</span><button class="btn danger" id="fyes">Закончить</button><button class="btn" id="fno">Отмена</button></div>`;
    $('fyes').onclick=()=>{ui.finish=false;game.ended=true;archive();saveGame();render()};
    $('fno').onclick=()=>{ui.finish=false;render()};
  } else if(net){net.actions(ac)
  } else {
    // reordering in the middle of a dice turn would hand the roll to another player
    const midTurn=game.dice&&game.roll&&(game.roll.n>0||game.roll.jokerTaken);
    const last=(game.log||[]).slice(-1)[0],lp=last&&game.players.find(p=>p.id===last.pid),lc=last&&[...ALL,JK].find(c=>c.id===last.cid);
    // on screen: undo, online and «Ещё»; the rest waits in the «Ещё» sheet, so ending a game early takes a deliberate tap
    ac.innerHTML=`<div class="row">${lp&&lc?`<button class="btn" id="undo">↶ Отменить: ${esc(lp.name)}, ${lc.name}</button>`:''}${window.openOnline?'<button class="btn" id="onl">Играть онлайн</button>':''}${over()?'':'<button class="btn" id="more">Ещё</button>'}</div>`;
    if($('onl'))$('onl').onclick=window.openOnline;
    if($('undo'))$('undo').onclick=undo;
    if($('more'))$('more').onclick=()=>openMore(n,midTurn);
  }
  renderDice();renderHist();keepAwake();
  window.onAfterRender&&window.onAfterRender();
}

// the «Ещё» sheet: new game, order, dice or manual entry, and ending the game early
function openMore(n,midTurn){
  sheet.open(`<h3>Партия</h3><div class="more">
    <button class="btn" id="ng">Новая игра</button>
    ${midTurn?'':`<button class="btn" id="sw">${n===2?'Поменять местами':'Сдвинуть порядок'}</button>`}
    <button class="btn" id="dmode">${game.dice?'Ввод вручную':'Кубики на экране'}</button>
    ${anyScore()?'<button class="btn danger" id="fin">Закончить досрочно</button>':''}</div>`);
  const then=f=>()=>{sheet.close();f();render();if(ui.confirm||ui.finish)$('actions').scrollIntoView({behavior:'smooth',block:'center'})};
  $('ng').onclick=then(()=>{if(!anyScore())openSetup();else ui.confirm=true});
  if($('sw'))$('sw').onclick=then(()=>{game.players.push(game.players.shift());game.scores.push(game.scores.shift());saveGame()});
  $('dmode').onclick=then(()=>{game.dice=!game.dice;if(game.dice&&!game.roll)game.roll=newRoll();lsSet('yatzy.dice',game.dice);saveGame()});
  if($('fin'))$('fin').onclick=then(()=>{ui.finish=true});
}

// keep the iPad screen on while a game is in progress
let wl=null;
async function keepAwake(){
  try{
    if(game&&!over()&&document.visibilityState==='visible'){if(!wl&&navigator.wakeLock){wl=await navigator.wakeLock.request('screen');wl.addEventListener('release',()=>{wl=null})}}
    else if(wl){await wl.release();wl=null}
  }catch(e){wl=null}
}
document.addEventListener('visibilitychange',keepAwake);


function setScore(i,cid,v){
  const beforeSc={...game.scores[i]};
  const turnBefore=whoseTurn();
  const entry={pid:game.players[i].id,cid,prev:game.scores[i][cid],roll:game.roll?JSON.parse(JSON.stringify(game.roll)):null};
  // the joker stands only on a Yatzy of 50: correcting that cell takes the joker with it (undo brings both back)
  if(cid==='yatzy'&&v!==50&&game.scores[i].joker!=null){entry.jk=game.scores[i].joker;delete game.scores[i].joker}
  (game.log=game.log||[]).push(entry);
  if(game.log.length>200)game.log.shift();
  if(v==null)delete game.scores[i][cid];else game.scores[i][cid]=v;
  if(v!=null)checkLive(i,beforeSc);
  // in dice mode a score for the player on turn ends the turn, except the joker, after which a 0 is still due
  if(game.dice&&v!=null&&i===turnBefore){if(cid==='joker'&&game.roll)game.roll.jokerTaken=true;else game.roll=newRoll()}
  // clearing someone else's cell can move the turn to them: the roll must not follow
  else if(game.dice&&whoseTurn()!==turnBefore)game.roll=newRoll();
  changed();
}
function undo(){
  const e=(game.log||[]).pop();if(!e)return;
  const i=game.players.findIndex(p=>p.id===e.pid);
  if(i>=0){if(e.prev==null)delete game.scores[i][e.cid];else game.scores[i][e.cid]=e.prev;if(e.jk===100)game.scores[i].joker=100}
  if('roll' in e)game.roll=e.roll;
  if(game.saved)unarchive();
  saveGame();render();
}

function renderHist(){
  if(!$('vstats').hidden)renderStats();
  const list=[...history].sort((a,b)=>b.at-a.at);
  const counted=list.filter(g=>!g.early),wins={};counted.forEach(g=>{if(g.winner!=null)wins[g.winner]=(wins[g.winner]||0)+1});
  const draws=counted.filter(g=>g.winner==null).length;
  $('tally').innerHTML=list.length?Object.entries(wins).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="chip">${esc(k)}: ${v}</span>`).join('')+(draws?`<span class="chip">Ничьи: ${draws}</span>`:''):'';
  $('hist').innerHTML=list.length?list.slice(0,100).map(g=>{
    const d=new Date(g.at).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
    const r=g.players.map(p=>p.name===g.winner?`<b>${esc(p.name)} ${p.total}</b>`:`${esc(p.name)} ${p.total}`).join(' · ');
    return `<li data-at="${g.at}" tabindex="0" role="button"><span class="res">${r}${g.early?'<span class="early">досрочно</span>':''}</span><span class="date">${d}</span></li>`}).join(''):'<li><span class="muted">Здесь появятся сыгранные партии с датой и счётом.</span></li>';
}

const sheet={el:null,
  open(html){$('sheet').innerHTML=`<div class="sheet-bg" id="bg"><div class="sheet" role="dialog" aria-modal="true"><button class="sheetx" id="sheetx" type="button" aria-label="Закрыть">✕</button>${html}</div></div>`;
    $('bg').onclick=e=>{if(e.target.id==='bg')sheet.close()};$('sheetx').onclick=sheet.close;pullDown($('bg').firstElementChild)},
  close(){$('sheet').innerHTML=''}};
document.addEventListener('keydown',e=>{if(e.key==='Escape')sheet.close()});
// a sheet at the bottom of a phone can be pulled down to close: it follows the finger while its content is scrolled to the top,
// and closes past a third of its height or on a quick flick, otherwise springs back
function pullDown(el){
  let y0=null,dy=0,t0=0;
  const back=()=>{el.style.transition='transform .2s ease';el.style.transform=''};
  el.addEventListener('touchstart',e=>{y0=e.touches.length===1&&el.scrollTop<=0&&!matchMedia('(min-width:700px)').matches?e.touches[0].clientY:null;dy=0;t0=performance.now()},{passive:true});
  el.addEventListener('touchmove',e=>{
    if(y0==null)return;dy=e.touches[0].clientY-y0;
    if(dy<=0){if(!el.style.transform)y0=null;else el.style.transform='';return}
    if(e.cancelable)e.preventDefault();
    el.style.transition='none';el.style.transform=`translateY(${dy}px)`;
  },{passive:false});
  el.addEventListener('touchend',()=>{
    if(y0==null)return;y0=null;if(dy<=0)return back();
    if(dy>el.offsetHeight/3||dy>40&&dy/(performance.now()-t0)>.6){el.style.transition='transform .18s ease-in';el.style.transform='translateY(100%)';setTimeout(()=>{if($('sheet').contains(el))sheet.close()},180)}
    else back();
  });
  el.addEventListener('touchcancel',()=>{if(y0!=null){y0=null;back()}});
}

function openCell(i,cid){
  const c=[...ALL,JK].find(x=>x.id===cid),cur=game.scores[i][cid];
  const noJoker=cid==='joker'&&game.scores[i].yatzy!==50;
  // with dice on screen, the player on turn writes what the dice give or 0, and only after a roll
  const r=game.dice&&game.roll,onTurn=r&&cur==null&&i===whoseTurn();
  if(onTurn&&cid!=='joker'){
    const x=r.n?(r.jokerTaken?0:scoreFor(cid,r.dice)):null,vals=x==null?[]:[...new Set([0,x])];
    sheet.open(`<h3>${esc(game.players[i].name)} · ${c.name}</h3><p class="muted">${x==null?'Сначала бросьте кубики.':x?`Кубики дают ${x}. 0 — вычеркнуть.`:'С этими кубиками здесь 0: клетка будет вычеркнута.'}</p>
      ${vals.length?`<div class="vals">${vals.map(v=>`<button data-v="${v}" class="${v===0?'z':''}">${v}</button>`).join('')}</div>`:''}
      <div class="row"><button class="btn" id="cancel">Отмена</button></div>`);
    $('cancel').onclick=sheet.close;
    document.querySelectorAll('.vals button').forEach(b=>b.onclick=()=>setScore(i,cid,+b.dataset.v));
    return;
  }
  sheet.open(`<h3>${esc(game.players[i].name)} · ${c.name}</h3><p class="muted">${c.hint}${cid==='joker'?'':'. 0 — вычеркнуть'}.</p>
    ${cid==='yatzy'&&game.scores[i].joker!=null?'<p class="note">Если здесь будет не 50, джокер тоже сотрётся.</p>':''}
    ${noJoker?'<p class="note">Джокер можно поставить только после Яцзы: сначала впишите 50 в клетку «Яцзы».</p>':`<div class="vals">${c.vals.map(v=>`<button data-v="${v}" class="${v===cur?'sel':''}${v===0?' z':''}">${v}</button>`).join('')}</div>`}
    <div class="row">${cur!=null?'<button class="btn" id="clr">Стереть</button>':''}<button class="btn" id="cancel">Отмена</button></div>`);
  $('cancel').onclick=sheet.close;
  const clr=$('clr');if(clr)clr.onclick=()=>setScore(i,cid,null);
  document.querySelectorAll('.vals button').forEach(b=>b.onclick=()=>setScore(i,cid,+b.dataset.v));
  const f=document.querySelector('.vals .sel')||document.querySelector('.vals button');f&&f.focus();
}
// the latest score written, for the line under the dice and the flash in its cell
let seen={game:null,n:0};
function lastMove(){
  const e=(game.log||[]).slice(-1)[0];if(!e)return null;
  const i=game.players.findIndex(p=>p.id===e.pid),c=[...ALL,JK].find(x=>x.id===e.cid),v=i<0?null:game.scores[i][e.cid];
  return c&&v!=null?{i,c,v}:null;
}
// rules of each combination, opened by tapping its name; the example dice score themselves
const HELP={
  three:['Хотя бы три одинаковых кубика. Записывается сумма всех пяти.',[5,5,5,2,3]],
  four:['Хотя бы четыре одинаковых кубика. Записывается сумма всех пяти.',[6,6,6,6,1]],
  small:['Четыре числа подряд: 1-2-3-4, 2-3-4-5 или 3-4-5-6. Всегда 30 очков.',[1,2,3,4,6]],
  large:['Пять чисел подряд: 1-2-3-4-5 или 2-3-4-5-6. Всегда 40 очков.',[2,3,4,5,6]],
  house:['Три одинаковых и ещё два одинаковых. Всегда 25 очков.',[3,3,3,5,5]],
  chance:['Любые кубики. Записывается сумма всех пяти.',[6,5,4,2,1]],
  yatzy:['Все пять кубиков одинаковые. 50 очков.',[4,4,4,4,4]],
  joker:['Ещё один Яцзы, когда в клетке «Яцзы» уже стоит 50. Даёт 100 очков, один раз за игру. После этого в любую другую свободную клетку ставится 0.',[4,4,4,4,4]],
  bonus:['Если сумма верхней части 63 или больше, добавляется 50 очков. 63 это по три кубика каждого числа. Под бонусом видно, с каким запасом идёт игрок или сколько ему не хватает.'],
};
UP.forEach((c,k)=>{const n=k+1;HELP[c.id]=[`${c.hint[0].toUpperCase()+c.hint.slice(1)}: складываются только кубики с числом ${n}, остальные не считаются.`,[n,n,n,n%6+1,(n+1)%6+1]]});
const miniDice=d=>`<span class="minidice">${d.map(v=>`<span class="die mini">${range(0,8).map(q=>`<i class="${PIPS[v].includes(q)?'on':''}"></i>`).join('')}</span>`).join('')}</span>`;
function openHelp(id){
  const name=x=>x==='bonus'?'Бонус':[...ALL,JK].find(c=>c.id===x).name;
  const pts=x=>x==='joker'?100:scoreFor(x,HELP[x][1]);
  if(id==='all'){
    sheet.open(`<h3>Правила</h3>
      <p>За ход можно бросить кубики до трёх раз. После броска нажмите на кубики, которые хотите оставить, и перебросьте остальные.</p>
      <p>В конце хода запишите очки в любую свободную клетку своей колонки. Если ничего не подходит, вычеркните какую-нибудь клетку нулём. Игра заканчивается, когда все клетки заполнены.</p>
      <dl class="rules"><dt>Единицы … Шестёрки</dt><dd>Сумма кубиков с нужным числом, остальные не считаются. Например, 4 4 4 2 6 в «Четвёрки» дают 12.</dd>${['bonus',...LOW.map(c=>c.id),'joker'].map(x=>`<dt>${name(x)}</dt><dd>${HELP[x][0]}</dd>`).join('')}</dl>
      <div class="row"><button class="btn primary" id="hok">Понятно</button></div>`);
  } else {
    const ex=HELP[id][1];
    sheet.open(`<h3>${name(id)}</h3><p>${HELP[id][0]}</p>
      ${ex?`<div class="example">${miniDice(ex)}<span>Запишется <b>${pts(id)}</b></span></div>`:''}
      ${id==='bonus'?'':'<p class="muted">Любую клетку можно вычеркнуть, записав 0.</p>'}
      <div class="row"><button class="btn primary" id="hok">Понятно</button><button class="btn" id="hall">Все правила</button></div>`);
    $('hall').onclick=()=>openHelp('all');
  }
  $('hok').onclick=sheet.close;
}
function changed(){sheet.close();if(done()&&!game.saved)archive();else if(game.saved&&!over())unarchive();saveGame();render()}
$('table').addEventListener('click',e=>{const hb=e.target.closest('button[data-help]');if(hb)return openHelp(hb.dataset.help);
  if(rolling)return;const b=e.target.closest('button[data-c]');
  if(b&&!mine(+b.dataset.p))return;
  if(b&&b.dataset.s!=null)return setScore(+b.dataset.p,b.dataset.c,+b.dataset.s);
  if(b)return openCell(+b.dataset.p,b.dataset.c);
  const n=e.target.closest('button[data-ren]');if(n)openRename(game.players[+n.dataset.ren].id)});

function renamePlayer(id,name){
  name=name.trim().slice(0,16);
  if(!name)return 'Введите имя';
  if(roster.some(r=>r.id!==id&&r.name.toLowerCase()===name.toLowerCase()))return 'Игрок с таким именем уже есть';
  let r=roster.find(x=>x.id===id);
  const gp=game&&game.players.find(x=>x.id===id);
  if(!r&&gp){r={id,name:gp.name};roster.push(r)}
  if(!r)return 'Игрок не найден';
  const old=r.name;if(old===name)return null;
  r.name=name;if(gp)gp.name=name;
  history.forEach(g=>{let hit=false;
    g.players.forEach(p=>{if(p.id===id||p.name===old){p.name=name;p.id=id;hit=true}});
    if(hit){if(g.winner===old)g.winner=name;store&&store.updateGame&&store.updateGame(g)}});
  if(statFilter===old)statFilter=name;
  lsSet('yatzy.hist',history);saveRoster();if(game)saveGame();render();
  return null;
}
function openRename(id){
  const r=roster.find(x=>x.id===id)||(game&&game.players.find(x=>x.id===id));if(!r)return;
  sheet.open(`<h3>Имя игрока</h3><p class="muted">Имя поменяется и в текущей партии, и в истории.</p>
    <form class="add" id="renf"><input id="renin" maxlength="16" autocomplete="off" aria-label="Новое имя" value="${esc(r.name)}"><button class="btn primary" type="submit">Сохранить</button></form>
    <p class="muted" id="renmsg"></p><div class="row"><button class="btn" id="cancel">Отмена</button></div>`);
  const inp=$('renin');inp.focus();inp.select();
  $('cancel').onclick=sheet.close;
  $('renf').onsubmit=e=>{e.preventDefault();const err=renamePlayer(id,inp.value);if(err)$('renmsg').textContent=err;else sheet.close()};
}

let pick=[],arm=null;
function openSetup(){
  pick=game?game.players.map(p=>p.id).filter(id=>roster.some(r=>r.id===id)):[];arm=null;drawSetup();
}
function editInSetup(id){
  const r=roster.find(x=>x.id===id);if(!r)return;
  const row=document.querySelector(`.del[data-edit="${id}"]`).parentElement;
  row.innerHTML=`<form class="add" style="flex:1"><input maxlength="16" autocomplete="off" aria-label="Новое имя" value="${esc(r.name)}"><button class="btn primary" type="submit">OK</button></form>`;
  const f=row.querySelector('form'),inp=f.querySelector('input');inp.focus();inp.select();
  f.onsubmit=e=>{e.preventDefault();const err=renamePlayer(id,inp.value);if(err){inp.setCustomValidity(err);inp.reportValidity();inp.oninput=()=>inp.setCustomValidity('')}else drawSetup()};
}
function drawSetup(){
  const canStart=pick.length>=2&&pick.length<=MAXP;
  sheet.open(`<h3>Кто играет</h3><p class="muted">Отметьте игроков в порядке хода, от 2 до ${MAXP}.</p>
    <div class="roster">${roster.map(r=>{const k=pick.indexOf(r.id);return `<div class="ritem"><button class="pick${k>=0?' on':''}" data-id="${esc(r.id)}"><span class="seat">${k>=0?k+1:''}</span><span>${esc(r.name)}</span></button><button class="del" data-edit="${esc(r.id)}" aria-label="Переименовать ${esc(r.name)}">✎</button><button class="del${arm===r.id?' arm':''}" data-del="${esc(r.id)}" aria-label="Удалить ${esc(r.name)}">${arm===r.id?'Удалить?':'✕'}</button></div>`}).join('')}</div>
    <form class="add" id="addf"><input id="newname" placeholder="Новый игрок" maxlength="16" autocomplete="off" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
    <div class="row"><button class="btn primary" id="go" ${canStart?'':'disabled'}>Начать игру</button><button class="btn" id="cancel">Отмена</button></div>`);
  document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{const id=b.dataset.id,k=pick.indexOf(id);arm=null;
    if(k>=0)pick.splice(k,1);else if(pick.length<MAXP)pick.push(id);drawSetup()});
  document.querySelectorAll('.del[data-edit]').forEach(b=>b.onclick=()=>editInSetup(b.dataset.edit));
  document.querySelectorAll('.del[data-del]').forEach(b=>b.onclick=()=>{const id=b.dataset.del;
    if(arm===id){roster=roster.filter(r=>r.id!==id);pick=pick.filter(x=>x!==id);arm=null;saveRoster()}else arm=id;drawSetup()});
  $('addf').onsubmit=e=>{e.preventDefault();const v=$('newname').value.trim();if(!v)return;
    let r=roster.find(x=>x.name.toLowerCase()===v.toLowerCase());
    if(!r){r={id:uid(),name:v};roster.push(r);saveRoster()}
    if(!pick.includes(r.id)&&pick.length<MAXP)pick.push(r.id);drawSetup();$('newname').focus()};
  $('go').onclick=()=>{if(over()&&!game.saved)archive();game=newGameFor(pick.map(id=>roster.find(r=>r.id===id)));ui.confirm=false;saveGame();sheet.close();render();window.scrollTo({top:0,behavior:'smooth'})};
  $('cancel').onclick=sheet.close;
}
$('players').onclick=()=>{if(net)return net.openRoom();if(game&&anyScore()&&!over()){ui.confirm=true;render();$('actions').scrollIntoView({behavior:'smooth',block:'center'})}else openSetup()};

// the total row, copied into a bar fixed to the bottom of the screen while the table's own total row is further down;
// the copy keeps the table's column widths, so its numbers stand under their columns.
// The bar goes away only when the real row has come up to exactly where the copy stands, so one replaces the other
// without a jump; its shadow fades out over the last stretch before that
let totGap=0,totRaf=0;
function drawTotbar(){
  let bar=$('totbar');if(!bar){bar=document.createElement('div');bar.id='totbar';bar.hidden=true;document.body.appendChild(bar)}
  const row=document.querySelector('#table tr.total');if(!row){bar.hidden=true;return}
  bar.innerHTML=`<div class="card"><table>${$('table').querySelector('colgroup').outerHTML}<tbody>${row.outerHTML}</tbody></table></div>`;
  totGap=0;placeTotbar();syncTotbar();
}
function placeTotbar(){const bar=$('totbar'),c=$('table').parentElement.getBoundingClientRect();if(bar&&c.width){bar.style.left=c.left+'px';bar.style.width=c.width+'px'}}
function syncTotbar(){
  totRaf=0;const bar=$('totbar'),row=document.querySelector('#table tr.total');if(!bar)return;
  if(!row||$('vgame').hidden||!row.offsetHeight){bar.hidden=true;return}
  // how far the copy's row ends above the bottom of the screen (bottoms, as the real row's top edge runs through the line above it), measured once while the bar is shown
  if(!totGap){const was=bar.hidden;bar.style.visibility='hidden';bar.hidden=false;totGap=innerHeight-bar.querySelector('tr').getBoundingClientRect().bottom;bar.hidden=was;bar.style.visibility=''}
  const d=row.getBoundingClientRect().bottom-(innerHeight-totGap);
  bar.hidden=d<=.5;
  if(!bar.hidden)bar.style.setProperty('--fade',Math.min(1,d/48).toFixed(2));
}
const queueTotbar=()=>{if(!totRaf)totRaf=requestAnimationFrame(syncTotbar)};
addEventListener('scroll',queueTotbar,{passive:true});
addEventListener('resize',()=>{totGap=0;placeTotbar();queueTotbar()});

function archive(){
  const T=game.players.map((_,i)=>totals(i)),best=Math.max(...T.map(t=>t.total)),w=T.filter(t=>t.total===best);
  const g={at:Date.now(),started:game.started,players:game.players.map((p,i)=>({id:p.id,name:p.name,total:T[i].total,scores:{...game.scores[i]}})),
    winner:w.length>1?null:game.players[T.findIndex(t=>t.total===best)].name};
  if(game.ended&&!done())g.early=true;
  const before=computeStats();
  game.saved=true;game.savedAt=g.at;history.push(g);lsSet('yatzy.hist',history);
  const after=computeStats();
  game.newAch=after.players.filter(p=>g.players.some(x=>x.name===p.name)).map(p=>{const b=before.players.find(x=>x.name===p.name);
    return {name:p.name,list:ACH.filter(a=>p.ach[a.id]&&(!b||!b.ach[a.id]||b.ach[a.id].n<p.ach[a.id].n)).map(a=>({id:a.id,name:a.name,first:!b||!b.ach[a.id]}))}});
  // pop up first-time ones not shown during the game; all of the game's achievements are listed under the result
  const pend=[];game.newAch.forEach(x=>x.list.forEach(a=>{if(a.first&&!((game.shown||{})[x.name]||[]).includes(a.id))pend.push({a:ACH.find(z=>z.id===a.id),name:x.name,first:true})}));
  // several at once make one card instead of a stack over the result
  if(pend.length===1)toastLater(pend[0].a,pend[0].name,true);
  else if(pend.length)toastLater({badge:'+'+pend.length,label:'Новые ачивки',name:`${pend.length} ${plural(pend.length,'новая ачивка','новые ачивки','новых ачивок')}`,desc:'список под итогом партии'},[...new Set(pend.map(x=>x.name))].join(', '),true);
  store&&store.addGame(g);renderHist();
}
function unarchive(){
  if(game.savedAt)deleteGame(game.savedAt);
  game.saved=false;game.savedAt=null;game.newAch=null;game.ended=false;
}
function deleteGame(at){
  const g=history.find(x=>x.at===at);if(!g)return;
  history=history.filter(x=>x!==g);lsSet('yatzy.hist',history);
  store&&store.deleteGame&&store.deleteGame(g);
  // the current game stays marked as handled so it is not archived again
  if(game&&game.savedAt===at){game.savedAt=null;game.newAch=null;saveGame()}
  renderHist();
}
function openGame(at){
  const g=history.find(x=>x.at===at);if(!g)return;
  const d=new Date(g.at).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const up=p=>UP.reduce((a,c)=>a+(p.scores[c.id]||0),0);
  const cellv=v=>v==null?'—':v;
  let armed=false;
  const draw=()=>{sheet.open(`<h3>${g.winner?'Победа: '+esc(g.winner):'Ничья'}</h3><p class="muted">${d}${g.early?' · закончена досрочно':''}</p>
    <div class="card scroll"><table class="avg"><thead><tr><th style="width:40%"></th>${g.players.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${UP.map(c=>`<tr><td>${c.name}</td>${g.players.map(p=>`<td>${cellv(p.scores[c.id])}</td>`).join('')}</tr>`).join('')}
    <tr class="t"><td>Бонус</td>${g.players.map(p=>`<td>${up(p)>=63?'+50':'0'}</td>`).join('')}</tr>
    ${[...LOW,JK].map(c=>`<tr><td>${c.name}</td>${g.players.map(p=>`<td>${cellv(p.scores[c.id])}</td>`).join('')}</tr>`).join('')}
    <tr class="t"><td>Итого</td>${g.players.map(p=>`<td>${p.total}</td>`).join('')}</tr></tbody></table></div>
    <div class="row"><button class="btn${armed?' danger':''}" id="gdel">${armed?'Точно удалить?':'Удалить партию'}</button><button class="btn" id="cancel">Закрыть</button></div>`);
    $('cancel').onclick=sheet.close;
    $('gdel').onclick=()=>{if(armed){deleteGame(at);sheet.close()}else{armed=true;draw()}};};
  draw();
}
$('hist').addEventListener('click',e=>{const li=e.target.closest('li[data-at]');if(li)openGame(+li.dataset.at)});
$('hist').addEventListener('keydown',e=>{const li=e.target.closest('li[data-at]');if(li&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openGame(+li.dataset.at)}});
// a finished game as one line for a chat
function resultText(){
  const T=game.players.map((p,i)=>({name:p.name,t:totals(i).total})).sort((a,b)=>b.t-a.t),score=T.map(x=>x.t).join(' : ');
  const head=T.length>1&&T[0].t===T[1].t?`ничья, ${score}`:`победа: ${T[0].name}, ${score}`;
  const fresh=(game.newAch||[]).flatMap(x=>x.list.filter(a=>a.first).map(a=>`${x.name} «${a.name}»`));
  return `Яцзы, ${head}.`+(fresh.length?` Новые ачивки: ${fresh.join(', ')}.`:'')+(game.ended&&!done()?' Партия закончена досрочно.':'');
}
function saveGame(){lsSet('yatzy.game',game);store&&store.saveGame(game);net&&net.push()}
function saveRoster(){lsSet('yatzy.roster',roster);store&&store.saveRoster(roster)}

function setView(v){
  const st=v==='stats';
  $('vgame').hidden=st;$('vstats').hidden=!st;
  // the total bar belongs to the game tab
  if(st){if($('totbar'))$('totbar').hidden=true}else drawTotbar();
  $('tgame').setAttribute('aria-selected',!st);$('tstats').setAttribute('aria-selected',st);
  if(st)renderStats();
}
$('tgame').onclick=()=>{location.hash='';setView('game')};
$('tstats').onclick=()=>{location.hash='stats';setView('stats')};
window.addEventListener('hashchange',()=>setView(location.hash==='#stats'?'stats':'game'));
