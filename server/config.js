import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

export function readAIConfig(root = process.cwd(), environment = process.env) {
  let local = {};
  try { local = parse(readFileSync(resolve(root, '.env.local'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read local AI configuration.'); }
  return { apiKey: (environment.OPENAI_API_KEY ?? local.OPENAI_API_KEY ?? '').trim() };
}

export const models = Object.freeze({ reasoning: 'gpt-6-astra', image: 'gpt-image-2' });
