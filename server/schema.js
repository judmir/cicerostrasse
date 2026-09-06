import { z } from 'zod';

const description = z.string().min(1).max(400);
export const styleSpecSchema = z.object({
  styleName: z.string().min(1).max(100),
  palette: z.array(z.object({ color: description, hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: description }).strict()).min(1).max(12),
  materials: z.array(z.object({
    surface: z.enum(['walls', 'ceiling', 'floor', 'woodwork', 'upholstery', 'metal', 'glass', 'existing_decor']),
    material: description, texture: description, finish: description,
  }).strict()).max(16),
  lightingMood: z.object({ temperature: description, contrast: description, mood: description }).strict(),
}).strict();

export const geometrySchema = z.object({
  status: z.enum(['no_changes_detected', 'changes_detected', 'uncertain']),
  findings: z.array(z.object({
    category: z.enum(['architecture', 'object_count', 'shape', 'position', 'camera', 'framing']),
    description,
  }).strict()).max(20),
}).strict();
