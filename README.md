# NilamburWorld

Open-world 3D exploration of Nilambur, Kerala (Three.js) with live multiplayer chat, friends and private chat.

## Run it (with multiplayer)

```
npm install        # first time only (installs the "ws" WebSocket library)
node server.js     # serves the game AND the multiplayer backend on port 8000
```

Open http://localhost:8000. The console also prints a `http://<your-ip>:8000` address:
anyone on the same Wi-Fi / network can open that address, pick a name and play with you.

To play with people who are **not** on your network, run the server somewhere public
(any host that runs Node, e.g. Render, Railway, Fly.io, a VPS - set `PORT` if the host requires it),
or expose your local server with a tunnel. Then share that address.

## Multiplayer features

- **Lobby chat** - every message is seen by everyone online.
- **Friends** - add a friend by their explorer name; they get a request they can accept or decline.
- **Private chat** - friends can message each other in a private tab. The server only delivers these
  messages to the two people involved; nobody else can see or read them.
- **Play together** - all online explorers show up in the world with name tags (friends are starred
  and gold on the minimap). Press the pin button next to a friend to jump to them.
- Your name is protected by a secret token kept in your browser, so nobody else can take it.
  Friends and private chat history are stored in `data/users.json` (never served over HTTP).

## Panels

Every side panel (Quests, Fast Travel, GPS Minimap, Weather & Time, Friends, Chat) has a **-** button
to minimise it. Your choice is remembered.

## Static hosting (GitHub Pages)

Pages only serves files, so the game runs there but without multiplayer (chat says "offline").
To point a Pages copy at a hosted server, open it once with `?server=wss://your-server/ws`.
