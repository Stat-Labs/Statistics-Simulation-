import { z } from 'zod'

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number')

export const emailSchema = z
  .string()
  .email('Enter a valid email address')
  .max(254)
  .transform((v) => v.toLowerCase().trim())

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name is required').max(80),
  accountType: z.enum(['personal', 'enterprise']).default('personal'),
  orgName: z.string().trim().min(2, 'Organization name is required').max(80).optional(),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
})

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
})

export const acceptInviteSchema = z.object({
  token: z.string().uuid('Invalid invite token'),
})
