'use strict';
// Test environment — require this FIRST in every test file (config is read at require time).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-0123456789';
process.env.SLIDE_API_KEY = process.env.SLIDE_API_KEY || 'sk_test_unit';
process.env.SLIDE_OTP_WIDGET_ID = process.env.SLIDE_OTP_WIDGET_ID || 'wgt_unit';
process.env.SLIDE_BASE_URL = 'https://slide.test';
process.env.JOBS_ENABLED = 'false';
process.env.REALTIME_CHANGE_STREAMS = 'false';
