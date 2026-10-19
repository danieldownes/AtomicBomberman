// Compare assembled blast joins, not just isolated atlas cels.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {environment}=require('./test_hd.cjs');
const out=path.resolve(__dirname,'../output/hd/repair');
(async()=>{const keepAlive=setInterval(()=>{},1000);try{
 const {A}=await environment(),G=A.gfx,c=createCanvas(3000,2070),x=c.getContext('2d');
 x.scale(3,3);x.fillStyle='#202831';x.fillRect(0,0,1000,690);
 const candidate=await loadImage(path.resolve(out,'../repairs/mflame.png'));
 const oldPath=path.resolve(out,'../mflame-0-packed.png');
 const previous=fs.existsSync(oldPath)?await loadImage(oldPath):null;
 const atlas=A.hd.atlas;
 for(let row=0;row<3;row++){
  await A.hd.set(row>0);A.hd.atlas=name=>name==='mflame'&&row>0?(row===2?candidate:previous||atlas(name)):atlas(name);G.releaseHDTints();
  x.fillStyle='#ffe39a';x.font='11px sans-serif';x.fillText(['Original',previous?'Previous HD':'Current HD','Connected HD repair'][row],10,row*225+18);
  for(let state=0;state<5;state++){
   const cx=100+state*200,cy=row*225+120;
   G.draw(x,'flame center green',state,cx,cy,4,true);
   for(const [dir,dx,dy]of [['west',-40,0],['east',40,0],['north',0,-36],['south',0,36]]){
    G.draw(x,'flame mid'+dir+' green',state,cx+dx,cy+dy,4,true);
    G.draw(x,'flame tip'+dir+' green',state,cx+dx*2,cy+dy*2,4,true);
   }
  }
 }
 fs.writeFileSync(path.join(out,'flame-joins.png'),c.toBuffer('image/png'));
 console.log('Flame joins compared at original runtime offsets.');
}finally{clearInterval(keepAlive)}})().catch(e=>{console.error(e);process.exitCode=1;});
