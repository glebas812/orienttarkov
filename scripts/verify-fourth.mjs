import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
const root=resolve(new URL("../",import.meta.url).pathname), dist=join(root,"dist"), shots=join(root,"verification-shots");
await mkdir(shots,{recursive:true});
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png"};
const server=createServer(async(req,res)=>{try{const path=req.url?.split("?")[0]==="/"?"/index.html":req.url?.split("?")[0]??"/index.html";const data=await readFile(join(dist,decodeURIComponent(path)));res.writeHead(200,{"content-type":mime[extname(path)]??"application/octet-stream"});res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,r)); const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??"/usr/bin/chromium",args:["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"]});
const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[], missing=[];
page.on("console",m=>{if(m.type()==="error")errors.push(m.text());}); page.on("pageerror",e=>errors.push(String(e))); page.on("response",r=>{if(r.status()===404)missing.push(r.url());});
const assert=(v,m)=>{if(!v)throw new Error(m);}, snap=()=>page.evaluate(()=>window.__gameTest.snapshot());
const start=(biome,difficulty="M12")=>page.evaluate(({biome,difficulty})=>window.__gameTest.start(biome,difficulty),{biome,difficulty});
try{
 await page.goto(`http://127.0.0.1:${port}/?test=1`,{waitUntil:"networkidle"}); await page.waitForFunction(()=>window.__GAME_READY__);
 await start("ladoga","M12"); await page.waitForTimeout(400);
 const before=(await snap()).stamina; await page.keyboard.down("Space"); await page.waitForTimeout(150); await page.keyboard.up("Space"); await page.waitForTimeout(120);
 const airborne=await page.evaluate(()=>window.__gameTest.physics()); assert(!airborne.grounded&&airborne.jumpHeight>0,"Space did not produce vertical motion"); assert(airborne.stamina<=before-20&&airborne.stamina>=before-30.01,`jump stamina cost incorrect: ${before-airborne.stamina}`);
 await page.keyboard.down("Space"); await page.waitForTimeout(1250); const chained=await page.evaluate(()=>window.__gameTest.physics()); await page.keyboard.up("Space"); console.log("chain",chained); assert(chained.stamina<65,"held Space did not chain bunny hops");
 await page.locator("#game-canvas").dispatchEvent("pointerdown",{button:0}); await page.waitForTimeout(300); const z0=await page.evaluate(()=>window.__gameTest.mapZoom());
 await page.keyboard.down("KeyV"); await page.locator("#game-canvas").dispatchEvent("wheel",{deltaY:-300}); await page.waitForTimeout(250); const z1=await page.evaluate(()=>window.__gameTest.mapZoom()); await page.keyboard.up("KeyV"); assert(z1>z0,"V+wheel did not zoom the hand map");
 await page.screenshot({path:join(shots,"15-map-zoom.png")});
 const water=await page.evaluate(()=>window.__gameTest.waterPosition()); await page.evaluate(({x,z})=>{window.__gameTest.teleport(x,z);window.__gameTest.view(0,-0.05);},water); await page.waitForTimeout(350); await page.screenshot({path:join(shots,"15b-water-hand-map.png")}); await page.evaluate(()=>window.dispatchEvent(new PointerEvent("pointerup",{button:0})));
 for(const biome of ["city","city-2"]){
   await start(biome,"ME"); await page.waitForTimeout(500); const course=await page.evaluate(()=>window.__gameTest.course());
   for(const cp of course.controls){const clear=[-90,0,90].every(l=>Math.abs(cp.x-l)>6&&Math.abs(cp.z-l)>6);assert(clear,`${biome} CP ${cp.code} is on a carriageway`);}
   if(biome==="city-2"){await page.evaluate(()=>{window.__gameTest.teleport(45,62);window.__gameTest.view(0,-0.08);});await page.waitForTimeout(500);await page.screenshot({path:join(shots,"16-city-2-fountain.png")});}
 }
 await start("slyudorudnik","ME"); await page.waitForTimeout(500); await page.evaluate(()=>{window.__gameTest.teleport(-20,-15);window.__gameTest.view(0,-0.06);}); await page.waitForTimeout(350); await page.screenshot({path:join(shots,"17-rock-ridges.png")});
 const stats=await page.evaluate(()=>window.__gameTest.renderStats());
 await start("mine","ME"); await page.waitForTimeout(500); const info=await page.evaluate(()=>window.__gameTest.mineInfo()); assert(info.walls>250&&info.floors>400,"closed mine geometry missing");
 const mineCourse=await page.evaluate(()=>window.__gameTest.course()); for(const cp of [mineCourse.start,...mineCourse.controls,mineCourse.finish])assert(await page.evaluate(({x,z})=>window.__gameTest.mineOpenAt(x,z),cp),`mine course point outside corridor ${cp.x},${cp.z}`);
 const collision=await page.evaluate(()=>window.__gameTest.collideAt(170,170)); assert(Math.abs(collision.x)<=152&&Math.abs(collision.z)<=152,"mine outer wall can be escaped");
 await page.keyboard.press("KeyM"); await page.waitForTimeout(400); await page.screenshot({path:join(shots,"18-mine-map.png")}); await page.keyboard.press("KeyM");
 await page.evaluate(()=>window.__gameTest.scare()); await page.waitForTimeout(250); await page.screenshot({path:join(shots,"19-mine-scare-final.png")});
 await start("mine","M12"); await page.waitForTimeout(250); await page.keyboard.press("KeyL"); await page.keyboard.press("KeyM"); await page.waitForTimeout(350); await page.screenshot({path:join(shots,"20-mine-map-clear.png")});
 assert(errors.length===0,`console errors: ${errors.join(" | ")}`);assert(missing.length===0,`404s: ${missing.join(" | ")}`);
 console.log(JSON.stringify({ok:true,jumpCost:before-airborne.stamina,bunnyStamina:chained.stamina,mapZoom:[z0,z1],cityControlsSafe:true,mine:info,mineOuterCollision:collision,renderStats:stats,consoleErrors:errors.length,missing404:missing.length},null,2));
}catch(e){console.error(e);console.error({errors,missing});process.exitCode=1;}finally{await browser.close();server.close();}
