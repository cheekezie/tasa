// Values the env schema requires; integration tests override MONGODB_URI per suite.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.SAYSWITCH_SECRET_KEY ??= 'sk_test_unit';
process.env.SAYSWITCH_PUBLIC_KEY ??= 'pk_test_unit';
process.env.SAYSWITCH_BASE_URL ??= 'https://sayswitch.test';
process.env.VTPASS_BASE_URL ??= 'https://vtpass.test/api';
process.env.VTPASS_API_KEY ??= 'vt_api_unit';
process.env.VTPASS_PUBLIC_KEY ??= 'PK_unit';
process.env.VTPASS_SECRET_KEY ??= 'SK_unit';
// A Redis db of its own (flushed by the integration suite) so tests never touch dev data.
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15';
process.env.CF_ACCOUNT_ID ??= 'acct';
process.env.R2_ACCESS_KEY_ID ??= 'r2-key-unit';
process.env.R2_SECRET_ACCESS_KEY ??= 'r2-secret-unit';
process.env.R2_BUCKET ??= 'tela-test';
process.env.R2_PUBLIC_URL ??= 'https://cdn.tela.test/';
process.env.BUSINESS_PHONE ??= '08000000000';
