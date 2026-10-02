process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://mesa:mesa@localhost:5433/mesa_a_dois_test?schema=public';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.LOGIN_MAX_ATTEMPTS = '5';

process.env.REQUIRE_2FA = 'false';
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = 'tmp-test-uploads';
process.env.PUBLIC_BASE_URL = '';
process.env.GEOIP_ENABLED = 'false';
