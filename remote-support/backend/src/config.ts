const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: required('JWT_SECRET'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  turn: {
    url: process.env.TURN_URL,
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  },
};
