/* Vertical number wheels: replace every troop and gold number box. The boxes stay in the page (hidden) so the game code is unchanged. Also builds the single Decrees menu. */
(function(){
  const $=id=>document.getElementById(id);
  const NS='http://www.w3.org/2000/svg',SWEEP=135;
  const polar=(r,d)=>{const a=d*Math.PI/180;return [100+r*Math.sin(a),100-r*Math.cos(a)]};
  const arc=(r,f,t)=>{const [x1,y1]=polar(r,f),[x2,y2]=polar(r,t);return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${(t-f)>180?1:0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`};
  const el=(n,a,p)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e};

  const ROW=40;
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
    root.append(view,band,cap);mount.appendChild(root);
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
    return {setRange,get value(){return value}};
  }

  const hm=(s,k)=>Math.max(0,Number(s.myHouse?.[k])||0);
  const cost=()=>Number(($('unitSelect')?.value==='navy'?$('navyCostLabel'):$('infantryCostLabel'))?.textContent)||4;
  const SPECS=[];
  [['gift','giftGold','giftInfantry','giftNavy'],['treaty','treatyGold','treatyInfantry','treatyNavy'],['decree','decreeGold','decreeInfantry','decreeNavy']].forEach(([,g,i,n])=>{
    SPECS.push({id:g,unit:'gold',min:()=>0,max:s=>hm(s,'money')},{id:i,unit:'infantry',min:()=>0,max:s=>hm(s,'infantry')},{id:n,unit:'ships',min:()=>0,max:s=>hm(s,'navy')});
  });
  SPECS.push(
    {id:'unitAmount',unit:'units',big:1,min:()=>1,max:()=>10},
    {id:'disbandAmount',unit:'units',big:1,min:()=>1,max:s=>Math.max(1,hm(s,$('disbandUnit')?.value||'infantry'))},
    {id:'spyGold',unit:'gold',big:1,min:()=>2,max:()=>20},
    {id:'attackInfantry',unit:'infantry',min:()=>0,max:s=>hm(s,'infantry')},
    {id:'attackNavy',unit:'ships',min:()=>0,max:s=>hm(s,'navy')},
    {id:'attackDragons',unit:'dragons',min:()=>0,max:s=>hm(s,'dragons')}
  );
  SPECS.forEach(s=>{if(s.id.startsWith('decree')&&s.id!=='decreeMessage')s.max=()=>20});
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
    SPECS.forEach(spec=>{
      build(spec);if(!spec.wheel)return;
      const min=spec.min(state),max=spec.max(state),raw=spec.input.value.trim(),cur=raw===''?min:Number(raw);
      spec.wheel.setRange(min,max,Number.isFinite(cur)?cur:min);
      const want=String(spec.wheel.value);
      if(spec.input.value!==want){spec.input.value=want;spec.input.dispatchEvent(new Event('input',{bubbles:true}))}
      spec.input.disabled=false;
    });
  }
  document.addEventListener('submit',()=>{[120,500,1000].forEach(t=>setTimeout(()=>refresh(last),t))});
  document.addEventListener('change',e=>{if(e.target&&(e.target.id==='unitSelect'||e.target.id==='disbandUnit'))refresh(last)});
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
    $('decreeKind').addEventListener('change',apply);apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',decreeMenu);else decreeMenu();
  window.__wheels={refresh};
})();
