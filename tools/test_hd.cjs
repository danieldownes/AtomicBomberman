// Native-canvas integration tests: lazy HD delivery, menu interaction, packing and rendering.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createCanvas, Image, GlobalFonts } = require('@napi-rs/canvas');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web'), out = path.join(root, 'output/hd');
GlobalFonts.registerFromPath(path.join(web, 'data/menu-amarante.ttf'), 'ABMenuClean');
const read = f => fs.readFileSync(path.join(web, f), 'utf8');
async function environment(protocol = 'http:') {
  const requests = [], storage = new Map(), fail = new Set(), metrics={canvases:0}; let c;
  class LocalImage extends Image {
    constructor() {
      super(); this.done = false; this.listeners = { load: [], error: [] };
      Object.defineProperty(this, 'complete', { get: () => this.done });
      for (const event of ['load', 'error']) {
        let fn; Object.defineProperty(this, 'on' + event, { set: f => { fn = f; }, get: () => (...args) => { this.done = true; if (fn) fn(...args); for (const f of this.listeners[event]) f(...args); } });
      }
    }
    set src(value) {
      requests.push(value); const file = value.split('?')[0];
      if (fail.has(file)) { setImmediate(() => this.onerror(new Error('intentional test failure'))); return; }
      try { super.src = value.startsWith('data:') ? Buffer.from(value.split(',')[1], 'base64') : fs.readFileSync(path.join(web, file)); }
      catch (e) { setImmediate(() => this.onerror(e)); }
    }
    addEventListener(event, fn) { this.listeners[event].push(fn); }
  }
  const canvas = createCanvas(640, 480); canvas.style = {};
  class LocalFontFace {
    constructor(name,source){this.name=name;if(typeof source==='string')this.src=source.match(/url\((.+)\)/)[1];else this.bytes=Buffer.from(source);}
    async load(){if(this.bytes){assert.ok(GlobalFonts.register(this.bytes,this.name));return this;}requests.push(this.src);if(fail.has(this.src))throw Error('Font unavailable');assert.ok(GlobalFonts.registerFromPath(path.join(web,this.src),this.name));return this;}
  }
  c = { window: {FontFace:LocalFontFace}, FontFace:LocalFontFace, Image: LocalImage, setTimeout, clearTimeout, console, structuredClone, atob,
    location: { protocol },
    document: { fonts:{add(){}}, createElement: name => {if(name!=='canvas')return {remove(){}};metrics.canvases++;return createCanvas(1,1);}, body: { appendChild(s) { requests.push(s.src); setImmediate(() => { try { if (fail.has(s.src)) throw Error('intentional test failure'); vm.runInContext(read(s.src.split('?')[0]), c); s.onload(); } catch (e) { s.onerror(e); } }); } } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  };
  c.document.head = c.document.body;
  Object.defineProperty(c, 'AB_PIXELS', { get: () => c.window.AB_PIXELS });
  vm.createContext(c);
  for (const f of ['data/gamedata.js','data/fonts.js','data/menufont.js','data/sprites.js','data/classic.js','js/core.js','js/hd.js','js/gfx.js','js/victory.js','js/tilesets.js','js/game.js','js/ai.js','js/render.js']) vm.runInContext(read(f),c,{filename:f});
  const A = c.window.AB;
  A.audio = { setVolumes() {}, music() {}, play() {}, playRange() {}, PRESET_LABEL:{extended:'Extended'} };
  A.input = { layouts:[],takePresses:()=>[] };
  for (const f of ['js/screens.js','js/screens2.js']) vm.runInContext(read(f),c,{filename:f});
  A.applyDisplay = () => A.gfx.applyDisplay(canvas); A.applyDisplay();
  await A.gfx.load(); await A.gfx.loadMenuFont(); await A.gfx.preloadImages(['mainmenu-clean','title','glue0']);
  return { A,c,canvas,requests,storage,fail,metrics };
}
function save(name, canvas) { fs.writeFileSync(path.join(out,name+'.png'),canvas.toBuffer('image/png')); }
module.exports = { environment };
if (require.main === module) (async()=>{
  const keepAlive = setInterval(()=>{},1000);
  try {
    const { A,c,canvas,requests,storage,fail,metrics } = await environment();
    assert.equal(A.settings.hdMode,false); assert.equal(A.hd.active(),false);
    assert.ok(!requests.some(r=>r.startsWith('hd/')),'Retro boot must not request HD manifest or artwork');
    A.screens.go('mainmenu'); A.screens.render(canvas.getContext('2d')); save('menu-retro',canvas);
    const menu=A.screens.current();
    for(let i=0;i<3;i++)menu.key({code:'ArrowDown'});
    assert.equal(menu.sel,3,'HD toggle follows Campaign');
    const progress=[]; await A.hd.set(true,p=>progress.push(p));
    assert.ok(progress.length>1 && progress.at(-1).fraction===1,'Visible progress must finish at 100%');
    assert.equal(canvas.width,1920);assert.equal(canvas.height,1440);
    assert.ok(!requests.some(r=>/^hd\/(img\/field|img\/tilesets|atlases\/(tiles|xbrick|classicarena))/.test(r)),'Switch must defer ALL arena graphics');
    assert.equal(A.hd.active(),true);
    const count=requests.length; await A.hd.set(true); assert.equal(requests.length,count,'Repeated enable must reuse decoded art');
    A.screens.render(canvas.getContext('2d'));save('menu-hd',canvas);
    for(let color=0;color<10;color++)A.gfx.frame(canvas.getContext('2d'),'walk',0,100,120,color);
    const warmedCanvases=metrics.canvases;
    for(let tick=0;tick<10;tick++)for(let color=0;color<10;color++)A.gfx.frame(canvas.getContext('2d'),'walk',0,100,120,color);
    assert.equal(metrics.canvases,warmedCanvases,'Ten player colours must reuse tinted HD cels without cache thrashing');
    const settings={...A.defaultSettings(),randomStart:false}, players=Array.from({length:10},(_,i)=>({slot:i,color:i,team:i%2,ai:false}));
    const manifest=c.window.AB_HD_MANIFEST, originals=c.window.AB_SPRITES;
    for(const photo of ['jerm','kurt','kurthead'])assert.ok(!manifest.images[photo],'Credit photos must stay original');
    assert.ok(!manifest.atlases.kface && !fs.existsSync(path.join(web,'hd/atlases/kface.webp')),'No generated real-person atlas');
    // what stays original (Classic, and the remasters that came out wrong) is left out of the pack
    const original=manifest.original||{}, RETRO_ONLY=new Set(Object.keys(original).filter(n=>original[n]===true));
    for(const name of ['classics','classicarena','field11'])assert.ok(RETRO_ONLY.has(name),name+' must stay 8-bit');
    for(const name of RETRO_ONLY)assert.ok(!manifest.atlases[name]&&!manifest.images[name],name+' must not be downloaded');
    for(const[name,frames]of Object.entries(original))if(frames!==true)assert.ok(manifest.atlases[name]&&frames.every(f=>f<originals[name].frames.length),name+' original frames');
    assert.equal(Object.keys(manifest.atlases).length,Object.keys(originals).filter(n=>!RETRO_ONLY.has(n)).length,'Every other animation needs HD coverage');
    let frames=0,bytes=0;
    for(const kind of ['atlases','images'])for(const[name,a]of Object.entries(manifest[kind])){
      const file=path.join(web,a.src), data=await sharp(file).metadata();
      assert.equal(data.width,a.width*a.scale,name+' width');assert.equal(data.height,a.height*a.scale,name+' height');
      assert.equal(fs.statSync(file).size,a.bytes,name+' download weight');bytes+=a.bytes;
      if(kind==='atlases'){assert.equal(a.frames,originals[name].frames.length,name+' frame coverage');frames+=a.frames;}
    }
    const jobs=JSON.parse(fs.readFileSync(path.join(out,'jobs.json'),'utf8'));
    for(const j of jobs){assert.ok(j.accepted,j.id+' is unfinished');if(j.kind==='image'&&!RETRO_ONLY.has(j.name))assert.ok(manifest.images[j.name],j.name+' absent from pack');}
    console.log('PASS: complete HD coverage: '+frames+' cels, '+Object.keys(manifest.images).length+' images, '+(bytes/1048576).toFixed(1)+' MiB delivered in total.');
    fail.add(manifest.images['tilesets/bedrock/textures'].src);
    await A.tilesets.prepare(A.BEDROCK_LEVEL);
    assert.equal(A.tilesets.status(A.BEDROCK_LEVEL),'failed');
    const afterFailure=requests.length;
    await A.tilesets.load(A.BEDROCK_LEVEL);await A.tilesets.load(A.BEDROCK_LEVEL);
    assert.equal(requests.length,afterFailure,'A failed preview must not repeatedly download every frame');
    fail.clear();await A.tilesets.prepare(A.BEDROCK_LEVEL);
    assert.equal(A.tilesets.status(A.BEDROCK_LEVEL),'ready');
    console.log('PASS: unavailable HD arena falls back, preview stops retrying, next round retries successfully.');
    for(const level of Array.from({length:A.BEDROCK_LEVEL+1},(_,i)=>i)) {
      await A.tilesets.prepare(level);
      const field=level===A.BEDROCK_LEVEL?'tilesets/bedrock/textures':'field'+level;
      if(level===A.CLASSIC_LEVEL)assert.ok(!A.hd.image(field),'Classic must keep its 8-bit field');
      else assert.ok(A.hd.image(field),'Arena '+level+' must have its HD field');
      for(const[name,a]of Object.entries(manifest.atlases))if(a.arena===level)assert.ok(A.hd.atlas(name),name+' must load with its arena');
      const g=new A.Game({settings,level,scheme:c.window.AB_DATA.schemes.basic,seed:1997,players,match:{}});
      A.render.draw(canvas.getContext('2d'),g,0); save('arena-'+level+'-hd',canvas);
      assert.equal(g.players.length,10);
    }
    const makeGame=()=>new A.Game({settings,level:A.BEDROCK_LEVEL,scheme:c.window.AB_DATA.schemes.basic,seed:1997,players,match:{}});
    const simulated=makeGame(),drawn=makeGame();
    for(let tick=0;tick<1200;tick++){
      const inputs=Int32Array.from({length:10},(_,i)=>(1<<((Math.floor(tick/30)+i)%4))|(tick%53===i?A.IN.BOMB:0));
      simulated.step(inputs);drawn.step(inputs);if(tick%30===0)A.render.draw(canvas.getContext('2d'),drawn,tick);
      if(tick%60===0)assert.equal(JSON.stringify(simulated.saveState()),JSON.stringify(drawn.saveState()));
    }
    assert.equal(simulated.checksum(),drawn.checksum());
    console.log('PASS: all 13 arenas load individually, ten player colours render, HD drawing preserves simulation for 1,200 ticks.');
    const animationGallery=createCanvas(1920,1170),ag=animationGallery.getContext('2d');ag.scale(3,3);
    const rows=[['Walk south','walk south',4],['Walk east','walk east',2],['Carrying bomb','walkbomb west',3],['Death','die green 1',6],['Brick destruction','flame brick 0',-1],['Bedrock crumble',null,-1]];
    ag.fillStyle='#101824';ag.fillRect(0,0,640,390);
    for(let row=0;row<rows.length;row++){
      const[label,seq,color]=rows[row];ag.fillStyle='#ffe954';ag.font='10px sans-serif';ag.fillText(label,8,row*65+12);
      const len=seq?A.gfx.seqLen(seq):A.tilesets.breakFrames(A.BEDROCK_LEVEL);assert.ok(len>0,label+' sequence missing');
      for(let col=0;col<8;col++){
        const state=Math.floor(col*(len-1)/7),x=75+col*76,y=row*65+62;
        if(seq)A.gfx.draw(ag,seq,state,x,y,color,'steady');else A.tilesets.draw(ag,A.BEDROCK_LEVEL,'breaking',state,x,y);
      }
    }
    save('animations-hd',animationGallery);
    const pairs=[[4,3],[2,6],[5,9],[8,1]], gallery=createCanvas(1280,960),gx=gallery.getContext('2d');
    for(let i=0;i<pairs.length;i++){
      const[w,l]=pairs[i];A.victory.draw(canvas.getContext('2d'),w,l);
      gx.drawImage(canvas,i%2*640,Math.floor(i/2)*480,640,480);
    }
    save('victory-hd-combinations',gallery);
    const hdMask=await sharp(path.join(web,manifest.images['victory-tint-mask'].src)).ensureAlpha().raw().toBuffer();
    const drawVictory=(w,l)=>{A.victory.draw(canvas.getContext('2d'),w,l);return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;};
    const originalPair=drawVictory(4,3),winnerChanged=drawVictory(2,3),loserChanged=drawVictory(4,6);
    let winnerPixels=0,loserPixels=0;
    for(let i=0;i<hdMask.length;i+=4){
      for(let ch=0;ch<3;ch++){
        if(!hdMask[i])assert.equal(winnerChanged[i+ch],originalPair[i+ch],'HD winner tint escaped its mask');
        else if(winnerChanged[i+ch]!==originalPair[i+ch])winnerPixels++;
        if(!hdMask[i+1])assert.equal(loserChanged[i+ch],originalPair[i+ch],'HD loser tint escaped its mask');
        else if(loserChanged[i+ch]!==originalPair[i+ch])loserPixels++;
      }
    }
    assert.ok(winnerPixels>1000&&loserPixels>1000,'Both HD characters must respond independently to tinting');
    // Actual menu toggle and persistence; returning to Retro restores the original backing store.
    menu.key({code:'Enter'}); await new Promise(r=>setImmediate(r));
    assert.equal(A.hd.active(),false); assert.equal(canvas.width,640); assert.equal(canvas.style.imageRendering,'pixelated');
    assert.equal(JSON.parse(storage.get('ab_settings')).hdMode,false);
    console.log('PASS: Retro default, zero HD boot requests, dynamic menu, real progress, 3x backing store, deferred arenas, cached enable and Retro switch.');
    const failed=await environment(); failed.fail.add('hd/manifest.js');
    await assert.rejects(failed.A.hd.set(true),/downloaded/); assert.equal(failed.A.hd.active(),false);
    failed.fail.clear(); await failed.A.hd.set(true); assert.equal(failed.A.hd.active(),true);
    console.log('PASS: failed manifest leaves Retro active and can be retried.');
    const broken=await environment(), m={window:{}}; vm.createContext(m);vm.runInContext(read('hd/manifest.js'),m);
    const first=Object.values(m.window.AB_HD_MANIFEST.atlases).find(a=>a.arena===null);
    broken.fail.add(first.src); await assert.rejects(broken.A.hd.set(true),/unavailable/);assert.equal(broken.A.hd.active(),false);
    broken.fail.clear(); await broken.A.hd.set(true);assert.equal(broken.A.hd.active(),true);
    console.log('PASS: a broken HD picture cannot activate a partial pack; retry succeeds.');
    const cancelled=await environment(), opening=cancelled.A.hd.set(true);
    cancelled.A.hd.cancel();await assert.rejects(opening,/cancelled/);
    await new Promise(r=>setImmediate(r));
    assert.equal(cancelled.A.hd.active(),false);
    assert.equal(cancelled.requests.filter(r=>r.startsWith('hd/')&&r!=='hd/manifest.js').length,0,'Cancelling the manifest must not start artwork downloads');
    await cancelled.A.hd.set(true);assert.equal(cancelled.A.hd.active(),true);
    console.log('PASS: cancel keeps Retro active, stops queued downloads and permits another enable.');
    const disk=await environment('file:');await disk.A.hd.set(true);
    for(const name of ['applbite','nuckblow','corner2','xplode13']) {
      assert.ok(disk.requests.includes('hd/atlases/'+name+'.js'),name+' must load its readable script from disk');
      const ctx=disk.canvas.getContext('2d');
      ctx.clearRect(0,0,640,480);disk.A.gfx.frame(ctx,name,0,100,120,4);
      const green=disk.canvas.toBuffer('image/png');
      ctx.clearRect(0,0,640,480);disk.A.gfx.frame(ctx,name,0,100,120,3);
      assert.ok(!green.equals(disk.canvas.toBuffer('image/png')),name+' disk tint must respond to player colour');
    }
    console.log('PASS: repaired character atlases load through file:// scripts and recolour independently.');
  } finally {clearInterval(keepAlive);}
})().catch(e=>{console.error(e);process.exitCode=1;});
