import express from 'express';
import cors from 'cors';
import { triggerSOS, updateSOSStatus } from './controllers/sos.controller';
import { processCheckout } from './controllers/checkout.controller';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.post('/api/v1/sos/trigger', triggerSOS);
app.patch('/api/v1/sos/:alertId/status', updateSOSStatus);
app.post('/api/v1/ecommerce/checkout', processCheckout);

// Swagger Documentation
try {
  const swaggerDocument = YAML.load(path.join(__dirname, '../docs/swagger.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customSiteTitle: "Medigo API Documentation"
  }));
} catch (e) {
  console.log('Swagger document not found during test run, skipping...');
}

// Basic healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Medigo Backend is running' });
});

export default app;
