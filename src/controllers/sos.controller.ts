import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getSocketGateway } from '../gateways/websocket.gateway';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Helper to simulate AES-256 decryption/encryption for the EHR link
function generateSecureEHRToken(patientRecordId: string): string {
  const secretKey = process.env.EHR_SECRET_KEY || 'default_secret_key_32_bytes_long';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey), iv);
  let encrypted = cipher.update(JSON.stringify({ recordId: patientRecordId, exp: Date.now() + 3600000 }), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export const triggerSOS = async (req: Request, res: Response) => {
  try {
    const { patientId, latitude, longitude } = req.body;

    if (!patientId || !latitude || !longitude) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Find nearest 3 hospitals using PostGIS
    // We use raw query because Prisma's native geospatial support is limited
    const nearestHospitals = await prisma.$queryRaw<
      Array<{ id: string; name: string; distance: number }>
    >`
      SELECT 
        id, 
        name, 
        ST_DistanceSphere(location, ST_MakePoint(${longitude}, ${latitude})) AS distance
      FROM "Hospital"
      WHERE "isActive" = true
      ORDER BY location <-> ST_MakePoint(${longitude}, ${latitude})
      LIMIT 3;
    `;

    if (!nearestHospitals || nearestHospitals.length === 0) {
      return res.status(404).json({ error: 'No active hospitals found nearby' });
    }

    // 2. Lock emergency slot (Create an SOS Alert for the nearest one for now)
    // In a real system, you might broadcast to all 3 and assign to the first to accept.
    const primaryHospital = nearestHospitals[0];
    
    const sosAlert = await prisma.sOSAlert.create({
      data: {
        patientId,
        hospitalId: primaryHospital.id,
        status: 'PENDING',
        patientLat: latitude,
        patientLng: longitude,
      }
    });

    // 3. Generate Encrypted EHR Link
    const patientRecord = await prisma.patientHealthRecord.findUnique({
      where: { userId: patientId }
    });
    
    let ehrToken = null;
    if (patientRecord) {
      ehrToken = generateSecureEHRToken(patientRecord.id);
    }

    const payload = {
      alertId: sosAlert.id,
      patientId,
      latitude,
      longitude,
      ehrLink: ehrToken ? `https://api.medigo.com/v1/ehr/secure-access?token=${ehrToken}` : null
    };

    // 4. Push Real-Time Alert to the 3 nearest hospitals via WebSocket
    const io = getSocketGateway();
    nearestHospitals.forEach((hospital) => {
      io.of('/sos-emergency').to(`hospital_${hospital.id}`).emit('emergency_sos_received', payload);
    });

    return res.status(201).json({
      message: 'SOS Alert dispatched successfully',
      alert: sosAlert,
      notifiedHospitals: nearestHospitals
    });

  } catch (error) {
    console.error('SOS Dispatch Error:', error);
    return res.status(500).json({ error: 'Internal server error during SOS dispatch' });
  }
};

export const updateSOSStatus = async (req: Request, res: Response) => {
  try {
    const { alertId } = req.params;
    const { status } = req.body; // e.g., DISPATCHED, RESOLVED
    
    const updatedAlert = await prisma.sOSAlert.update({
      where: { id: alertId },
      data: {
        status,
        ...(status === 'DISPATCHED' ? { dispatchedAt: new Date() } : {}),
        ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      }
    });

    const io = getSocketGateway();
    io.of('/sos-emergency').to(`patient_${updatedAlert.patientId}`).emit('sos_status_updated', {
      alertId,
      status
    });

    return res.status(200).json(updatedAlert);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update SOS status' });
  }
};
