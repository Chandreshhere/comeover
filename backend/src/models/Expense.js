'use strict';
// expenses ← expenses + expense_items + item_assignments + expense_shares (embedded).
// SplitMate is a LEDGER ONLY: no custody, no wallet; user-marked payments are never bank-confirmed.
const { makeSchema, sub, uuid, model } = require('./_base');

const AssigneeSchema = sub({
  userId: { type: String, required: true },
  shareRatio: { type: Number, default: 1, min: 0.001 },
});

const ItemSchema = new (require('mongoose').Schema)(
  {
    _id: { type: String, default: uuid },
    label: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    quantity: { type: Number, default: 1, min: 1 },
    assignees: { type: [AssigneeSchema], default: [] },
  },
  { id: false, versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);

const ShareSchema = sub({
  userId: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 0 },
  state: { type: String, enum: ['unsettled', 'marked_paid', 'confirmed', 'disputed'], default: 'unsettled' },
  paymentReference: { type: String, default: null },
  settlementIntentAt: { type: Date, default: null },
  confirmedBy: { type: String, default: null },
  confirmedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
});

const ExpenseSchema = makeSchema({
  creatorUserId: { type: String, required: true },
  activityId: { type: String, default: null },
  description: { type: String, required: true, maxlength: 120 },
  currency: { type: String, default: 'INR', minlength: 3, maxlength: 3 },
  totalMinor: { type: Number, required: true, min: 1 },
  splitMethod: { type: String, enum: ['equal', 'custom', 'itemised', 'percentage'], required: true },
  payeeUserId: { type: String, default: null },
  payeeUpiVpa: { type: String, default: null }, // public VPA for deep links only — never PINs/credentials
  receiptKey: { type: String, default: null },
  idempotencyKey: { type: String, default: undefined },
  items: { type: [ItemSchema], default: [] },
  shares: { type: [ShareSchema], default: [] },
});
ExpenseSchema.index({ creatorUserId: 1, createdAt: -1 });
ExpenseSchema.index({ 'shares.userId': 1, createdAt: -1 });
ExpenseSchema.index({ activityId: 1 }, { partialFilterExpression: { activityId: { $type: 'string' } } });
ExpenseSchema.index({ creatorUserId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

module.exports = model('Expense', ExpenseSchema, 'expenses');
