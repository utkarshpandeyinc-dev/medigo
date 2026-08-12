import { Request, Response } from 'express';
import { processCheckout } from '../checkout.controller';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mPrismaClient = {
    $transaction: jest.fn(),
    inventory: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      create: jest.fn(),
      update: jest.fn(),
    },
    platformTransaction: {
      create: jest.fn(),
    }
  };
  return { PrismaClient: jest.fn(() => mPrismaClient) };
});

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'secret_test_123'
      })
    }
  }));
});

describe('Checkout Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let prismaMock: any;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const { PrismaClient } = require('@prisma/client');
    prismaMock = new PrismaClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if checkout payload is invalid', async () => {
    mockRequest.body = {
      patientId: 'patient_1' // missing items, pharmacyId
    };

    await processCheckout(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid checkout payload' });
  });

  it('should successfully process checkout using mock transaction', async () => {
    mockRequest.body = {
      patientId: 'patient_1',
      pharmacyId: 'pharmacy_1',
      items: [{ sku: 'PARACETAMOL', quantity: 2 }],
      paymentMethod: 'UPI',
      deliveryDistanceKm: 2 // 2km -> 20 + (2*5) = 30 delivery fee
    };

    // The checkout controller uses $transaction which takes a callback.
    // We will simulate the callback execution.
    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      // Mock the tx (transaction context) to have the same methods as prismaMock
      const tx = {
        inventory: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv_1',
            sku: 'PARACETAMOL',
            quantity: 10,
            price: 50
          }),
          update: jest.fn()
        },
        order: {
          create: jest.fn().mockResolvedValue({
            id: 'order_1',
            subtotal: 100, // 50 * 2
            deliveryFee: 30,
            platformFee: 10,
            discount: 5, // 5% of 100
            total: 135
          })
        },
        platformTransaction: {
          create: jest.fn()
        }
      };
      
      return await callback(tx);
    });

    await processCheckout(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Checkout processed successfully',
      orderId: 'order_1',
      clientSecret: 'secret_test_123',
    }));
  });
});
