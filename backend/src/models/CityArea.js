'use strict';
// city_areas — manual (location-off) discovery areas with centroids.
const { makeSchema, pointSchema, model } = require('./_base');

const CityAreaSchema = makeSchema({
  city: { type: String, required: true },
  name: { type: String, required: true },
  centroid: { type: pointSchema, required: true },
  active: { type: Boolean, default: true },
});
CityAreaSchema.index({ city: 1, name: 1 }, { unique: true });
CityAreaSchema.index({ centroid: '2dsphere' });

module.exports = model('CityArea', CityAreaSchema, 'city_areas');
