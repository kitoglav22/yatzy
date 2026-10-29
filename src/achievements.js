// achievements: pop-ups during the game, statistics and the achievement grid
// achievement pop-ups, only for a player's first time (repeats are still counted in the statistics and listed under the result):
// ones that depend only on a player's own cells show up as soon as they are earned, the rest (wins, streaks, records) when the game ends
const LIVE=['yatzy','joker','bonus','upper80','sixes','ladder','chance','ones','chance30','nochance','low150','fullset','solid'];
function toast(a,name,first){
  const box=$('toasts');if(!box)return;
  const t=document.createElement('div');t.className='toast'+(first?' first':'');
  t.innerHTML=`<span class="badge">${a.badge}</span><div style="min-width:0"><small>${a.label||(first?'Новая ачивка':'Ачивка')}</small><b>${a.name}</b><span class="who">${esc(name)} · ${a.desc}</span></div>`;
  const kill=()=>{if(t.classList.contains('out'))return;t.classList.add('out');setTimeout(()=>t.remove(),260)};
  t.onclick=kill;box.appendChild(t);setTimeout(kill,4200);
  while(box.children.length>4)box.firstChild.remove();
}
let toastQ=Promise.resolve();
function toastLater(a,name,first){toastQ=toastQ.then(()=>new Promise(r=>{toast(a,name,first);setTimeout(r,600)}))}
function liveCtx(sc){const up=UP.reduce((a,c)=>a+(sc[c.id]||0),0),low=LOW.reduce((a,c)=>a+(sc[c.id]||0),0);return {sc,up,low,p:{total:0},s:{}}}
function hadBefore(name,id){return history.some(g=>!g.early&&g.players.some(p=>p.name===name&&ACH.find(a=>a.id===id).t(liveCtx(p.scores||{}))))}
function checkLive(i,beforeSc){
  const sc=game.scores[i],name=game.players[i].name,shown=(game.shown=game.shown||{})[name]=(game.shown[name]||[]);
  ACH.filter(a=>LIVE.includes(a.id)).forEach(a=>{
    if(shown.includes(a.id))return;
    if(a.t(liveCtx(sc))&&!a.t(liveCtx(beforeSc))){shown.push(a.id);if(!hadBefore(name,a.id))toastLater(a,name,true)}
  });
}

// statistics and achievements, computed from finished games
const ACH=[
  {id:'win',badge:'1',name:'Первая победа',desc:'выиграть партию',t:c=>c.won},
  {id:'yatzy',badge:'50',name:'Яцзы!',desc:'выбросить Яцзы',t:c=>c.sc.yatzy===50},
  {id:'joker',badge:'+100',name:'Джокер',desc:'выбросить Яцзы второй раз',t:c=>c.sc.joker===100},
  {id:'bonus',badge:'63',name:'Бонус',desc:'набрать 63+ в верхней части',t:c=>c.up>=63},
  {id:'upper80',badge:'80',name:'Верхний этаж',desc:'80+ в верхней части',t:c=>c.up>=80},
  {id:'sixes',badge:'6×5',name:'Пять шестёрок',desc:'30 в «Шестёрках»',t:c=>c.sc.u6===30},
  {id:'ladder',badge:'4+5',name:'Лестница',desc:'оба стрита в одной партии',t:c=>c.sc.small===30&&c.sc.large===40},
  {id:'fullset',badge:'7/7',name:'Полный набор',desc:'ни одного нуля в нижней части',t:c=>LOW.every(x=>c.sc[x.id]>0)},
  {id:'clean',badge:'0×0',name:'Без потерь',desc:'ни одного вычёркивания за партию',t:c=>c.zeros===0},
  {id:'chance',badge:'27+',name:'Не упустил шанс',desc:'27+ в «Шансе»',t:c=>c.sc.chance>=27},
  {id:'s250',badge:'250',name:'Четверть тысячи',desc:'250+ очков за партию',t:c=>c.p.total>=250},
  {id:'s300',badge:'300',name:'Трёхсотка',desc:'300+ очков за партию',t:c=>c.p.total>=300},
  {id:'crush',badge:'+100',name:'Разгром',desc:'победить с отрывом 100+',t:c=>c.won&&c.margin>=100},
  {id:'photo',badge:'≤5',name:'Фотофиниш',desc:'победить с отрывом до 5 очков',t:c=>c.won&&c.margin>0&&c.margin<=5},
  {id:'streak3',badge:'×3',name:'Серия',desc:'3 победы подряд',t:c=>c.s.streak===3},
  {id:'streak5',badge:'×5',name:'Неудержимый',desc:'5 побед подряд',t:c=>c.s.streak===5},
  {id:'grave',badge:'✕5',name:'Кладбище',desc:'вычеркнуть 5+ клеток за партию',t:c=>c.zeros>=5},
  {id:'g10',badge:'10',name:'Завсегдатай',desc:'сыграть 10 партий',t:c=>c.s.games===10},
  {id:'g50',badge:'50',name:'Полсотни',desc:'сыграть 50 партий',t:c=>c.s.games===50},
  {id:'s200',badge:'200',name:'Разминка',desc:'200+ очков за партию',t:c=>c.p.total>=200},
  {id:'low150',badge:'150',name:'Нижний этаж',desc:'150+ в нижней части',t:c=>c.low>=150},
  {id:'exact63',badge:'=63',name:'Впритык',desc:'ровно 63 в верхней части',t:c=>c.up===63},
  {id:'almost',badge:'60–62',name:'Чуть-чуть не хватило',desc:'60–62 в верхней части',t:c=>c.up>=60&&c.up<=62},
  {id:'solid',badge:'3+',name:'Крепкий середняк',desc:'в каждой клетке верха минимум три кубика',t:c=>UP.every(x=>c.sc[x.id]>=x.par)},
  {id:'ones',badge:'1×5',name:'Пять единиц',desc:'5 в «Единицах»',t:c=>c.sc.u1===5},
  {id:'chance30',badge:'30',name:'Максимальный шанс',desc:'30 в «Шансе»',t:c=>c.sc.chance===30},
  {id:'noyatzy',badge:'250',name:'Без Яцзы, но 250+',desc:'250+ очков без Яцзы',t:c=>c.p.total>=250&&!(c.sc.yatzy>0)},
  {id:'nochance',badge:'0',name:'Пустой шанс',desc:'0 в «Шансе»',t:c=>c.sc.chance===0},
  {id:'crushed',badge:'−100',name:'Разгромлен',desc:'проиграть на 100+ очков',t:c=>!c.won&&c.behind>=100},
  {id:'draw',badge:'=',name:'Ничья',desc:'сыграть вничью',t:c=>c.draw&&c.p.total===c.top},
  {id:'comeback',badge:'↺',name:'Камбэк',desc:'победить после трёх поражений подряд',t:c=>c.won&&c.lossRun>=3},
  {id:'record',badge:'PB',name:'Новый личный рекорд',desc:'побить свой лучший счёт, с 4-й партии',t:c=>c.s.games>=4&&c.p.total>c.prevBest},
  {id:'steady',badge:'5×200',name:'Стабильность',desc:'5 партий подряд по 200+',t:c=>c.s.run200===5},
  {id:'night',badge:'00:00',name:'Полуночник',desc:'закончить партию после полуночи',t:c=>c.hour<5},
  {id:'marathon',badge:'5/день',name:'Марафон',desc:'5 партий за один день',t:c=>c.dayN===5},
  {id:'g100',badge:'100',name:'Сотня',desc:'сыграть 100 партий',t:c=>c.s.games===100},
];

function computeStats(){
  const games=[...history].sort((a,b)=>a.at-b.at),P={},rec={best:null,margin:null,worst:null};
  const get=n=>P[n]||(P[n]={name:n,games:0,wins:0,sum:0,best:0,worst:Infinity,bonus:0,yatzy:0,joker:0,zeros:{},cat:{},streak:0,bestStreak:0,ach:{},last:[],lossRun:0,run200:0,days:{}});
  games.forEach(g=>{
    const sorted=[...g.players].sort((a,b)=>b.total-a.total);
    const margin=sorted.length>1?sorted[0].total-sorted[1].total:0;
    if(g.winner&&(!rec.margin||margin>rec.margin.v))rec.margin={v:margin,who:g.winner,at:g.at};
    g.players.forEach(p=>{
      const s=get(p.name),sc=p.scores||{},won=g.winner===p.name,prevBest=s.best,lossRun=s.lossRun;
      const up=UP.reduce((a,c)=>a+(sc[c.id]||0),0),zeros=ALL.filter(c=>sc[c.id]===0).length;
      s.games++;s.sum+=p.total;s.best=Math.max(s.best,p.total);s.worst=Math.min(s.worst,p.total);s.last.push(won);
      if(up>=63)s.bonus++;if(sc.yatzy===50)s.yatzy++;if(sc.joker===100)s.joker++;
      ALL.forEach(c=>{if(sc[c.id]==null)return;(s.cat[c.id]=s.cat[c.id]||[]).push(sc[c.id]);if(sc[c.id]===0)s.zeros[c.id]=(s.zeros[c.id]||0)+1});
      (s.cat.joker=s.cat.joker||[]).push(sc.joker||0);
      if(won){s.wins++;s.streak++;s.bestStreak=Math.max(s.bestStreak,s.streak);s.lossRun=0}else{s.streak=0;if(g.winner)s.lossRun++}
      s.run200=p.total>=200?s.run200+1:0;
      const dk=new Date(g.at).toDateString();s.days[dk]=(s.days[dk]||0)+1;
      if(!rec.best||p.total>rec.best.v)rec.best={v:p.total,who:p.name,at:g.at};
      if(!rec.worst||p.total<rec.worst.v)rec.worst={v:p.total,who:p.name,at:g.at};
      const low=LOW.reduce((a,c)=>a+(sc[c.id]||0),0),top=sorted[0].total;
      const c={p,sc,up,low,won,margin,zeros,s,prevBest,lossRun,top,behind:top-p.total,draw:!g.winner&&g.players.length>1,hour:new Date(g.at).getHours(),dayN:s.days[dk]};
      if(!g.early)ACH.forEach(a=>{if(a.t(c)){const r=s.ach[a.id]||(s.ach[a.id]={n:0,first:g.at});r.n++}});
    });
  });
  return {players:Object.values(P).sort((a,b)=>b.wins-a.wins||b.games-a.games),rec,count:games.length};
}

const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const fmt=x=>Math.round(x).toLocaleString('ru-RU');
const pct=(a,b)=>b?Math.round(100*a/b)+'%':'—';
const day=t=>new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
let statFilter=null;

function renderStats(){
  const st=computeStats(),el=$('stats');
  if(!st.count){
    el.innerHTML=`<div class="card" style="padding:20px"><p style="margin:0 0 6px;font-weight:700">Статистика появится после первой законченной партии</p><p class="muted">Здесь будут победы, средний счёт, рекорды и средние очки по каждой клетке. Ниже все ачивки, которые можно открыть.</p></div>`+achGrid(st);
    return;
  }
  let h=`<div class="pcards">${st.players.map(p=>{
    const z=Object.entries(p.zeros).sort((a,b)=>b[1]-a[1])[0];
    const zc=z?[...ALL].find(c=>c.id===z[0]).name:'—';
    return `<div class="pcard"><h3>${esc(p.name)}</h3>
      <div class="big"><b>${p.wins}</b><span class="muted">${plural(p.wins,'победа','победы','побед')} из ${p.games} · ${pct(p.wins,p.games)}</span></div>
      ${p.streak>=2?`<span class="streak">${p.streak} ${plural(p.streak,'победа','победы','побед')} подряд</span>`:''}
      <dl class="kv"><dt>Средний счёт</dt><dd>${fmt(p.sum/p.games)}</dd><dt>Лучший / худший</dt><dd>${p.best} / ${p.worst}</dd>
      <dt>Бонус взят</dt><dd>${pct(p.bonus,p.games)}</dd><dt>Яцзы</dt><dd>${p.yatzy} из ${p.games}</dd><dt>Джокеров</dt><dd>${p.joker}</dd>
      <dt>Лучшая серия побед</dt><dd>${p.bestStreak}</dd><dt>Чаще вычёркивает</dt><dd>${zc}</dd></dl></div>`}).join('')}</div>`;
  const r=st.rec;
  h+=`<section><h2>Рекорды</h2><div class="card"><ul class="records">
    <li><span>Самый большой счёт</span><span><b>${r.best.v}</b> · ${esc(r.best.who)}, ${day(r.best.at)}</span></li>
    ${r.margin?`<li><span>Самый крупный отрыв</span><span><b>${r.margin.v}</b> · ${esc(r.margin.who)}, ${day(r.margin.at)}</span></li>`:''}
    <li><span>Самый скромный счёт</span><span><b>${r.worst.v}</b> · ${esc(r.worst.who)}, ${day(r.worst.at)}</span></li>
    <li><span>Сыграно партий</span><span><b>${st.count}</b></span></li></ul></div></section>`;
  const ps=st.players;
  h+=`<section><h2>Средние очки по клеткам</h2><div class="card scroll"><table class="avg"><thead><tr><th style="width:40%"></th>${ps.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${[...ALL,JK].map(c=>{const vals=ps.map(p=>avg(p.cat[c.id]||[]));const mx=Math.max(...vals);
      return `<tr><td>${c.name}</td>${vals.map(v=>`<td class="${ps.length>1&&v===mx&&v>0?'hi':''}">${v?v.toFixed(1).replace('.',','):'0'}</td>`).join('')}</tr>`}).join('')}
  </tbody></table></div></section>`;
  el.innerHTML=h+achGrid(st);
  el.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{statFilter=b.dataset.n||null;renderStats()});
}

function achGrid(st){
  const ps=st.players,sel=ps.find(p=>p.name===statFilter);
  const seg=ps.length>1?`<div class="seg"><button class="${sel?'':'on'}" data-n="">Все</button>${ps.map(p=>`<button class="${sel===p?'on':''}" data-n="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>`:'';
  const pool=sel?[sel]:ps,cmp=!sel&&ps.length>1;
  const score=ps.length?`<div class="tally">${ps.map(p=>`<span class="chip">${esc(p.name)}: ${ACH.filter(a=>p.ach[a.id]).length} из ${ACH.length}</span>`).join('')}</div>`:'';
  return `<section><h2>Ачивки</h2>${score}${seg}<div class="achs">${ACH.map(a=>{
    const who=pool.filter(p=>p.ach[a.id]);
    const pills=cmp?pool.map(p=>p.ach[a.id]?`<span>${esc(p.name)}${p.ach[a.id].n>1?' ×'+p.ach[a.id].n:''}</span>`:`<span class="no">${esc(p.name)}</span>`).join('')
      :who.map(p=>`<span>${p.ach[a.id].n>1?'×'+p.ach[a.id].n:'есть'}</span>`).join('');
    return `<div class="ach${who.length?'':' off'}"><span class="badge">${a.badge}</span><div style="min-width:0"><b>${a.name}</b><small>${a.desc}</small>${pills&&(who.length||cmp)?`<div class="who">${pills}</div>`:''}</div></div>`}).join('')}</div></section>`;
}

