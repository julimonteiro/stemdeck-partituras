import { readableNotationZoom } from './notationSpacing.js';
import { currentJobId, audioEngine, multitrack, totalDuration, waveScroll, waveZoom } from './state.js';

const active = new Map();
let timer;
let priorZoom=1;
let syncNativeRuler=null;
const NS = 'http://www.w3.org/2000/svg';
function node(tag, attributes, parent, text) {
  const n = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attributes || {})) n.setAttribute(key,String(value));
  if (text !== undefined) n.textContent = text;
  parent?.append(n);
  return n;
}
export function timelineMode(stem) { return active.get(stem)?.mode || 'audio'; }
export function clearTimeline(stem) {
  active.get(stem)?.overlay?.remove(); active.delete(stem);
  if (!active.size) {clearInterval(timer); timer=null;import('./transport.js').then(({setNotationZoomLimit,setWaveZoomLevel})=>{if(!active.size){setNotationZoomLimit(false);setWaveZoomLevel(priorZoom);}});}
  document.dispatchEvent(new Event('sd-score-timeline-changed'));
}
export async function showTimeline(jobId, stem, result) {
  if (jobId !== currentJobId || !result.timeline) return;
  if(!active.size)priorZoom=waveZoom;
  clearTimeline(stem);
  active.set(stem,{jobId,stem,result,mode:result.notation,overlay:null,width:0,height:0,groups:[]});
  if (!timer) timer=setInterval(update,40);
  document.dispatchEvent(new Event('sd-score-timeline-changed'));
  const {setWaveZoomLevel,setNotationZoomLimit,syncRulerScroll}=await import('./transport.js');
  syncNativeRuler=syncRulerScroll;
  if (jobId===currentJobId&&active.has(stem)){
    setNotationZoomLimit(true);
    const readable=readableNotationZoom(result.timeline,totalDuration,waveScroll?.clientWidth||750);
    setWaveZoomLevel(Math.max(waveZoom,readable));
  }
  update();
}

function draw(entry, width, height) {
  const {result,mode}=entry;
  const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,width:'100%',height:'100%',preserveAspectRatio:'none',role:'group','aria-label':mode==='tab'?'Tablatura na timeline':'Partitura na timeline'},entry.overlay);
  const duration=totalDuration || result.duration;
  const px=time=>Math.max(0,Math.min(width,time/duration*width));
  const line=(x1,y1,x2,y2,color='#38444e',lineWidth=.7)=>node('line',{x1,y1,x2,y2,stroke:color,'stroke-width':lineWidth},svg);
  let yForPitch;
  if (mode==='tab') {
    const labels=['G','D','A','E',...(result.strings===5?['B']:[])];
    const top=15, gap=Math.min(13,(height-25)/(labels.length-1));
    labels.forEach((label,index)=>{const y=top+index*gap;line(0,y,width,y);node('text',{x:width-7,y:y+3,'text-anchor':'end','font-size':9,'font-family':'system-ui',fill:'#728794'},svg,label);});
    yForPitch=e=>top+((e.string||1)-1)*gap;
  } else {
    const steps=[0,0,1,1,2,3,3,4,4,5,5,6];
    const diatonic=pitch=>Math.floor(pitch/12)*7+steps[pitch%12];
    // Bass staff G2..A3, with enough vertical space for low B0 on a 5-string.
    const low=Math.min(diatonic(23),...result.timeline.map(e=>diatonic(e.pitch)));
    const high=Math.max(diatonic(57),...result.timeline.map(e=>diatonic(e.pitch)));
    const step=Math.min(3.2,(height-20)/(high-low+2));
    const y=diatonicPitch=>10+(high-diatonicPitch)*step;
    for(let i=0;i<5;i++) line(0,y(diatonic(43)+i*2),width,y(diatonic(43)+i*2));
    yForPitch=e=>entry.stem==='drums'?height*({36:.75,38:.5,47:.38,42:.23,49:.1}[e.pitch]||.5):y(diatonic(e.pitch));
    entry.staff={bottom:y(diatonic(43)),top:y(diatonic(57)),step};
  }
  entry.measureRects=[];
  for (const measure of result.measures) {
    const x=px(measure.start), end=px(measure.start+result.beats*60/result.bpm);
    const rect=node('rect',{x,y:0,width:Math.max(0,end-x),height,fill:'transparent','class':'sd-timeline-measure'},svg);
    entry.measureRects.push({rect,start:measure.start,end:measure.start+result.beats*60/result.bpm});
    line(x,8,x,height-4,'#53616c',1);
    node('text',{x:x+3,y:9,'font-size':9,fill:'#7e909d','font-family':'system-ui'},svg,String(measure.number));
  }
  entry.groups=[];
  result.timeline.forEach((event,index)=>{
    const x=Math.max(6,Math.min(width-10,px(event.start))),y=yForPitch(event);
    const group=node('g',{'class':'sd-timeline-note','data-start':event.start,'data-end':event.end,
      tabindex:0,role:'button','aria-label':`${entry.stem==='bass'?'Nota':'Batida'} ${index+1}, ${event.start.toFixed(2)} segundos`},svg);
    if (mode==='tab') {
      node('line',{x1:x+7,y1:y-4,x2:Math.max(x+7,px(event.end)-3),y2:y-4,stroke:'#58707f','stroke-width':1},group);
      node('rect',{x:x-7,y:y-8,width:18,height:18,rx:4,fill:'#111a21','class':'sd-fret-bed'},group);
      node('text',{x,y:y+4,'font-size':14,'font-weight':'600','font-family':'system-ui','text-anchor':'middle',fill:'currentColor'},group,event.fret??'?');
    } else {
      const dotted=[.375,.75,1.5,3,6].some(n=>Math.abs(event.beats-n)<.001);
      const base=dotted?event.beats/1.5:event.beats;
      node('line',{x1:x+5,y1:height-5,x2:Math.max(x+5,px(event.end)-2),y2:height-5,stroke:'currentColor','stroke-width':2,opacity:.2},group);
      if(entry.stem==='bass') {
        const {bottom,top,step}=entry.staff;
        if(y>bottom+step) for(let ly=bottom+step*2;ly<=y+1;ly+=step*2) node('line',{x1:x-6,y1:ly,x2:x+6,y2:ly,stroke:'currentColor','stroke-width':.8},group);
        if(y<top-step) for(let ly=top-step*2;ly>=y-1;ly-=step*2) node('line',{x1:x-6,y1:ly,x2:x+6,y2:ly,stroke:'currentColor','stroke-width':.8},group);
      }
      if(entry.stem==='drums' && [42,49].includes(event.pitch)) node('text',{x,y:y+4,'font-size':14,'text-anchor':'middle',fill:'currentColor'},group,'×');
      else node('ellipse',{cx:x,cy:y,rx:4.3,ry:2.7,transform:`rotate(-20 ${x} ${y})`,fill:base>=2?'#111a21':'currentColor',stroke:'currentColor','stroke-width':1},group);
      if(base<4) node('line',{x1:x+4,y1:y,x2:x+4,y2:Math.max(4,y-19),stroke:'currentColor','stroke-width':1},group);
      if(dotted)node('circle',{cx:x+8,cy:y-1,r:1.3,fill:'currentColor'},group);
      const flags=base<=.25?2:base<=.5?1:0;
      for(let f=0;f<flags;f++) node('path',{d:`M${x+4} ${Math.max(4,y-19)+f*4}q9 3 4 9`,fill:'none',stroke:'currentColor','stroke-width':1},group);
      if(entry.stem==='bass' && [1,3,6,8,10].includes(event.pitch%12)) node('text',{x:x-10,y:y+4,'font-size':10,fill:'currentColor'},group,'♯');
    }
    async function seek(e){e.preventDefault();e.stopPropagation();const {setPlayheadTime}=await import('./transport.js');if(currentJobId===entry.jobId)setPlayheadTime(event.start);}
    group.addEventListener('click',seek);
    group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')seek(e);});
    entry.groups.push({element:group,event});
  });
  const initial=document.querySelector('#ruler-time .playhead-marker')?.style.left || `${((audioEngine||multitrack)?.getCurrentTime?.()||0)/duration*100}%`;
  entry.cursor=node('line',{x1:initial,y1:0,x2:initial,y2:height,stroke:'#e54e4e','stroke-width':2,'class':'sd-timeline-cursor'},svg);
}

function update() {
  // The ruler lives outside the scrolling lanes. Keep it in step even when
  // a browser coalesces scroll events during an expensive notation zoom.
  syncNativeRuler?.();
  const engine=audioEngine||multitrack;
  const time=engine?.getCurrentTime?.()||0;
  for(const [stem,entry] of active) {
    if(entry.jobId!==currentJobId) {clearTimeline(stem);continue;}
    const column=document.querySelector('.waves-column');
    let row=document.querySelector(`.stem-waveform-row[data-stem="${stem}"]`);
    if(!row?.getBoundingClientRect().height)row=document.querySelector(`.lane-header[data-stem="${stem}"]`);
    if(!column||!row) continue;
    if(!entry.overlay?.isConnected){entry.overlay=document.createElement('div');entry.overlay.className='sd-timeline-overlay';entry.overlay.dataset.stem=stem;column.append(entry.overlay);entry.width=0;}
    const bounds=column.getBoundingClientRect(), rb=row.getBoundingClientRect();
    const scale=column.clientWidth/(bounds.width||1);
    const width=column.clientWidth, height=rb.height*scale;
    entry.overlay.style.top=`${(rb.top-bounds.top)*scale}px`;
    entry.overlay.style.height=`${height}px`;
    entry.overlay.hidden=rb.height===0;
    if(width!==entry.width||Math.abs(height-entry.height)>.5){entry.width=width;entry.height=height;entry.overlay.replaceChildren();draw(entry,width,height);}
    for(const {element,event} of entry.groups) element.classList.toggle('sd-playing',time>=event.start&&time<event.end);
    for(const m of entry.measureRects) m.rect.setAttribute('fill',time>=m.start&&time<m.end?'#f3b83009':'transparent');
    // The transport updates both cursors together. Do not introduce a second clock here.
  }
  if(active.size&&engine?.isPlaying?.()&&waveScroll){
    const x=time/(totalDuration||1)*waveScroll.scrollWidth;
    if(x<waveScroll.scrollLeft||x>waveScroll.scrollLeft+waveScroll.clientWidth*.85) waveScroll.scrollLeft=Math.max(0,x-waveScroll.clientWidth*.2);
  }
}
