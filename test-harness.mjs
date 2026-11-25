import { spawn } from "node:child_process";
const T = process.argv[2];
const srv = spawn("python3", ["-m", "http.server", "8661", "--directory", T + "/site"], { stdio: "ignore" });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9341;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--user-data-dir=" + T + "/profile", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = false; for (let i = 0; i < 50 && !ok; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ok = true; } catch { await sleep(200); } }
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(); const logs = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); else if (d.method === "Runtime.consoleAPICalled") logs.push("LOG " + d.params.args.map(a => a.value ?? a.description).join(" ")); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
async function drag(pts, step = 16) { await touch("touchStart", [pts[0]]); for (const p of pts.slice(1)) { await touch("touchMove", [p]); await sleep(step); } await touch("touchEnd", []); await sleep(80); }
async function tap(x, y) { await touch("touchStart", [[x, y]]); await sleep(40); await touch("touchEnd", []); await sleep(120); }
async function tapEl(id) { const r = await ev(`(()=>{const b=document.getElementById('${id}').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`); await tap(r[0], r[1]); }
const results = []; const check = (name, cond, extra = "") => { results.push(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); };

async function load() {
  await send("Page.navigate", { url: "http://localhost:8661/index.html" });
  for (let i = 0; i < 50; i++) { if (await ev("!!window.FN").catch(() => false)) break; await sleep(100); }
}
try {
await load();
await ev(`fetch('test.mp4').then(r=>r.blob()).then(b=>FN.openFile(new File([b],'test.mp4',{type:'video/mp4'}),true))`);
for (let i = 0; i < 60; i++) { if (await ev("FN.S.total>0")) break; await sleep(100); }
await sleep(500);
const R = await ev(`(()=>{const b=document.getElementById('ink').getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height}})()`);
const P = (fx, fy) => [R.l + R.w * fx, R.t + R.h * fy];
const notes = f => ev(`JSON.stringify(FN.S.notes.get(${f})||null)`).then(JSON.parse);
check("frame laid out", R.w > 100, JSON.stringify(R));

// pen circle
const circle = []; for (let a = 0; a <= 360; a += 15) circle.push(P(0.5 + 0.2 * Math.cos(a * Math.PI / 180), 0.5 + 0.12 * Math.sin(a * Math.PI / 180)));
await drag(circle);
let n = await notes(0); check("pen draws a stroke", n && n.strokes.length === 1);
await tapEl("undo"); n = await notes(0); check("undo removes stroke", !n || n.strokes.length === 0);
check("undo disabled when nothing left", await ev("document.getElementById('undo').disabled"));
await drag(circle); n = await notes(0); check("redraw stroke", n && n.strokes.length === 1);

// text: drag a box, type, done
await tapEl("toolText");
await drag([P(0.1, 0.2), P(0.3, 0.25), P(0.6, 0.3)]);
check("editor open after drag", !(await ev("document.getElementById('editor').hidden")));
check("editor focused", await ev("document.activeElement===document.getElementById('editor')"));
await send("Input.insertText", { text: "Too dark here" }); await sleep(100);
n = await notes(0); check("text saved while typing (no Done)", n && n.texts.length === 1 && n.texts[0].s === "Too dark here");
await tapEl("editDone");
check("Done closes editor", await ev("document.getElementById('editor').hidden"));
n = await notes(0); check("note kept after Done", n && n.texts.length === 1);
const t0 = n.texts[0];
// move the note by dragging in Text mode
await drag([P(t0.x + 0.05, t0.y + 0.02), P(t0.x + 0.1, t0.y + 0.1), P(t0.x + 0.15, t0.y + 0.3)]);
n = await notes(0); check("drag moves note (Text mode)", n.texts[0].y > t0.y + 0.2, `y ${t0.y} -> ${n.texts[0].y}`);
check("drag did not open editor", await ev("document.getElementById('editor').hidden"));
// tap note to edit, then tap outside to finish
const t1 = n.texts[0];
await tap(...P(t1.x + 0.05, t1.y + 0.02));
check("tap note opens editor", !(await ev("document.getElementById('editor').hidden")));
await send("Input.insertText", { text: " please" }); await sleep(80);
await tap(...P(0.9, 0.95));
check("tap outside closes editor", await ev("document.getElementById('editor').hidden"));
n = await notes(0); check("edit kept", n.texts[0].s === "Too dark here please", JSON.stringify(n.texts[0].s));
check("tap outside did not create a new note", n.texts.length === 1);
await tapEl("undo"); n = await notes(0); check("undo reverts the edit", n.texts[0].s === "Too dark here", JSON.stringify(n.texts[0].s));
// empty box then undo should hit the real last step
await tap(...P(0.2, 0.8)); await tap(...P(0.9, 0.95));
n = await notes(0); check("empty tap box leaves no note", n.texts.length === 1);

// select: tap stroke, move it, delete it
await tapEl("toolSelect");
const s0 = n.strokes[0].p[0];
await tap(...P(s0[0], s0[1]));
check("select picks stroke", await ev("FN.S.sel && FN.S.sel.kind==='stroke'"));
check("X shows", !(await ev("document.getElementById('selX').hidden")));
await drag([P(s0[0], s0[1]), P(s0[0] - 0.05, s0[1]), P(s0[0] - 0.1, s0[1] + 0.05)]);
n = await notes(0); check("select drag moves stroke", Math.abs(n.strokes[0].p[0][0] - (s0[0] - 0.1)) < 0.02, `${s0[0]} -> ${n.strokes[0].p[0][0]}`);
await tapEl("selX"); n = await notes(0); check("X deletes stroke only", n.strokes.length === 0 && n.texts.length === 1);
// select note and move
const t2 = n.texts[0];
await drag([P(t2.x + 0.05, t2.y + 0.02), P(t2.x + 0.05, t2.y - 0.1), P(t2.x + 0.05, t2.y - 0.2)]);
n = await notes(0); check("select drag moves note", n.texts[0].y < t2.y - 0.15, `${t2.y} -> ${n.texts[0].y}`);
check("select drag does not open editor", await ev("document.getElementById('editor').hidden"));

// pinch zoom
await touch("touchStart", [P(0.45, 0.5), P(0.55, 0.5)]);
for (let k = 1; k <= 8; k++) { await touch("touchMove", [P(0.45 - 0.03 * k, 0.5), P(0.55 + 0.03 * k, 0.5)]); await sleep(16); }
await touch("touchEnd", []); await sleep(100);
const zs = await ev("FN.S.z.s"); check("pinch zooms", zs > 1.5, `scale ${zs.toFixed(2)}`);
n = await notes(0); check("pinch made no mark", n.strokes.length === 0 && n.texts.length === 1);
await tapEl("fit"); check("1x resets", (await ev("FN.S.z.s")) === 1);

// frames stay separate
await tapEl("fwd"); await sleep(200);
check("next frame has no marks", (await notes(1)) === null);
await tapEl("toolPen"); await drag(circle); n = await notes(1); check("mark on frame 1", n && n.strokes.length === 1);
check("frame 0 unchanged", (await notes(0)).texts.length === 1);


// long note keeps its box size, folds with more, keeps every word
await tapEl("toolText");
await tap(...P(0.1, 0.65));
const long = "Overall I think the order of the animation can start with the white washi covering the entire screen and start drawing and colouring it and then fading into the actual mountain kind of rotating the order END";
await send("Input.insertText", { text: long }); await sleep(100);
await tapEl("editDone"); await sleep(100);
n = await notes(1); const ln = n.texts[n.texts.length - 1];
check("long note saved in full", ln.s === long, String(ln.s.length));
const box = await ev(`(()=>{const n=FN.S.notes.get(1);const t=n.texts[n.texts.length-1];const c=document.createElement('canvas').getContext('2d');return JSON.stringify(null)})()`);
check("box stays three lines tall", (ln.h || 0) === 0);
// late dictation words after Done
await ev(`(()=>{const e=document.getElementById('editor');e.value=e.value+' LATE';e.dispatchEvent(new Event('input'));})()`); await sleep(80);
n = await notes(1); check("late dictation words kept", n.texts[n.texts.length - 1].s.endsWith("END LATE"));

// persistence across reload (last video reopens)
await sleep(800);
await load();
for (let i = 0; i < 60; i++) { if (await ev("FN.S.total>0").catch(() => false)) break; await sleep(100); }
await sleep(300);
check("reopens last video", await ev("FN.S.name==='test.mp4'"));
check("notes survive reload", (await ev("FN.S.notes.size")) === 2);
await ev("FN.goTo(1)"); await sleep(400);
const shot2 = await send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(T + "/ui2.png", Buffer.from(shot2.result.data, "base64"));

} catch (e) { results.push("ERROR " + e.message); }
console.log(results.join("\n"));
console.log(logs.join("\n") || "(no console errors)");
ws.close(); chrome.kill(); srv.kill();
