"use strict";

const byId = id => document.getElementById(id);
const scene = byId("scene"), actor = byId("actor"), figure = byId("figure");
const portrait = byId("portrait"), face = byId("face"), tooltip = byId("hover-label");
const floatingProp = byId("floating-prop");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const actors = new Map(), markers = new Map(), counts = new Map();
let active, pose, ready = false, selection = 0, resetTimer, movement;
let soundEnabled = false, audio;

function makePicture(path) {
  const img = new Image();
  img.src = path;
  return img;
}
function prepareCast() {
  for (const [key, model] of Object.entries(MODELS)) {
    const images = {}, decoded = [], masks = {};
    for (const state of ["idle", ...Object.keys(model.descriptions)]) {
      const body = makePicture("art/" + key + "/" + state + ".png");
      const head = makePicture("art/" + key + "/face-" + state + ".png");
      images[state] = {body, head};
      decoded.push(body.decode(), head.decode());
      masks[state] = atob(SILHOUETTES[key][state]);
    }
    let prop;
    if (model.prop) {
      const body = makePicture("art/" + key + "/" + model.prop.key + ".png");
      decoded.push(body.decode());
      prop = {body, mask:atob(SILHOUETTES[key][model.prop.key]), parts:model.prop.parts};
    }
    const bodyParts = Object.keys(model.points).filter(part => !prop?.parts.includes(part));
    for (const [state, region] of Object.entries(model.maskedParts ?? {})) {
      images[state].region = {
        part: region.part, mask: atob(SILHOUETTES[key][region.mask]),
        remaining: bodyParts.filter(part => part !== region.part)
      };
    }
    const button = document.createElement("button");
    button.type = "button"; button.dataset.id = key;
    button.style.setProperty("--cast-tone", model.tone);
    button.style.setProperty("--metal", model.accent);
    const thumbnail = images.idle.head.cloneNode(); thumbnail.alt = "";
    const label = document.createElement("span"), job = document.createElement("small"), name = document.createElement("strong");
    job.textContent = model.role; name.textContent = model.name; label.append(job, name);
    button.append(thumbnail, label); byId("cast").append(button);
    const loaded = Promise.all(decoded);
    loaded.catch(() => {}); // The selected character reports errors in its dialogue panel.
    actors.set(key, {key, model, images, masks, loaded, button, prop, bodyParts});
    button.addEventListener("click", () => { if (active.key !== key || !ready) select(key); });
  }
  select(Object.keys(MODELS)[0]);
}
function stopMotion() {
  clearTimeout(resetTimer);
  if (movement) movement.cancel();
  tooltip.hidden = true;
  byId("touch-fx").replaceChildren();
}
function anchors(part) {
  return active.model.poses[pose]?.[part] ?? active.model.points[part];
}
function setPose(state) {
  pose = state; actor.dataset.pose = state;
  const {body, head} = active.images[state];
  portrait.src = body.src; face.src = head.src;
  const description = state === "idle" ? "기본 자세" : active.model.descriptions[state];
  portrait.alt = active.model.name + " 전신 도트 · " + description;
  for (const [part, marker] of markers) {
    const [x,y] = active.model.hitAreas[part] ?? anchors(part)[0];
    marker.style.left = x + "%"; marker.style.top = y + "%";
  }
  tooltip.hidden = true;
}
async function select(key) {
  const token = ++selection;
  stopMotion(); ready = false; active = actors.get(key); const {model} = active;
  for (const a of actors.values()) a.button.setAttribute("aria-pressed", String(a === active));
  markers.clear(); byId("markers").replaceChildren(); portrait.style.visibility = "hidden"; face.style.visibility = "hidden";
  floatingProp.hidden = true;
  actor.dataset.character = key; delete actor.dataset.zone;
  byId("trade").textContent = model.role; byId("speaker").textContent = model.name;
  byId("line").textContent = model.greeting;
  document.documentElement.style.setProperty("--active-tone",model.tone); document.documentElement.style.setProperty("--active-gold",model.accent);
  actor.setAttribute("aria-label",model.name+" 터치 영역");
  try { await active.loaded; } catch {
    if (token === selection) byId("line").textContent = "캐릭터 파일을 열 수 없어요. 캐릭터 초상화를 눌러 다시 시도해 주세요.";
    return;
  }
  if (token !== selection) return;
  const body = active.images.idle.body;
  if (active.prop) { floatingProp.src = active.prop.body.src; floatingProp.hidden = false; }
  actor.style.setProperty("--art-ratio",String(body.naturalWidth / body.naturalHeight));
  for (const [part, region] of Object.entries(model.zones)) {
    const marker = document.createElement("button"); marker.type = "button"; marker.className = "marker"; marker.dataset.part = part;
    marker.setAttribute("aria-label", region.name + " 터치");
    const caption = document.createElement("span"); caption.textContent = region.name; marker.append(caption);
    marker.addEventListener("click", e => {
      e.stopPropagation(); const b = marker.getBoundingClientRect(); react(part, b.left+b.width/2, b.top+b.height/2);
    });
    markers.set(part, marker); byId("markers").append(marker);
  }
  setPose("idle"); portrait.style.visibility = "visible"; face.style.visibility = "visible"; ready = true;
}
function hasPixel(body, mask, x, y) {
  if (x<0 || x>=100 || y<0 || y>=100) return false;
  const col = Math.floor(x * body.naturalWidth / 100), row = Math.floor(y * body.naturalHeight / 100);
  const index = row * body.naturalWidth + col;
  return Boolean(mask.charCodeAt(index >> 3) & (1 << (index & 7)));
}
function partAt(x,y) {
  if (!ready) return null;
  const body = active.images[pose].body;
  if (active.prop) {
    const frame = figure.getBoundingClientRect();
    const propY = y - 100*(floatingProp.getBoundingClientRect().top-frame.top)/frame.height;
    if (hasPixel(active.prop.body, active.prop.mask, x, propY))
      return nearestPart(active.prop.parts, active.prop.body, x, propY);
  }
  if (!hasPixel(body, active.masks[pose], x, y)) return null;
  // These two regions have fixed clothing boundaries. Nearest-point selection
  // would also trigger them on a nearby sleeve or the folds of a wide skirt.
  for (const [part, [cx, cy, rx, ry]] of Object.entries(active.model.hitAreas)) {
    if (((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1) return part;
  }
  const region = active.images[pose].region;
  if (region && hasPixel(body, region.mask, x, y)) return region.part;
  return nearestPart(region?.remaining ?? active.bodyParts, body, x, y);
}
function nearestPart(parts, body, x, y) {
  let key = null, closest = Infinity;
  for (const part of parts) {
    for (const [px,py] of anchors(part)) {
      const dx=(px-x)*body.naturalWidth, dy=(py-y)*body.naturalHeight;
      const d=dx*dx+dy*dy;
      if (d<closest) { key=part; closest=d; }
    }
  }
  return key;
}
function chime(notes) {
  if (!soundEnabled || !audio) return;
  notes.forEach((note, i) => {
    const start = audio.currentTime + i * .08;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = note;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.045, start + .014);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .23);
    osc.connect(gain).connect(audio.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(start);
    osc.stop(start + .24);
  });
}
function sparkle(clientX, clientY, color) {
  const fx = byId("touch-fx");
  const rect = scene.getBoundingClientRect();
  fx.style.left = (clientX - rect.left) + "px";
  fx.style.top = (clientY - rect.top) + "px";
  fx.style.color = color;
  fx.replaceChildren();
  for (const [dx, dy] of [[-14,-12],[4,-21],[16,-8],[11,9],[-12,7]]) {
    const dot = document.createElement("i");
    dot.style.setProperty("--dx", dx + "px");
    dot.style.setProperty("--dy", dy + "px");
    fx.append(dot);
  }
}
function react(part,x,y) {
  if (!ready) return;
  stopMotion();
  const z=active.model.zones[part], counter=active.key+"/"+part, count=counts.get(counter)||0;
  byId("line").textContent = z.lines[count % z.lines.length]; counts.set(counter,count+1);
  actor.dataset.zone = part; setPose(z.pose);
  const guarded = Boolean(active.model.hitAreas[part]);
  if (!reducedMotion.matches) {
    if (!guarded) sparkle(x, y, z.pose === "cast" ? active.model.accent : "#f0bcbb");
    const shift = guarded ? (z.pose.startsWith("glare") ? "translateY(-2px)" : "translate(-5px,-3px) rotate(-1.5deg)")
                          : (z.pose === "cast" ? "translateY(-3px) rotate(.9deg)" : "rotate(-1deg)");
    if (figure.animate) movement = figure.animate(
      [{transform:"none"},{transform:shift,offset:.35},{transform:"none"}],
      {duration:guarded ? 460 : 330,easing:"ease-out"});
  }
  chime(guarded ? [392,330] : z.pose === "cast" ? [659,880] : [493,587]);
  resetTimer=setTimeout(()=>{setPose("idle");delete actor.dataset.zone;},guarded ? 2300 : 1900);
}
function pick(e) {
  const b=figure.getBoundingClientRect();
  return partAt((e.clientX-b.left)/b.width*100,(e.clientY-b.top)/b.height*100);
}
actor.addEventListener("click",e=>{const part=pick(e); if (part) react(part,e.clientX,e.clientY);});
actor.addEventListener("pointermove",e=>{
  if (e.pointerType === "touch") return;
  const part=pick(e); actor.style.cursor=part?"pointer":"default";
  tooltip.hidden=!part || !scene.classList.contains("guide-on") || !!e.target.closest(".marker");
  if (tooltip.hidden) return;
  const b=scene.getBoundingClientRect(); tooltip.textContent=active.model.zones[part].name;
  tooltip.style.left=Math.max(4,Math.min(e.clientX-b.left+12,b.width-tooltip.offsetWidth-5))+"px";
  tooltip.style.top=Math.max(4,e.clientY-b.top-32)+"px";
});
actor.addEventListener("pointerleave",()=>{tooltip.hidden=true;});
byId("guide").addEventListener("click",()=>{
  byId("guide").setAttribute("aria-pressed",String(scene.classList.toggle("guide-on"))); tooltip.hidden=true;
});
// Tiny UI glyphs follow the same pixel grid as the game art.
const glyphs = {
  mute: ["000010000000","000110000000","001110010001","111110001010","111110000100","111110001010","001110010001","000110000000","000010000000"],
  sound: ["000010000100","000110000010","001110010001","111110001001","111110001001","111110001001","001110010001","000110000010","000010000100"],
  help: ["0011111100","0110000110","0100000010","0000000110","0000011100","0000110000","0000110000","0000000000","0000110000","0000110000"],
  touch: ["000110000000","001001000000","001001000000","001001110000","001001001100","001001001011","111000000001","100000000001","010000000001","001000000010","000100000100","000111111000"]
};
function drawIcon(holder, name) {
  const lines = glyphs[name];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = name === "touch" ? "#bdc4b9" : "#c9d4d0";
  const x0 = Math.floor((16 - lines[0].length) / 2), y0 = Math.floor((16 - lines.length) / 2);
  lines.forEach((line,y) => [...line].forEach((cell,x) => { if (cell === "1") ctx.fillRect(x+x0,y+y0,1,1); }));
  holder.replaceChildren(canvas);
}
document.querySelectorAll("[data-icon]").forEach(icon => drawIcon(icon, icon.dataset.icon));

byId("sound").addEventListener("click", async () => {
  if (!audio && (window.AudioContext || window.webkitAudioContext)) {
    const Context = window.AudioContext || window.webkitAudioContext;
    audio = new Context();
  }
  if (!audio) { byId("sound-label").textContent = "효과음 미지원"; return; }
  soundEnabled = !soundEnabled;
  byId("sound").setAttribute("aria-pressed", String(soundEnabled));
  byId("sound-label").textContent = soundEnabled ? "소리 켜짐" : "소리 꺼짐";
  drawIcon(byId("sound").querySelector(".pixel-icon"), soundEnabled ? "sound" : "mute");
  if (soundEnabled) {
    try { await audio.resume(); chime([554, 740]); } catch { /* Browser audio can be unavailable in silent mode. */ }
  }
});
const help = byId("help");
byId("help-open").addEventListener("click", () => help.showModal());
for (const id of ["help-done", "help-close"]) byId(id).addEventListener("click", () => help.close());
help.addEventListener("click", event => {
  if (event.target !== help) return;
  const rect = help.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) help.close();
});

prepareCast();
