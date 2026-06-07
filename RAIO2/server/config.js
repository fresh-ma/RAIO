import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const MAAS_API_URL = process.env.MAAS_API_URL || 'https://api.modelarts-maas.com/v2/chat/completions';
export const MAAS_API_KEY = process.env.MAAS_API_KEY || '';
export const MAAS_MODEL = process.env.MAAS_MODEL || 'deepseek';
export const JWT_SECRET = process.env.JWT_SECRET || 'raio-secret-2026';
export const PORT = parseInt(process.env.PORT || '3001');
