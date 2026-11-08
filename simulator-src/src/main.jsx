import React,{useState,useMemo,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import '../../sim/models.js';
import {sources,THEORY} from './data';
import './style.css';
import TwinWorld from './TwinWorld';
const M=globalThis.GlassModels, PI=Math.PI;
const seq=(n,a,b)=>Array.from({length:n},(_,i)=>a+(b-a)*i/(n-1));
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'해당 없음';
const preset=s=>Object.fromEntries(s.params.map(v=>[v.id,v.value]));
const color=['#007e79','#b85524','#747e93','#955a91'];
function calculate(s,p){
 const stat=(label,value,unit='',note='계산값 · 가정 조건')=>({label,value,unit,note});
 let series=[],stats=[],marker=null;
 if(s.mode==='ion'){
  const o={thicknessUm:p.thickness,depthUm:p.depth,compressionMPa:p.compression};
  series=[{name:'평형 응력',points:M.balancedProfile({...o,samples:401}).map(v=>[v.zUm,v.stressMPa])}];
  const at=M.balancedStress({...o,zUm:Math.min(p.laser,p.thickness)});
  stats=[stat('가정한 내부 인장응력',at.interiorTensionMPa,'MPa'),stat('선택 깊이의 응력',at.stressMPa,'MPa'),stat('두께 적분 힘 평형',0,'MPa·µm','해석식의 적분값')];marker=Math.min(p.laser,p.thickness);
 }else if(s.mode==='anneal'){
  const y=t=>M.annealStress({initialStressMPa:p.load,time:t,tau:p.tau});
  series=[{name:'가정한 완화',points:seq(121,0,120).map(t=>[t,y(t)])}];marker=p.time;
  stats=[stat('현재 응력 크기',y(p.time),'MPa'),stat('초기 대비 잔존 비율',p.load?100*y(p.time)/p.load:null,'%',p.load?'계산값 · 가정 조건':'초기 응력 0: 비율 정의 불가'),stat('가정한 시간상수',p.tau,'min','온도 의존성 미포함')];
 }else if(s.mode==='tip'||s.mode==='fracture'){
  const o={stressMPa:p.load,crackLengthUm:p.crack,geometryFactor:p.Y,toughnessMPaSqrtM:p.KIC,coreRadiusUm:1};const f=M.crackTip({...o,rUm:10});
  if(s.mode==='tip')series=[{name:'60°의 주응력차',points:seq(151,1,150).map(r=>[r,M.modeICrackField({...o,xUm:r*.5,yUm:r*Math.sqrt(3)/2}).principalDifferenceMPa])}];
  else {series=[{name:'불안정성 지표',points:seq(151,0,150).map(a=>[a,M.crackTip({...o,crackLengthUm:a,rUm:10}).instabilityRatio])},{name:'KI = KIC',points:[[0,1],[150,1]],dashed:true}];marker=p.crack;}
  const ac=p.load?1e6*(p.KIC/(p.Y*p.load))**2/PI:null;
  stats=[stat('응력확대계수 KI',f.kiMPaSqrtM,'MPa√m'),stat('KI / KIC',f.instabilityRatio,'','확률·수명 아님'),s.mode==='tip'?stat('r=10 µm, 60°의 광학 지연',M.retardanceNm({coefficient:p.C,thicknessUm:p.thickness,stressDifferenceMPa:M.modeICrackField({...o,xUm:5,yUm:5*Math.sqrt(3)}).principalDifferenceMPa}),'nm','두께 내 균일 응력차 가정'):stat('가정상 임계 결함 길이',ac,'µm',p.load?'균일 응력의 LEFM 기준':'0 MPa: 유한 임계값 없음')];
 }else if(s.mode==='oct'){
  const v=M.octProfile({depthUm:500,samples:251,scatterers:[{depthUm:20,widthUm:p.resolution,amplitude:.8},{depthUm:p.damageDepth,widthUm:p.resolution,amplitude:.55}],coefficient:p.C,stressMPa:p.load,wavelengthNm:p.lambda});
  series=[{name:'합성 산란 진폭',points:v.map(d=>[d.zUm,d.amplitude])}];marker=p.damageDepth;
  stats=[stat('가정한 내부 산란층',p.damageDepth,'µm'),stat('층 위치의 왕복 위상',4*PI*p.C*p.load*p.damageDepth*.001/p.lambda,'rad'),stat('Gaussian 폭 σ',p.resolution,'µm','장비 분해능 실측 아님')];
 }else if(s.mode==='reference'){
  const intensity=r=>{const f=M.kirsch({x:r/Math.sqrt(2),y:r/Math.sqrt(2),loadMPa:p.load});return M.crossedTransmission({retardanceNm:M.retardanceNm({coefficient:p.C,stressDifferenceMPa:f.principalDifferenceMPa,thicknessUm:p.thickness}),wavelengthNm:p.lambda,angleRad:f.angleRad-p.angle*PI/180});};
  const ref=intensity(p.reference);series=[{name:'기준 차감 신호',points:seq(151,1,6).map(r=>[r,p.multiplier*(intensity(r)-ref)])}];marker=p.reference;
  stats=[stat('기준 영역 투과율',ref,'I/I₀'),stat('홀 경계의 비교 신호',p.multiplier*(intensity(1)-ref),'a.u.'),stat('기준 위치',p.reference,'r/a','45° 방향에서 비교')];
 }else if(s.mode==='waveplate'){
  const calc=(l,withPlate)=>M.jonesTransmission({retardanceNm:p.gamma,wavelengthNm:l,angleRad:p.angle*PI/180,waveplateRetardanceNm:withPlate?p.plate:0,waveplateAngleRad:p.plateAngle*PI/180});
  series=[{name:'전파장판 없음',points:seq(176,400,750).map(l=>[l,calc(l,false)])},{name:'전파장판 있음',points:seq(176,400,750).map(l=>[l,calc(l,true)])}];marker=p.lambda;
  stats=[stat('판 없음 · 선택 파장',calc(p.lambda,false),'I/I₀'),stat('판 있음 · 선택 파장',calc(p.lambda,true),'I/I₀'),stat('설계 파장에서 강도차',Math.abs(calc(p.plate,true)-calc(p.plate,false)),'','이상적 전파장판이면 0')];
 }else if(s.mode==='dual'){
  const a=x=>p.top*Math.exp(-.5*((x-20)/5)**2),b=x=>p.bottom*Math.exp(-.5*((x-20-p.offset)/5)**2);
  series=[{name:'상면',points:seq(121,-60,60).map(x=>[x,a(x)])},{name:'하면',points:seq(121,-60,60).map(x=>[x,b(x)])},{name:'단순 최대값 융합',points:seq(121,-60,60).map(x=>[x,Math.max(a(x),b(x))]),dashed:true},{name:'문턱값',points:[[-60,p.threshold],[60,p.threshold]],dashed:true}];
  stats=[stat('정합 오차',p.offset,'px','실제 µm 환산 불가'),stat('설정 문턱값',p.threshold,'a.u.'),stat('합성 상·하면 최대 대비',Math.max(p.top,p.bottom),'a.u.','검출 성능 지표 아님')];
 }else if(s.mode==='interference'){
  const calc=(l,after)=>M.twoBeamIntensity({visibility:p.visibility,refractiveIndex:p.index,lengthNm:p.path+(after?p.change:0),wavelengthNm:l});
  series=[{name:'가공 전',points:seq(241,400,1600).map(l=>[l,calc(l,false)])},{name:'가공 후',points:seq(241,400,1600).map(l=>[l,calc(l,true)])}];marker=p.lambda;
  stats=[stat('선택 파장의 강도 변화',calc(p.lambda,true)-calc(p.lambda,false),'I/I₀'),stat('펼친 위상 변화',4*PI*p.index*p.change/p.lambda,'rad'),stat('경로 길이 모호성 주기',p.lambda/(2*p.index),'nm')];
 }
 return {series,stats,marker};
}
function Chart({source,result,baseline}){
 const all=[...result.series,...(baseline?[{...baseline.series[0],name:'고정한 이전 조건',baseline:true}]:[])];
 const pts=all.flatMap(s=>s.points),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
 let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(0,...ys),ymax=Math.max(...ys);if(ymax===ymin)ymax=ymin+1;
 const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;
 const X=x=>90+(x-xmin)/(xmax-xmin||1)*522,Y=y=>225-(y-ymin)/(ymax-ymin)*192;
 return <div className="chart"><svg viewBox="0 0 650 284" role="img" aria-label={`${source.plot}. ${source.x}, ${source.y}. 현재 입력으로 계산한 곡선.`}>
  {[0,.25,.5,.75,1].map((t,i)=>{const y=ymin+t*(ymax-ymin);return <g key={i}><line x1="90" x2="612" y1={Y(y)} y2={Y(y)} stroke="#dce4df"/><text x="79" y={Y(y)+4} textAnchor="end">{fmt(y,1)}</text></g>})}
  {[0,.25,.5,.75,1].map((t,i)=>{const x=xmin+t*(xmax-xmin);return <text key={i} x={X(x)} y="247" textAnchor="middle">{fmt(x,1)}</text>})}
  <text x="90" y="19" className="axisTitle">{source.y}</text><text x="340" y="276" textAnchor="middle" className="axisTitle">{source.x}</text>
  {all.map((s,i)=><path key={s.name+i} d={s.points.map(([x,y],j)=>`${j?'L':'M'}${X(x)},${Y(y)}`).join(' ')} fill="none" stroke={s.baseline?'#7354a1':color[i%color.length]} strokeWidth={s.baseline?2:2.5} strokeDasharray={s.dashed||s.baseline?'6 4':undefined}/>)}
  {result.marker!==null&&<line x1={X(result.marker)} x2={X(result.marker)} y1="30" y2="225" stroke="#143c43" strokeDasharray="3 5"/>}
 </svg><div className="legend">{all.map((s,i)=><span key={s.name+i}><i style={{background:s.baseline?'#7354a1':color[i%color.length]}}/>{s.name}</span>)}</div></div>;
}
function Field({source:s,p}){
 const ref=useRef(null);const [range,setRange]=useState('');
 const title=s.mode==='ion'?'두께방향 응력 단면 (1D)':s.mode==='reference'?'이상적 교차 편광 강도':s.mode==='tip'?'균열 주변의 합성 광학 지연':s.mode==='oct'?'합성 깊이 산란 포락선':s.mode==='waveplate'?'파장별 투과 강도':s.mode==='dual'?'합성 상·하면 관찰':s.mode==='interference'?'합성 간섭 신호':'주응력차 해석 모형';
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;const c=canvas.getContext('2d');const N=240;c.clearRect(0,0,N,N);
  if(s.mode==='dual'){
   c.fillStyle='#112e35';c.fillRect(0,0,N,N);for(let j=0;j<2;j++){const cy=65+j*112,contrast=j?p.bottom:p.top,dx=j?p.offset:0;c.strokeStyle='#73979b';c.lineWidth=2;c.beginPath();c.arc(100+dx,cy,25,0,2*PI);c.stroke();c.strokeStyle=`rgb(${Math.round(60+195*contrast)},${Math.round(60+195*contrast)},${Math.round(60+195*contrast)})`;c.lineWidth=3;c.beginPath();c.moveTo(125+dx,cy);c.lineTo(172+dx,cy-15);c.lineTo(185+dx,cy-5);c.stroke();if(contrast>=p.threshold){c.strokeStyle='#ffc078';c.lineWidth=1;c.strokeRect(120+dx,cy-23,73,38);}c.fillStyle='#e9f3ee';c.font='14px sans-serif';c.fillText(j?'하면 · 합성':'상면 · 합성',15,cy-37);}setRange('합성 영상 · 밝기와 좌표만 변경');return;
  }
  if(s.mode==='interference'){
   c.fillStyle='#112e35';c.fillRect(0,0,N,N);c.lineWidth=3;[false,true].forEach((after,k)=>{c.strokeStyle=color[k];c.beginPath();for(let i=0;i<N;i++){const val=M.twoBeamIntensity({visibility:p.visibility,refractiveIndex:p.index,lengthNm:p.path+(after?p.change:0)+i*4,wavelengthNm:p.lambda});const y=30+k*100+val*65;i?c.lineTo(i,y):c.moveTo(i,y);}c.stroke();});c.fillStyle='#e7f1ed';c.font='13px sans-serif';c.fillText('위: 가공 전 / 아래: 가공 후',16,225);setRange('경로 길이 변화에 따른 주기성 · 개념도');return;
  }
  const values=new Float64Array(N*N);let lo=Infinity,hi=-Infinity;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   let v=0;const xx=(x/N-.5)*8,yy=(.5-y/N)*8;
   if(s.mode==='ion')v=M.balancedStress({thicknessUm:p.thickness,depthUm:p.depth,compressionMPa:p.compression,zUm:y/(N-1)*p.thickness}).stressMPa;
   else if(s.mode==='tip'||s.mode==='fracture'){
    const f=M.modeICrackField({xUm:xx*25,yUm:yy*25,stressMPa:p.load,crackLengthUm:p.crack,geometryFactor:p.Y,toughnessMPaSqrtM:p.KIC,coreRadiusUm:1});v=f.excluded?NaN:s.mode==='tip'?M.retardanceNm({coefficient:p.C,stressDifferenceMPa:f.principalDifferenceMPa,thicknessUm:p.thickness}):f.principalDifferenceMPa;
   }else if(s.mode==='oct')v=.8*Math.exp(-.5*((y/(N-1)*500-20)/p.resolution)**2)+.55*Math.exp(-.5*((y/(N-1)*500-p.damageDepth)/p.resolution)**2);
   else if(s.mode==='waveplate')v=M.jonesTransmission({retardanceNm:p.gamma,wavelengthNm:400+x/(N-1)*350,angleRad:p.angle*PI/180,waveplateRetardanceNm:y<N/2?0:p.plate,waveplateAngleRad:p.plateAngle*PI/180});
   else {const load=s.mode==='anneal'?M.annealStress({initialStressMPa:p.load,time:p.time,tau:p.tau}):p.load;const f=M.kirsch({x:xx,y:yy,loadMPa:load});if(f.excluded)v=NaN;else if(s.mode==='reference')v=M.crossedTransmission({retardanceNm:M.retardanceNm({coefficient:p.C,stressDifferenceMPa:f.principalDifferenceMPa,thicknessUm:p.thickness}),wavelengthNm:p.lambda,angleRad:f.angleRad-p.angle*PI/180});else v=f.principalDifferenceMPa;}
   values[y*N+x]=v;if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  }
  if(['reference','waveplate'].includes(s.mode)){lo=0;hi=1;}
  const img=c.createImageData(N,N);
  for(let i=0;i<values.length;i++){const v=values[i],o=i*4;if(!Number.isFinite(v)){img.data.set([17,46,53,255],o);continue;}const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo||1)));let rgb;if(t<.5){const a=t*2;rgb=[17+154*a,48+160*a,58+136*a];}else{const a=(t-.5)*2;rgb=[171+78*a,208-51*a,194-119*a];}img.data.set([...rgb,255],o);}c.putImageData(img,0,0);
  c.strokeStyle='#f4f5eb';c.lineWidth=1.5;
  if((s.mode==='tip'||s.mode==='fracture')&&p.crack>0){c.beginPath();c.moveTo(0,120);c.lineTo(120,120);c.stroke();}
  if(s.mode==='ion'){const yy=Math.min(p.laser,p.thickness)/p.thickness*240;c.setLineDash([5,4]);c.beginPath();c.moveTo(0,yy);c.lineTo(240,yy);c.stroke();}
  const unit=['reference','waveplate'].includes(s.mode)?'I/I₀':s.mode==='oct'?'a.u.':s.mode==='tip'?'nm':'MPa';
  setRange(`${fmt(lo,1)} → ${fmt(hi,1)} ${unit}${['reference','waveplate'].includes(s.mode)?' · 고정 눈금':' · 현재 조건 자동 눈금'}`);
 },[s,p]);
 return <div className="field"><div className="field-head"><span className="mini-label">FORWARD MODEL</span><h3>{title}</h3></div><canvas ref={ref} width="240" height="240" role="img" aria-label={`${s.title}의 합성 시각화. 실제 영상이 아닙니다. ${range}`}/><div className="colorbar"/><p className="scale">{range}</p><p className="field-note">{s.mode==='ion'?'위·아래 압축층과 중앙 인장층. 점선은 선택 깊이입니다.':s.mode==='tip'||s.mode==='fracture'?'왼쪽 선은 기존 균열의 방향도이며 입력 길이와 축척이 같지 않습니다. 1 µm 코어 제외. 결함 크기에 비해 먼 영역은 근방식을 외삽한 설명도입니다.':s.mode==='oct'?'1D 깊이 신호를 가로로 반복한 설명도입니다. 실제 B-scan이 아닙니다.':s.mode==='waveplate'?'가로: 400 → 750 nm. 위: 판 없음, 아래: 판 있음. 실제 색상 영상이 아닙니다.':s.mode==='dual'?'합성 선 특징입니다. 주황 테두리는 대비가 문턱값 이상인 선을 표시합니다. 실제 검출 결과가 아닙니다.':s.mode==='interference'?'광로를 바꾸면 같은 강도가 반복됩니다. 시간에 따른 측정 파형이 아닙니다.':'원형 빈 홀의 무한 평판 모형. 가로·세로 범위는 −4a → +4a입니다.'}</p></div>;
}
function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function NumericInput({label,min,max,step,value,onCommit}){
 const [draft,setDraft]=useState(String(value));
 useEffect(()=>setDraft(String(value)),[value]);
 const commit=()=>{const n=Number(draft);const v=draft.trim()!==''&&Number.isFinite(n)?Math.min(max,Math.max(min,n)):value;setDraft(String(v));onCommit(v);};
 return <input aria-label={`${label} 수치 입력`} type="number" min={min} max={max} step={step} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(String(value));}}}/>;
}
function App(){
 const initial=()=>sources.find(s=>s.id===new URLSearchParams(location.search).get('source'))||sources[0];
 const [s,setS]=useState(initial),[p,setP]=useState(()=>preset(initial())),[baseline,setBaseline]=useState(null),[notice,setNotice]=useState('');
 const result=useMemo(()=>calculate(s,p),[s,p]);
 useEffect(()=>{const on=()=>{const next=initial();setS(next);setP(preset(next));setBaseline(null);};window.addEventListener('popstate',on);return()=>window.removeEventListener('popstate',on);},[]);
 const choose=next=>{setS(next);setP(preset(next));setBaseline(null);setNotice('');const u=new URL(location.href);u.searchParams.set('source',next.id);history.pushState(null,'',u);};
 const set=(id,v)=>{setP(prev=>{const next={...prev,[id]:v};if(id==='thickness'&&next.laser>v)next.laser=v;return next;});};
 const exportCSV=()=>{let text='source_id,series,x,x_unit,y,y_unit\n';result.series.forEach(z=>z.points.forEach(([x,y])=>text+=`${s.id},"${z.name}",${x},"${s.x}",${y},"${s.y}"\n`));download(`glass-lab-${s.id}.csv`,'\uFEFF'+text,'text/csv;charset=utf-8');setNotice('현재 계산 곡선을 CSV로 저장했습니다. 출처와 가정은 JSON에도 포함됩니다.');};
 const exportJSON=()=>{download(`glass-lab-${s.id}-conditions.json`,JSON.stringify({schemaVersion:1,modelVersion:'1.1.0',sourceId:s.id,title:s.title,url:s.href,evidence:s.status,parameters:p,parameterDefinitions:s.params,assumptions:s.assumed,limitations:s.limit,generatedAt:new Date().toISOString(),quantitativeReplicationValidated:false,result},null,2),'application/json');setNotice('출처·단위·가정·계산값을 JSON으로 저장했습니다.');};
 return <><a href="#lab" className="skip">실험 조절판으로 건너뛰기</a><header><a className="brand" href="../">GLASS / <strong>LAB</strong><span>유리 패키징 연구</span></a><nav aria-label="상단 메뉴"><a href="../#research">연구 근거</a><a href="../#process">공정 GIF</a><a href="https://github.com/waterfirst/hackerton/tree/main/simulator-src" target="_blank" rel="noreferrer">코드 ↗</a></nav></header>
 <main><section className="hero"><div><p className="eyebrow">SOURCE-LINKED RESEARCH PLAYGROUND</p><h1>논문에서 가설로,<br/><span>가설에서 계산으로.</span></h1><p className="intro">6편의 논문과 5건의 특허를 한 실험실에 연결했습니다.<br/>조건을 바꾸고, 결과를 비교하며, 아직 모르는 부분까지 확인하세요.</p></div><div className="hero-note"><b>먼저 알아둘 점</b><p>지금은 <strong>출처 기반 탐구 모형</strong>입니다.<br/>문헌 전체의 정량 재현이나 검증된 크랙 예측 도구가 아닙니다.</p><div className="counts"><span><strong>11</strong>문헌별 연결</span><span><strong>10</strong>계산·개념 시나리오</span><span><strong>0</strong>정량 재현 검증</span></div></div></section>
 <TwinWorld source={s} p={p} onParam={set} onChoose={id=>choose(sources.find(v=>v.id===id))}/>
 <section className="source-section" aria-labelledby="source-label"><div className="section-line"><h2 id="source-label">01 <span>문헌을 선택하세요</span></h2><span className="small">각 버튼은 서로 다른 질문을 다룹니다</span></div><div className="source-grid">{sources.map(z=><button key={z.id} className={`source-button ${s.id===z.id?'selected':''}`} aria-pressed={s.id===z.id} onClick={()=>choose(z)}><span>{z.id} <small>{z.kind}</small></span><b>{z.title}</b><small>{z.author}</small></button>)}</div></section>
 <section id="lab" className="lab" aria-labelledby="scenario-title"><div className="scenario-heading"><div><div className="tags"><span className="id-tag">{s.id}</span><span className="badge">{s.status}</span><span className="badge subtle">{s.mode==='pending'?'계산 미제공':'합성·이상화 모형'}</span></div><h2 id="scenario-title">{s.question}</h2></div><a href={s.href} target="_blank" rel="noreferrer">원문 열기 ↗</a></div>
 <div className="warning"><strong>{s.mode==='pending'?'재현 대기':'해석 범위'}</strong><span>{s.limit}</span></div>
 {s.mode==='pending'?<div className="pending"><span className="pending-icon">P6</span><h3>원문을 확보한 뒤 이 칸을 채웁니다.</h3><p>제목만으로 조건이나 결과를 만들어 넣지 않았습니다.<br/>아래 자료를 확보하면 실험 조건 → 모형 → 데이터 대조 순서로 구현합니다.</p><ol>{s.need.map(n=><li key={n}>{n}</li>)}</ol><a className="primary link-button" href={s.href} target="_blank" rel="noreferrer">논문 DOI 확인 ↗</a></div>:<>
 <div className="workbench"><aside className="controls"><div className="section-line"><h3>02 <span>조건 조절</span></h3><button className="text-button" onClick={()=>{setP(preset(s));setNotice('현재 문헌의 시작 조건으로 되돌렸습니다.');}}>초기화 ↺</button></div><p className="control-note">출처 값이 명시된 경우 외에는 설명용 가정입니다. 단위와 적용 범위를 확인하세요.</p>{s.params.map(v=>{const max=v.id==='laser'?p.thickness:v.max;return <div className="control" key={s.id+v.id}><label htmlFor={v.id}>{v.label}<small>{v.unit}</small></label><div className="control-input"><input id={v.id} type="range" min={v.min} max={max} step={v.step} value={p[v.id]} onChange={e=>set(v.id,+e.target.value)}/><NumericInput label={v.label} min={v.min} max={max} step={v.step} value={p[v.id]} onCommit={n=>set(v.id,n)}/></div><div className="control-range"><span>{v.min}</span><span>{max}</span></div></div>;})}<button className="secondary full" onClick={()=>{setBaseline(result);setNotice('현재 곡선을 고정했습니다. 조건을 바꾸면 보라색 이전 곡선과 비교할 수 있습니다.');}}>현재 곡선 고정 · 비교</button>{baseline&&<button className="text-button full" onClick={()=>setBaseline(null)}>고정 곡선 지우기</button>}</aside>
 <div className="results"><div className="result-top"><Field source={s} p={p}/><div className="stats"><span className="mini-label">CALCULATED, NOT MEASURED</span><h3>현재 조건의 계산값</h3>{result.stats.map(v=><div className="stat" key={v.label}><span>{v.label}</span><b>{fmt(v.value,3)} <small>{v.unit}</small></b><p>{v.note}</p></div>)}</div></div><div className="chart-block"><div className="section-line"><h3>{s.plot}</h3><span className="small">{baseline?'이전 조건과 비교 중':'현재 조건 · 즉시 계산'}</span></div><Chart source={s} result={result} baseline={baseline}/><details className="data-table"><summary>계산 데이터 보기 · 대표 11개 지점</summary><div className="table-wrap"><table><caption>{s.plot} · 전체 데이터는 CSV로 저장</caption><thead><tr><th>{s.x}</th>{result.series.map(z=><th key={z.name}>{z.name} ({s.y})</th>)}</tr></thead><tbody>{result.series[0].points.filter((_,i,a)=>i%Math.max(1,Math.floor((a.length-1)/10))===0).map(([x,y],i)=><tr key={i}><td>{fmt(x)}</td>{result.series.map(z=><td key={z.name}>{fmt(z.points.reduce((a,b)=>Math.abs(b[0]-x)<Math.abs(a[0]-x)?b:a)[1],4)}</td>)}</tr>)}</tbody></table></div></details></div></div></div>
 <div className="export-row"><div><b>가정까지 함께 기록하세요.</b><p>계산은 이 브라우저에서 수행합니다. 파일 업로드·서버 전송은 없습니다.</p></div><div><button className="secondary" onClick={exportCSV}>곡선 CSV 저장 ↓</button><button className="primary" onClick={exportJSON}>조건·출처 JSON 저장 ↓</button></div></div><p role="status" className="status-message">{notice}</p></>}
 <div className="evidence"><div className="section-line"><h3>03 <span>무엇을 확인했고, 무엇을 가정했나</span></h3></div><div className="evidence-grid"><article><span className="mini-label">SOURCE</span><h4>문헌에서 확인한 내용</h4><p>{s.verified}</p><a href={s.href} target="_blank" rel="noreferrer">{s.author} · 원문 ↗</a></article><article><span className="mini-label">ASSUMPTION</span><h4>이 시뮬레이터의 선택</h4><p>{s.assumed}</p>{s.equations.map(q=><div className="equation" key={q}>{q}</div>)}</article><article><span className="mini-label">NEXT EVIDENCE</span><h4>정량 재현에 필요한 것</h4><ul>{s.need.map(n=><li key={n}>{n}</li>)}</ul></article></div></div></section>
 <section className="methods"><div><p className="eyebrow">HOW TO READ THIS LAB</p><h2>그림이 그럴듯한 것과<br/>검증된 것은 다릅니다.</h2><p>{THEORY}</p></div><div><details open><summary>수치 검증과 실험 검증을 구분합니다</summary><p>단위 변환, 힘 평형, Kirsch의 홀 경계 3배 응력, 무하중, 전파장판 불변성, 균열면 무응력, 광학 강도 범위, 간섭 주기성 등을 자동 시험합니다. 이는 코드의 일관성 확인이며 논문·실험 일치의 증명이 아닙니다.</p></details><details><summary>브라우저 계산과 전문 해석기의 역할</summary><p>React는 조작 화면을 담당하고 해석식·축약모형은 JavaScript에서 계산합니다. 실제 3D FEM, 열-구조 연성, 이온 확산, 균열 성장, 대용량 OCT 재구성은 재료·경계조건과 검증된 해석기가 필요합니다. ngspice는 회로용이므로 유리 응력 해석기를 대신하지 않습니다. 이 페이지는 백엔드 해석기에 연결되지 않습니다.</p></details><details><summary>특허·공개자료의 사용 범위</summary><p>특허는 기술 설명이며 성능 검증 자료가 아닙니다. 본 실험실은 공개 내용의 학습용 모형으로 청구항 전체의 구현·법률 검토·자유실시 의견을 제공하지 않습니다. 원문 그림·비공개 시편 데이터를 재배포하지 않습니다.</p></details></div></section>
 </main><footer><div><strong>GLASS / LAB</strong><p>출처 검토 2026.11.08 · 모델 버전 1.4.0<br/>공개 GitHub Pages · 브라우저 내 계산 · React + Three.js</p></div><a href="../">기획서와 연구 근거로 돌아가기 ↗</a></footer></>;
}
createRoot(document.getElementById('root')).render(<App/>);
