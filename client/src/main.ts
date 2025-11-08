// --- DOM refs ---
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const toolSel = document.getElementById("tool") as HTMLSelectElement;
const colorInp = document.getElementById("color") as HTMLInputElement;
const sizeInp = document.getElementById("size") as HTMLInputElement;
const undoBtn = document.getElementById("undo") as HTMLButtonElement;
const redoBtn = document.getElementById("redo") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const roomLabel = document.getElementById("roomLabel")!;

const userId = crypto.randomUUID();
const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";
roomLabel.textContent = `Room: ${room}`;

// --- Types + state (MUST be before fitCanvas/redraw) ---
type Point = { x:number; y:number; t:number };
type Tool = "pen"|"eraser";
type Stroke = { id:string; userId:string; color:string; size:number; tool:Tool; points:Point[]; removed?: boolean };

const strokes: Stroke[] = [];
const cursors = new Map<string, {el:HTMLElement, x:number, y:number}>();

// runtime state for current drawing
let drawing = false;
let currentId: string | null = null;       // <- we will set this AFTER server echoes begin_stroke
let pendingPoints: Point[] = [];            // points collected before we know currentId
let localTempStroke: Stroke | null = null;  // local stroke to show immediate ink

// --- Sizing ---
function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  redraw();
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// --- WebSocket ---
const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://localhost:8080`);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type:"join_room", room, userId }));
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);

  switch (msg.type) {
    case "room_state": {
      strokes.splice(0, strokes.length, ...msg.state.strokes);
      redraw();
      break;
    }

    case "begin_stroke": {
      // Server announces a new stroke with its own id (for everyone)
      const s: Stroke = { ...msg.stroke, points: [] };
      strokes.push(s);

      // If this is OUR stroke starting, bind the server id and flush any buffered points
      if (s.userId === userId && drawing && currentId === null) {
        currentId = s.id;
        // merge any points we collected locally before id arrived
        if (pendingPoints.length) {
          s.points.push(...pendingPoints);
          // draw what we buffered
          for (let i = 1; i < s.points.length; i++) {
            pathStroke(s, () => {
              const a = s.points[i-1], b = s.points[i];
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            });
          }
          // send those to server now that we have the real id
          ws.send(JSON.stringify({ type:"add_points", room, strokeId: currentId, points: pendingPoints }));
          pendingPoints = [];
        }
        localTempStroke = null; // no longer needed; we now have the real stroke object in strokes[]
      }
      break;
    }

    case "add_points": {
      const s = strokes.find(st => st.id === msg.strokeId && !st.removed);
      if (!s) return;
      s.points.push(...msg.points);
      // draw the last segment(s)
      for (let i = Math.max(1, s.points.length - msg.points.length); i < s.points.length; i++) {
        const a = s.points[i-1], b = s.points[i];
        pathStroke(s, () => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); });
      }
      break;
    }

    case "end_stroke":
      // nothing client must do; stroke already drawn
      break;

    case "remove_stroke": {
      const s = strokes.find(st => st.id === msg.strokeId);
      if (s) { s.removed = true; redraw(); }
      break;
    }

    case "restore_stroke": {
      const idx = strokes.findIndex(st => st.id === msg.stroke.id);
      if (idx >= 0) strokes[idx] = msg.stroke; else strokes.push(msg.stroke);
      redraw();
      break;
    }

    case "clear":
      strokes.splice(0, strokes.length);
      redraw();
      break;

    case "cursor":
      renderCursor(msg.userId, msg.x, msg.y);
      break;
  }
});

// --- Pointer helpers ---
function toCanvas(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Start drawing: DO NOT create an id here. Wait for server's begin_stroke echo.
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  drawing = true;
  currentId = null;             // will be set when server echoes
  pendingPoints = [];
  const { x, y } = toCanvas(e);

  const strokeMeta = {
    color: colorInp.value,
    size: Number(sizeInp.value),
    tool: toolSel.value as Tool
  };

  // local temp stroke so user sees ink immediately
  localTempStroke = { id: "temp", userId, ...strokeMeta, points: [] };
  localTempStroke.points.push({ x, y, t: performance.now() });

  // ask server to start a stroke; it will broadcast back the real id
  ws.send(JSON.stringify({ type:"begin_stroke", room, stroke: strokeMeta }));
});

canvas.addEventListener("pointermove", (e) => {
  const { x, y } = toCanvas(e);
  renderCursor(userId, x, y);
  if (!drawing) return;

  const p = { x, y, t: performance.now() };

  if (currentId) {
    // We know the server id → add to the real stroke & buffer to send
    const s = strokes.find(st => st.id === currentId && !st.removed);
    if (s) {
      const last = s.points[s.points.length - 1];
      s.points.push(p);
      // draw segment live
      pathStroke(s, () => { ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); });
      pendingPoints.push(p);
    }
  } else if (localTempStroke) {
    // No server id yet → draw locally and queue points
    const last = localTempStroke.points[localTempStroke.points.length - 1];
    localTempStroke.points.push(p);
    pathStroke(localTempStroke, () => { ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); });
    pendingPoints.push(p);
  }
});

["pointerup","pointercancel","pointerleave"].forEach(evt =>
  canvas.addEventListener(evt as any, () => finishStroke())
);

function finishStroke() {
  if (!drawing) return;
  drawing = false;

  if (currentId) {
    ws.send(JSON.stringify({ type:"end_stroke", room, strokeId: currentId }));
  }
  // clear temp locals
  currentId = null;
  pendingPoints = [];
  localTempStroke = null;
}

// --- Drawing helpers ---
function pathStroke(s: Stroke, cb: () => void) {
  ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = s.size;
  ctx.strokeStyle = s.color;
  ctx.beginPath();
  cb();
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function redraw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (const s of strokes) {
    if (s.removed || s.points.length < 2) continue;
    pathStroke(s, () => {
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    });
  }
}

// send buffered points ~60fps (only if we already have the real server id)
setInterval(() => {
  if (pendingPoints.length && currentId) {
    ws.send(JSON.stringify({ type:"add_points", room, strokeId: currentId, points: pendingPoints }));
    pendingPoints = [];
  }
}, 16);

// --- Toolbar actions ---
undoBtn.onclick = () => ws.send(JSON.stringify({ type:"undo", room, userId }));
redoBtn.onclick = () => ws.send(JSON.stringify({ type:"redo", room, userId }));
clearBtn.onclick = () => {
  if (confirm("Clear the canvas for everyone?")) ws.send(JSON.stringify({ type:"clear", room }));
};

// --- Remote cursor rendering ---
function renderCursor(id:string, x:number, y:number) {
  let c = cursors.get(id);
  if (!c) {
    const el = document.createElement("div");
    el.className = "cursor";
    el.textContent = id === userId ? "You" : id.slice(0,6);
    document.body.appendChild(el);
    c = { el, x, y };
    cursors.set(id, c);
  }
  c.x = x; c.y = y;
  const toolbarHeight = 54;
  c.el.style.left = `${x}px`;
  c.el.style.top = `${y + toolbarHeight}px`;
  ws.send(JSON.stringify({ type:"cursor", room, userId, x, y }));
}
