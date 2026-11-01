/** Keep note centres readable without changing their positions in musical time. */
export function readableNotationZoom(events, duration, viewport, spacing = 40) {
  if (!(duration > 0) || !(viewport > 0)) return 1;
  const starts = [...new Set(events.map(e=>e.start).filter(Number.isFinite))].sort((a,b)=>a-b);
  let shortest = Infinity;
  for(let i=1;i<starts.length;i++) {
    const gap=starts[i]-starts[i-1];
    if(gap>1e-4)shortest=Math.min(shortest,gap);
  }
  const pixelsPerSecond=Number.isFinite(shortest)?spacing/shortest:viewport/12;
  return Math.min(256,Math.max(1,duration*pixelsPerSecond/viewport,duration/12));
}
