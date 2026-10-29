// rules, game state, storage and totals
const range=(a,b,s=1)=>{const r=[];for(let x=a;x<=b;x+=s)r.push(x);return r};
const UP=[1,2,3,4,5,6].map((n,i)=>({id:'u'+n,name:['Единицы','Двойки','Тройки','Четвёрки','Пятёрки','Шестёрки'][i],hint:'сумма '+['единиц','двоек','троек','четвёрок','пятёрок','шестёрок'][i],vals:range(0,5).map(k=>k*n),par:3*n}));
const LOW=[
  {id:'three',name:'Тройка',hint:'три одинаковых, сумма всех кубиков',vals:[0,...range(5,30)]},
  {id:'four',name:'Каре',hint:'четыре одинаковых, сумма всех кубиков',vals:[0,...range(5,30)]},
  {id:'small',name:'Малый стрит',hint:'четыре подряд',vals:[0,30]},
  {id:'large',name:'Большой стрит',hint:'пять подряд',vals:[0,40]},
  {id:'house',name:'Фулл-хаус',hint:'тройка + пара',vals:[0,25]},
  {id:'chance',name:'Шанс',hint:'сумма всех кубиков',vals:[0,...range(5,30)]},
  {id:'yatzy',name:'Яцзы',hint:'пять одинаковых',vals:[0,50]},
];
const ALL=[...UP,...LOW];
const JK={id:'joker',name:'Джокер',hint:'повторный Яцзы, один раз за игру; в другую клетку 0',vals:[0,100]};
const MAXP=4;
const uid=()=>Math.random().toString(36).slice(2,9);

let roster=[], game=null, history=[], ui={confirm:false}, store=null, net=null;
// in an online room a device acts only for its own players
const mine=i=>!net||net.mine(i);

function normGame(g){
  if(!g||!Array.isArray(g.scores))return null;
  if(!g.players&&Array.isArray(g.names))g.players=g.names.map(n=>({id:uid(),name:n}));
  if(!Array.isArray(g.players)||g.players.length!==g.scores.length)return null;
  delete g.names;
  g.scores.forEach(s=>{delete s.pair;delete s.twopair;if(s.joker>100)s.joker=100});
  return g;
}
function newGameFor(players){const dice=!!lsGet('yatzy.dice');return {players:players.map(p=>({id:p.id,name:p.name})),scores:players.map(()=>({})),started:Date.now(),saved:false,dice,roll:dice?newRoll():null}}
function ensureRoster(g){if(!g)return;g.players.forEach(p=>{const r=roster.find(r=>r.id===p.id||r.name===p.name);if(r)p.id=r.id;else roster.push({id:p.id,name:p.name})})}

function lsGet(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}

function load(){
  roster=lsGet('yatzy.roster')||[];
  const old=lsGet('yatzy.state');
  game=normGame(lsGet('yatzy.game'))||normGame(old);
  history=lsGet('yatzy.hist')||[];
  // an online game keeps other devices' players out of the local roster
  if(game&&!game.players.some(p=>p.dev))ensureRoster(game);
}

function totals(i){
  const s=game.scores[i];let up=0,low=0;
  UP.forEach(c=>{if(s[c.id]!=null)up+=s[c.id]});
  LOW.forEach(c=>{if(s[c.id]!=null)low+=s[c.id]});
  const par=UP.reduce((a,c)=>a+(s[c.id]!=null?s[c.id]-c.par:0),0);
  const upFilled=UP.filter(c=>s[c.id]!=null).length;
  const bonus=up>=63?50:0, jk=s.joker||0;
  return {up,bonus,low,jk,total:up+bonus+low+jk,par,upFilled,filled:ALL.filter(c=>s[c.id]!=null).length};
}
const done=()=>game&&game.players.every((_,i)=>totals(i).filled===ALL.length);
const over=()=>game&&(done()||!!game.ended);
function whoseTurn(){if(!game||over())return -1;const f=game.players.map((_,i)=>totals(i).filled);const m=Math.min(...f);return f.indexOf(m)}
const anyScore=()=>game&&game.scores.some(s=>Object.keys(s).length);

// also used inside attributes, so quotes are escaped too
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const $=id=>document.getElementById(id);
// a short vibration; inside Telegram its haptics are used, they also work on iPhone and iPad
let haptic=null;
function buzz(kind){try{if(haptic)return haptic(kind);navigator.vibrate&&navigator.vibrate(kind==='yatzy'?[40,60,40,60,120]:15)}catch(e){}}
