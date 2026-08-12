import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import http from 'http';

let io: Server;

export const initWebSocket = async (server: http.Server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Redis Adapter for scaling across multiple Node.js instances
  const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  const subClient = pubClient.duplicate();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis adapter connected successfully.');
  } catch (err) {
    console.warn('⚠️ Could not connect to Redis. Running WebSocket without Redis adapter (local mode only). Please start Docker for full scaling.');
  }

  // Middleware for Authentication
  const authMiddleware = (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth.token || socket.handshake.headers['x-access-token'];
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }
    
    try {
      const decoded = jwt.verify(token as string, process.env.JWT_SECRET || 'super_secret_jwt');
      (socket as any).user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  };

  // Namespace: SOS Emergency
  const sosNamespace = io.of('/sos-emergency');
  sosNamespace.use(authMiddleware);
  sosNamespace.on('connection', (socket) => {
    const user = (socket as any).user;
    
    // Hospitals join their specific room to receive alerts
    if (user.role === 'HOSPITAL_ADMIN' && user.hospitalId) {
      socket.join(`hospital_${user.hospitalId}`);
      console.log(`Hospital ${user.hospitalId} connected to SOS feed`);
    }

    // Patients join to get updates on their own SOS
    if (user.role === 'PATIENT') {
      socket.join(`patient_${user.userId}`);
    }

    socket.on('disconnect', () => {
      console.log(`User ${user.userId} disconnected from SOS feed`);
    });
  });

  // Namespace: Ambulance Telemetry
  const telemetryNamespace = io.of('/ambulance-telemetry');
  telemetryNamespace.use(authMiddleware);
  telemetryNamespace.on('connection', (socket) => {
    const user = (socket as any).user;
    
    socket.on('update_location', (data: { ambulanceId: string, lat: number, lng: number }) => {
      // In real-world, we'd update Redis/DB with current location and broadcast to tracking clients
      socket.broadcast.emit('location_updated', data);
    });
  });

  // Namespace: Inventory Sync (B2B & Retail)
  const inventoryNamespace = io.of('/inventory-sync');
  inventoryNamespace.use(authMiddleware);
  inventoryNamespace.on('connection', (socket) => {
    const user = (socket as any).user;
    
    if (user.role === 'PHARMACY_OWNER' && user.pharmacyId) {
      socket.join(`pharmacy_${user.pharmacyId}`);
    }

    socket.on('stock_update', (data) => {
      // Broadcast to B2B dashboard if stock goes below safety threshold
      socket.to('wholesaler_admins').emit('pharmacy_stock_low', data);
    });
  });

  console.log('WebSocket Gateway Initialized with Redis Adapter');
  return io;
};

export const getSocketGateway = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};
