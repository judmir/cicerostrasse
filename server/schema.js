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

const placementSchema = z.object({
  id: z.string().min(1).max(100),
  itemType: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  widthM: z.number().positive().max(12),
  depthM: z.number().positive().max(12),
  rotationDeg: z.number().min(0).max(359),
}).strict();

const openingSchema = z.object({
  kind: z.enum(['door', 'window', 'balcony_door']),
  edge: z.enum(['top', 'right', 'bottom', 'left']),
  start: z.number().min(0).max(1),
  end: z.number().min(0).max(1),
}).strict();

export const firstDesignInputSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
  mode: z.enum(['mock', 'real']).optional(),
  operation: z.literal('first_design'),
  room: z.object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    type: z.string().min(1).max(80),
    plan: z.object({
      source: z.enum(['measured_plan', 'relative_only']),
      widthM: z.number().positive().max(50).nullable(),
      depthM: z.number().positive().max(50).nullable(),
      areaM2: z.number().positive().max(1000).nullable(),
      openings: z.array(openingSchema).max(16),
      note: z.string().max(600).nullable(),
    }).strict(),
  }).strict(),
  roomImages: z.array(z.object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(160),
    role: z.enum(['main_view', 'context']),
    image: z.object({ base64: z.string().min(1), mimeType: z.string().min(1).max(100) }).strict(),
  }).strict()).min(1).max(8),
  styleReferences: z.array(z.object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(160),
    image: z.object({ base64: z.string().min(1), mimeType: z.string().min(1).max(100) }).strict(),
  }).strict()).max(6),
  layout: z.object({ version: z.literal(1), placements: z.array(placementSchema).max(40) }).strict(),
  viewpoint: z.object({ sourceImageId: z.string().min(1).max(100), label: z.string().min(1).max(200) }).strict(),
  styleBrief: z.string().trim().min(3).max(1200),
}).strict();

export const firstDesignSpecSchema = z.object({
  conceptName: z.string().min(1).max(100),
  style: styleSpecSchema,
  roomReading: z.object({
    architecture: z.array(description).max(12),
    daylight: z.array(description).max(8),
  }).strict(),
  designIntent: z.string().min(1).max(800),
}).strict();

export const layoutReviewSchema = z.object({
  status: z.enum(['matches_constraints', 'differences_detected', 'uncertain']),
  findings: z.array(z.object({
    category: z.enum(['architecture', 'openings', 'viewpoint', 'placement', 'scale', 'item_count']),
    description,
  }).strict()).max(20),
}).strict();
