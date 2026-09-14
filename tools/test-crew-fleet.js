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
const AC = ['Boeing 787-9','Airbus A320','Airbus A220-300'];
const LIV = {
  'Boeing 787-9':['Aeromexico','Generic'],
  'Airbus A320':['Aeromexico'],
  'Airbus A220-300':['Air Austral','Air Baltic'],
};
// Every lookup the page makes, so a test can assert not just what came back but
// WHEN it was asked — the bug being that it was asked far too early.
let lookups = [];
let lookupReply = null;                // set to a body to hand back a photo
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
  if(p.includes('/aircraft/lookup')){
    lookups.push({ type:url.searchParams.get('type')||'', livery:url.searchParams.get('liveryName')||'' });
    return json(lookupReply || {isPlaceholder:true});
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
    // The fleet is its own drawer now, not the bottom of a settings panel.
    await page.evaluate(()=>window.openFleet()); await page.waitForTimeout(300);
    return {ctx,page,errs};
  };
  // The same page, stopped at the dashboard — the tile is what is under test,
  // so nothing may open the drawer on its behalf. The first-visit walkthrough
  // puts a mask over the page, and a returning user does not have it.
  const openDash=async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await ctx.newPage();
    const errs=[]; page.on('pageerror',e=>errs.push(e.message));
    await page.route('**/api/**', api);
    await page.addInitScript(()=>{
      localStorage.setItem('crew:session:testva',JSON.stringify({token:'tok',name:'Owner',role:'owner'}));
      localStorage.setItem('crew:tour:staff:testva','1');
    });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1400);
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

  // "I type in the plane and it already pops up, instead of wait for a selection
  // of the livery." A <datalist> suggests but never constrains, so the aircraft
  // box kept whatever was typed — and the livery lookup was a strict
  // LIV_MAP[exact] hit, which a lowercase or loosely-spaced name missed. The
  // livery box then offered nothing, with no hint that it was waiting on the
  // box before it.
  console.log('\nAn aircraft typed loosely, not picked from the list');
  await ctx.close();
  brandingFleet=[]; settingsReply=null;
  ({ctx,page,errs}=await open());
  await page.evaluate(()=>addFleet()); await page.waitForTimeout(150);
  const typeSel='#fleetRows [data-idx="0"] [data-f="type"]';
  const livSel='#fleetRows [data-idx="0"] [data-f="name"]';
  ok('the livery box says it is waiting on the aircraft',
     /Pick an aircraft first/.test(await page.getAttribute(livSel,'placeholder')),
     await page.getAttribute(livSel,'placeholder'));

  await page.fill(typeSel,'  boeing 787-9 ');
  await page.waitForTimeout(150);
  ok('its liveries are found anyway',
     (await page.$$eval('#livList-0 option', o=>o.map(x=>x.value))).includes('Aeromexico'),
     JSON.stringify(await page.$$eval('#livList-0 option', o=>o.map(x=>x.value))));
  ok('…and the livery box now says how many there are',
     /2 to choose from/.test(await page.getAttribute(livSel,'placeholder')),
     await page.getAttribute(livSel,'placeholder'));

  await page.dispatchEvent(typeSel,'change'); await page.waitForTimeout(200);
  ok('committing snaps it to the catalogue spelling',
     (await page.inputValue(typeSel))==='Boeing 787-9', await page.inputValue(typeSel));
  ok('…so what is stored is what the tracker matches against',
     (await page.evaluate(()=>FLEET[0].type))==='Boeing 787-9',
     await page.evaluate(()=>JSON.stringify(FLEET[0])));

  await page.fill(livSel,'aeromexico');
  await page.dispatchEvent(livSel,'change'); await page.waitForTimeout(200);
  ok('a loosely typed livery is snapped too',
     (await page.evaluate(()=>FLEET[0].name))==='Aeromexico',
     await page.evaluate(()=>JSON.stringify(FLEET[0])));

  posts=[]; await page.evaluate(()=>saveStructure('fleet')); await page.waitForTimeout(500);
  ok('and the row saves canonically',
     posts.length===1 && posts[0].fleet[0].type==='Boeing 787-9' && posts[0].fleet[0].name==='Aeromexico',
     JSON.stringify(posts));
  ok('no page errors', errs.length===0, errs.join('|'));

  /* ====================================================================
   * THE REPORTED GLITCH
   *
   * "Just writing the aircraft type, the aircraft image pops out. You have to
   * get rid of the plane image by clicking the X then typing the livery to get
   * it correct."
   *
   * Two faults in one: the photo was looked up on the aircraft ALONE, so the
   * library answered with somebody else's A320; and the guard that stops a
   * lookup clobbering a picture could not tell that picture apart from an
   * upload, so typing the right livery afterwards changed nothing.
   * ================================================================== */
  console.log('\nThe photo waits for the livery');
  brandingFleet=[];
  lookupReply={ imageUrl:'https://cdn.test/wrong.jpg', imageUrls:['https://cdn.test/wrong.jpg'],
                contributorName:'Someone', imageContributors:[{name:'Someone'}] };
  ({ctx,page,errs}=await open());
  await page.evaluate(()=>addFleet()); await page.waitForTimeout(150);
  lookups=[];
  await page.fill('#fleetRows [data-idx="0"] [data-f="type"]','Boeing 787-9');
  await page.dispatchEvent('#fleetRows [data-idx="0"] [data-f="type"]','change');
  await page.waitForTimeout(300);
  ok('naming only the aircraft asks the library nothing', lookups.length===0, JSON.stringify(lookups));
  ok('…so no photograph appears on a half-filled row',
     (await page.evaluate(()=>FLEET[0].image))==='', await page.evaluate(()=>JSON.stringify(FLEET[0])));

  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Aeromexico');
  await page.dispatchEvent('#fleetRows [data-idx="0"] [data-f="name"]','change');
  await page.waitForTimeout(400);
  ok('naming the livery asks it, with both halves',
     lookups.length===1 && lookups[0].type==='Boeing 787-9' && lookups[0].livery==='Aeromexico',
     JSON.stringify(lookups));
  ok('…and the photo lands', (await page.evaluate(()=>FLEET[0].image))==='https://cdn.test/wrong.jpg');
  ok('…marked as ours to replace, not as the airline\u2019s own',
     (await page.evaluate(()=>FLEET[0].imageAuto))===true, await page.evaluate(()=>JSON.stringify(FLEET[0])));

  /* CHANGING YOUR MIND. The old editor kept the first photo whatever you typed
     next, which is why the X was the only way forward. */
  lookups=[]; lookupReply={ imageUrl:'https://cdn.test/right.jpg', imageUrls:['https://cdn.test/right.jpg'],
                            contributorName:'Jan Polet', imageContributors:[{name:'Jan Polet'}] };
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Generic');
  await page.dispatchEvent('#fleetRows [data-idx="0"] [data-f="name"]','change');
  await page.waitForTimeout(400);
  ok('changing the livery fetches the right photo instead of keeping the wrong one',
     (await page.evaluate(()=>FLEET[0].image))==='https://cdn.test/right.jpg',
     await page.evaluate(()=>JSON.stringify(FLEET[0])));
  ok('…and the credit moves with it',
     (await page.evaluate(()=>FLEET[0].photographer))==='Jan Polet');

  // An upload is the airline's, and nothing typed afterwards may take it away.
  await page.evaluate(()=>{ FLEET[0].image='https://cdn.test/mine.jpg'; FLEET[0].imageAuto=false; FLEET[0].imageFor=''; renderStructure(); });
  lookups=[];
  await page.fill('#fleetRows [data-idx="0"] [data-f="name"]','Aeromexico');
  await page.dispatchEvent('#fleetRows [data-idx="0"] [data-f="name"]','change');
  await page.waitForTimeout(400);
  ok('an upload of their own survives a later change of livery',
     (await page.evaluate(()=>FLEET[0].image))==='https://cdn.test/mine.jpg',
     await page.evaluate(()=>JSON.stringify(FLEET[0])));
  ok('no page errors', errs.length===0, errs.join('|'));
  await ctx.close();

  /* ====================================================================
   * FINDING AN AEROPLANE BY THE NAME ON ITS SIDE
   *
   * Nobody thinks "Airbus A220-300" and then "Air Austral". The catalogue is
   * keyed the wrong way round for how people search it, and reading it the
   * other way is an index rather than a request.
   * ================================================================== */
  console.log('\nFinding an aircraft by its livery');
  brandingFleet=[]; lookupReply=null;
  ({ctx,page,errs}=await open());
  await page.fill('#fleetFind','air austral');
  await page.waitForTimeout(250);
  const hits=await page.$$eval('#fleetFindList [data-ac]', els=>els.map(e=>e.textContent.replace(/\s+/g,' ').trim()));
  ok('typing a livery finds the aeroplane that wears it',
     hits.length>0 && /Air Austral/.test(hits[0]) && /A220-300/.test(hits[0]), JSON.stringify(hits));

  lookups=[];
  // mousedown, not click(): Tailwind is a CDN this harness cannot reach, so the
  // drawer is not positioned and Playwright refuses to click into it. The
  // picker listens for mousedown, which is what a pointer sends first anyway.
  await page.dispatchEvent('#fleetFindList [data-ac="0"]','mousedown');
  await page.waitForTimeout(350);
  const added=await page.evaluate(()=>FLEET[0]);
  ok('picking one adds a complete row, both halves at once',
     added && added.type==='Airbus A220-300' && added.name==='Air Austral', JSON.stringify(added));
  ok('…and only then is the library asked',
     lookups.length===1 && lookups[0].livery==='Air Austral', JSON.stringify(lookups));
  ok('the search box empties itself for the next one',
     (await page.inputValue('#fleetFind'))==='');

  // It also still works the way it always did, from the aircraft end.
  await page.fill('#fleetFind','787');
  await page.waitForTimeout(250);
  ok('and an aircraft type still finds its liveries',
     (await page.$$eval('#fleetFindList [data-ac]', e=>e.length))>0);

  await page.fill('#fleetFind','air austral');
  await page.waitForTimeout(200);
  await page.dispatchEvent('#fleetFindList [data-ac="0"]','mousedown');
  await page.waitForTimeout(250);
  ok('the same aircraft is not added twice',
     (await page.evaluate(()=>FLEET.length))===1, await page.evaluate(()=>JSON.stringify(FLEET)));
  ok('no page errors', errs.length===0, errs.join('|'));
  await ctx.close();

  /* ====================================================================
   * A CODESHARE IS SOMEBODY ELSE'S AEROPLANE
   *
   * The route form offered the VA's own fleet and nothing else, so a codeshare
   * could only be filed as an aircraft the airline does not operate, or as
   * "Any aircraft".
   * ================================================================== */
  console.log('\nA codeshare names the partner\u2019s aircraft');
  brandingFleet=[{type:'Boeing 787-9',name:'Generic',image:''}];
  ({ctx,page,errs}=await open());
  await page.evaluate(()=>{ openRoutes(); openRouteForm(); });
  await page.waitForTimeout(300);
  ok('own metal is picked from the fleet',
     await page.isVisible('#nr_aircraft') && !(await page.isVisible('#nr_acFreeWrap')));

  await page.evaluate(()=>setRouteKind('codeshare'));
  await page.waitForTimeout(200);
  ok('a codeshare gets the whole catalogue instead',
     !(await page.isVisible('#nr_aircraft')) && await page.isVisible('#nr_acFreeWrap'));

  await page.fill('#nr_acFree','air austral');
  await page.waitForTimeout(250);
  await page.dispatchEvent('#nr_acFreeList [data-ac="0"]','mousedown');
  await page.waitForTimeout(200);
  ok('…searched by livery, like the fleet',
     /Airbus A220-300/.test(await page.inputValue('#nr_acFree'))
     && /Air Austral/.test(await page.inputValue('#nr_acFree')),
     await page.inputValue('#nr_acFree'));
  ok('and that is what the route would be saved with',
     /Air Austral/.test(await page.evaluate(()=>routeAircraftValue())),
     await page.evaluate(()=>routeAircraftValue()));

  await page.evaluate(()=>setRouteKind('own'));
  await page.waitForTimeout(150);
  ok('switching back reads the fleet picker again',
     (await page.evaluate(()=>routeAircraftValue()))===(await page.inputValue('#nr_aircraft')));
  ok('no page errors', errs.length===0, errs.join('|'));
  await ctx.close();

  /* ====================================================================
   * THE WAY IN.
   *
   * Every test above reaches the editor by calling openFleet() directly, and
   * that is how the reported failure survived: the Fleet TILE on the dashboard
   * was never wired to anything. It drew, it hovered, and pressing it did
   * nothing at all — the only doors left were a button inside Routes, which is
   * hidden below 640px, and one at the bottom of Settings. On a phone there was
   * no way into the fleet.
   *
   * So the tile is pressed here, as a person presses it, and every other tile
   * is checked for an opener too — the list that lost the fleet had a line per
   * tile and would have lost another.
   * ================================================================== */
  console.log('\nThe Fleet tile on the dashboard');
  brandingFleet=[];
  ({ctx,page,errs}=await openDash());
  const tiles=await page.evaluate(()=>[...document.querySelectorAll('#toolGrid [data-i]')]
      .map(el=>el.textContent.replace(/\s+/g,' ').trim()));
  const fleetIdx=tiles.findIndex(t=>/^Fleet/.test(t));
  ok('is offered to somebody who can keep the fleet', fleetIdx>=0, tiles.join(' / '));
  await page.dispatchEvent(`#toolGrid [data-i="${fleetIdx}"]`,'click');
  await page.waitForTimeout(500);
  ok('opens the fleet when it is pressed',
     await page.evaluate(()=>!document.getElementById('fleet').classList.contains('hidden')));
  ok('…and the editor is really there, not an empty drawer',
     await page.evaluate(()=>!!document.getElementById('fleetFind')));
  // And not just this one: every tool the dashboard offers has to have
  // something behind it. This is the check the old per-tile list could not
  // make about itself.
  const unbound=await page.evaluate(()=>
     TOOLS.map(t=>t.action).filter(a=>typeof TILE_OPEN[a]!=='function'));
  ok('no tool is a door painted on a wall', unbound.length===0, unbound.join(','));
  ok('no page errors', errs.length===0, errs.join('|'));
  await ctx.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail?1:0);
})();
