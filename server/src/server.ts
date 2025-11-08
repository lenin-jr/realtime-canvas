import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import crypto from "crypto";

type Point = { x: number; y: number; t: number };
type Tool = "pen" | "eraser";
type Stroke = {
  id: string;
  userId: string;
  color: string;
  size: number;
  tool: Tool;
  points: Point[];
  removed?: boolean;
};

type Msg =
  | { type: "join_room"; room: string; userId: string }
  | { type: "begin_stroke"; room: string; stroke: { color: string; size: number; tool: Tool } }
  | { type: "add_points"; room: string; strokeId: string; points: Point[] }
  | { type: "end_stroke"; room: string; strokeId: string }
  | { type: "undo"; room: string; userId: string }
  | { type: "redo"; room: string; userId: string }
  | { type: "clear"; room: string }
  | { type: "cursor"; room: string; userId: string; x: number; y: number };

type RoomState = {
  strokes: Stroke[];
  userStacks: Record<string, string[]>;
};

const rooms: Record<string, RoomState> = {};

function getRoom(room: string): RoomState {
  if (!rooms[room]) rooms[room] = { strokes: [], userStacks: {} };
  return rooms[room];
}

const server = http.createServer();
const wss = new WebSocketServer({ server });

function broadcast(room: string, data: any, except?: WebSocket) {
  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN && client.room === room && client !== except) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on("connection", (ws) => {
  (ws as any).room = "default";
  (ws as any).userId = crypto.randomUUID();

  ws.on("message", (raw) => {
    let msg: Msg;
    try {
      msg = JSON.parse(raw.toString());
      
    } catch {
      return;
    }

    if (msg.type === "join_room") {
      (ws as any).room = msg.room;
      (ws as any).userId = msg.userId || (ws as any).userId;
      const state = getRoom(msg.room);
      ws.send(JSON.stringify({ type: "room_state", state }));
      return;
    }

    const room = (ws as any).room;
    const state = getRoom(room);

    switch (msg.type) {
      case "begin_stroke": {
        const id = crypto.randomUUID();
        const s: Stroke = {
          id,
          userId: (ws as any).userId,
          color: msg.stroke.color,
          size: msg.stroke.size,
          tool: msg.stroke.tool,
          points: [],
        };
        state.strokes.push(s);
        (state.userStacks[s.userId] ||= []).push(id);

        const payload = { type: "begin_stroke", stroke: { ...s, points: [] } };
        broadcast(room, payload);
        (ws as any).send(JSON.stringify(payload));
        break;
      }
      case "add_points": {
        const s = state.strokes.find((st) => st.id === msg.strokeId && !st.removed);
        if (!s) return;
        const pts = msg.points.slice(0, 200);
        s.points.push(...pts);
        broadcast(room, { type: "add_points", strokeId: s.id, points: pts }, ws);
        break;
      }
      case "end_stroke": {
        broadcast(room, { type: "end_stroke", strokeId: msg.strokeId }, ws);
        break;
      }
      case "undo": {
        const stack = state.userStacks[msg.userId] || [];
        while (stack.length) {
          const id = stack.pop()!;
          const s = state.strokes.find((st) => st.id === id && !st.removed);
          if (s) {
            s.removed = true;
            broadcast(room, { type: "remove_stroke", strokeId: id });
            break;
          }
        }
        break;
      }
      case "redo": {
        const idx = [...state.strokes]
          .reverse()
          .findIndex((st) => st.userId === msg.userId && st.removed);
        if (idx !== -1) {
          const s = [...state.strokes].reverse()[idx];
          s.removed = false;
          (state.userStacks[msg.userId] ||= []).push(s.id);
          broadcast(room, { type: "restore_stroke", stroke: s });
        }
        break;
      }
      case "clear": {
        state.strokes = [];
        state.userStacks = {};
        broadcast(room, { type: "clear" });
        break;
      }
      case "cursor": {
        broadcast(room, { type: "cursor", userId: msg.userId, x: msg.x, y: msg.y }, ws);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`WS server listening on :${PORT}`));
