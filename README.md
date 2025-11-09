#  Real-Time Collaborative Drawing Canvas

A web-based **real-time collaborative drawing application** that enables multiple users to draw together on a shared canvas simultaneously.  
Built using **TypeScript**, **Vite**, and **WebSockets**, this project demonstrates seamless real-time communication and event synchronization.


##  Features

 **Live Drawing Sync:**  
Every stroke is instantly shared between all connected users.  

 **Drawing Tools:**  
- Pen & Eraser  
- Adjustable Brush Size  
- Color Picker  
- Undo / Redo / Clear  

 **Room Support:**  
Each unique room ID (e.g., `?room=team1`) opens an independent collaborative space.  

 **Scalable Server:**  
WebSocket backend built with Node.js, capable of handling multiple sessions.  

---

##  Tech Stack

| Layer | Technology |
|--------|-------------|
| **Frontend** | Vite + TypeScript + HTML Canvas API |
| **Backend** | Node.js + WebSocket (`ws`) |
| **Language** | TypeScript |
| **Build Tool** | Vite |
| **Realtime Transport** | Native WebSockets |

---

##  Folder Structure

