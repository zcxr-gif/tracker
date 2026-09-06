// test-crew-fleet.js
// Drives the REAL crew-dashboard.html fleet editor and the pickers that read
// from it, covering the two things reported:
//
//   * "adding aircraft to the fleet ... it says some error" — the save had one
//     error path for everything, `d.error || 'Could not save.'`, and the report
//     was the bare fallback: the reply carried no message at all. It now says
//     what the status means, and a database that is behind gets the same
//     "Update it ->" way out the route form has always had.
//   * "the aircraft should appear when the livery is chosen, not when just the
//     aircraft type is there" — the pickers offered half-filled entries, and
//     showed two liveries of one type as the same line twice.
//
// Also pins the shape migration: fleet entries predate the aircraft/livery
// split and old ones carry the aircraft in `name`.
//
// Run:  node tools/test-crew-fleet.js
const { chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
const server = http.createServer((req,res)=>{
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let posts = [];
let settingsReply = null;              // set to [status, body] to force a failure
let brandingFleet = [];
const AC = ['Boeing 787-9','Airbus A320'];
const LIV = { 'Boeing 787-9':['Aeromexico','Generic'], 'Airbus A320':['Aeromexico'] };
function api(route){
  const url=new URL(route.request().url()); const p=url.pathname; const m=route.request().method();
  const json=(b,s=200)=>route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(b)});
  if(p.endsWith('/crew/aircraft-metadata')) return json({ok:true,aircraft:AC,liveries:LIV});
  if(p.endsWith('/settings') && m==='POST'){
    posts.push(route.request().postDataJSON()||{});
    if(settingsReply) return json(settingsReply[1], settingsReply[0]);
    return json(route.request().postDataJSON()||{});
  }
  if(p.includes('/va-ads/by-slug/')) return json({name:'Test VA',code:'TVA',layout:'editorial',allowedLayouts:['editorial'],fleet:brandingFleet});
  if(p.endsWith('/branding')) return json({name:'Test VA',code:'TVA',layout:'editorial',allowedLayouts:['editorial'],fleet:brandingFleet});
  if(p.endsWith('/me')) return json({role:'owner',capabilities:[],name:'Owner'});
  if(p.includes('/aircraft/lookup')) return json({isPlaceholder:true});
  return json({});
}
let pass=0, fail=0;
const ok=(n,c,x)=>{ if(c){console.log('  ✓ '+n);pass++;} else {console.log('  ✗ '+n+(x?'  ('+x+')':''));fail++;} };

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;
  const browser=await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium'});
  const open=async()=>{
    const ctx=await browser.newContext({viewport:{width:1280,height:900}});
    const page=await ctx.newPage();
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.route('**/api/**', api);
    await page.addInitScript(()=>localStorage.setItem('crew:session:testva',JSON.stringify({token:'tok',name:'Owner',role:'owner'})));
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1100);
    await page.evaluate(()=>window.openSettings()); await page.waitForTimeout(200);
    await page.evaluate(()=>window.setCat('crew')); await page.waitForTimeout(250);
    return {ctx,page,errs};
  };
  const noteOf=(page)=>page.evaluate(()=>{const n=document.getElementById('fleetNote');return{t:n.textContent.trim(),c:n.className,hidden:n.classList.contains('hidden')};});

  console.log('\nA legacy fleet entry (aircraft stored in `name`)');
  brandingFleet=[{name:'Airbus A320',image:''}];
  let {ctx,page,errs}=await open();
  const legacy=await page.evaluate(()=>({fleet:JSON.stringify(FLEET),
     typeBox:document.querySelector('#fleetRows [data-idx="0"] [data-f="type"]').value,
     livBox:document.querySelector('#fleetRows [data-idx="0"] [data-f="name"]').value}));
  ok('is shown as the AIRCRAFT, not as a livery', legacy.typeBox==='Airbus A320' && legacy.livBox==='', JSON.stringify(legacy));
  posts=[]; await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(500);
  ok('…and still saves', posts.length===1 && posts[0].fleet[0].type==='Airbus A320', JSON.stringify(posts));
  ok('no page errors', errs.length===0, errs.join('|'));
  await ctx.close();

  console.log('\nA livery typed with no aircraft under it');
  brandingFleet=[];
  ({ctx,page,errs}=await open());
  await page.evaluate(()=>addFleet()); await page.waitForTimeout(150);
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Aeromexico');
  posts=[]; await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(400);
  let n=await noteOf(page);
  ok('is refused before it reaches the server', posts.length===0, JSON.stringify(posts));
  ok('…and the row is named', /Row 1/.test(n.t) && /Aeromexico/.test(n.t), n.t);

  console.log('\nA normal aircraft + livery');
  await page.fill('#fleetRows [data-idx="0"] [data-f="type"]','Boeing 787-9');
  await page.waitForTimeout(150);
  posts=[]; await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(500);
  n=await noteOf(page);
  ok('saves', posts.length===1 && posts[0].fleet[0].type==='Boeing 787-9' && posts[0].fleet[0].name==='Aeromexico', JSON.stringify(posts));
  ok('…and says so', /Saved for your crew/.test(n.t), n.t);

  console.log('\nA database that is behind');
  settingsReply=[400,{code:'store_schema_outdated',error:'Your project has no column for aircraft liveries.'}];
  await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(500);
  n=await noteOf(page);
  const hasBtn=await page.evaluate(()=>!!document.querySelector('#fleetNote button'));
  ok('says what is actually wrong', /no column for aircraft liveries/.test(n.t), n.t);
  ok('…and offers the fix, as the route form does', hasBtn, n.t);

  console.log('\nA failure the server sends no message for');
  settingsReply=[500,{}];
  await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(500);
  n=await noteOf(page);
  ok('names the status instead of a bare "Could not save."', /500/.test(n.t), n.t);
  ok('no page errors throughout', errs.length===0, errs.join('|'));


  console.log('\nWhat the route picker offers');
  settingsReply=null;
  brandingFleet=[
    { type:'Boeing 787-9', name:'Aeromexico', image:'' },
    { type:'Boeing 787-9', name:'Retro',      image:'' },
    { type:'Airbus A320',  name:'',           image:'' },   // type only — not finished
  ];
  await ctx.close();
  ({ctx,page,errs}=await open());
  await page.evaluate(()=>openRoutes()); await page.waitForTimeout(400);
  await page.evaluate(()=>openRouteForm()); await page.waitForTimeout(300);
  const opts=await page.$$eval('#nr_aircraft option', els=>els.map(o=>({t:o.textContent,v:o.value,d:o.disabled})));
  ok('an aircraft with a livery is offered', opts.some(o=>o.t==='Boeing 787-9 · Aeromexico'), JSON.stringify(opts));
  ok('…the two 787-9s are told apart by livery', opts.some(o=>o.t==='Boeing 787-9 · Retro'), JSON.stringify(opts));
  ok('a type-only aircraft is NOT offered', !opts.some(o=>/A320/.test(o.t) && !o.d), JSON.stringify(opts));
  ok('…and the picker says why it is missing', opts.some(o=>o.d && /need a livery/.test(o.t)), JSON.stringify(opts));
  ok('the stored value stays the bare type, so matching is unchanged',
     opts.filter(o=>o.t.includes('787-9')).every(o=>o.v==='Boeing 787-9'), JSON.stringify(opts));
  ok('no page errors', errs.length===0, errs.join('|'));

  console.log('\nThe reported failure: "Could not save." with nothing in it');
  await page.evaluate(()=>{ closeRouteForm(); closeRoutes(); openSettings(); setCat('crew'); });
  await page.waitForTimeout(400);
  settingsReply=[401,{}];
  await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(400);
  n=await noteOf(page);
  ok('a 401 says the sign-in expired', /sign-in has expired/i.test(n.t), n.t);
  settingsReply=[500,{}];
  await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(400);
  n=await noteOf(page);
  ok('a 500 says it is not their typing', /not something you have typed wrong/i.test(n.t), n.t);
  ok('…and is never the bare "Could not save."', !/^Could not save\.$/.test(n.t), n.t);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail?1:0);
})();
