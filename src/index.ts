import http from 'http';
import dotenv from 'dotenv';
import { initWebSocket } from './gateways/websocket.gateway';
import app from './app';

dotenv.config();

const server = http.createServer(app);

// Initialize WebSockets
initWebSocket(server).then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize WebSockets', err);
  process.exit(1);
});
