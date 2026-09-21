'use strict';
// Publish the address of your hosted game server so the GitHub Pages copy of the game can find it:
//   node set-server.js https://your-app.onrender.com
// writes server.json ({"url": "wss://your-app.onrender.com/ws"}); commit and push it to update the site.
const fs = require('fs');
const arg = process.argv[2];
if (!arg || !/^https?:\/\/[^\s/]+/i.test(arg)) {
  console.error('Usage: node set-server.js https://your-server-address');
  process.exit(1);
}
const u = new URL(arg);
const url = (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws';
fs.writeFileSync(__dirname + '/server.json', JSON.stringify({ url: url }, null, 2) + '\n');
console.log('server.json now points at ' + url);
console.log('Next: git add server.json && git commit -m "Point site at game server" && git push');
