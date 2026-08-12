import { Request, Response } from 'express';
import { triggerSOS } from '../sos.controller';

// Mock dependencies
jest.mock('@prisma/client', () => {
  const mPrismaClient = {
    $queryRaw: jest.fn(),
    sOSAlert: {
      create: jest.fn(),
    },
    patientHealthRecord: {
      findUnique: jest.fn(),
    }
  };
  return { PrismaClient: jest.fn(() => mPrismaClient) };
});

jest.mock('../../gateways/websocket.gateway', () => {
  return {
    getSocketGateway: jest.fn(() => ({
      of: jest.fn().mockReturnValue({
        to: jest.fn().mockReturnValue({
          emit: jest.fn()
        })
      })
    }))
  };
});

describe('SOS Controller', () => {
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

  it('should return 400 if fields are missing', async () => {
    mockRequest.body = {};
    await triggerSOS(mockRequest as Request, mockResponse as Response);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
  });

  it('should successfully trigger SOS and notify nearest hospitals', async () => {
    mockRequest.body = {
      patientId: 'patient_123',
      latitude: 28.7,
      longitude: 77.1
    };

    // Mock PostGIS raw query response
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'hospital_1', name: 'Apollo', distance: 1200 }
    ]);

    // Mock SOS Alert creation
    prismaMock.sOSAlert.create.mockResolvedValue({
      id: 'alert_1',
      patientId: 'patient_123',
      hospitalId: 'hospital_1',
      status: 'PENDING'
    });

    // Mock EHR findUnique
    prismaMock.patientHealthRecord.findUnique.mockResolvedValue({
      id: 'record_123',
      userId: 'patient_123'
    });

    await triggerSOS(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(201);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'SOS Alert dispatched successfully'
    }));
  });
});
