import request from 'supertest';
import app from '../app';

// Mock the controllers so we don't need Prisma or Redis
jest.mock('../controllers/sos.controller', () => ({
  triggerSOS: (req: any, res: any) => {
    if (!req.body.patientId) return res.status(400).json({ error: 'Missing required fields' });
    res.status(201).json({ message: 'SOS Alert dispatched successfully' });
  },
  updateSOSStatus: (req: any, res: any) => {
    res.status(200).json({ status: req.body.status });
  }
}));

jest.mock('../controllers/checkout.controller', () => ({
  processCheckout: (req: any, res: any) => {
    if (!req.body.items) return res.status(400).json({ error: 'Invalid checkout payload' });
    res.status(200).json({ message: 'Checkout processed successfully', orderId: 'test' });
  }
}));

describe('App Endpoints Integration Tests', () => {
  it('should return 200 OK for /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'OK', message: 'Medigo Backend is running' });
  });

  it('should trigger SOS successfully', async () => {
    const response = await request(app)
      .post('/api/v1/sos/trigger')
      .send({ patientId: '123', latitude: 10, longitude: 10 });
    expect(response.status).toBe(201);
  });

  it('should fail SOS trigger on missing fields', async () => {
    const response = await request(app)
      .post('/api/v1/sos/trigger')
      .send({ latitude: 10, longitude: 10 });
    expect(response.status).toBe(400);
  });

  it('should update SOS status', async () => {
    const response = await request(app)
      .patch('/api/v1/sos/alert_123/status')
      .send({ status: 'DISPATCHED' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISPATCHED');
  });

  it('should process checkout successfully', async () => {
    const response = await request(app)
      .post('/api/v1/ecommerce/checkout')
      .send({ items: [{ sku: 'TEST' }] });
    expect(response.status).toBe(200);
  });

  it('should fail checkout without items', async () => {
    const response = await request(app)
      .post('/api/v1/ecommerce/checkout')
      .send({});
    expect(response.status).toBe(400);
  });
});
