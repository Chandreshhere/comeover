'use strict';
// business_invoices — Razorpay orders for Venue/Club plans (B2B only).
const { makeSchema, model } = require('./_base');

const BusinessInvoiceSchema = makeSchema({
  businessId: { type: String, required: true },
  planCode: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String, default: undefined },
  razorpayPaymentId: { type: String, default: null },
  status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created' },
  paidAt: { type: Date, default: null },
});
BusinessInvoiceSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } });
BusinessInvoiceSchema.index({ businessId: 1, createdAt: -1 });

module.exports = model('BusinessInvoice', BusinessInvoiceSchema, 'business_invoices');
