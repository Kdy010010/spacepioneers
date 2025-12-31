const SAVE_KEY = "space_trip_save_v2";

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function qs(){ return new URLSearchParams(location.search); }
function entryHash(){
  const h = (location.hash||"").replace("#","").trim().toLowerCase();
  return (h==="left"||h==="right"||h==="up"||h==="down") ? h : "";
}
function loadSave(){ try { return JSON.parse(localStorage.getItem(SAVE_KEY)||"{}"); } catch { return {}; } }
function saveSave(obj){ localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); }

function createJoystick(root){
  const wrap = document.createElement("div");
  wrap.className = "joy";
  wrap.innerHTML = `<div class="joyBase"><div class="joyKnob"></div></div>`;
  root.appendChild(wrap);

  const base = wrap.querySelector(".joyBase");
  const knob = wrap.querySelector(".joyKnob");
  let active=false, cx=0, cy=0;
  const vec = {x:0,y:0};

  function set(dx,dy){
    const r=42;
    const len=Math.hypot(dx,dy);
    if(len>r){ dx*=r/len; dy*=r/len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    vec.x = clamp(dx/r,-1,1);
    vec.y = clamp(dy/r,-1,1);
  }
  function down(e){
    active=true;
    const rect=base.getBoundingClientRect();
    cx=rect.left+rect.width/2;
    cy=rect.top+rect.height/2;
    base.setPointerCapture(e.pointerId);
    set(e.clientX-cx, e.clientY-cy);
  }
  function move(e){ if(active) set(e.clientX-cx, e.clientY-cy); }
  function up(){
    active=false;
    knob.style.transform=`translate(0px, 0px)`;
    vec.x=0; vec.y=0;
  }

  base.addEventListener("pointerdown", down);
  base.addEventListener("pointermove", move);
  base.addEventListener("pointerup", up);
  base.addEventListener("pointercancel", up);
  base.addEventListener("lostpointercapture", up);

  return { get vx(){return vec.x;}, get vy(){return vec.y;} };
}

function rectHitCircle(r, c){
  const nx = clamp(c.x, r.x, r.x+r.w);
  const ny = clamp(c.y, r.y, r.y+r.h);
  return (c.x-nx)**2 + (c.y-ny)**2 <= c.r**2;
}

function computeSpawnFromEntry(entry, viewW, viewH, forcedX){
  const pad=30;
  // forcedX 있으면 그 x를 우선 적용(단, 화면 범위로 clamp)
  const fx = Number.isFinite(forcedX) ? clamp(forcedX, pad, viewW-pad) : null;

  if(entry==="left")  return {x:pad,      y:viewH/2};
  if(entry==="right") return {x:viewW-pad, y:viewH/2};
  if(entry==="up")    return {x:viewW/2,  y:pad};
  if(entry==="down")  return {x:viewW/2,  y:viewH-pad};
  return {x:viewW/2, y:viewH/2};
}

function runRegion(cfg){
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const ui = document.getElementById("ui");
  const joy = createJoystick(ui);

  const key = {up:false,down:false,left:false,right:false};
  addEventListener("keydown", (e)=>{
    if(e.key==="ArrowUp"||e.key==="w"||e.key==="W") key.up=true;
    if(e.key==="ArrowDown"||e.key==="s"||e.key==="S") key.down=true;
    if(e.key==="ArrowLeft"||e.key==="a"||e.key==="A") key.left=true;
    if(e.key==="ArrowRight"||e.key==="d"||e.key==="D") key.right=true;
  });
  addEventListener("keyup", (e)=>{
    if(e.key==="ArrowUp"||e.key==="w"||e.key==="W") key.up=false;
    if(e.key==="ArrowDown"||e.key==="s"||e.key==="S") key.down=false;
    if(e.key==="ArrowLeft"||e.key==="a"||e.key==="A") key.left=false;
    if(e.key==="ArrowRight"||e.key==="d"||e.key==="D") key.right=false;
  });

  // resize
  function resize(){
    const dpr = Math.max(1, Math.floor(devicePixelRatio||1));
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width*dpr);
    canvas.height = Math.floor(rect.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  addEventListener("resize", resize);
  resize();

  // helpers (zones에서 쓰기 좋게)
  const runtime = {
    state: loadSave(),
    toast(msg){
      // 간단 토스트(원하면 더 예쁘게)
      console.log(msg);
    }
  };

  // spawn logic: entry + ?x=
  const viewW = canvas.getBoundingClientRect().width;
  const viewH = canvas.getBoundingClientRect().height;

  const entry = entryHash();
  const forcedX = qs().has("x") ? parseFloat(qs().get("x")) : NaN;

  let spawn = computeSpawnFromEntry(entry, viewW, viewH, forcedX);
  // forcedX가 있으면 entry에 따라 x를 오버라이드
  if(Number.isFinite(forcedX)) spawn.x = clamp(forcedX, 30, viewW-30);

  // save 기반 이어하기(원하면 hash가 있으면 hash 우선)
  const save = runtime.state;
  if(save.loc === cfg.id && save.player && !entry && !qs().has("x")){
    spawn = {x: save.player.x, y: save.player.y};
  }

  const player = {
    x: spawn.x, y: spawn.y,
    r: cfg.player?.r ?? 12,
    speed: cfg.player?.speed ?? 180
  };

  // background image preload (optional)
  let bgImg = null;
  if(cfg.bg?.type==="image"){
    bgImg = new Image();
    bgImg.src = cfg.bg.value;
  }

  // zones enter/leave tracking
  const zoneInside = new Map();

  function gotoExit(ex){
    // carry x 계산
    let carryX = null;
    if(ex.carry?.xFrom === "playerX") carryX = player.x;
    if(ex.carry?.xFrom === "playerY") carryX = player.y;
    if(typeof ex.carry?.xFrom === "number") carryX = ex.carry.xFrom;

    const url = new URL(ex.to, location.href);
    if(Number.isFinite(carryX)) url.searchParams.set("x", String(Math.round(carryX)));
    url.hash = "#" + (ex.entry || "");
    // save minimal
    runtime.state.loc = cfg.id;
    runtime.state.player = {x: player.x, y: player.y};
    saveSave(runtime.state);
    location.href = url.toString();
  }

  function blocked(nx, ny){
    if(!cfg.walls) return false;
    const c = {x:nx,y:ny,r:player.r};
    for(const w of cfg.walls){
      if(rectHitCircle(w, c)) return true;
    }
    return false;
  }

  function draw(){
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    // bg
    if(cfg.bg?.type==="color"){
      ctx.fillStyle = cfg.bg.value || "#0b1020";
      ctx.fillRect(0,0,w,h);
    } else if(cfg.bg?.type==="image" && bgImg && bgImg.complete){
      // 간단 cover
      const iw = bgImg.width, ih = bgImg.height;
      const s = Math.max(w/iw, h/ih);
      const dw = iw*s, dh = ih*s;
      ctx.drawImage(bgImg, (w-dw)/2, (h-dh)/2, dw, dh);
    } else {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0,0,w,h);
    }

    // walls
    if(cfg.walls){
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for(const ww of cfg.walls) ctx.fillRect(ww.x, ww.y, ww.w, ww.h);
    }

    // exits (디버그용 표시: 필요없으면 지워도 됨)
    if(cfg.exits){
      for(const ex of cfg.exits){
        ctx.fillStyle = "rgba(0,255,140,0.25)";
        const r = ex.rect;
        ctx.fillRect(r.x,r.y,r.w,r.h);
      }
    }

    // player
    ctx.fillStyle = "#f5f5f5";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
  }

  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.05, (t-last)/1000);
    last = t;

    // input vec
    let vx = joy.vx, vy = joy.vy;
    vx += (key.right?1:0) - (key.left?1:0);
    vy += (key.down?1:0) - (key.up?1:0);

    const len = Math.hypot(vx, vy);
    if(len>1e-6){ vx/=Math.max(1,len); vy/=Math.max(1,len); } else { vx=0; vy=0; }

    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;

    let nx = player.x + vx*player.speed*dt;
    let ny = player.y + vy*player.speed*dt;

    nx = clamp(nx, player.r, w-player.r);
    ny = clamp(ny, player.r, h-player.r);

    // collision
    if(!blocked(nx, player.y)) player.x = nx;
    if(!blocked(player.x, ny)) player.y = ny;

    // zones
    if(cfg.zones){
      for(const z of cfg.zones){
        const inside = rectHitCircle(z.rect, player);
        const was = zoneInside.get(z.id) === true;
        if(inside && !was){ zoneInside.set(z.id,true); z.onEnter && z.onEnter(runtime); }
        if(inside){ z.onStay && z.onStay(runtime, dt); }
        if(!inside && was){ zoneInside.set(z.id,false); z.onLeave && z.onLeave(runtime); }
      }
    }

    // exits
    if(cfg.exits){
      for(const ex of cfg.exits){
        if(rectHitCircle(ex.rect, player)){
          gotoExit(ex);
          return;
        }
      }
    }

    // autosave
    runtime.state.loc = cfg.id;
    runtime.state.player = {x: player.x, y: player.y};
    saveSave(runtime.state);

    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
