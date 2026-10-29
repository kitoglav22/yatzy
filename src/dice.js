// on-screen dice: up to three rolls per turn, tap a die to keep it
const PIPS={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
const newRoll=()=>({dice:[0,0,0,0,0],held:[false,false,false,false,false],n:0,jokerTaken:false});
// fair die: crypto random bytes, values 252..255 are re-drawn so every face has exactly 1/6
const rnd6=()=>{try{const a=new Uint8Array(1);do crypto.getRandomValues(a);while(a[0]>=252);return 1+a[0]%6}catch(e){return 1+Math.floor(Math.random()*6)}};
function scoreFor(cid,d){
  const cnt=[0,0,0,0,0,0,0];d.forEach(x=>cnt[x]++);
  const sum=d.reduce((a,b)=>a+b,0),mx=Math.max(...cnt),has=n=>cnt[n]>0;
  const run=(a,b)=>{for(let k=a;k<=b;k++)if(!has(k))return false;return true};
  if(cid[0]==='u'){const n=+cid[1];return n*cnt[n]}
  switch(cid){
    case 'three':return mx>=3?sum:0;
    case 'four':return mx>=4?sum:0;
    case 'small':return run(1,4)||run(2,5)||run(3,6)?30:0;
    case 'large':return run(1,5)||run(2,6)?40:0;
    case 'house':return cnt.includes(3)&&cnt.includes(2)?25:0;
    case 'chance':return sum;
    case 'yatzy':return mx===5?50:0;
  }
  return null;
}
function suggestions(i){
  const r=game.roll,sc=game.scores[i];if(!game.dice||!r||!r.n)return null;
  const out={},isY=Math.max(...[1,2,3,4,5,6].map(n=>r.dice.filter(x=>x===n).length))===5;
  ALL.forEach(c=>{if(sc[c.id]==null)out[c.id]=r.jokerTaken?0:scoreFor(c.id,r.dice)});
  if(sc.joker==null&&!r.jokerTaken&&isY&&sc.yatzy===50)out.joker=100;
  return out;
}
function renderDice(){
  const el=$('dice');
  if(!game||!game.dice||over()){el.innerHTML='';return}
  if(rolling)return;
  const r=game.roll=game.roll||newRoll(),turn=whoseTurn(),who=game.players[turn].name,my=mine(turn),showHeld=r.n>0&&r.n<3&&!r.jokerTaken,canHold=my&&showHeld;
  // a hint while the first turn of the game goes on, after that a line about the latest score
  const lm=lastMove(),first=!(game.log||[]).length;
  const tip=r.jokerTaken&&my?`Джокер записан. Теперь поставьте 0 в любую свободную клетку колонки «${esc(who)}».`
    :first&&my?(!r.n?'Нажмите синюю кнопку со стрелкой, потом на кубики, которые хотите оставить.':r.n<3?'Нажмите на кубики, которые оставить, и бросайте ещё, или выберите клетку.':'Выберите клетку в таблице.')
    :'';
  el.innerHTML=`<div class="dicebar"><div class="dicehead"><span>Ходит <b>${esc(who)}</b></span><span class="dhr"><span class="muted">бросок ${r.n} из 3</span>${!my&&net&&nudgeVia?'<button class="rbtn" id="nudge" aria-label="Поторопить">👉</button>':''}${net&&net.react?'<button class="rbtn" id="rbtn" aria-label="Реакция" aria-expanded="'+!!ui.reacts+'">😊</button>':''}</span></div>
    ${net&&net.react&&ui.reacts?`<div class="reacts">${REACTS.map((e,k)=>`<button data-react="${k}">${e}</button>`).join('')}</div>`:''}
    <div class="dicerow"><div class="dies">${r.dice.map((v,k)=>`<button class="die${showHeld&&r.held[k]?' held':''}${v?'':' blank'}" data-k="${k}" ${canHold?'':'disabled'} aria-label="${v?'Кубик '+v:'Кубик'}${showHeld&&r.held[k]?', держу':''}">${range(0,8).map(q=>`<i class="${v&&PIPS[v].includes(q)?'on':''}"></i>`).join('')}</button>`).join('')}</div>
    <button class="btn primary rollbtn" id="roll" ${!my||r.n>=3||r.jokerTaken?'disabled':''} aria-label="${r.n?'Бросить ещё':'Бросить'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v5h-5"/></svg></button></div>
    ${tip?`<p class="muted">${tip}</p>`:lm?`<p class="muted dnote">Записано: <b>${esc(game.players[lm.i].name)}</b>, ${lm.c.name} ${lm.v||'вычеркнуто'}</p>`:''}</div>`;
  el.querySelectorAll('.die').forEach(b=>b.onclick=()=>{const k=+b.dataset.k;r.held[k]=!r.held[k];saveGame();renderDice()});
  $('roll').onclick=rollDice;
  if($('nudge'))$('nudge').onclick=()=>nudgeVia(net.code,who);
  if($('rbtn')){$('rbtn').onclick=()=>{ui.reacts=!ui.reacts;renderDice()};el.querySelectorAll('[data-react]').forEach(b=>b.onclick=()=>{ui.reacts=false;net.react(+b.dataset.react);renderDice()})}
}
// the result is drawn and saved at once; the animation only reveals it:
// free dice rattle in place, calm down and slam onto the rolled face in random order
let rolling=false;
function setFace(el,v){el.querySelectorAll('i').forEach((p,q)=>p.classList.toggle('on',PIPS[v].includes(q)));el.classList.remove('blank')}
function rollDice(){
  const r=game.roll;if(rolling||!r||r.n>=3||r.jokerTaken||!mine(whoseTurn()))return;
  const free=r.dice.map((_,k)=>!r.held[k]||!r.n);
  if(!r.n)r.held=r.held.map(()=>false);
  free.forEach((f,k)=>{if(f)r.dice[k]=rnd6()});
  r.n++;saveGame();
  animateRoll(free);
}
// also shows a roll made on another device
function animateRoll(free){
  const r=game.roll,els=[...document.querySelectorAll('.die')];
  if(rolling||els.length!==5||$('vgame').hidden){render();return}
  const quick=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bar=document.querySelector('.dicebar');
  const order=free.map((f,k)=>f?k:-1).filter(k=>k>=0);
  rolling=true;$('roll').disabled=true;els.forEach(d=>d.disabled=true);
  if(r.n>=3)els.forEach(d=>d.classList.remove('held'));
  bar.classList.add('rolling');bar.classList.remove('shake');void bar.offsetWidth;if(!quick)bar.classList.add('shake');
  const span=quick?0:1200+Math.random()*1200,stopAt={},next={},face={};
  order.forEach(k=>{stopAt[k]=quick?0:600+Math.random()*(span-600);els[k].classList.remove('held','land');els[k].classList.add('shaking')});
  const t0=performance.now(),j=a=>(Math.random()*2-1)*a;
  const tick=now=>{
    const t=now-t0;
    order.forEach(k=>{
      const d=els[k];if(!d.classList.contains('shaking'))return;
      if(t>=stopAt[k]){d.classList.remove('shaking');d.style.transform='';setFace(d,r.dice[k]);void d.offsetWidth;d.classList.add('land');buzz('land');return}
      const left=(stopAt[k]-t)/stopAt[k],gap=left>.6?45:left>.3?85:150;
      if(!next[k]||now>=next[k]){
        // rattle: random offset and tilt, strong at first and calmer towards the stop
        const a=3+9*left;d.style.transform=`translate(${j(a)}px,${j(a)-a*.6}px) rotate(${j(8+22*left)}deg) scale(${1+.06*left})`;
        let f=rnd6();if(f===face[k])f=f%6+1;face[k]=f;setFace(d,f);next[k]=now+gap;
      }
    });
    if(t<(quick?0:Math.max(...Object.values(stopAt),0))+450)requestAnimationFrame(tick);
    else{
      rolling=false;
      const yz=r.dice.every(v=>v===r.dice[0]);
      render();
      if(yz){const b=document.querySelector('.dicebar');if(b){b.classList.add('yatzy');b.querySelector('.dicehead').firstElementChild.insertAdjacentHTML('beforeend','<span class="yflash">Яцзы!</span>');buzz('yatzy')}}
    }
  };
  requestAnimationFrame(tick);
}
