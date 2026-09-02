import { Server } from 'socket.io';
import { config } from '../config/index.js';

export function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.frontendOrigin },
  });
  io.on('connection', (socket) => {
    socket.emit('hello', { ok: true, time: Date.now() });
  });
  return io;
}
