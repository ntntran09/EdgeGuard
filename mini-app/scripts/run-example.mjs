const aliases = {
  example_1: 'stranger',
  example_2: 'open_rfid',
  example_3: 'suspicious_object',
  example_4: 'configure_rfid',
  blocked_camera: 'blocked_camera',
  configure_rfid: 'configure_rfid',
  open_rfid: 'open_rfid',
  stranger: 'stranger',
  suspicious_object: 'suspicious_object',
};

const requested = process.argv[2] || 'example_1';
const flow = aliases[requested];

if (!flow) {
  console.error(`Unknown example flow: ${requested}`);
  console.error(`Available: ${Object.keys(aliases).join(', ')}`);
  process.exit(1);
}

process.env.EXAMPLE_FLOW = flow;
process.env.NEXT_PUBLIC_EXAMPLE_FLOW = flow;
process.env.TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED || 'true';
process.env.NEXT_PUBLIC_AI_MODEL_READY = process.env.NEXT_PUBLIC_AI_MODEL_READY || 'true';

console.log(`[Example] Starting EdgeGuard demo flow: ${requested} -> ${flow}`);
await import('../server.js');
