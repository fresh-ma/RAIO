import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const MAAS_API_URL = process.env.MAAS_API_URL || 'https://api.modelarts-maas.com/v2/chat/completions';
export const MAAS_MODEL = process.env.MAAS_MODEL || 'deepseek';
export const JWT_SECRET = process.env.JWT_SECRET || 'raio-secret-2026';
export const PORT = parseInt(process.env.PORT || '3001');

function agentRuntime(agentKey, aliases = []) {
  const keys = [agentKey.toUpperCase(), ...aliases.map(a => a.toUpperCase())];
  const pick = (prefix, fallback) => {
    for (const key of keys) {
      const value = process.env[`${prefix}_${key}`];
      if (value) return value;
    }
    return fallback;
  };

  return {
    apiUrl: pick('MAAS_API_URL', MAAS_API_URL),
    model: pick('MAAS_MODEL', MAAS_MODEL),
  };
}

export const AGENT_RUNTIMES = {
  lumo: agentRuntime('lumo', ['router']),
  hoot: agentRuntime('hoot', ['router']),
  bookworm: agentRuntime('bookworm', ['paper']),
  scholar: agentRuntime('scholar', ['learn']),
  bloom: agentRuntime('bloom', ['life']),
  gears: agentRuntime('gears', ['server', 'code']),
};
