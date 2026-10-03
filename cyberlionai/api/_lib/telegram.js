import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mod = require('./telegram.cjs');
export default mod;
export const send = mod.send;
export const sendMessage = mod.sendMessage || mod.send;
export const notify = mod.notify || mod.send;
