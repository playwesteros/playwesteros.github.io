/* Vertical number wheels: replace every troop and gold number box. The boxes stay in the page (hidden) so the game code is unchanged. Also builds the single Decrees menu. */
(function(){
  const $=id=>document.getElementById(id);
  const NS='http://www.w3.org/2000/svg',SWEEP=135;
  const polar=(r,d)=>{const a=d*Math.PI/180;return [100+r*Math.sin(a),100-r*Math.cos(a)]};
  const arc=(r,f,t)=>{const [x1,y1]=polar(r,f),[x2,y2]=polar(r,t);return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${(t-f)>180?1:0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`};
  const el=(n,a,p)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e};

  const ROW=40;
  const IMG=name=>'./assets/'+name+'.png?v=4';
  function Wheel(mount,o){
    let min=0,max=0,value=0,items=[];
    const rows=o.rows||3,pad=((rows-1)/2)*ROW;
    const root=document.createElement('div');root.className='wv';
    const view=document.createElement('div');view.className='wv-view';view.tabIndex=0;view.setAttribute('role','spinbutton');view.setAttribute('aria-label',o.label);
    view.style.height=(rows*ROW)+'px';
    const list=document.createElement('div');list.className='wv-list';list.style.paddingBlock=pad+'px';
    view.appendChild(list);
    const band=document.createElement('div');band.className='wv-band';band.style.height=ROW+'px';band.style.top=pad+'px';
    const cap=document.createElement('div');cap.className='wv-cap';
    const head=document.createElement('div');head.className='wv-head';
    const ic=document.createElement('img');ic.className='wv-icon';ic.alt='';head.appendChild(ic);
    function setIcon(name){if(name){const src=IMG(name);if(ic.getAttribute('src')!==src)ic.setAttribute('src',src);head.hidden=false}else head.hidden=true}
    root.append(view,band,cap);mount.append(head,root);
    const clamp=v=>Math.max(min,Math.min(max,Math.round(v)));
    function build(){
      list.textContent='';items=[];
      for(let n=min;n<=max;n++){const d=document.createElement('div');d.className='wv-item';d.textContent=n;d.dataset.n=n;list.appendChild(d);items.push(d)}
    }
    function mark(){items.forEach((d,i)=>d.classList.toggle('sel',min+i===value));}
    function show(){
      const dis=max<=min;root.dataset.disabled=dis;
      view.setAttribute('aria-valuemin',min);view.setAttribute('aria-valuemax',max);view.setAttribute('aria-valuenow',value);
      cap.textContent=o.unit+(dis?'':'  \u00b7  '+min+' to '+max);
      view.scrollTop=(value-min)*ROW;mark();
    }
    function set(v,scroll){
      const nv=clamp(v);const changed=nv!==value;value=nv;
      if(scroll!==false)view.scrollTop=(value-min)*ROW;
      mark();view.setAttribute('aria-valuenow',value);
      if(changed)o.onChange(value);
    }
    function setRange(a,b2,keep){
      const changed=a!==min||b2!==max||!items.length;
      min=a;max=Math.max(a,b2);value=clamp(keep===undefined?value:keep);
      if(changed)build();show();
    }
    let raf=0;
    view.addEventListener('scroll',()=>{
      if(drag)return;cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{const i=Math.round(view.scrollTop/ROW);if(min+i!==value&&i>=0&&i<items.length)set(min+i,false)});
    });
    // Mouse wheel and trackpad: one notch moves one number; trackpad pixels add up.
    let acc=0,resetT=0;
    view.addEventListener('wheel',e=>{
      if(max<=min)return;e.preventDefault();
      let dy=e.deltaY||e.deltaX;if(!dy)return;
      if(e.deltaMode===1)dy*=ROW;else if(e.deltaMode===2)dy*=ROW*rows;
      let steps;
      if(e.deltaMode===0&&Math.abs(dy)>=50&&Math.abs(dy)%1===0&&Math.abs(dy)>=80){steps=Math.sign(dy)*Math.max(1,Math.round(Math.abs(dy)/100))}
      else{acc+=dy;steps=Math.trunc(acc/26);acc-=steps*26}
      clearTimeout(resetT);resetT=setTimeout(()=>{acc=0},200);
      if(steps)set(value+steps);
    },{passive:false});
    // Mouse drag (touch uses native scrolling).
    let drag=false,y0=0,s0=0;
    view.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||max<=min)return;drag=true;y0=e.clientY;s0=view.scrollTop;view.classList.add('drag');view.setPointerCapture(e.pointerId);view.focus({preventScroll:true})});
    view.addEventListener('pointermove',e=>{if(!drag)return;view.scrollTop=s0-(e.clientY-y0);const i=Math.max(0,Math.min(items.length-1,Math.round(view.scrollTop/ROW)));if(min+i!==value){value=min+i;mark();o.onChange(value)}});
    const up=e=>{if(!drag)return;drag=false;view.classList.remove('drag');try{view.releasePointerCapture(e.pointerId)}catch(_){}view.scrollTop=(value-min)*ROW};
    view.addEventListener('pointerup',up);view.addEventListener('pointercancel',up);
    list.addEventListener('click',e=>{const d=e.target.closest('.wv-item');if(d&&!drag)set(Number(d.dataset.n))});
    view.addEventListener('keydown',e=>{const big=Math.max(1,Math.round((max-min)/10));
      const m={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:big,PageDown:-big};
      if(e.key in m){e.preventDefault();set(value+m[e.key])}else if(e.key==='Home'){e.preventDefault();set(min)}else if(e.key==='End'){e.preventDefault();set(max)}});
    return {setRange,setIcon,get value(){return value}};
  }

  const UNIT_ICON={infantry:'ui-spear',navy:'ui-ship',dragons:'ui-dragon'};
  const hm=(s,k)=>Math.max(0,Number(s.myHouse?.[k])||0);
  const cost=()=>Number(($('unitSelect')?.value==='navy'?$('navyCostLabel'):$('infantryCostLabel'))?.textContent)||4;
  const SPECS=[];
  [['gift','giftGold','giftInfantry','giftNavy'],['treaty','treatyGold','treatyInfantry','treatyNavy'],['decree','decreeGold','decreeInfantry','decreeNavy']].forEach(([,g,i,n])=>{
    SPECS.push({id:g,unit:'gold',icon:'game-coins',min:()=>0,max:s=>hm(s,'money')},{id:i,unit:'infantry',icon:'ui-spear',min:()=>0,max:s=>hm(s,'infantry')},{id:n,unit:'ships',icon:'ui-ship',min:()=>0,max:s=>hm(s,'navy')});
  });
  SPECS.push(
    {id:'unitAmount',unit:'units',big:1,icon:()=>UNIT_ICON[$('unitSelect')?.value]||'ui-spear',min:()=>1,max:()=>10},
    {id:'disbandAmount',unit:'units',big:1,icon:()=>UNIT_ICON[$('disbandUnit')?.value]||'ui-spear',min:()=>1,max:s=>Math.max(1,hm(s,$('disbandUnit')?.value||'infantry'))},
    {id:'spyGold',unit:'gold',big:1,icon:'game-coins',min:()=>2,max:()=>20},
    {id:'dragonSpyGold',unit:'gold',big:1,icon:'game-coins',min:()=>2,max:()=>20},
    {id:'attackInfantry',unit:'infantry',icon:'ui-spear',min:()=>0,max:s=>hm(s,'infantry')},
    {id:'attackNavy',unit:'ships',icon:'ui-ship',min:()=>0,max:s=>hm(s,'navy')},
    {id:'attackDragons',unit:'dragons',icon:'ui-dragon',min:()=>0,max:s=>hm(s,'dragons')}
  );
  SPECS.forEach(s=>{if(s.id.startsWith('decree')&&s.id!=='decreeMessage')s.max=()=>20});
  // Coloured dropdowns with an icon, in the style of the player pickers.
  const DROPS={
    unitSelect:{infantry:['ui-spear','#c8a86c'],navy:['ui-ship','#4f8fb5']},
    disbandUnit:{infantry:['ui-spear','#c8a86c'],navy:['ui-ship','#4f8fb5'],dragons:['ui-dragon','#d9602f']},
    spyMission:{wealth:['game-coins','#d9b24a'],messages:['game-raven','#9fb4c9'],war:['game-swords','#c9574c']},
    decreeKind:{tax:['game-coins','#d9b24a'],hand:['game-hand','#8fa8c4'],traitor:['game-chain','#b5483f'],crown:['game-throne','#c8a86c']}
  };
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function drop(id){
    const sel=$(id),meta=DROPS[id];if(!sel)return;
    let dd=sel.nextElementSibling&&sel.nextElementSibling.classList.contains('hdrop')?sel.nextElementSibling:null;
    if(!dd){
      dd=document.createElement('div');dd.className='hdrop';
      dd.innerHTML='<button type="button" class="hdrop-btn" aria-haspopup="listbox"></button><div class="hdrop-list" role="listbox"></div>';
      sel.classList.add('hdrop-native');sel.after(dd);
      dd.querySelector('.hdrop-btn').addEventListener('click',()=>{if(sel.disabled)return;const open=!dd.classList.contains('open');document.querySelectorAll('.hdrop.open').forEach(d=>d.classList.remove('open'));dd.classList.toggle('open',open)});
      dd.querySelector('.hdrop-list').addEventListener('click',e=>{const it=e.target.closest('.hdrop-item');if(!it)return;sel.value=it.dataset.value;sel.dispatchEvent(new Event('change',{bubbles:true}));dd.classList.remove('open');drop(id)});
    }
    const row=o=>{const m=meta[o.value];return (m?`<img class="hdrop-icon" src="${IMG(m[0])}" alt="">`:'')+`<span>${esc(o.textContent)}</span>`};
    const cur=sel.selectedOptions[0];
    dd.querySelector('.hdrop-btn').innerHTML=cur&&meta[cur.value]?row(cur):'<span class="muted">Choose…</span>';
    dd.style.setProperty('--house-color',(cur&&meta[cur.value]?meta[cur.value][1]:'')||'');
    dd.classList.toggle('has-house',Boolean(cur&&meta[cur.value]));
    dd.querySelector('.hdrop-list').innerHTML=[...sel.options].filter(o=>meta[o.value]).map(o=>`<div class="hdrop-item ${o.value===sel.value?'sel':''}" role="option" data-value="${esc(o.value)}" style="--house-color:${meta[o.value][1]}">${row(o)}</div>`).join('');
  }
  const dropAll=()=>Object.keys(DROPS).forEach(drop);
  // Recruit and disband share one card: pick the action, then the unit.
  function recruitMenu(){
    const rf=$('recruitForm'),df=$('disbandForm');if(!rf||!df||$('armyMode'))return;
    const box=document.createElement('div');box.className='army-mode seg';box.id='armyMode';box.setAttribute('role','group');box.setAttribute('aria-label','Action');
    box.innerHTML='<button type="button" data-v="recruit" aria-pressed="true">Recruit</button><button type="button" data-v="disband" aria-pressed="false">Disband</button>';
    rf.parentElement.insertAdjacentElement('beforebegin',box);
    const apply=()=>{const m=box.querySelector('[aria-pressed="true"]').dataset.v;rf.classList.toggle('dec-off',m!=='recruit');df.classList.toggle('dec-off',m!=='disband')};
    box.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;box.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));apply()});
    apply();
  }
  const FORM_ICON={recruitForm:{infantry:'ui-army',navy:'ui-ship'},disbandForm:{infantry:'ui-soldier',navy:'ui-ship',dragons:'ui-dragon'}};
  function formIcons(){
    [['recruitForm','unitSelect'],['disbandForm','disbandUnit']].forEach(([f,s])=>{
      const img=$(f)?.querySelector('.action-icon-image'),name=FORM_ICON[f][$(s)?.value];
      if(img&&name){const src=IMG(name);if(img.getAttribute('src')!==src)img.setAttribute('src',src)}
    });
  }
  let last=null;
  function build(spec){
    const input=$(spec.id);if(!input||spec.wheel)return;
    const label=document.querySelector(`label[for="${spec.id}"]`);
    const mount=document.createElement('div');mount.className='wh-mount'+(spec.big?' wh-big':'');
    input.insertAdjacentElement('afterend',mount);input.classList.add('wh-hidden');input.removeAttribute('required');
    spec.input=input;
    spec.wheel=Wheel(mount,{label:(label?.textContent||spec.id).replace(/\(.*\)/,'').trim(),unit:spec.unit,rows:5,onChange:v=>{input.value=String(v);input.dispatchEvent(new Event('input',{bubbles:true}))}});
  }
  function refresh(state){
    last=state;if(!state||!state.myHouse)return;
    recruitMenu();dropAll();formIcons();
    SPECS.forEach(spec=>{
      build(spec);if(!spec.wheel)return;
      const min=spec.min(state),max=spec.max(state),raw=spec.input.value.trim(),cur=raw===''?min:Number(raw);
      spec.wheel.setRange(min,max,Number.isFinite(cur)?cur:min);
      spec.wheel.setIcon(typeof spec.icon==='function'?spec.icon():spec.icon);
      const want=String(spec.wheel.value);
      if(spec.input.value!==want){spec.input.value=want;spec.input.dispatchEvent(new Event('input',{bubbles:true}))}
      spec.input.disabled=false;
    });
  }
  document.addEventListener('submit',()=>{[120,500,1000].forEach(t=>setTimeout(()=>refresh(last),t))});
  document.addEventListener('change',e=>{if(e.target&&(e.target.id==='unitSelect'||e.target.id==='disbandUnit')){refresh(last)}else if(e.target&&e.target.id==='spyMission')drop('spyMission')});
  // One decree menu: a dropdown picks which decree to write.
  function decreeMenu(){
    const page=document.querySelector('.sub-page[data-sub="decrees"]');if(!page||$('decreeKind'))return;
    const head=page.querySelector('.section-head');
    const box=document.createElement('div');box.className='decree-pick';
    box.innerHTML='<label for="decreeKind">Decree type</label><select id="decreeKind"><option value="tax">Tax</option><option value="hand">Appoint New Hand</option><option value="traitor">Label traitor</option><option value="crown">Give Up The Crown</option></select>';
    head.insertAdjacentElement('afterend',box);
    const parts={tax:['decreeForm','kingDecrees'],hand:['newHandForm'],traitor:['kingTools'],crown:['kingForfeit']};
    const all=[...new Set(Object.values(parts).flat())];
    const apply=()=>{const on=parts[$('decreeKind').value];all.forEach(id=>{const e=$(id);if(e)e.classList.toggle('dec-off',!on.includes(id))})};
    $('decreeKind').addEventListener('change',()=>{apply();drop('decreeKind')});apply();drop('decreeKind');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decreeMenu);else decreeMenu();
  window.__wheels={refresh};
})();
