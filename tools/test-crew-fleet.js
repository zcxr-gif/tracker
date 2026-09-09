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
// Every /api/aircraft/lookup this page makes, so a test can assert not only
// which picture came back but WHAT WAS ASKED — the reported bug was a query
// that never carried the livery at all.
let lookups = [];
// The community photo library, keyed the way the real one is: type + livery.
// A type asked about with NO livery answers with the first paint on file,
// which is exactly the behaviour that made the wrong picture stick.
let PHOTOS = {
  'Boeing 787-9|Aeromexico': 'https://cdn.example/787-aeromexico.jpg',
  'Boeing 787-9|Retro':      'https://cdn.example/787-retro.jpg',
  'Boeing 787-9|Generic':    'https://cdn.example/787-generic.jpg',
  'Airbus A320|Aeromexico':  'https://cdn.example/a320-aeromexico.jpg',
};
let photoAsArray = false;              // the library answers with a list for some types
const AC = ['Boeing 787-9','Boeing 787-10','Airbus A320'];
const LIV = { 'Boeing 787-9':['Aeromexico','Retro','Generic'], 'Boeing 787-10':['Generic'], 'Airbus A320':['Aeromexico'] };
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
  if(p.endsWith('/badge-image')) return json({url:'https://cdn.example/uploaded.png'});
  if(p.includes('/aircraft/lookup')){
    const type=url.searchParams.get('type')||'';
    const livery=url.searchParams.get('livery')||'';
    lookups.push({type,livery,raw:url.search});
    // No livery asked for -> the first paint on file for that type. The
    // library does this; the editor's job is not to ask that question.
    const key = livery ? `${type}|${livery}`
      : Object.keys(PHOTOS).find(k=>k.split('|')[0]===type);
    const hit = key ? PHOTOS[key] : '';
    if(!hit) return json({isPlaceholder:true});
    const rec={imageUrl:hit,isPlaceholder:false};
    return json(photoAsArray?[rec]:rec);
  }
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
  ok('an aircraft with a livery is offered', opts.some(o=>/^Boeing 787-9 · /.test(o.t)), JSON.stringify(opts));
  // Two options carrying one value are one option wearing two coats: a <select>
  // set to "Boeing 787-9" lands on whichever is listed first, so editing the
  // Retro route came back showing Aeromexico. The liveries collect onto the
  // aircraft they paint instead.
  ok('…the two 787-9s are ONE choice, naming both liveries',
     opts.filter(o=>o.v==='Boeing 787-9').length===1
     && opts.some(o=>o.t==='Boeing 787-9 · Aeromexico, Retro'), JSON.stringify(opts));
  ok('a type-only aircraft is NOT offered', !opts.some(o=>/A320/.test(o.t) && !o.d), JSON.stringify(opts));
  ok('…and the picker says why it is missing', opts.some(o=>o.d && /need a livery/.test(o.t)), JSON.stringify(opts));
  ok('the stored value stays the bare type, so matching is unchanged',
     opts.filter(o=>o.t.includes('787-9')).every(o=>o.v==='Boeing 787-9'), JSON.stringify(opts));
  // The bug that shape caused: what a route was saved as has to come back
  // SELECTED, not merely present somewhere in the list.
  const rt=await page.evaluate(()=>{
    openRouteForm({id:'r9',origin:'EGLL',destination:'KJFK',aircraft:'Boeing 787-9',active:true,kind:'own'});
    const s=document.getElementById('nr_aircraft');
    return { shown:s.options[s.selectedIndex].textContent, value:s.value };
  });
  ok('editing a route comes back on the aircraft it was saved as',
     rt.value==='Boeing 787-9' && /Aeromexico, Retro/.test(rt.shown), JSON.stringify(rt));

  console.log('\nThe pilot form’s aircraft chips');
  const chips=await page.evaluate(()=>{
    buildAircraftChips([]);
    const all=()=>[...document.querySelectorAll('#np_aircraft [data-ac]')]
      .map(e=>({label:e.textContent.trim(), value:e.getAttribute('data-ac'), lit:e.classList.contains('accent-bg')}));
    const before=all();
    [...document.querySelectorAll('#np_aircraft [data-ac]')].find(x=>/787-9/.test(x.textContent)).click();
    const set=[...NP_AIRCRAFT];
    buildAircraftChips(set);            // what reopening the form does
    return { before, set, reopened:all() };
  });
  ok('one chip per aircraft, not one per livery',
     chips.before.filter(c=>c.value==='Boeing 787-9').length===1, JSON.stringify(chips.before));
  ok('ticking it selects that aircraft', JSON.stringify(chips.set)===JSON.stringify(['Boeing 787-9']), JSON.stringify(chips.set));
  ok('…and reopening the form lights exactly what was saved',
     chips.reopened.filter(c=>c.lit).length===1 && chips.reopened.find(c=>c.lit).value==='Boeing 787-9',
     JSON.stringify(chips.reopened));
  ok('no page errors', errs.length===0, errs.join('|'));

  console.log('\nThe reported failure: getting the RIGHT photo');
  settingsReply=null; brandingFleet=[]; photoAsArray=false;
  await ctx.close();
  ({ctx,page,errs}=await open());
  const rowImg=()=>page.evaluate(()=>{const i=document.querySelector('#fleetRows [data-idx="0"] img');return i?i.getAttribute('src'):'';});
  const stateOf=()=>page.evaluate(()=>{const s=document.querySelector('#fleetRows [data-idx="0"] [data-fleetstate]');return s?s.textContent.trim():'';});
  await page.evaluate(()=>addFleet()); await page.waitForTimeout(150);
  lookups=[];
  // Typing only the aircraft used to fetch a photo immediately — whichever
  // livery the library held first — and that picture then blocked the right one.
  await page.fill('#fleetRows [data-idx="0"] [data-f="type"]','Boeing 787-9');
  await page.waitForTimeout(900);
  ok('the bare aircraft is NOT asked about, so no arbitrary livery lands', lookups.length===0, JSON.stringify(lookups));
  ok('…and the row says what it is waiting for', /Pick one of its 3 liveries/.test(await stateOf()), await stateOf());
  ok('no photo yet', !(await rowImg()), await rowImg());

  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Aeromexico');
  await page.waitForTimeout(1000);
  ok('choosing the livery asks for it under the name the library reads (`livery`)',
     lookups.length>0 && lookups[0].livery==='Aeromexico' && /[?&]livery=/.test(lookups[0].raw), JSON.stringify(lookups));
  ok('…and the photo is that livery’s', (await rowImg())==='https://cdn.example/787-aeromexico.jpg', await rowImg());

  // The heart of the report: the picture was already set, so changing the
  // livery changed nothing.
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Retro');
  await page.waitForTimeout(1000);
  ok('changing the livery REPLACES the photo', (await rowImg())==='https://cdn.example/787-retro.jpg', await rowImg());

  // A livery with no photo of its own falls back to the type's generic paint,
  // never to another airline's.
  PHOTOS['Boeing 787-9|Retro']=undefined; delete PHOTOS['Boeing 787-9|Retro'];
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Aeromexico'); await page.waitForTimeout(900);
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Retro'); await page.waitForTimeout(1000);
  ok('a livery with no photo falls back to the aircraft’s generic paint',
     (await rowImg())==='https://cdn.example/787-generic.jpg', await rowImg());
  PHOTOS['Boeing 787-9|Retro']='https://cdn.example/787-retro.jpg';

  console.log('\nThe aircraft box does not guess');
  await page.evaluate(()=>{ FLEET.length=0; addFleet(); }); await page.waitForTimeout(150);
  lookups=[];
  await page.fill('#fleetRows [data-idx="0"] [data-f="type"]','787');
  await page.waitForTimeout(900);
  ok('a name matching several aircraft picks none of them', lookups.length===0, JSON.stringify(lookups));
  ok('…and says how many it matches', /2 Infinite Flight aircraft match/.test(await stateOf()), await stateOf());
  // Typed loosely, settled on blur to the catalogue's own spelling.
  await page.fill('#fleetRows [data-idx="0"] [data-f="type"]','boeing 787-10');
  await page.evaluate(()=>document.querySelector('#fleetRows [data-idx="0"] [data-f="type"]').blur());
  await page.waitForTimeout(900);
  const typed=await page.evaluate(()=>({box:document.querySelector('#fleetRows [data-idx="0"] [data-f="type"]').value, stored:FLEET[0].type}));
  ok('a loosely typed aircraft settles on the catalogue’s exact name', typed.box==='Boeing 787-10' && typed.stored==='Boeing 787-10', JSON.stringify(typed));

  console.log('\nA photo the VA uploaded is theirs');
  await page.evaluate(()=>{ FLEET.length=0; FLEET.push({type:'Boeing 787-9',name:'Aeromexico',image:'https://cdn.example/mine.png',imageOwn:true}); renderStructure(); });
  await page.waitForTimeout(150);
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Retro'); await page.waitForTimeout(1000);
  ok('changing the livery never replaces an upload', (await rowImg())==='https://cdn.example/mine.png', await rowImg());
  await page.evaluate(()=>document.querySelector('#fleetRows [data-idx="0"] [data-autopic]').click());
  await page.waitForTimeout(1000);
  ok('…but the picture button still does', (await rowImg())==='https://cdn.example/787-retro.jpg', await rowImg());

  console.log('\nThe library answering with a list, not an object');
  photoAsArray=true;
  await page.evaluate(()=>{ FLEET.length=0; FLEET.push({type:'Airbus A320',name:'Aeromexico'}); renderStructure(); });
  await page.waitForTimeout(150);
  await page.evaluate(()=>document.querySelector('#fleetRows [data-idx="0"] [data-autopic]').click());
  await page.waitForTimeout(1000);
  ok('is read, not silently discarded', (await rowImg())==='https://cdn.example/a320-aeromexico.jpg', await rowImg());
  photoAsArray=false;

  console.log('\nWhat actually gets posted');
  await page.evaluate(()=>{ FLEET.length=0; FLEET.push({type:'  Boeing 787-9 ',name:' Aeromexico ',image:'https://cdn.example/x.jpg',imageAuto:'boeing 787-9|aeromexico',imageOwn:false,stray:'junk'}); renderStructure(); });
  posts=[]; await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(600);
  const sent=posts[0] && posts[0].fleet && posts[0].fleet[0];
  ok('only the three fields the store knows', sent && JSON.stringify(Object.keys(sent).sort())===JSON.stringify(['image','name','type']), JSON.stringify(sent));
  ok('…trimmed', sent && sent.type==='Boeing 787-9' && sent.name==='Aeromexico', JSON.stringify(sent));
  ok('the auto-photo bookkeeping survives the round trip', await page.evaluate(()=>FLEET[0].imageAuto==='boeing 787-9|aeromexico'), '');

  console.log('\nA save that cannot reach the server');
  await page.route('**/settings', r=>r.abort());
  await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(600);
  n=await noteOf(page);
  ok('says nothing was lost', /nothing you typed is lost/i.test(n.t), n.t);
  ok('…and offers one click to try again', await page.evaluate(()=>!!document.querySelector('#fleetNote button')), n.t);
  ok('the fleet is still there', await page.evaluate(()=>FLEET.length===1 && FLEET[0].type==='Boeing 787-9'), '');
  await page.unroute('**/settings');
  ok('no page errors throughout the photo work', errs.length===0, errs.join('|'));
  await ctx.close();
  ({ctx,page,errs}=await open());

  console.log('\nThe reported failure: "Could not save." with nothing in it');
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
