import tg from '../api/_lib/telegram.js';
const msg = process.argv[2] || "CyberLion canlı test OK";
const res = await tg.send(msg);
console.log("Gönderildi:", res);
