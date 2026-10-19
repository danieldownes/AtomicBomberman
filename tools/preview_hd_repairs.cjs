// Render real runtime sequences offline, including their original offsets and player tinting.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('@napi-rs/canvas');
const {environment}=require('./test_hd.cjs');
const out=path.resolve(__dirname,'../output/hd/repair');
function canvas(w,h){const c=createCanvas(w*3,h*3),x=c.getContext('2d');x.scale(3,3);x.fillStyle='#202831';x.fillRect(0,0,w,h);return[c,x];}
function label(x,s,a,b){x.fillStyle='#ffe39a';x.font='11px sans-serif';x.fillText(s,a,b);}
function save(name,c){fs.writeFileSync(path.join(out,name+'.png'),c.toBuffer('image/png'));}
async function main(){
 const keepAlive=setInterval(()=>{},1000);
 try{
  const {A,c}=await environment();await A.hd.set(true);await A.tilesets.prepare(6);
  const S=c.window.AB_SPRITES,G=A.gfx;
  const rows=[['Apple eating','applbite'],['Knuckle blowing','nuckblow'],['Head reaction','corner0'],['BYE reaction','corner1'],['Shovel reaction','corner2'],['Tears reaction','corner3'],['Ash death','xplode1'],['Angel death','xplode9'],['Wobble / fall','xplode13']];
  const [gallery,g]=canvas(720,rows.length*90+30);
  label(g,'Repaired HD animations — selected frames, rendered by the game',10,17);
  rows.forEach(([title,name],row)=>{
   label(g,title,10,42+row*90);
   for(let k=0;k<7;k++){
    const f=Math.round(k*(S[name].frames.length-1)/6),r=S[name].frames[f],cx=180+k*77,cy=68+row*90;
    G.frame(g,name,f,cx-r[2]/2+r[4],cy-r[3]/2+r[5],4);
   }
  });save('repaired-animations',gallery);
  const [walls,w]=canvas(440,190);
  for(const [hd,x,title]of [[false,30,'Original'],[true,250,'Repaired HD']]){
   await A.hd.set(hd);label(w,title,x,22);w.save();w.imageSmoothingEnabled=hd;w.translate(x,40);w.scale(4,4);G.draw(w,'tile 6 solid',0,20,35,-1,false);w.restore();
  }save('aliens-wall-repaired',walls);
  const [small,s]=canvas(680,215);label(s,'Repaired timer, conveyors, portal and Aliens enemies',10,20);
  for(let n=0;n<12;n++)G.frame(s,'kfont',n,25+n*52,68,-1);
  for(let n=0;n<5;n++)G.frame(s,'conveyor',n,30+n*60,120,-1);
  for(let n=10;n<14;n++)G.frame(s,'conveyor',n,365+(n-10)*50,125,-1);
  G.frame(s,'extras',4,55,190,-1);G.frame(s,'misc',2,130,190,-1);
  for(let n=11;n<16;n++)G.frame(s,'misc',n,215+(n-11)*55,190,-1);
  for(let n=0;n<Math.min(4,S.aliens1.frames.length);n++)G.frame(s,'aliens1',n,530+n*40,190,-1);
  save('repaired-effects',small);
  const playback=path.join(out,'playback');fs.mkdirSync(playback,{recursive:true});
  function bounds(name,states){
   const counts=new Map();let best='0,0',max=0;
   for(const st of states){const key=st[1]+','+st[2],count=(counts.get(key)||0)+1;counts.set(key,count);if(count>max){best=key;max=count;}}
   const [bx,by]=best.split(',').map(Number),left=[],top=[],right=[],bottom=[];
   for(const st of states)for(let k=0;k<st.length;k+=3){const r=S[name].frames[st[k]],x=bx+st[k+1]-st[1]-r[4],y=by+st[k+2]-st[2]-r[5];left.push(x);top.push(y);right.push(x+r[2]);bottom.push(y+r[3]);}
   return [Math.min(...left),Math.min(...top),Math.max(...right),Math.max(...bottom)];
  }
  // Original animation states run at 20 Hz. Keep every state, including the final idle cel.
  for(let tick=0;tick<121;tick++){
   const [strip,x]=canvas(650,450);
   rows.forEach(([title,name],i)=>{
    const seq=Object.keys(S[name].seqs)[0],states=S[name].seqs[seq],ox=i%3*215,oy=Math.floor(i/3)*150;
    label(x,title,ox+10,oy+18);
    const [l,t,r,b]=bounds(name,states);
    G.draw(x,G.seqFrom(name,seq),tick%states.length,ox+(215-r+l)/2-l,oy+32+(110-b+t)/2-t,4,'steady');
   });fs.writeFileSync(path.join(playback,String(tick).padStart(3,'0')+'.png'),strip.toBuffer('image/png'));
  }
  console.log('Repair galleries and playback frames:',out);
 }finally{clearInterval(keepAlive);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
