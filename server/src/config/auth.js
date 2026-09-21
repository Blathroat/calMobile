const PLACEHOLDER_SECRET = /^(your_|replace-with|change-me)/i;
const MIN_SECRET_LENGTH = 32;

function readSecret(name) {
  const value = process.env[name];
  if (!value || value.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRET.test(value)) {
    throw new Error(`${name} must be a non-placeholder secret of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return value;
}

module.exports = {
  accessSecret: readSecret('JWT_SECRET'),
  refreshSecret: readSecret('JWT_REFRESH_SECRET'),
  accessExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
};
