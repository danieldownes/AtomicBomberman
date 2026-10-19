// Prepare exact animation contact sheets and pack imagegen remasters without changing game metadata.
// NODE_PATH must include sharp. Usage: node tools/build_hd.cjs prepare | accept ID GENERATED.png | manifest
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'output/hd'), dest = path.join(root, 'web/hd');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const dbfile = path.join(work, 'jobs.json');
const context = { window: {} }; vm.createContext(context);
for (const f of ['sprites', 'classic']) vm.runInContext(fs.readFileSync(path.join(root, 'web/data/' + f + '.js'), 'utf8'), context);
const sprites = context.window.AB_SPRITES, SCALE = 3;
async function registeredFrame(generated, name, rect) {
  const [left,top,width,height] = rect, meta = sprites[name];
  const source = await sharp(Buffer.from(meta.src.split(',')[1], 'base64')).extract({left,top,width,height}).resize(width*SCALE,height*SCALE).ensureAlpha().raw().toBuffer();
  const pixels = await sharp(generated).ensureAlpha().raw().toBuffer();
  // AI supplies new surface detail; the original animation supplies registration and coverage.
  // This removes generated matte speckles and prevents pose/silhouette drift across adjacent cels.
  for (let i=0;i<pixels.length;i+=4) {
    const a=pixels[i+3]/255;
    for(let ch=0;ch<3;ch++) pixels[i+ch]=Math.round(pixels[i+ch]*a+source[i+ch]*(1-a));
    let alpha=source[i+3];
    if(meta.fx==='glow') alpha=Math.round(alpha*Math.pow(Math.min(1,Math.max(source[i],source[i+1],source[i+2])/150),0.85));
    if(meta.fx==='shadow') alpha=Math.round(alpha*110/255);
    pixels[i+3]=alpha;
  }
  return sharp(pixels,{raw:{width:width*SCALE,height:height*SCALE,channels:4}}).png().toBuffer();
}
async function prepare() {
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(dest, { recursive: true });
  const jobs = [];
  for (const [name, meta] of Object.entries(sprites)) {
    if (name === 'kface') continue; // Photo atlas; never send real people through the art remaster.
    const raw = Buffer.from(meta.src.split(',')[1], 'base64');
    // Up to 64 cels per reference. Regridding gives every cel enough space for a real remaster.
    const cw = Math.max(...meta.frames.map(f => f[2])) + 8, ch = Math.max(...meta.frames.map(f => f[3])) + 8;
    for (let start = 0; start < meta.frames.length; start += 64) {
      const frames = meta.frames.slice(start, start + 64), cols = Math.ceil(Math.sqrt(frames.length * ch / cw)), rows = Math.ceil(frames.length / cols);
      const id = name + '-' + start, ref = path.join(work, id + '-reference.png');
      const layers = [];
      for (let i = 0; i < frames.length; i++) {
        const [left, top, width, height] = frames[i];
        const input = await sharp(raw).extract({ left, top, width, height }).png().toBuffer();
        layers.push({ input, left: i % cols * cw + 4, top: Math.floor(i / cols) * ch + 4 });
      }
      const grid = await sharp({ create: { width: cols * cw, height: rows * ch, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer();
      await sharp(grid).resize(cols * cw * SCALE, rows * ch * SCALE, { kernel: 'nearest' }).png().toFile(ref);
      jobs.push({ id, kind: 'atlas', name, start, count: frames.length, cols, rows, cw, ch, ref, scale: SCALE, frames });
    }
  }
  // Real people in the credits keep their original photos in both graphics modes.
  const excluded = /^(field\d+|mainmenu|victory-mask|pow|jerm\.|kurt\.|kurthead\.)/;
  for (const file of fs.readdirSync(path.join(root, 'web/img'))) {
    if (!file.endsWith('.png') || excluded.test(file)) continue;
    const name = path.basename(file, '.png'), ref = path.join(root, 'web/img', file), m = await sharp(ref).metadata();
    jobs.push({ id: 'image-' + name, kind: 'image', name, ref, width: m.width, height: m.height, scale: SCALE });
  }
  // Fields have fixed layout: preserve playable-area geometry exactly while remastering surfaces.
  for (let level = 0; level < 12; level++) jobs.push({ id: 'image-field' + level, kind: 'image', name: 'field' + level, ref: path.join(root, 'web/img/field' + level + '.png'), width: 640, height: 480, level, scale: SCALE });
  jobs.push({ id: 'image-mainmenu-clean', kind: 'image', name: 'mainmenu-clean', ref: path.join(root, 'web/img/mainmenu.png'), width: 640, height: 480, scale: SCALE });
  jobs.push({ id: 'image-tilesets-bedrock-textures', kind: 'image', name: 'tilesets/bedrock/textures', ref: path.join(root, 'output/tilesets/bedrock-textures-source.png'), width: 120, height: 36, level: 12, scale: SCALE });
  const previous = fs.existsSync(dbfile) ? read(dbfile) : [];
  for (const j of jobs) if (previous.find(p => p.id === j.id && p.accepted)) j.accepted = true;
  write(dbfile, jobs); console.log(jobs.map(j => j.id).join('\n')); console.log(jobs.length + ' jobs');
}
async function accept(id, generated, rebuild = true) {
  const jobs = read(dbfile), j = jobs.find(j => j.id === id); if (!j) throw new Error('Unknown job ' + id);
  const saved = path.join(work, id + '-generated.png'); if(path.resolve(generated)!==path.resolve(saved)) fs.copyFileSync(generated, saved);
  if (j.kind === 'image') {
    const file = path.join(dest, 'img', j.name + '.webp'); fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(saved).resize(j.width * SCALE, j.height * SCALE, { fit: 'fill' }).webp({quality:92,alphaQuality:100,effort:5}).toFile(file);
  } else if (j.kind === 'bundle') {
    const page = await sharp(saved).resize(j.cols * j.cw * SCALE, j.rows * j.ch * SCALE, { fit: 'fill' }).png().toBuffer();
    for (const name of [...new Set(j.entries.map(e => e.ani))]) {
      const layers = [];
      for (let i = 0; i < j.entries.length; i++) {
        const e = j.entries[i]; if (e.ani !== name) continue;
        const [left, top, width, height] = e.rect;
        const crop = await sharp(page).extract({ left: (i % j.cols * j.cw + 4) * SCALE, top: (Math.floor(i / j.cols) * j.ch + 4) * SCALE, width: width * SCALE, height: height * SCALE }).png().toBuffer();
        const input = await registeredFrame(crop, name, e.rect);
        layers.push({ input, left: left * SCALE, top: top * SCALE });
      }
      const m = await sharp(Buffer.from(sprites[name].src.split(',')[1], 'base64')).metadata();
      await sharp({ create: { width: m.width * SCALE, height: m.height * SCALE, channels: 4, background: '#00000000' } }).composite(layers).png().toFile(path.join(work, j.id + '-' + name + '-packed.png'));
    }
  } else {
    // Keep the original frame rectangles and hotspots. Only the pixels inside those rectangles change.
    const page = await sharp(saved).resize(j.cols * j.cw * SCALE, j.rows * j.ch * SCALE, { fit: 'fill' }).png().toBuffer();
    const layers = [];
    for (let i = 0; i < j.frames.length; i++) {
      const [left, top, width, height] = j.frames[i];
      const crop = await sharp(page).extract({ left: (i % j.cols * j.cw + 4) * SCALE, top: (Math.floor(i / j.cols) * j.ch + 4) * SCALE, width: width * SCALE, height: height * SCALE }).png().toBuffer();
      const input = await registeredFrame(crop,j.name,j.frames[i]);
      layers.push({ input, left: left * SCALE, top: top * SCALE });
    }
    const m = await sharp(Buffer.from(sprites[j.name].src.split(',')[1], 'base64')).metadata();
    const pagefile = path.join(work, j.id + '-packed.png');
    await sharp({ create: { width: m.width * SCALE, height: m.height * SCALE, channels: 4, background: '#00000000' } }).composite(layers).png().toFile(pagefile);
  }
  j.accepted = true; write(dbfile, jobs); if(rebuild) await manifest();
}
// What stays original in HD too. `true`: the whole picture or animation is left out of the pack (not
// downloaded); a list: those frames of the atlas are drawn from the original sprites instead.
// * Classic (8-bit) keeps its pixel art by design (js/render.js draws it with sharp pixels).
// * The rest came out wrong in the remaster (see `python tools/check_hd_cels.py`): for the idles,
//   the corner-head and several deaths the image model drew a generic standing bomberman instead of
//   the pose it was given, or parts of neighbouring frames ended up in a frame (doubled heads, a
//   second rim in the teleport hole, the conveyors drawn twice, stray bits in the timer digits).
//   Regenerate and accept a job, check it, then take it off this list.
// (The bombs' small frames are wrong too; js/render.js draws HD bombs from their biggest frame.)
const ORIGINAL = {
  classics: true, classicarena: true, field11: true,
  // kface is a real-person photo atlas, not character artwork.
  kface: true, zen: true, headwipe: true,
  xplode2: true, xplode3: true, xplode4: true, xplode10: true,
  xplode12: true, xplode14: true, xplode16: true,
};
async function manifest() {
  const jobs = read(dbfile), images = {}, atlases = {};
  // Retained approved sources take precedence over the old, tightly gridded generation pages.
  // Merely generating/aligning a candidate never changes runtime selection.
  const repairFile = path.join(work, 'repairs.json');
  const repairs = fs.existsSync(repairFile) ? read(repairFile).atlases : {};
  for (const j of jobs.filter(j => j.accepted && j.kind === 'image' && ORIGINAL[j.name] !== true)) {
    const ext = fs.existsSync(path.join(dest,'img',j.name+'.webp')) ? '.webp' : '.png';
    images[j.name] = { src: 'hd/img/' + j.name + ext, width: j.width, height: j.height, scale: SCALE, bytes: fs.statSync(path.join(dest, 'img', j.name + ext)).size };
  }
  fs.mkdirSync(path.join(dest, 'atlases'), { recursive: true });
  for (const [name, meta] of Object.entries(sprites)) {
    if (ORIGINAL[name] === true) continue;
    const pages = jobs.filter(j => j.kind === 'atlas' && j.name === name || j.kind === 'bundle' && j.entries.some(e => e.ani === name));
    const covered = pages.reduce((n,j) => n + (j.kind === 'atlas' ? j.count : j.entries.filter(e => e.ani === name).length),0);
    if (covered !== meta.frames.length || !pages.every(j => j.accepted)) continue;
    const m = await sharp(Buffer.from(meta.src.split(',')[1], 'base64')).metadata();
    const file = path.join(dest, 'atlases', name + '.webp');
    const repair = repairs[name];
    if (repair) {
      if (!Array.isArray(repair.frames) || new Set(repair.frames).size !== repair.frames.length ||
          repair.frames.some(f => !Number.isInteger(f) || f < 0 || f >= meta.frames.length))
        throw Error('Invalid repaired frame list: ' + name);
      const input = path.resolve(work, repair.source);
      if (!input.startsWith(path.join(work, 'repairs') + path.sep)) throw Error('Invalid repair source: ' + name);
      const size = await sharp(input).metadata();
      if (size.width !== m.width*SCALE || size.height !== m.height*SCALE) throw Error('Repair dimensions: ' + name);
      if (!fs.existsSync(file) || fs.statSync(input).mtimeMs > fs.statSync(file).mtimeMs)
        await sharp(input).webp({quality:92,alphaQuality:100,effort:4}).toFile(file);
    } else {
      const layers=pages.map(j=>({input:path.join(work,j.id+(j.kind==='bundle'?'-'+name:'')+'-packed.png'),left:0,top:0}));
      if(!fs.existsSync(file)||layers.some(l=>fs.statSync(l.input).mtimeMs>fs.statSync(file).mtimeMs)) await sharp({ create: { width: m.width * SCALE, height: m.height * SCALE, channels: 4, background: '#00000000' } }).composite(layers).webp({quality:92,alphaQuality:100,effort:4}).toFile(file);
    }
    const arena = /^(tiles|xbrick)\d+$/.test(name) ? +name.match(/\d+/)[0] : name === 'classicarena' ? 11 : null;
    atlases[name] = { src: 'hd/atlases/' + name + '.webp', width: m.width, height: m.height, scale: SCALE, frames: meta.frames.length, bytes: fs.statSync(file).size, arena };
  }
  if(images['victory-base']) {
    const base = await sharp(path.join(root,'web',images['victory-base'].src)).ensureAlpha().raw().toBuffer();
    const old = await sharp(path.join(root,'web/img/victory-mask.png')).extract({left:0,top:0,width:640,height:480}).ensureAlpha().raw().toBuffer();
    const mask = Buffer.alloc(1920*1440*4), regions = [new Uint8Array(640*480),new Uint8Array(640*480)];
    for(let y=0;y<480;y++)for(let x=0;x<640;x++)for(let k=0;k<2;k++)if(old[(y*640+x)*4+k]) {
      for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)if(x+dx>=0&&x+dx<640&&y+dy>=0&&y+dy<480)regions[k][(y+dy)*640+x+dx]=1;
    }
    for(let y=0;y<1440;y++)for(let x=0;x<1920;x++) {
      const i=(y*1920+x)*4,roi=Math.floor(y/3)*640+Math.floor(x/3),r=base[i],g=base[i+1],b=base[i+2];
      if(regions[0][roi]&&g>Math.max(r,b)+5)mask[i]=255;
      else if(regions[1][roi]&&b>Math.max(r,g)+5)mask[i+1]=255;
      mask[i+3]=255;
    }
    const file=path.join(dest,'img/victory-tint-mask.png');await sharp(mask,{raw:{width:1920,height:1440,channels:4}}).png().toFile(file);
    images['victory-tint-mask']={src:'hd/img/victory-tint-mask.png',width:640,height:480,scale:SCALE,bytes:fs.statSync(file).size};
  }
  // Menus/manual pages reuse the remastered in-game powerups, rather than a second art set.
  if(atlases.powers) {
    const icons={powbad:8,powbomb:5,powdisea:0,powebola:8,powfast:13,powflame:2,powgold:7,powgrab:12,powjelly:11,powkick:1,powpunch:3,powrand:10,powskate:4,powslow:14,powspoog:6,powtrig:9};
    for(const[name,index]of Object.entries(icons)) {
      const[left,top,width,height]=sprites.powers.frames[index],file=path.join(dest,'img',name+'.webp');
      if(!fs.existsSync(file)||fs.statSync(path.join(root,'web',atlases.powers.src)).mtimeMs>fs.statSync(file).mtimeMs)await sharp(path.join(root,'web',atlases.powers.src)).extract({left:left*SCALE,top:top*SCALE,width:width*SCALE,height:height*SCALE}).webp({quality:95,alphaQuality:100}).toFile(file);
      images[name]={src:'hd/img/'+name+'.webp',width,height,scale:SCALE,bytes:fs.statSync(file).size};
    }
  }
  const fonts={};for(const name of ['font0','font1','font6']){const file=path.join(dest,'fonts',name+'.ttf');if(fs.existsSync(file))fonts[name]=fs.readFileSync(file).toString('base64');}
  const result = { version: 1, scale: SCALE, images, atlases, fonts, original: ORIGINAL };
  fs.writeFileSync(path.join(dest, 'manifest.js'), 'window.AB_HD_MANIFEST=' + JSON.stringify(result) + ';\n');
  console.log('HD: ' + Object.keys(atlases).length + '/' + Object.keys(sprites).length + ' atlases, ' + Object.keys(images).length + ' images');
  // the recoloured pictures again as scripts, for opening the game from disk (file://)
  require('./build_pixel_scripts.cjs').build();
}
async function bundle() {
  const old = read(dbfile), jobs = old.filter(j => j.kind === 'image' || j.accepted);
  const names = Object.keys(sprites).filter(name => name !== 'kface' && !old.some(j => j.kind === 'atlas' && j.name === name && j.accepted));
  const groups = {
    actions: names.filter(n => /^(bwalk|pup|punbomb)/.test(n)),
    deaths: names.filter(n => /^xplode/.test(n)),
    celebrations: names.filter(n => /^corner/.test(n)),
    idles: names.filter(n => /^(zen|headwipe|applbite|nuckblow)$/.test(n)),
    terrain: names.filter(n => /^(tiles|xbrick|classicarena)/.test(n)),
    other: names.filter(n => !/^(bwalk|pup|punbomb|xplode|corner|zen|headwipe|applbite|nuckblow|tiles|xbrick|classicarena)/.test(n)),
  };
  for (const [group, names] of Object.entries(groups)) {
    const entries = names.flatMap(ani => sprites[ani].frames.map((rect,index) => ({ ani, index, rect })));
    for (let start = 0; start < entries.length; start += 64) {
      const slice = entries.slice(start,start+64), cw = Math.max(...slice.map(e => e.rect[2])) + 8, ch = Math.max(...slice.map(e => e.rect[3])) + 8;
      const cols = Math.ceil(Math.sqrt(slice.length * ch / cw)), rows = Math.ceil(slice.length / cols), id = 'bundle-' + group + '-' + start;
      const ref = path.join(work,id+'-reference.png'), layers = [];
      for (let i=0;i<slice.length;i++) {
        const e=slice[i], [left,top,width,height]=e.rect;
        const input=await sharp(Buffer.from(sprites[e.ani].src.split(',')[1],'base64')).extract({left,top,width,height}).png().toBuffer();
        layers.push({ input,left:i%cols*cw+4,top:Math.floor(i/cols)*ch+4 });
      }
      const grid = await sharp({create:{width:cols*cw,height:rows*ch,channels:4,background:'#00000000'}}).composite(layers).png().toBuffer();
      await sharp(grid).resize(cols*cw*SCALE,rows*ch*SCALE,{kernel:'nearest'}).png().toFile(ref);
      jobs.push({ id,kind:'bundle',group,cols,rows,cw,ch,count:slice.length,ref,entries:slice });
    }
  }
  write(dbfile,jobs); console.log(jobs.filter(j=>!j.accepted).map(j=>j.id).join('\n')); console.log(jobs.length+' jobs including completed');
}
async function splitOther() {
  const old=read(dbfile), entries=old.filter(j=>j.kind==='bundle'&&j.group==='other').flatMap(j=>j.entries);
  if(!entries.length||old.some(j=>j.kind==='bundle'&&j.group==='other'&&j.accepted))throw Error('Split only ungenerated other pages');
  const jobs=old.filter(j=>!(j.kind==='bundle'&&j.group==='other'));
  for(const [group,all]of [['small',entries.filter(e=>e.ani!=='hurry')],['banner',entries.filter(e=>e.ani==='hurry')]])for(let start=0;start<all.length;start+=64){
    const slice=all.slice(start,start+64),cw=Math.max(...slice.map(e=>e.rect[2]))+8,ch=Math.max(...slice.map(e=>e.rect[3]))+8;
    const cols=Math.ceil(Math.sqrt(slice.length*ch/cw)),rows=Math.ceil(slice.length/cols),id='bundle-'+group+'-'+start,ref=path.join(work,id+'-reference.png'),layers=[];
    for(let i=0;i<slice.length;i++){
      const e=slice[i],[left,top,width,height]=e.rect;
      const input=await sharp(Buffer.from(sprites[e.ani].src.split(',')[1],'base64')).extract({left,top,width,height}).png().toBuffer();
      layers.push({input,left:i%cols*cw+4,top:Math.floor(i/cols)*ch+4});
    }
    const grid=await sharp({create:{width:cols*cw,height:rows*ch,channels:4,background:'#00000000'}}).composite(layers).png().toBuffer();
    await sharp(grid).resize(cols*cw*SCALE,rows*ch*SCALE,{kernel:'nearest'}).png().toFile(ref);
    jobs.push({id,kind:'bundle',group,cols,rows,cw,ch,count:slice.length,ref,entries:slice});
  }
  write(dbfile,jobs);console.log('Separated the large banner from small UI/effect cels.');
}
(async () => { const [cmd, a, b] = process.argv.slice(2); if (cmd === 'prepare') await prepare(); else if (cmd === 'bundle') await bundle(); else if(cmd==='split-other') await splitOther(); else if (cmd === 'accept') await accept(a, b); else if (cmd === 'repack') {for(const j of read(dbfile).filter(j=>j.accepted)) await accept(j.id,path.join(work,j.id+'-generated.png'),false);await manifest();} else if (cmd === 'manifest') await manifest(); else throw new Error('prepare | bundle | split-other | accept ID GENERATED.png | repack | manifest'); })().catch(e => { console.error(e); process.exitCode = 1; });
