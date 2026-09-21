# NilamburWorld

Open-world 3D exploration of Nilambur, Kerala (Three.js) with live multiplayer chat, friends and private chat.

## Run it (with multiplayer)

```
npm install        # first time only (installs the "ws" WebSocket library)
node server.js     # serves the game AND the multiplayer backend on port 8000
```

Open http://localhost:8000. The console also prints a `http://<your-ip>:8000` address:
anyone on the same Wi-Fi / network can open that address, pick a name and play with you.

To play with people who are **not** on your network, the server has to be reachable from the internet.

### Going public

**Permanent (recommended): host it on Render** - free plan, no credit card.
1. Sign in at https://render.com with your GitHub account.
2. New > Blueprint > choose this repository. `render.yaml` sets everything up (`npm install`, `node server.js`).
3. When it is live you get an address like `https://nilamburworld.onrender.com`. Share it: anyone who opens it
   plays the game with chat, friends and private messages.
4. To make the GitHub Pages copy connect to it as well:
   ```
   node set-server.js https://nilamburworld.onrender.com
   git add server.json && git commit -m "Point site at game server" && git push
   ```
   (the Pages copy then reads `server.json` to find the server).

Notes: on Render's free plan the server sleeps after ~15 minutes without visitors (the first load then takes
~30 s) and its disk is wiped on restart, so friend lists and private history reset. Add a paid disk and set
`DATA_DIR` to its mount path to keep them. Any other host that runs Node works the same way (set `PORT` if the
host requires it).

**Temporary:** any tunnel tool that forwards a public HTTPS address to `localhost:8000` works while your computer
is on; share the tunnel address. The server has per-address limits on connections and new accounts.

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
