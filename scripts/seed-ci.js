#!/usr/bin/env node
/**
 * seed-ci.js
 * Seeds the test database with products for CI/CD pipeline runs.
 * Uses the existing productSeeds.js — just wires up the DB connection.
 */

const mongoose = require('../backend/node_modules/mongoose');
const seedDB = require('../backend/seed/productSeeds');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ecom_test';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB:', MONGO_URI);
    const result = await seedDB({ force: true, skipIfExists: false });
    console.log(`✅ Test database seeded successfully — inserted ${result.inserted} products`);
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  });
