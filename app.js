/* 방치공 현장조사 앱 — Supabase(기록·사진·로그인) + 카카오 지도 */
(function(){
'use strict';
const CFG=window.APP_CONFIG||{};
const CK=[
 {k:'owner',q:'소유자(관리자) 확인',o:['소유자 확인','소유자 미상','연락불가']},
 {k:'location',q:'관정 위치 확인',o:['위치 확인','위치 불명','진입불가']},
 {k:'report',q:'지하수 개발·이용 신고 여부',o:['신고 확인','미신고 추정','확인불가']},
 {k:'construction',q:'지하수 착공 여부',o:['착공 확인','미착공','확인불가']},
 {k:'usage',q:'현재 사용 여부',o:['사용중','미사용','장기간 미사용']},
 {k:'well',q:'관정 존재 여부',o:['관정 확인','관정 미확인','멸실 추정']},
 {k:'structure',q:'상부시설 상태',o:['양호','파손','노후','시설 없음']},
 {k:'pump',q:'펌프 설치 여부',o:['설치','철거','고장','확인불가']},
 {k:'electricity',q:'전기 연결 여부',o:['연결','차단','계량기 철거']},
 {k:'access',q:'접근·조사 가능 여부',o:['조사 가능','사유지 출입불가','수풀 등으로 확인곤란']}];
const FINDINGS=['확인 완료','추가 확인 필요','시설 미확인','조사 불가'];
const ST={todo:{t:'미조사',c:'p-todo'},check:{t:'확인 필요',c:'p-check'},done:{t:'조사 완료',c:'p-done'}};
const SPEC=[['굴착지름','㎜'],['굴착깊이','m'],['동력장치마력','HP'],['토출관직경','㎜'],['설치심도','m'],['양수능력','㎥/일'],['취수계획량','㎥/일'],['허가신고번호',''],['허가신고일',''],['시설구분',''],['지하수용도',''],['세부용도','']];
const COMPANY=CFG.COMPANY||{name:'회사',lat:36.99192,lon:127.92226};

/* ---------- state ---------- */
const S={F:{},S:{},P:{},tab:'map',q:'',ri:'',status:'',mapFilter:'all',open:null,form:null,dirty:false,saveState:'',
  calMonth:null,calDay:null,outbox:[],urls:{},local:{},here:null,user:null,online:navigator.onLine,today:null,sel:null,askPlan:null};
let sb=null,K=null,map=null,overlays={},routeLine=null,coMk=null,meMk=null;

/* ---------- utils ---------- */
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
const addDays=(d,n)=>{const x=new Date(d+'T12:00:00+09:00');x.setDate(x.getDate()+n);return x.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})};
const fmtD=d=>{if(!d)return'';const[,m,dd]=String(d).split('-');return`${+m}/${+dd}`};
const nowISO=()=>new Date().toISOString();
const hhmm=()=>new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
const ls={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}},keys(p){try{return Object.keys(localStorage).filter(k=>k.startsWith(p))}catch(e){return[]}}};
function toast(t,ms){const el=document.createElement('div');el.className='toast';el.textContent=t;$('#toastSlot').replaceChildren(el);setTimeout(()=>el.isConnected&&el.remove(),ms||2600)}
function hav(a,b){const R=6371,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lon-a.lon)*r;const x=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
const facs=()=>Object.values(S.F).sort((a,b)=>a.id-b.id);
const hasXY=f=>f&&typeof f.lat==='number'&&typeof f.lon==='number';
const nm=f=>f.name||'성명 미기재';
const jibun=f=>f.short_address||f.address||'';
function navURL(f){return hasXY(f)?`https://map.kakao.com/link/to/${encodeURIComponent(f.id+' '+nm(f))},${f.lat},${f.lon}`:`https://map.kakao.com/link/search/${encodeURIComponent(f.address||'')}`}
function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}

/* ---------- status ---------- */
function ckCount(s){return s&&s.checklist?CK.filter(x=>s.checklist[x.k]).length:0}
function issuesOf(id){
  const f=S.F[id],s=S.S[id],p=S.P[id],out=[];
  if(s){
    if(!s.legacy){const miss=[!s.near_path&&'근경',!s.far_path&&'원경'].filter(Boolean);if(miss.length)out.push(miss.join('·')+' 사진 없음')}
    if(pendingPhotos(id))out.push('사진 전송 대기');
    const k=ckCount(s);if(k<10)out.push(k?`체크리스트 ${k}/10`:'체크리스트 없음');
  }
  if(p&&!s&&p.date<S.today)out.push(`예정일(${fmtD(p.date)}) 지남·미조사`);
  if(f&&f.coord_status==='failed'&&!hasXY(f))out.push('위치 확인 필요');
  return out;
}
function statusOf(id){const s=S.S[id];if(!s)return'todo';return issuesOf(id).filter(x=>!/예정일|위치 확인/.test(x)).length?'check':'done'}
function pendingPhotos(id){return S.outbox.some(e=>e.type==='photo'&&String(e.facility)===String(id))}
function drafts(){return ls.keys('draft:').map(k=>({id:k.slice(6),d:ls.get(k)})).filter(x=>x.d&&S.F[x.id])}

/* ---------- IndexedDB outbox ---------- */
let idb=null;
function idbOpen(){return new Promise(res=>{try{const r=indexedDB.open('bangchi',1);r.onupgradeneeded=()=>r.result.createObjectStore('outbox',{keyPath:'key'});r.onsuccess=()=>{idb=r.result;res()};r.onerror=()=>res()}catch(e){res()}})}
function idbAll(){return new Promise(res=>{if(!idb)return res([]);try{const q=idb.transaction('outbox').objectStore('outbox').getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>res([])}catch(e){res([])}})}
function idbPut(v){return new Promise(res=>{if(!idb){S.outbox.push(v);return res()}try{const t=idb.transaction('outbox','readwrite');t.objectStore('outbox').put(v);t.oncomplete=()=>res();t.onerror=()=>res()}catch(e){res()}})}
function idbDel(k){return new Promise(res=>{if(!idb)return res();try{const t=idb.transaction('outbox','readwrite');t.objectStore('outbox').delete(k);t.oncomplete=()=>res();t.onerror=()=>res()}catch(e){res()}})}
async function loadOutbox(){if(idb)S.outbox=(await idbAll()).sort((a,b)=>a.ts-b.ts);for(const e of S.outbox)if(e.type==='photo'&&e.blob&&!S.local[e.path])S.local[e.path]=URL.createObjectURL(e.blob)}
async function enqueue(e){e.ts=Date.now();await idbPut(e);await loadOutbox();renderChrome();schedFlush(5000)}
let flushT=null,flushing=false;
function schedFlush(ms){clearTimeout(flushT);flushT=setTimeout(flush,ms)}
async function flush(){
  if(flushing||!sb||!S.user)return;flushing=true;
  try{await loadOutbox();
    for(const e of [...S.outbox]){
      try{
        if(e.type==='photo'){const{error}=await sb.storage.from('photos').upload(e.path,e.blob,{contentType:'image/jpeg',upsert:true});if(error)throw error}
        else if(e.type==='upsert'){const{error}=await sb.from(e.table).upsert(e.row);if(error)throw error}
        else if(e.type==='delete'){const{error}=await sb.from(e.table).delete().eq(e.col,e.val);if(error)throw error}
        await idbDel(e.key);S.outbox=S.outbox.filter(x=>x.key!==e.key);
      }catch(err){break}
    }
  }finally{flushing=false;await loadOutbox();renderChrome();rerender();if(S.outbox.length)schedFlush(60000)}
}
async function upsert(table,row){
  if(sb&&S.online){try{const{error}=await sb.from(table).upsert(row);if(!error)return true}catch(e){}}
  await enqueue({key:table+':'+(row.facility??row.id),type:'upsert',table,row});return false;
}
async function remove(table,col,val){
  if(sb&&S.online){try{const{error}=await sb.from(table).delete().eq(col,val);if(!error)return true}catch(e){}}
  await enqueue({key:table+':del:'+val,type:'delete',table,col,val});return false;
}

/* ---------- photo urls ---------- */
async function photoURL(path){
  if(!path)return'';if(S.local[path])return S.local[path];
  const c=S.urls[path];if(c&&c.exp>Date.now())return c.url;
  try{const{data,error}=await sb.storage.from('photos').createSignedUrl(path,3600);if(error)throw error;S.urls[path]={url:data.signedUrl,exp:Date.now()+3000e3};return data.signedUrl}catch(e){return''}
}

/* ---------- chrome ---------- */
function renderChrome(){
  const p=[];
  if(!S.online)p.push('<span class="pill p-crit">오프라인</span>');
  if(S.outbox.length)p.push(`<span class="pill p-check">전송 대기 ${S.outbox.length}</span>`);
  else if(S.online)p.push('<span class="pill p-done">서버 저장됨</span>');
  $('#syncPills').innerHTML=p.join('');
  const b=[];
  if(S.outbox.length)b.push(`<div class="banner"><span class="grow"><b>서버로 아직 못 보낸 기록·사진 ${S.outbox.length}건</b>이 이 휴대폰에 보관돼 있습니다. 연결되면 자동으로 보냅니다.</span><button class="btn sm" data-act="flush">지금 보내기</button></div>`);
  const dr=drafts().filter(x=>x.id!==S.open);
  if(dr.length)b.push(`<div class="banner"><span class="grow"><b>저장 안 한 작성 중 기록 ${dr.length}건</b>: ${dr.slice(0,3).map(x=>esc(x.id+' '+nm(S.F[x.id]))).join(', ')}${dr.length>3?' 외':''}</span><button class="btn sm" data-open="${esc(dr[0].id)}">열기</button></div>`);
  $('#banners').innerHTML=b.join('');
}

/* ---------- weather (Open-Meteo, 키 불필요) ---------- */
const WMO={0:'맑음',1:'대체로 맑음',2:'구름 조금',3:'흐림',45:'안개',48:'안개',51:'이슬비',53:'이슬비',55:'이슬비',61:'비',63:'비',65:'강한 비',66:'어는 비',67:'어는 비',71:'눈',73:'눈',75:'많은 눈',77:'싸락눈',80:'소나기',81:'소나기',82:'강한 소나기',85:'눈 소나기',86:'눈 소나기',95:'뇌우',96:'뇌우',99:'뇌우'};
const WIC=c=>c<=1?'☀':c<=3?'⛅':c<=48?'🌫':c<=67||(c>=80&&c<=82)?'🌧':c<=86?'❄':'⛈';
let WX=null,wxAt=0;
async function loadWeather(force){
  if(!force&&WX&&Date.now()-wxAt<20*60e3)return WX;
  const w=CFG.WEATHER||{lat:36.972,lon:127.796};
  try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m,weather_code,precipitation_probability&forecast_days=2&timezone=Asia%2FSeoul&wind_speed_unit=ms`);WX=await r.json();wxAt=Date.now()}catch(e){}
  return WX;
}
async function renderWxBtn(){const w=await loadWeather();const b=$('#wxBtn');if(!b)return;if(w&&w.current){b.textContent=`${WIC(w.current.weather_code)} ${Math.round(w.current.temperature_2m)}° 날씨`}else b.textContent='날씨'}
async function renderWxPanel(){
  const p=$('#wxPanel'),w=await loadWeather();
  if(!w||!w.current){p.innerHTML='날씨를 불러오지 못했습니다. <a href="https://www.weather.go.kr/w/index.do" target="_blank" rel="noopener">기상청 열기</a>';return}
  const c=w.current,h=w.hourly,now=c.time.slice(0,13);let i=h.time.findIndex(t=>t.slice(0,13)>=now);if(i<0)i=0;
  const hrs=h.time.slice(i,i+12).map((t,k)=>`<div>${+t.slice(11,13)}시<b>${WIC(h.weather_code[i+k])}</b>${Math.round(h.temperature_2m[i+k])}°<br><span class="muted">${h.precipitation_probability[i+k]??'-'}%</span></div>`).join('');
  p.innerHTML=`<div class="row" style="justify-content:space-between"><b>${esc(CFG.AREA||'')} 지금 ${WMO[c.weather_code]||''} ${Math.round(c.temperature_2m)}°</b><span class="muted small">바람 ${c.wind_speed_10m}m/s</span></div><div class="wx-hours">${hrs}</div><div class="muted small" style="margin-top:6px">시간별 아래 숫자는 강수확률 · <a href="https://www.weather.go.kr/w/index.do" target="_blank" rel="noopener">기상청</a></div>`;
}

/* ---------- Kakao map ---------- */
function loadKakao(){
  return new Promise(res=>{
    if(!CFG.KAKAO_JS_KEY){res(false);return}
    const s=document.createElement('script');
    s.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CFG.KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    s.onload=()=>{try{kakao.maps.load(()=>{K=kakao.maps;res(true)})}catch(e){res(false)}};
    s.onerror=()=>res(false);document.head.appendChild(s);
    setTimeout(()=>res(!!K),12000);
  });
}
function initMap(){
  if(!K){const m=$('#mapMsg');m.hidden=false;m.innerHTML=CFG.KAKAO_JS_KEY?'<b>카카오 지도를 불러오지 못했습니다.</b> 카카오 개발자 사이트에 이 앱 주소가 Web 도메인으로 등록됐는지 확인해 주세요. 목록·일정은 그대로 쓸 수 있습니다.':'<b>카카오 JavaScript 키가 아직 없습니다.</b> config.js에 키를 넣어 주세요.';return}
  map=new K.Map($('#kmap'),{center:new K.LatLng(36.975,127.795),level:7});
  map.setMapTypeId(K.MapTypeId.HYBRID);
  K.event.addListener(map,'click',()=>{S.sel=null;renderPeek();drawMarkers()});
  const co=document.createElement('div');co.className='mk-co';co.textContent='회사';
  coMk=new K.CustomOverlay({position:new K.LatLng(COMPANY.lat,COMPANY.lon),content:co,yAnchor:0.5,zIndex:2});coMk.setMap(map);
  drawMarkers();fitAll();
}
function mapShow(f){
  const d=S.calDay||S.today;
  if(S.mapFilter==='all')return true;
  if(S.mapFilter==='todo')return statusOf(f.id)==='todo';
  if(S.mapFilter==='check')return statusOf(f.id)==='check';
  if(S.mapFilter==='day')return S.P[f.id]&&S.P[f.id].date===d;
  return true;
}
function drawMarkers(){
  if(!map)return;
  const d=S.calDay||S.today,route=dayStops(d);
  const seen=new Set();
  for(const f of facs()){
    const id=String(f.id);seen.add(id);
    let o=overlays[id];
    if(!hasXY(f)||!mapShow(f)){if(o){o.setMap(null)}continue}
    const st=statusOf(f.id),ri=route.findIndex(x=>x.id===f.id);
    const html=`${f.id}${ri>=0&&S.mapFilter==='day'?`<span class="o">${ri+1}</span>`:''}`;
    const cls=`mk s-${st}${S.sel===id?' sel':''}`;
    if(!o){const el=document.createElement('div');el.addEventListener('click',ev=>{ev.stopPropagation();S.sel=id;renderPeek();drawMarkers()});
      o=new K.CustomOverlay({position:new K.LatLng(f.lat,f.lon),content:el,yAnchor:0.5,zIndex:3,clickable:true});overlays[id]=o;}
    const el=o.getContent();el.className=cls;if(el.innerHTML!==html)el.innerHTML=html;el.title=`${f.id} ${nm(f)} ${jibun(f)}`;
    o.setPosition(new K.LatLng(f.lat,f.lon));o.setZIndex(S.sel===id?10:3);o.setMap(map);
  }
  for(const id in overlays)if(!seen.has(id)){overlays[id].setMap(null);delete overlays[id]}
  if(routeLine){routeLine.setMap(null);routeLine=null}
  if(S.mapFilter==='day'){const pts=route.filter(hasXY);if(pts.length>1){routeLine=new K.Polyline({path:pts.map(f=>new K.LatLng(f.lat,f.lon)),strokeWeight:5,strokeColor:'#0d6670',strokeOpacity:.85});routeLine.setMap(map)}}
}
function fitAll(){
  if(!map)return;const d=S.calDay||S.today;
  let pts=facs().filter(f=>hasXY(f)&&mapShow(f));if(!pts.length)pts=facs().filter(hasXY);if(!pts.length)return;
  const b=new K.LatLngBounds();pts.forEach(f=>b.extend(new K.LatLng(f.lat,f.lon)));map.setBounds(b,40,20,60,20);
}
function renderPeek(){
  const el=$('#peek');const f=S.sel&&S.F[S.sel];if(!f){el.hidden=true;return}
  const st=statusOf(f.id),s=S.S[f.id],p=S.P[f.id],iss=issuesOf(f.id);
  el.hidden=false;
  el.innerHTML=`<div class="row" style="justify-content:space-between"><span class="t">${f.id}. ${esc(nm(f))}</span><span class="pill ${ST[st].c}">${ST[st].t}</span></div>
  <div class="small">${esc(jibun(f))}${f.phone?` · <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a>`:''}</div>
  <div class="small muted">${esc(f.mgmt_no||'')}${s?` · 조사 ${fmtD(s.date)}`:''}${p?` · 예정 ${fmtD(p.date)}`:''}${iss.length?` · <span style="color:var(--warn)">${esc(iss.join(', '))}</span>`:''}</div>
  <div class="row"><button class="btn pri sm" data-open="${f.id}">조사 입력</button><a class="btn sm" href="${navURL(f)}" target="_blank" rel="noopener">길찾기</a><button class="btn sm" data-act="peekclose">닫기</button></div>`;
}
function focusFacility(f){
  S.sel=String(f.id);go('map');
  if(map&&hasXY(f)){map.setLevel(3);map.panTo(new K.LatLng(f.lat,f.lon))}
  renderPeek();drawMarkers();
}
function renderMapChips(){
  const d=S.calDay||S.today;
  const cnt={all:facs().length,todo:0,check:0,day:dayStops(d).length};facs().forEach(f=>{const s=statusOf(f.id);if(s!=='done')cnt[s]++});
  $('#mapChips').innerHTML=[['all','전체'],['todo','미조사'],['check','확인 필요'],['day',d===S.today?'오늘 일정':`${fmtD(d)} 일정`]].map(([k,t])=>`<button class="chip" data-mf="${k}" aria-pressed="${S.mapFilter===k}">${t}<span class="n">${cnt[k]}</span></button>`).join('');
}
function renderMap(){
  renderMapChips();renderWxBtn();
  if(map){setTimeout(()=>{map.relayout();drawMarkers()},30)}
  renderPeek();
}

/* ---------- geolocation ---------- */
function locate(){return new Promise((res,rej)=>{if(!navigator.geolocation)return rej(new Error('위치 기능 없음'));navigator.geolocation.getCurrentPosition(p=>{S.here={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy,at:Date.now()};res(S.here)},e=>rej(e),{enableHighAccuracy:true,timeout:15000,maximumAge:30000})})}
async function showHere(){
  try{const h=await locate();if(!map)return toast(`현재 위치 ${h.lat.toFixed(5)}, ${h.lon.toFixed(5)}`);
    const el=document.createElement('div');el.className='mk-me';if(meMk)meMk.setMap(null);
    meMk=new K.CustomOverlay({position:new K.LatLng(h.lat,h.lon),content:el,zIndex:20});meMk.setMap(map);map.setLevel(4);map.panTo(new K.LatLng(h.lat,h.lon));
  }catch(e){toast('현재 위치를 가져오지 못했습니다. 휴대폰 위치 권한을 확인해 주세요')}
}

/* ---------- geocoding (주소 → 좌표) ---------- */
let geoRunning=false;
async function geocodeAll(onlyPending){
  if(!K||!K.services){toast('카카오 지도가 연결돼야 주소 변환을 할 수 있습니다');return}
  if(geoRunning)return;geoRunning=true;
  const gc=new K.services.Geocoder();
  const targets=facs().filter(f=>f.coord_source!=='gps'&&(onlyPending?(f.coord_status==='pending'||!f.coord_status):true));
  let ok=0,fail=0,i=0;
  const one=f=>new Promise(res=>gc.addressSearch(f.address,(r,st)=>{if(st===K.services.Status.OK&&r[0])res({lat:+r[0].y,lon:+r[0].x,type:r[0].address_type,many:r.length});else res(null)}));
  for(const f of targets){
    i++;$('#mapMsg').hidden=false;$('#mapMsg').innerHTML=`주소로 위치 잡는 중… ${i}/${targets.length}`;
    let r=await one(f);
    if(!r&&f.address&&/\s산\s?\d/.test(f.address))r=await one({address:f.address.replace(/\s산\s?(\d)/,' 산$1')});
    const row={id:f.id,updated_at:nowISO()};
    if(r){Object.assign(row,{lat:r.lat,lon:r.lon,coord_source:'kakao',coord_status:'ok'});ok++}
    else{Object.assign(row,{lat:null,lon:null,coord_source:null,coord_status:'failed'});fail++}
    Object.assign(S.F[f.id],row);await upsert('facilities',row);
    await new Promise(r=>setTimeout(r,120));
  }
  geoRunning=false;$('#mapMsg').hidden=true;drawMarkers();fitAll();rerender();
  toast(`주소 변환 완료: 성공 ${ok}곳, 실패 ${fail}곳${fail?' (실패한 곳은 지도에 찍지 않고 "위치 확인 필요"로 표시)':''}`,6000);
}

/* ---------- list ---------- */
function renderList(){
  const all=facs(),t=S.today;
  const cnt={'':all.length,todo:0,check:0,done:0,plan:0,loc:0};
  all.forEach(f=>{cnt[statusOf(f.id)]++;if(S.P[f.id]&&S.P[f.id].date===t)cnt.plan++;if(!hasXY(f))cnt.loc++});
  $('#statusChips').innerHTML=[['','전체'],['todo','미조사'],['check','확인 필요'],['done','조사 완료'],['plan','오늘 일정'],['loc','위치 확인 필요']].map(([k,x])=>`<button class="chip" data-st="${k}" aria-pressed="${S.status===k}">${x}<span class="n">${cnt[k]}</span></button>`).join('');
  const ris=[...new Set(all.map(f=>f.ri))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ko'));
  $('#riChips').innerHTML=`<button class="chip" data-ri="" aria-pressed="${!S.ri}">모든 리</button>`+ris.map(r=>`<button class="chip" data-ri="${esc(r)}" aria-pressed="${S.ri===r}">${esc(r)}<span class="n">${all.filter(f=>f.ri===r).length}</span></button>`).join('');
  const q=S.q.trim().toLowerCase().replace(/\s+/g,'');
  let l=all.filter(f=>(!S.ri||f.ri===S.ri)&&(!q||[f.id,f.name,f.mgmt_no,f.short_address,f.address,f.phone].join('|').toLowerCase().replace(/\s+/g,'').includes(q)));
  if(S.status==='plan')l=l.filter(f=>S.P[f.id]&&S.P[f.id].date===t).sort((a,b)=>S.P[a.id].position-S.P[b.id].position);
  else if(S.status==='loc')l=l.filter(f=>!hasXY(f));
  else if(S.status)l=l.filter(f=>statusOf(f.id)===S.status);
  $('#flist').innerHTML=l.length?'<div class="flist">'+l.map(itemHTML).join('')+'</div>':'<div class="card empty">조건에 맞는 시설이 없습니다.</div>';
}
function itemHTML(f){
  const st=statusOf(f.id),p=S.P[f.id],s=S.S[f.id],iss=issuesOf(f.id);
  return `<button class="fitem" data-open="${f.id}"><span class="num s-${st}">${f.id}</span>
  <span class="fmain"><span class="fname">${esc(nm(f))}<span class="mono">${esc(f.mgmt_no||'')}</span></span><span class="fsub">${esc(jibun(f))}${f.phone?' · '+esc(f.phone):''}${s?` · 조사 ${fmtD(s.date)}`:''}</span></span>
  <span class="fside"><span class="pill ${ST[st].c}">${ST[st].t}</span>${p?`<span class="date-chip">예정 ${fmtD(p.date)}</span>`:''}</span>
  ${iss.length?`<span class="fissue">${esc(iss.join(' · '))}</span>`:''}</button>`;
}

/* ---------- detail ---------- */
function openDetail(id){
  id=String(id);const f=S.F[id];if(!f)return;
  if(S.open&&S.open!==id&&S.dirty){askLeave(()=>openDetail(id));return}
  S.open=id;const s=S.S[id]||{},p=S.P[id];
  const base={date:s.date||S.today,finding:s.finding||'',note:s.note||'',near:s.near_path||null,far:s.far_path||null,legacy:!!s.legacy,answers:{...(s.checklist||{})},plan:p?p.date:''};
  const d=ls.get('draft:'+id);
  S.form=d?{...base,...d,answers:{...base.answers,...(d.answers||{})}}:base;S.dirty=!!d;S.saveState=d?'':(S.S[id]?'saved':'');
  renderSheet(f);$('#sheet').hidden=false;$('#sheet').scrollTop=0;
  if(d)toast('저장 안 한 작성 내용을 불러왔습니다');
}
function closeDetail(force){
  if(!force&&S.dirty){askLeave(()=>closeDetail(true));return}
  $('#sheet').hidden=true;$('#sheet').innerHTML='';S.open=null;S.form=null;S.dirty=false;rerender();
}
function askLeave(next){
  const el=document.createElement('div');el.className='leave';
  el.innerHTML=`<b style="flex:1;min-width:200px">저장하지 않은 내용이 있습니다.</b><button class="btn pri sm" data-a="save">저장하고 나가기</button><button class="btn sm" data-a="keep">작성 중으로 두기</button><button class="btn sm" data-a="stay">계속 작성</button>`;
  document.body.append(el);
  el.onclick=async e=>{const a=e.target.closest('button')?.dataset.a;if(!a)return;el.remove();if(a==='save'){await saveForm();next()}else if(a==='keep'){S.dirty=false;next()}};
}
function saveDraft(){if(S.open&&S.form)ls.set('draft:'+S.open,{...S.form,ts:Date.now()})}
function markDirty(){S.dirty=true;S.saveState='';saveDraft();renderSaveBar()}
function renderSheet(f){
  const id=String(f.id),F=S.form,info=f.info||{},v=info.registration||{},co=info.contractor||{};
  const spec=SPEC.filter(([k])=>v[k]!=null&&v[k]!=='').map(([k,u])=>`<div><span>${esc(k)}</span>${esc(v[k])}${u&&typeof v[k]==='number'?' '+u:''}</div>`).join('');
  const coRows=[['시공사',co['상호']],['사업자·법인번호',co['등록번호']],['대표자',co['대표자']],['시공사 주소',co['소재지']]].filter(x=>x[1]);
  const exDiff=(hasXY(f)&&typeof f.excel_lat==='number')?Math.round(hav(f,{lat:f.excel_lat,lon:f.excel_lon})*1000):null;
  const locTxt=hasXY(f)?`<span class="mono">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</span> <span class="muted small">(${f.coord_source==='gps'?'현장 GPS':f.coord_source==='kakao'?'주소 변환':'엑셀'})${exDiff!=null&&exDiff>300?` · 엑셀 좌표와 ${exDiff>=1000?(exDiff/1000).toFixed(1)+'km':exDiff+'m'} 차이`:''}</span>`
    :`<span style="color:var(--warn)">${f.coord_status==='failed'?'주소로 위치를 찾지 못함 — 확인 필요':'아직 위치 없음'}</span>`;
  $('#sheet').innerHTML=`
  <div class="sheet-top"><button class="icon-btn" id="sBack" aria-label="닫기">‹</button>
    <div class="sheet-title"><b>${id}. ${esc(nm(f))}</b><span class="mono">${esc(f.mgmt_no||'')}</span> <span>· ${esc(jibun(f))}</span></div><span id="sStatus"></span></div>
  <div class="sheet-body">
    <div class="sec"><div class="card"><dl class="kv">
      <dt>주소</dt><dd>${esc(f.address)}</dd>
      <dt>전화</dt><dd>${f.phone?`<a class="mono" href="tel:${esc(f.phone)}">${esc(f.phone)}</a>`:'<span class="muted">없음</span>'}</dd>
      <dt>용도</dt><dd>${esc([info.use,info.drinking].filter(Boolean).join(' · '))}</dd>
      <dt>구분</dt><dd>${esc(info.type||'')}${info.permitDate?' · 신고 '+esc(info.permitDate):''}</dd>
      <dt>위치</dt><dd>${locTxt}</dd></dl>
      <div class="row" style="padding:0 12px 12px"><a class="btn pri sm" href="${navURL(f)}" target="_blank" rel="noopener">길찾기 (현재 위치에서)</a>${hasXY(f)?`<button class="btn sm" data-act="showmap">지도에서 보기</button>`:''}<button class="btn sm" data-act="gpsfix">지금 위치를 이 시설 위치로</button></div></div>
    ${coRows.length?`<div class="card"><h3>시공사</h3><dl class="kv">${coRows.map(([a,b])=>`<dt>${a}</dt><dd>${esc(b)}</dd>`).join('')}</dl></div>`:''}
    ${spec?`<div class="card"><h3>관정 제원·허가</h3><div class="spec" style="margin-top:8px">${spec}</div></div>`:''}</div>

    <div class="sec"><div class="sec-h"><h2>조사</h2></div>
      <div class="row"><label class="muted small" for="fDate">조사일</label><input type="date" id="fDate" value="${esc(F.date)}" style="width:auto"></div>
      <div class="opts" id="fFind">${FINDINGS.map(x=>`<button class="opt" data-find="${esc(x)}" aria-pressed="${F.finding===x}">${esc(x)}</button>`).join('')}</div>
      <div class="photos" id="photos"></div>
      ${F.legacy?'<p class="note">이전 앱에서 조사한 건이라 사진은 이전 ZIP에 있습니다. 새로 찍으면 이 앱에 저장됩니다.</p>':''}
      <textarea id="fNote" placeholder="현장 메모">${esc(F.note)}</textarea></div>

    <div class="sec"><div class="sec-h"><h2>체크리스트</h2><span class="sub" id="ckCount"></span></div>
      <div class="card" id="ck">${CK.map((x,i)=>`<div class="cl-row"><div class="cl-q"><i>${i+1}</i>${esc(x.q)}</div><div class="opts">${x.o.map(o=>`<button class="opt" data-ck="${x.k}" data-v="${esc(o)}" aria-pressed="${F.answers[x.k]===o}">${esc(o)}</button>`).join('')}</div></div>`).join('')}</div></div>

    <div class="sec"><div class="sec-h"><h2>방문 예정일</h2></div>
      <div class="row"><input type="date" id="fPlan" value="${esc(F.plan)}" style="width:auto"><button class="btn sm" data-act="plantoday">오늘</button><button class="btn sm" data-act="plantmr">내일</button><button class="btn sm" data-act="planclear">지우기</button></div></div>
  </div>
  <div class="savebar" id="savebar"><div class="msg" id="saveMsg"></div><button class="btn pri" id="saveBtn">저장</button></div>`;
  renderPhotos();renderSaveBar();
  $('#sBack').onclick=()=>closeDetail();
  $('#fDate').onchange=e=>{F.date=e.target.value;markDirty()};
  $('#fNote').oninput=e=>{F.note=e.target.value;markDirty()};
  $('#fPlan').onchange=e=>{F.plan=e.target.value;markDirty()};
  $('#fFind').onclick=e=>{const b=e.target.closest('[data-find]');if(!b)return;F.finding=F.finding===b.dataset.find?'':b.dataset.find;$('#fFind').querySelectorAll('.opt').forEach(o=>o.setAttribute('aria-pressed',o.dataset.find===F.finding));markDirty()};
  $('#ck').onclick=e=>{const b=e.target.closest('[data-ck]');if(!b)return;const k=b.dataset.ck;F.answers[k]=F.answers[k]===b.dataset.v?'':b.dataset.v;b.parentElement.querySelectorAll('.opt').forEach(o=>o.setAttribute('aria-pressed',o.dataset.v===F.answers[k]));markDirty()};
  $('#saveBtn').onclick=()=>saveForm();
}
async function renderPhotos(){
  const F=S.form,id=S.open;if(!F||!$('#photos'))return;
  const html=await Promise.all(['near','far'].map(async slot=>{
    const path=F[slot],up=S.local['up:'+id+slot],src=up?up.url:(path?await photoURL(path):'');
    const pend=path&&S.outbox.some(e=>e.type==='photo'&&e.path===path);
    const stat=up?'<span class="st pill p-acc">올리는 중…</span>':pend?'<span class="st pill p-check">전송 대기</span>':path?'<span class="st pill p-done">올라감 ✓</span>':'';
    return `<div class="shot"><label class="frame" for="ph-${slot}">${src?`<img src="${esc(src)}" alt="">`:'<span>눌러서<br>촬영·선택</span>'}<span class="tag">${slot==='near'?'근경':'원경'}</span>${stat}</label>
      <input type="file" accept="image/*" capture="environment" id="ph-${slot}" data-slot="${slot}">
      ${src?`<label class="btn sm" for="ph-${slot}">다시 찍기</label>`:''}</div>`}));
  if(S.open!==id||!$('#photos'))return;
  $('#photos').innerHTML=html.join('');
  $('#photos').querySelectorAll('input[type=file]').forEach(inp=>inp.onchange=e=>{const file=e.target.files&&e.target.files[0];if(file)pickPhoto(id,inp.dataset.slot,file);e.target.value=''});
  const st=statusOf(id);const ss=$('#sStatus');if(ss)ss.innerHTML=`<span class="pill ${ST[st].c}">${ST[st].t}</span>`;
}
async function compress(file){
  try{const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});const sc=Math.min(1,2048/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file),'image/jpeg',0.85))}catch(e){return file}}
async function pickPhoto(id,slot,file){
  const blob=await compress(file),url=URL.createObjectURL(blob);
  S.local['up:'+id+slot]={url};renderPhotos();
  const path=`${id}/${slot}_${Date.now()}.jpg`;
  S.local[path]=url;
  let ok=false;
  if(S.online){try{const{error}=await sb.storage.from('photos').upload(path,blob,{contentType:'image/jpeg',upsert:true});ok=!error}catch(e){}}
  if(!ok)await enqueue({key:'photo:'+path,type:'photo',path,blob,facility:id,slot});
  delete S.local['up:'+id+slot];
  if(S.open!==id||!S.form)return;
  S.form[slot]=path;S.form.legacy=false;markDirty();renderPhotos();
  toast(ok?`${slot==='near'?'근경':'원경'} 사진을 올렸습니다. 저장을 눌러 주세요`:'인터넷이 약해 사진을 휴대폰에 보관했습니다. 연결되면 자동으로 올립니다');
}
function renderSaveBar(){
  const F=S.form;if(!F||!$('#saveMsg'))return;
  const k=CK.filter(x=>F.answers[x.k]).length,miss=[];if(!F.legacy&&!F.near)miss.push('근경');if(!F.legacy&&!F.far)miss.push('원경');
  const bar=$('#savebar'),btn=$('#saveBtn');bar.classList.toggle('saved',S.saveState==='saved'&&!S.dirty);
  let head;
  if(S.saveState==='saving')head='<b>저장 중…</b>';
  else if(S.dirty)head='<b style="color:var(--crit)">● 저장 안 함</b>';
  else if(S.saveState==='queued')head='<b style="color:var(--warn)">휴대폰에 보관됨 · 전송 대기</b>';
  else if(S.saveState==='saved')head=`<b style="color:var(--done)">✓ 저장 완료</b>${S.savedAt?' '+S.savedAt:''}`;
  else head='<span class="muted">새 기록</span>';
  const tail=[miss.length?miss.join('·')+' 사진 없음':'',k<10?`체크 ${k}/10`:''].filter(Boolean).join(' · ');
  $('#saveMsg').innerHTML=head+(tail?`<br><span class="small muted">${tail}</span>`:'');
  btn.textContent=S.saveState==='saving'?'저장 중…':(S.saveState==='saved'&&!S.dirty?'저장 완료 ✓':'저장');btn.disabled=S.saveState==='saving';
  const ck=$('#ckCount');if(ck)ck.textContent=`${k}/10`;
}
async function saveForm(){
  const id=S.open,F=S.form;if(!id||!F)return;
  S.saveState='saving';renderSaveBar();
  const ans={};CK.forEach(x=>{if(F.answers[x.k])ans[x.k]=F.answers[x.k]});
  const row={facility:+id,date:F.date||S.today,finding:F.finding||null,note:F.note||null,near_path:F.near||null,far_path:F.far||null,checklist:ans,checklist_date:Object.keys(ans).length?(F.date||S.today):null,legacy:!!F.legacy&&!F.near&&!F.far,updated_at:nowISO(),updated_by:S.user?.email||null};
  const ok1=await upsert('surveys',row);S.S[id]=row;
  let ok2=true;const p=S.P[id];
  if(F.plan&&(!p||p.date!==F.plan)){const pos=Object.values(S.P).filter(x=>x.date===F.plan).length+1;const pr={facility:+id,date:F.plan,position:pos,updated_at:nowISO()};S.P[id]=pr;ok2=await upsert('plans',pr)}
  else if(!F.plan&&p){delete S.P[id];ok2=await remove('plans','facility',+id)}
  ls.del('draft:'+id);S.dirty=false;S.saveState=(ok1&&ok2)?'saved':'queued';S.savedAt=hhmm();
  renderSaveBar();renderPhotos();renderChrome();drawMarkers();
  toast(ok1&&ok2?'저장 완료':'휴대폰에 보관했습니다. 연결되면 서버로 보냅니다');
}
async function gpsFix(){
  const id=S.open,f=S.F[id];if(!f)return;
  try{const h=await locate();
    if(!confirm(`${id}. ${nm(f)} 위치를 지금 서 있는 곳(오차 약 ${Math.round(h.acc)}m)으로 저장할까요?`))return;
    const row={id:+id,lat:h.lat,lon:h.lon,coord_source:'gps',coord_status:'ok',updated_at:nowISO()};Object.assign(f,row);await upsert('facilities',row);
    toast('위치를 저장했습니다');renderSheet(f);drawMarkers();
  }catch(e){toast('현재 위치를 가져오지 못했습니다')}
}

/* ---------- calendar ---------- */
function dayStops(d){return facs().filter(f=>S.P[f.id]&&S.P[f.id].date===d).sort((a,b)=>(S.P[a.id].position||0)-(S.P[b.id].position||0))}
function renderCal(){
  const t=S.today;if(!S.calMonth)S.calMonth=t.slice(0,7);if(!S.calDay)S.calDay=t;
  const[y,m]=S.calMonth.split('-').map(Number);$('#calTitle').textContent=`${y}년 ${m}월`;
  const first=new Date(y,m-1,1),start=new Date(y,m-1,1-first.getDay());
  const pl={},dn={};Object.values(S.P).forEach(p=>{pl[p.date]=(pl[p.date]||0)+1});Object.values(S.S).forEach(s=>{dn[s.date]=(dn[s.date]||0)+1});
  let h=['일','월','화','수','목','금','토'].map(d=>`<div class="dow">${d}</div>`).join('');
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    h+=`<button class="day${d.getMonth()!==m-1?' out':''}${ds===t?' today':''}" data-day="${ds}" aria-pressed="${ds===S.calDay}"><span class="mono">${d.getDate()}</span>${pl[ds]?`<span class="c">예정${pl[ds]}</span>`:''}${dn[ds]?`<span class="d">✓${dn[ds]}</span>`:''}</button>`}
  $('#cal').innerHTML=h;renderDay();
}
function routeKm(list,origin){let km=0,prev=origin;list.forEach(f=>{if(hasXY(f)){km+=hav(prev,f);prev=f}});return km}
function renderDay(){
  const d=S.calDay,list=dayStops(d),done=facs().filter(f=>S.S[f.id]&&S.S[f.id].date===d);
  const origin=S.startMode==='here'&&S.here?S.here:COMPANY;
  let prev=origin;const legs=list.map(f=>{if(!hasXY(f))return null;const k=hav(prev,f);prev=f;return k});
  const lbl=d===S.today?'오늘':d===addDays(S.today,1)?'내일':fmtD(d);
  $('#dayPanel').innerHTML=`
  <div class="sec"><div class="sec-h"><h2>${lbl} 방문 계획 ${list.length}곳</h2>${list.length?`<span class="sub">직선거리 합계 약 ${routeKm(list,origin).toFixed(1)}km</span>`:''}</div>
  ${list.length?`<div class="row"><span class="small muted">출발</span><button class="chip" data-start="company" aria-pressed="${S.startMode!=='here'}">회사(신립로 132)</button><button class="chip" data-start="here" aria-pressed="${S.startMode==='here'}">현재 위치</button></div>
    <div class="row"><button class="btn sm" data-act="reroute">추천 순서로 다시 짜기</button><button class="btn sm" data-act="daymap">지도에서 보기</button></div>
    <div class="note">추천 순서는 직선거리 기준이라 실제 도로 최단 경로와 다를 수 있습니다. 실제 경로와 예상 시간은 각 시설의 길찾기(카카오맵)에서 확인하세요.</div>
    <div class="card stops">${list.map((f,i)=>{const st=statusOf(f.id);return `<div class="stop"><span class="o">${i+1}</span>
      <button class="main" data-open="${f.id}"><b>${f.id}. ${esc(nm(f))}</b> <span class="pill ${ST[st].c}" style="font-size:11.5px">${ST[st].t}</span><br><span class="small muted">${esc(jibun(f))}${f.phone?' · '+esc(f.phone):''}</span> <span class="leg">${legs[i]!=null?'+'+legs[i].toFixed(1)+'km':'위치 없음'}</span></button>
      <span class="acts"><a class="icon-btn" href="${navURL(f)}" target="_blank" rel="noopener" title="길찾기">➜</a><button class="icon-btn" data-up="${f.id}" aria-label="위로">↑</button><button class="icon-btn" data-rm="${f.id}" aria-label="빼기">×</button></span></div>`}).join('')}</div>`
  :`<div class="card empty">이 날 방문 계획이 없습니다. 요청 탭에서 "대곡리 ${lbl} 30곳 잡아줘"처럼 입력하세요.</div>`}</div>
  <div class="sec"><div class="sec-h"><h2>${lbl} 조사한 곳 ${done.length}곳</h2></div>
  ${done.length?`<div class="flist">${done.map(f=>{const s=S.S[f.id];return `<button class="fitem" data-open="${f.id}"><span class="num s-${statusOf(f.id)}">${f.id}</span><span class="fmain"><span class="fname">${esc(nm(f))}</span><span class="fsub">${esc(jibun(f))} · ${esc(s.finding||'결과 미입력')} · 체크 ${ckCount(s)}/10 · 사진 ${s.legacy?'이전 ZIP':[s.near_path&&'근경',s.far_path&&'원경'].filter(Boolean).join('·')||'없음'}</span>${s.note?`<span class="fsub">메모: ${esc(s.note)}</span>`:''}</span><span class="fside"><span class="pill ${ST[statusOf(f.id)].c}">${ST[statusOf(f.id)].t}</span></span></button>`}).join('')}</div>`:'<div class="card empty">이 날 조사 기록이 없습니다.</div>'}</div>`;
}
async function setDay(d,ids){
  for(let i=0;i<ids.length;i++){const id=String(ids[i]);const r={facility:+id,date:d,position:i+1,updated_at:nowISO()};S.P[id]=r;await upsert('plans',r)}
  rerender();
}

/* ---------- route (직선거리 기준) ---------- */
function optimize(ids,origin){
  const fs=ids.map(i=>S.F[String(i)]).filter(Boolean),xy=fs.filter(hasXY),no=fs.filter(f=>!hasXY(f));
  let cur=origin;const left=[...xy],ord=[];
  while(left.length){let bi=0,bd=1e9;left.forEach((f,i)=>{const d=hav(cur,f);if(d<bd){bd=d;bi=i}});cur=left.splice(bi,1)[0];ord.push(cur)}
  const len=a=>a.reduce((s,f,i)=>s+hav(i?a[i-1]:origin,f),0);
  let imp=true,g=0;while(imp&&g++<60){imp=false;for(let i=0;i<ord.length-1;i++)for(let j=i+1;j<ord.length;j++){const c=ord.slice(0,i).concat(ord.slice(i,j+1).reverse(),ord.slice(j+1));if(len(c)+1e-9<len(ord)){ord.splice(0,ord.length,...c);imp=true}}}
  for(const f of no){let at=-1;ord.forEach((x,i)=>{if(x.ri===f.ri)at=i});if(at<0)ord.push(f);else ord.splice(at+1,0,f)}
  return ord.map(f=>f.id);
}

/* ---------- request box (규칙 기반) ---------- */
function parseAsk(t){
  const s=t.replace(/\s+/g,' ').trim();
  let date=S.today;
  if(/모레/.test(s))date=addDays(S.today,2);else if(/내일/.test(s))date=addDays(S.today,1);
  let m=s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)||s.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if(m){const y=S.today.slice(0,4);date=`${y}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`}
  const cm=s.match(/(\d+)\s*(곳|개|군데|건|개소)/);const count=cm?+cm[1]:null;
  const ris=[...new Set(facs().map(f=>f.ri))].filter(Boolean).filter(r=>s.includes(r)||s.includes(r.replace(/리$/,'')));
  const here=/현재\s*위치|여기|지금\s*위치/.test(s);
  const reorder=/순서|다시\s*짜/.test(s)&&!count&&!ris.length;
  const clear=/(일정|계획).*(비워|지워|취소)/.test(s);
  return{date,count,ris,here,reorder,clear};
}
async function runAsk(text){
  const out=$('#askOut'),r=parseAsk(text);
  const lbl=r.date===S.today?'오늘':r.date===addDays(S.today,1)?'내일':fmtD(r.date);
  let origin=COMPANY,originName='회사(신립로 132)';
  if(r.here){try{origin=await locate();originName='현재 위치'}catch(e){toast('현재 위치를 못 가져와 회사에서 출발로 계산합니다')}}
  if(r.clear){const l=dayStops(r.date);for(const f of l){delete S.P[f.id];await remove('plans','facility',f.id)}rerender();out.innerHTML=`<div class="card plan-card">${lbl} 계획 ${l.length}곳을 비웠습니다.</div>`;return}
  if(r.reorder){const l=dayStops(r.date);if(!l.length){out.innerHTML=`<div class="card plan-card">${lbl} 계획이 없습니다.</div>`;return}
    S.askPlan={date:r.date,ids:optimize(l.map(f=>f.id),origin),origin,originName,notes:[`${lbl} 계획 ${l.length}곳의 순서를 ${originName} 출발 기준으로 다시 짰습니다.`]};renderAskPlan();return}
  const pool=facs().filter(f=>!r.ris.length||r.ris.includes(f.ri));
  const done=[],other=[],same=[],cand=[],overdue=[];
  for(const f of pool){
    const p=S.P[f.id];
    if(S.S[f.id]){done.push(f);continue}
    if(p&&p.date===r.date){same.push(f);continue}
    if(p&&p.date>S.today&&p.date!==r.date){other.push(f);continue}
    if(p&&p.date<r.date)overdue.push(f);
    cand.push(f);
  }
  const want=r.count||cand.length+same.length;
  let pick=[...same];
  const need=Math.max(0,want-pick.length);
  const xy=cand.filter(hasXY),no=cand.filter(f=>!hasXY(f));
  // 가까운 곳부터 차례로 묶기(직선거리)
  let cur=pick.filter(hasXY).length?pick.filter(hasXY).slice(-1)[0]:origin;const left=[...xy],chosen=[];
  while(chosen.length<need&&left.length){let bi=0,bd=1e9;left.forEach((f,i)=>{const d=hav(cur,f);if(d<bd){bd=d;bi=i}});cur=left.splice(bi,1)[0];chosen.push(cur)}
  while(chosen.length<need&&no.length)chosen.push(no.shift());
  pick=pick.concat(chosen);
  const notes=[];
  notes.push(`대상: ${r.ris.length?r.ris.join('·'):'주덕읍 전체'} ${pool.length}곳 중 조사 완료 ${done.length}곳 제외${other.length?`, 다른 날 예약 ${other.length}곳 제외(${other.slice(0,5).map(f=>f.id+'번 '+fmtD(S.P[f.id].date)).join(', ')}${other.length>5?' 외':''})`:''}.`);
  if(same.length)notes.push(`이미 ${lbl} 계획에 있던 ${same.length}곳은 중복 없이 그대로 포함했습니다.`);
  const od=overdue.filter(f=>pick.includes(f));if(od.length)notes.push(`지난 계획에 있었지만 아직 조사 안 한 ${od.length}곳을 포함했습니다(${od.slice(0,6).map(f=>f.id+'번').join(', ')}${od.length>6?' 외':''}).`);
  if(r.count&&pick.length<r.count)notes.push(`요청한 ${r.count}곳보다 적은 ${pick.length}곳만 잡았습니다. 남은 미조사 대상이 ${cand.length+same.length}곳뿐이기 때문입니다.`);
  const nNo=pick.filter(f=>!hasXY(f)).length;if(nNo)notes.push(`위치가 없는 ${nNo}곳은 같은 리 순서 뒤에 넣었습니다(주소로 길찾기).`);
  if(!pick.length){out.innerHTML=`<div class="card plan-card"><b>잡을 수 있는 곳이 없습니다.</b><div class="small">${notes.map(esc).join('<br>')}</div></div>`;return}
  S.askPlan={date:r.date,ids:optimize(pick.map(f=>f.id),origin),origin,originName,notes};renderAskPlan();
}
function renderAskPlan(){
  const P=S.askPlan,out=$('#askOut');if(!P){out.innerHTML='';return}
  const list=P.ids.map(i=>S.F[String(i)]),km=routeKm(list,P.origin);
  const lbl=P.date===S.today?'오늘':P.date===addDays(S.today,1)?'내일':fmtD(P.date);
  out.innerHTML=`<div class="card plan-card"><b>${lbl}(${fmtD(P.date)}) ${list.length}곳 · ${esc(P.originName)} 출발 · 직선거리 합계 약 ${km.toFixed(1)}km</b>
   <div class="small">${P.notes.map(esc).join('<br>')}</div>
   <div class="note">직선거리로 가까운 순서를 추천한 것이며 실제 도로 최단 경로는 아닙니다.</div>
   <ol>${list.map(f=>`<li>${f.id}. ${esc(nm(f))} <span class="muted small">${esc(jibun(f))}</span>${hasXY(f)?'':' <span class="pill p-check">위치 없음</span>'}</li>`).join('')}</ol>
   <div class="row"><button class="btn pri" data-act="askapply">${lbl} 일정에 넣기</button><button class="btn" data-act="askcancel">취소</button></div></div>`;
}
async function applyAsk(){
  const P=S.askPlan;if(!P)return;
  const keep=dayStops(P.date).map(f=>f.id).filter(i=>!P.ids.includes(i));
  await setDay(P.date,P.ids.concat(keep));
  S.calDay=P.date;S.calMonth=P.date.slice(0,7);S.mapFilter='day';S.startMode=P.originName==='현재 위치'?'here':'company';
  $('#askOut').innerHTML=`<div class="card plan-card"><b>${fmtD(P.date)} 일정에 ${P.ids.length}곳을 넣었습니다.</b><div class="row"><button class="btn sm" data-act="daymap">지도에서 보기</button><button class="btn sm" data-tabgo="cal">일정 보기</button></div></div>`;
  S.askPlan=null;
}

/* ---------- board ---------- */
function renderBoard(){
  const all=facs(),N=all.length||1,cnt={todo:0,check:0,done:0};all.forEach(f=>cnt[statusOf(f.id)]++);
  const pct=v=>(v/N*100).toFixed(1);
  const ris=[...new Set(all.map(f=>f.ri))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ko'));
  const rows=ris.map(r=>{const a=all.filter(f=>f.ri===r),c={todo:0,check:0,done:0};a.forEach(f=>c[statusOf(f.id)]++);return `<tr><td>${esc(r)}</td><td class="b"><div class="bar"><i style="width:${c.done/a.length*100}%;background:var(--done)"></i><i style="width:${c.check/a.length*100}%;background:var(--warn)"></i></div></td><td class="n">${c.done}</td><td class="n">${c.check}</td><td class="n">${c.todo}</td><td class="n">${a.length}</td></tr>`}).join('');
  const iss=all.map(f=>({f,i:issuesOf(f.id)})).filter(x=>x.i.length);
  const pend=facs().filter(f=>f.coord_status==='pending'||!f.coord_status).length,failed=facs().filter(f=>!hasXY(f)).length;
  $('#board').innerHTML=`
  <div class="sec"><div class="tiles">
   <div class="card tile"><b>${all.length}</b><span>전체 시설</span></div><div class="card tile"><b style="color:var(--done)">${cnt.done}</b><span>조사 완료</span></div>
   <div class="card tile"><b style="color:var(--warn)">${cnt.check}</b><span>확인 필요</span></div><div class="card tile"><b>${cnt.todo}</b><span>미조사</span></div></div>
   <div class="bar" style="height:14px"><i style="width:${pct(cnt.done)}%;background:var(--done)"></i><i style="width:${pct(cnt.check)}%;background:var(--warn)"></i></div>
   <span class="small muted">조사 진행 ${pct(cnt.done+cnt.check)}% (완료 ${pct(cnt.done)}%)</span></div>
  <div class="sec"><div class="sec-h"><h2>위치</h2><span class="sub">위치 없음·변환 실패 ${failed}곳${pend?` · 아직 변환 안 함 ${pend}곳`:''}</span></div>
   <div class="row"><button class="btn sm" data-act="geocode">${pend?'주소로 위치 잡기':'주소로 위치 전부 다시 잡기'}</button><button class="btn sm" data-st-go="loc">위치 확인 필요 목록</button></div>
   <div class="note">주소를 카카오 좌표로 바꿉니다. 실패한 곳은 지도에 임의로 찍지 않고 "위치 확인 필요"로 남깁니다. 현장에서 "지금 위치를 이 시설 위치로"를 누르면 그 위치가 우선입니다.</div></div>
  <div class="sec"><div class="sec-h"><h2>확인할 것</h2><span class="sub">${iss.length}건</span></div>
   ${iss.length?`<div class="card">${iss.slice(0,60).map(x=>`<button class="issue" data-open="${x.f.id}"><span class="num s-${statusOf(x.f.id)}">${x.f.id}</span><span style="flex:1;min-width:0"><b>${esc(nm(x.f))}</b> <span class="small muted">${esc(jibun(x.f))}</span><br><span class="small" style="color:var(--warn)">${esc(x.i.join(' · '))}</span></span></button>`).join('')}</div>`:'<div class="card empty">빠진 사진이나 미작성 체크리스트가 없습니다.</div>'}</div>
  <div class="sec"><div class="sec-h"><h2>리별 진행</h2></div><div class="card" style="overflow-x:auto"><table class="ritable"><thead><tr><th>리</th><th></th><th style="text-align:right">완료</th><th style="text-align:right">확인</th><th style="text-align:right">미조사</th><th style="text-align:right">전체</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="sec"><div class="sec-h"><h2>내려받기</h2></div><div class="card" style="padding:12px;display:flex;flex-direction:column;gap:10px">
   <div class="row"><button class="btn pri sm" data-act="zip">전체 ZIP (사진·기록·체크리스트)</button><span class="small muted" id="zipMsg"></span></div>
   <div class="small muted">시설별 폴더(번호_이름)에 근경·원경 사진과 조사기록이 들어가고, 빠진 사진 목록이 함께 들어갑니다. 이 ZIP을 Claude에게 주면 한글 서류를 만들어 드립니다.</div>
   <div class="row"><button class="btn sm" data-act="vcf">연락처 파일 받기 (지번+이름)</button><button class="btn sm" data-act="csv">조사목록 CSV</button></div>
   <div class="small muted">연락처 파일(.vcf)을 휴대폰에서 열면 "대곡리390-1 천종신" 같은 이름으로 전화번호가 한꺼번에 들어갑니다.</div></div></div>`;
}
function saveBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000)}
function exportVcf(){
  const L=[];facs().filter(f=>f.phone).forEach(f=>{const n=`${(jibun(f)).replace(/\s+/g,'')} ${nm(f)}`;
    String(f.phone).split(/[,/]/).map(x=>x.trim()).filter(Boolean).forEach((ph,i)=>{L.push('BEGIN:VCARD','VERSION:3.0',`FN:${n}${i?' '+(i+1):''}`,`N:${n};;;;`,`TEL;TYPE=CELL:${ph}`,`NOTE:${f.id}번 ${f.mgmt_no||''} ${f.address||''}`,'END:VCARD')})});
  saveBlob(new Blob([L.join('\r\n')],{type:'text/vcard'}),`방치공_연락처_${S.today}.vcf`);toast('연락처 파일을 받았습니다. 휴대폰에서 열어 가져오기 하세요');
}
function listCSV(){
  const rows=[['번호','관리번호','이름','리','지번','주소','전화','상태','조사일','조사결과','메모','근경','원경',...CK.map(x=>x.q),'방문예정일','위도','경도','위치출처']].concat(facs().map(f=>{const s=S.S[f.id]||{},c=s.checklist||{};return[f.id,f.mgmt_no,f.name,f.ri,jibun(f),f.address,f.phone,ST[statusOf(f.id)].t,s.date||'',s.finding||'',s.note||'',s.near_path?'있음':(s.legacy?'이전ZIP':''),s.far_path?'있음':(s.legacy?'이전ZIP':''),...CK.map(x=>c[x.k]||''),S.P[f.id]?.date||'',f.lat??'',f.lon??'',f.coord_source||'']}));
  return '﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
async function exportZip(){
  if(!window.JSZip){toast('잠시 후 다시 눌러 주세요');return}
  const msg=$('#zipMsg');const zip=new JSZip(),photos=[],miss=[];
  const all=facs();let i=0;
  for(const f of all){const s=S.S[f.id];if(!s)continue;const folder=`${f.id}_${nm(f).replace(/[\\/:*?"<>|]/g,'')}`;
    for(const slot of ['near','far']){const p=s[slot+'_path'],kn=slot==='near'?'근경':'원경';
      if(!p){if(!s.legacy)miss.push(`${f.id} ${nm(f)} - ${kn} 없음`);continue}
      i++;msg.textContent=`사진 모으는 중 ${i}`;
      try{const{data,error}=await sb.storage.from('photos').download(p);if(error)throw error;const file=`${folder}/${folder}_${kn}.jpg`;zip.file(file,data);photos.push({id:p,facility:f.id,kind:slot,mime:'image/jpeg',size:data.size,created:s.updated_at,file})}
      catch(e){miss.push(`${f.id} ${nm(f)} - ${kn} 내려받기 실패(서버 미전송일 수 있음)`)}}
    const c=s.checklist||{};
    zip.file(`${folder}/조사기록.txt`,[`${f.id}. ${nm(f)} (${f.mgmt_no||''})`,`주소: ${f.address}`,`전화: ${f.phone||''}`,'',`조사일: ${s.date||''}`,`조사 결과: ${s.finding||''}`,`메모: ${s.note||''}`,'','체크리스트'].concat(CK.map((x,k)=>`${k+1}. ${x.q}: ${c[x.k]||'미작성'}`)).join('\r\n'));
  }
  const exp={format:'judeok-field-export',version:2,created:nowISO(),
    facilities:all.map(f=>({number:f.id,id:f.mgmt_no,name:f.name,address:f.address,shortAddress:f.short_address,ri:f.ri,phone:f.phone,...(f.info||{}),registration:{values:(f.info||{}).registration||{}},lat:f.lat,lon:f.lon})),
    surveys:Object.values(S.S).map(s=>({facility:s.facility,date:s.date,note:s.note||'',finding:s.finding||'',near:s.near_path,far:s.far_path,legacy:s.legacy,updated:s.updated_at})),
    checklists:Object.values(S.S).filter(s=>s.checklist&&Object.keys(s.checklist).length).map(s=>({facility:s.facility,date:s.checklist_date||s.date,answers:s.checklist,updated:s.updated_at})),
    plans:Object.values(S.P).map(p=>({facility:p.facility,date:p.date,position:p.position})),photos};
  zip.file('기록_원본.json',JSON.stringify(exp,null,1));
  zip.file('조사목록.csv',listCSV());
  zip.file('사진_누락_목록.txt',miss.length?miss.join('\r\n'):'빠진 사진 없음 (이전 앱 조사분은 이전 ZIP에 사진이 있음)');
  msg.textContent='압축하는 중…';
  const blob=await zip.generateAsync({type:'blob'});saveBlob(blob,`방치공조사_전체_${S.today}.zip`);msg.textContent=`완료 · 사진 ${photos.length}장 · 누락 ${miss.length}건`;
}

/* ---------- menu ---------- */
function openMenu(){
  const m=$('#menu');m.hidden=!m.hidden;if(m.hidden)return;
  m.innerHTML=`<div class="small muted" style="padding:8px 12px">${esc(S.user?.email||'')}</div>
   <button data-act="refresh">새로 불러오기</button><button data-act="flush">전송 대기 지금 보내기</button><button data-act="install">홈 화면에 앱으로 추가하는 법</button><button data-act="logout">로그아웃</button>`;
}

/* ---------- routing ---------- */
const VIEWS={map:'v-map',list:'v-list',cal:'v-cal',board:'v-board',ask:'v-ask'};
function go(t){if(!VIEWS[t])t='map';S.tab=t;for(const k in VIEWS)$('#'+VIEWS[k]).hidden=k!==t;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===t?'page':'false'));renderActive()}
function renderActive(){({map:renderMap,list:renderList,cal:renderCal,board:renderBoard,ask:renderAsk})[S.tab]();}
function renderAsk(){const sg=['대곡리 오늘 30곳 잡아줘','내일 삼청리 20곳','오늘 순서 다시 현재 위치에서','오늘 계획 비워줘'];$('#askSugg').innerHTML=sg.map(s=>`<button class="chip" data-sg="${esc(s)}">${esc(s)}</button>`).join('');renderAskPlan()}
let rT=null;function rerender(){clearTimeout(rT);rT=setTimeout(()=>{renderActive();renderChrome();if(S.tab!=='map')drawMarkers();if(S.open&&$('#sStatus'))renderPhotos()},60)}

/* ---------- events ---------- */
function bind(){
  document.querySelector('.tabs').onclick=e=>{const b=e.target.closest('.tab');if(b)go(b.dataset.tab)};
  $('#q').oninput=e=>{S.q=e.target.value;renderList()};
  $('#mapQ').onkeydown=e=>{if(e.key!=='Enter')return;const q=e.target.value.trim().replace(/\s+/g,'');if(!q)return;
    const f=facs().find(f=>String(f.id)===q)||facs().find(f=>[f.name,f.short_address,f.mgmt_no].join('|').replace(/\s+/g,'').includes(q));if(f){e.target.blur();focusFacility(f)}else toast('찾는 시설이 없습니다')};
  $('#wxBtn').onclick=async()=>{const p=$('#wxPanel'),open=p.hidden;p.hidden=!open;$('#wxBtn').setAttribute('aria-expanded',open);if(open){p.innerHTML='불러오는 중…';await renderWxPanel()}};
  $('#hereBtn').onclick=showHere;$('#fitBtn').onclick=fitAll;
  $('#menuBtn').onclick=openMenu;
  $('#calPrev').onclick=()=>{const[y,m]=S.calMonth.split('-').map(Number);const d=new Date(y,m-2,1);S.calMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;renderCal()};
  $('#calNext').onclick=()=>{const[y,m]=S.calMonth.split('-').map(Number);const d=new Date(y,m,1);S.calMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;renderCal()};
  $('#calToday').onclick=()=>{S.calDay=S.today;S.calMonth=S.today.slice(0,7);renderCal()};
  $('#askForm').onsubmit=e=>{e.preventDefault();const v=$('#askIn').value.trim();if(v)runAsk(v)};
  document.addEventListener('click',async e=>{
    const t=e.target;
    if(!$('#menu').hidden&&!t.closest('#menu')&&!t.closest('#menuBtn'))$('#menu').hidden=true;
    const o=t.closest('[data-open]');if(o){openDetail(o.dataset.open);return}
    const st=t.closest('[data-st]');if(st){S.status=st.dataset.st;renderList();return}
    const sg2=t.closest('[data-st-go]');if(sg2){S.status=sg2.dataset.stGo;go('list');return}
    const ri=t.closest('[data-ri]');if(ri){S.ri=ri.dataset.ri;renderList();return}
    const mf=t.closest('[data-mf]');if(mf){S.mapFilter=mf.dataset.mf;renderMapChips();drawMarkers();fitAll();return}
    const dy=t.closest('[data-day]');if(dy){S.calDay=dy.dataset.day;renderCal();return}
    const sm=t.closest('[data-start]');if(sm){if(sm.dataset.start==='here'){try{await locate();S.startMode='here'}catch(_){toast('현재 위치를 가져오지 못했습니다');return}}else S.startMode='company';renderDay();return}
    const up=t.closest('[data-up]');if(up){const l=dayStops(S.calDay).map(f=>f.id),i=l.indexOf(+up.dataset.up);if(i>0){[l[i-1],l[i]]=[l[i],l[i-1]];await setDay(S.calDay,l)}return}
    const rm=t.closest('[data-rm]');if(rm){const id=rm.dataset.rm;delete S.P[id];await remove('plans','facility',+id);await setDay(S.calDay,dayStops(S.calDay).map(f=>f.id));toast('계획에서 뺐습니다');return}
    const sg=t.closest('[data-sg]');if(sg){$('#askIn').value=sg.dataset.sg;$('#askIn').focus();return}
    const tg=t.closest('[data-tabgo]');if(tg){go(tg.dataset.tabgo);return}
    const a=t.closest('[data-act]');if(!a)return;
    const act=a.dataset.act;
    if(act==='flush'){$('#menu').hidden=true;flush();toast('보내는 중')}
    else if(act==='peekclose'){S.sel=null;renderPeek();drawMarkers()}
    else if(act==='showmap'){const f=S.F[S.open];closeDetail();if(!S.open&&f)focusFacility(f)}
    else if(act==='gpsfix')gpsFix();
    else if(act==='plantoday'||act==='plantmr'||act==='planclear'){S.form.plan=act==='planclear'?'':act==='plantoday'?S.today:addDays(S.today,1);$('#fPlan').value=S.form.plan;markDirty()}
    else if(act==='reroute'){const origin=S.startMode==='here'&&S.here?S.here:COMPANY;await setDay(S.calDay,optimize(dayStops(S.calDay).map(f=>f.id),origin));toast('추천 순서로 다시 짰습니다(직선거리 기준)')}
    else if(act==='daymap'){S.mapFilter='day';go('map');fitAll()}
    else if(act==='askapply')applyAsk();
    else if(act==='askcancel'){S.askPlan=null;renderAskPlan()}
    else if(act==='geocode'){if(confirm('주소를 카카오 좌표로 바꿔 위치를 다시 잡을까요? (현장 GPS로 저장한 곳은 그대로 둡니다)')){go('map');geocodeAll(facs().some(f=>f.coord_status==='pending'||!f.coord_status))}}
    else if(act==='zip')exportZip();
    else if(act==='vcf')exportVcf();
    else if(act==='csv')saveBlob(new Blob([listCSV()],{type:'text/csv'}),`조사목록_${S.today}.csv`);
    else if(act==='refresh'){$('#menu').hidden=true;await loadAll();toast('새로 불러왔습니다')}
    else if(act==='install'){$('#menu').hidden=true;alert('아이폰: 사파리에서 이 주소를 열고 공유 버튼 → "홈 화면에 추가"\n안드로이드: 크롬에서 열고 ⋮ 메뉴 → "홈 화면에 추가" 또는 "앱 설치"')}
    else if(act==='logout'){if(S.outbox.length&&!confirm('아직 서버로 못 보낸 기록이 있습니다. 그래도 로그아웃할까요?'))return;await sb.auth.signOut();location.reload()}
  });
  window.addEventListener('online',()=>{S.online=true;renderChrome();flush()});
  window.addEventListener('offline',()=>{S.online=false;renderChrome()});
  window.addEventListener('beforeunload',e=>{if(S.dirty||S.outbox.length){e.preventDefault();e.returnValue=''}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();flush()}});
}
function tick(){const t=today();if(t!==S.today){const old=S.today;S.today=t;if(!S.calDay||S.calDay===old)S.calDay=t;rerender()}}

/* ---------- data ---------- */
async function loadAll(){
  const [f,s,p]=await Promise.all([sb.from('facilities').select('*').order('id'),sb.from('surveys').select('*'),sb.from('plans').select('*')]);
  if(f.error)throw f.error;
  S.F={};(f.data||[]).forEach(r=>S.F[r.id]=r);S.S={};(s.data||[]).forEach(r=>S.S[r.facility]=r);S.P={};(p.data||[]).forEach(r=>S.P[r.facility]=r);
  rerender();if(map)drawMarkers();
}
function subscribe(){
  sb.channel('all').on('postgres_changes',{event:'*',schema:'public'},ev=>{
    const t=ev.table,n=ev.new,o=ev.old;
    const key=t==='facilities'?'F':t==='surveys'?'S':'P',idk=t==='facilities'?'id':'facility';
    if(ev.eventType==='DELETE'){if(o&&o[idk]!=null)delete S[key][o[idk]]}else if(n)S[key][n[idk]]=n;
    if(S.open&&String(n?.[idk]??o?.[idk])===S.open&&!S.dirty&&t==='surveys'){/* 다른 기기에서 저장됨 */}
    rerender();
  }).subscribe();
}

/* ---------- gate ---------- */
function gate(html){$('#gate').hidden=false;$('#app').hidden=true;$('#gate').innerHTML=`<div class="card">${html}</div>`}
function showLogin(err){
  gate(`<h1>방치공 조사 로그인</h1><p class="muted small">관리자가 만들어 준 이메일과 비밀번호로 로그인하세요.</p>
   <form id="lf" style="display:flex;flex-direction:column;gap:10px"><input type="email" id="le" placeholder="이메일" autocomplete="username" required><input type="password" id="lp" placeholder="비밀번호" autocomplete="current-password" required>
   <button class="btn pri">로그인</button></form><div id="lerr" class="small" style="color:var(--crit)">${esc(err||'')}</div>`);
  $('#lf').onsubmit=async e=>{e.preventDefault();$('#lerr').textContent='확인 중…';
    const{error}=await sb.auth.signInWithPassword({email:$('#le').value.trim(),password:$('#lp').value});
    if(error){$('#lerr').textContent='로그인 실패: 이메일이나 비밀번호를 확인하세요'}else start()};
}
async function start(){
  const{data}=await sb.auth.getSession();S.user=data.session?.user||null;
  if(!S.user){showLogin();return}
  $('#gate').hidden=true;$('#app').hidden=false;$('#areaName').textContent=CFG.AREA||'';
  S.today=today();S.calDay=S.today;
  bind();go('map');renderChrome();
  await idbOpen();await loadOutbox();renderChrome();
  try{await loadAll()}catch(e){toast('자료를 불러오지 못했습니다. 인터넷을 확인해 주세요',5000)}
  subscribe();flush();
  setInterval(tick,60e3);
  loadKakao().then(ok=>{initMap();if(ok&&facs().some(f=>f.coord_status==='pending'||!f.coord_status)){
    const m=$('#mapMsg');m.hidden=false;m.style.background='var(--accent-soft)';m.style.borderColor='var(--accent)';
    m.innerHTML=`<b>아직 위치를 잡지 않은 시설이 있습니다.</b> 주소를 카카오 좌표로 바꿀까요? <div class="row" style="margin-top:8px"><button class="btn pri sm" id="geoGo">주소로 위치 잡기</button><button class="btn sm" id="geoLater">나중에</button></div>`;
    $('#geoGo').onclick=()=>geocodeAll(true);$('#geoLater').onclick=()=>{m.hidden=true}}});
  renderWxBtn();
}
function boot(){
  if(!CFG.SUPABASE_URL||!CFG.SUPABASE_ANON_KEY){gate(`<h1>설정이 필요합니다</h1><p>config.js 파일에 Supabase 주소와 anon 키를 넣어 주세요. 설치 안내서 3단계를 보세요.</p>`);return}
  if(!window.supabase){gate(`<h1>인터넷 연결을 확인해 주세요</h1><p>앱 프로그램을 불러오지 못했습니다.</p><button class="btn pri" onclick="location.reload()">다시 시도</button>`);return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  start();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
boot();
})();
