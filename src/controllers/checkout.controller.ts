import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key', {
  apiVersion: '2023-10-16' as any,
});

const PLATFORM_FEE = 10.0;

export const processCheckout = async (req: Request, res: Response) => {
  try {
    const { patientId, pharmacyId, items, paymentMethod, deliveryDistanceKm } = req.body;

    if (!patientId || !pharmacyId || !items || items.length === 0) {
      return res.status(400).json({ error: 'Invalid checkout payload' });
    }

    // Start a transaction to ensure stock is checked and decremented safely
    const result = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const orderItemsData = [];

      // 1. Verify and decrement stock for each item
      for (const item of items) {
        const inventory = await tx.inventory.findUnique({
          where: {
            pharmacyId_sku: {
              pharmacyId,
              sku: item.sku,
            }
          }
        });

        if (!inventory || inventory.quantity < item.quantity) {
          throw new Error(`Insufficient stock for SKU: ${item.sku}`);
        }

        // Decrement stock
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: inventory.quantity - item.quantity }
        });

        const itemTotal = inventory.price * item.quantity;
        subtotal += itemTotal;

        orderItemsData.push({
          sku: item.sku,
          quantity: item.quantity,
          price: inventory.price,
        });
      }

      // 2. Dynamic Pricing Math
      // Base delivery fee = ₹20 + ₹5 per km
      const deliveryFee = 20.0 + (deliveryDistanceKm * 5.0);
      
      // Discount Engine
      let discount = 0;
      if (paymentMethod === 'UPI') {
        discount = subtotal * 0.05; // 5% discount for UPI
      }

      const total = subtotal + deliveryFee + PLATFORM_FEE - discount;

      // 3. Create the Order
      const order = await tx.order.create({
        data: {
          patientId,
          pharmacyId,
          status: 'PENDING',
          subtotal,
          deliveryFee,
          platformFee: PLATFORM_FEE,
          discount,
          total,
          items: {
            create: orderItemsData
          }
        },
        include: { items: true }
      });

      // 4. Split Revenue Calculation
      const pharmacyShare = subtotal - discount; // Pharmacy absorbs the discount in this model
      const deliveryShare = deliveryFee;
      const platformShare = PLATFORM_FEE;

      await tx.platformTransaction.create({
        data: {
          orderId: order.id,
          totalAmount: total,
          pharmacyShare,
          platformShare,
          deliveryShare,
        }
      });

      return { order, total, pharmacyShare, deliveryShare, platformShare };
    });

    // 5. Payment Intent via Stripe
    // For a real implementation, we use Stripe Connect to route funds to the Pharmacy's connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(result.total * 100), // Stripe expects amounts in the smallest currency unit (paise/cents)
      currency: 'inr',
      transfer_data: {
        // Ideally fetch the pharmacy's Stripe Connect Account ID
        destination: 'acct_123456789', 
      },
      // Platform keeps the delivery fee (if using own fleet) + platform fee
      application_fee_amount: Math.round((result.platformShare + result.deliveryShare) * 100),
      metadata: {
        orderId: result.order.id
      }
    });

    // Update order with payment intent
    await prisma.order.update({
      where: { id: result.order.id },
      data: { paymentIntentId: paymentIntent.id }
    });

    return res.status(200).json({
      message: 'Checkout processed successfully',
      orderId: result.order.id,
      clientSecret: paymentIntent.client_secret,
      breakdown: {
        subtotal: result.order.subtotal,
        deliveryFee: result.order.deliveryFee,
        platformFee: result.order.platformFee,
        discount: result.order.discount,
        total: result.order.total
      }
    });

  } catch (error: any) {
    console.error('Checkout Error:', error);
    return res.status(400).json({ error: error.message || 'Checkout failed' });
  }
};
