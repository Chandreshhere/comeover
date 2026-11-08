'use strict';
// Shared model helpers.
//  - _id is a string UUID (crypto.randomUUID) so API ids keep the same shape
//    the mobile/admin clients already use.
//  - toJSON exposes `id` (and drops `_id`); `lean()` results still have `_id`.
//  - createdAt / updatedAt timestamps by default.
const crypto = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;
const uuid = () => crypto.randomUUID();

function toJSONTransform(doc, ret) {
  ret.id = ret._id;
  delete ret._id;
  return ret;
}

function makeSchema(definition, options = {}) {
  const { timestamps = true, ...rest } = options;
  return new Schema(
    { _id: { type: String, default: uuid }, ...definition },
    {
      timestamps,
      versionKey: false,
      minimize: false,
      id: false,
      toJSON: { virtuals: true, transform: toJSONTransform },
      ...rest,
    }
  );
}

// Embedded sub-document schema without its own _id.
const sub = (definition, options = {}) => new Schema(definition, { _id: false, id: false, minimize: false, ...options });

// GeoJSON point. Leave the whole field undefined when there are no coordinates
// (a 2dsphere index rejects half-filled points).
const pointSchema = sub({
  type: { type: String, enum: ['Point'], required: true, default: 'Point' },
  coordinates: { type: [Number], required: true }, // [lng, lat]
});

const toPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) ? { type: 'Point', coordinates: [Number(lng), Number(lat)] } : undefined;

function model(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

module.exports = { mongoose, Schema, Mixed: Schema.Types.Mixed, uuid, makeSchema, sub, pointSchema, toPoint, model };
